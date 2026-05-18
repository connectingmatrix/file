import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseNumberValue, parseRecordValue, parseStringValue } from 'giga-ai-helper/workflow';
import { AttachmentEntity, OrganisationEntity } from '@gigav2/repositories/entities';
import { isCurrentUserRootUser } from '@gigav2/lib/helper';
import { assertFileName, assertWritable } from '@gigav2/services/shared-space/file-ops';
import { hostPath } from '@gigav2/services/shared-space/path';
import { WorkflowNodeStatusEnum, type WorkflowNodeHandler } from '@gigav2/services/workflow/types';

const STORAGE_BUCKET = 'storage';
const fileChecksum = async (path: string) =>
  await new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });

const scopedRoot = (context: Parameters<WorkflowNodeHandler>[0]) => {
  const workflowId = parseStringValue(context.workflow.metadata.id || 'workflow').replace(/[^a-zA-Z0-9_.-]/g, '_');
  const userId = parseStringValue(context.requestContext.userId || 'user').replace(/[^a-zA-Z0-9_.-]/g, '_');
  const root = join(tmpdir(), 'giga-workflow-files', userId, workflowId);
  mkdirSync(root, { recursive: true });
  return root;
};

const scopedPath = (root: string, name: string) => {
  const path = resolve(root, basename(name || `artifact-${Date.now()}`));
  if (!path.startsWith(resolve(root))) throw new Error('Workflow file path escaped the scoped folder.');
  return path;
};

const props = (context: Parameters<WorkflowNodeHandler>[0]) => ({
  ...parseRecordValue(context.input),
  ...parseRecordValue(context.node.properties),
  ...parseRecordValue(context.node.runtime),
});

const flag = (value: unknown): boolean => value === true || parseStringValue(value).toLowerCase() === 'true';

const driveInfo = (context: Parameters<WorkflowNodeHandler>[0], path: string) => {
  const drive = context.settings.sharedDrive;
  if (!drive || !path.startsWith('/drive')) return { path, hostPath: path };
  return { path, hostPath: hostPath(drive.path, path) };
};

const driveWriteAction = (context: Parameters<WorkflowNodeHandler>[0], path: string) => {
  const drive = context.settings.sharedDrive;
  return drive && existsSync(hostPath(drive.path, path)) ? 'update' : 'create';
};

const assertDriveWritable = (access: { quotaBytes: number; root: string; usedBytes: number }, path: string, bytes: number) => {
  const target = hostPath(access.root, path);
  const current = existsSync(target) ? statSync(target).size : 0;
  assertWritable({ ...access, usedBytes: Math.max(0, access.usedBytes - current) }, bytes);
};

const graphContext = async (context: Parameters<WorkflowNodeHandler>[0]) =>
  ({
    effectiveRoot: await isCurrentUserRootUser(context.requestContext.supabase),
    request: context.requestContext.request,
    supabase: context.requestContext.supabase,
    userId: context.requestContext.userId,
  } as any);

const workflowOrganizationId = (context: Parameters<WorkflowNodeHandler>[0]) =>
  parseStringValue(context.workflow.metadata.organizationId || parseRecordValue(context.workflow.metadata.scope).organizationId).trim();

const sharedSpace = (organizationId: string) => (OrganisationEntity.load(organizationId) as OrganisationEntity).sharedSpace;

const copySource = async (source: string, target: string, allowLocalFile: boolean) => {
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const response = await fetch(source);
    if (!response.ok || !response.body) throw new Error(`Download failed with status ${response.status}.`);
    await pipeline(Readable.fromWeb(response.body as any), createWriteStream(target));
    return;
  }
  const path = source.startsWith('file://') ? new URL(source).pathname : source;
  if (!allowLocalFile || !existsSync(path)) throw new Error('Workflow File Download requires an http(s) URL or allowed local file.');
  await pipeline(createReadStream(path), createWriteStream(target));
};

export const executeWorkflowFileDownloadNode: WorkflowNodeHandler = async (context) => {
  const values = props(context);
  const source = parseStringValue(values.url || values.sourceUrl || values.sourceFile).trim();
  if (!source) return { output: { error: 'url is required.' }, status: WorkflowNodeStatusEnum.Failed, logs: ['url is required.'] };
  const root = scopedRoot(context);
  if (parseStringValue(values.destination || values.target).trim() === 'drive') {
    if (!context.settings.sharedDrive) throw new Error('Workflow shared drive mount is not available.');
    const organizationId = parseStringValue(values.organizationId || workflowOrganizationId(context)).trim();
    const drivePath = parseStringValue(
      values.drivePath || values.path || `/drive/${parseStringValue(values.fileName || basename(source)).trim()}`,
    ).trim();
    if (!source.startsWith('http://') && !source.startsWith('https://')) {
      assertFileName(drivePath);
      const ref = driveInfo(context, drivePath);
      const localSource = source.startsWith('file://') ? new URL(source).pathname : source;
      if (!flag(values.allowLocalFile) || !existsSync(localSource))
        throw new Error('Workflow File Download requires an http(s) URL or allowed local file.');
      if (existsSync(ref.hostPath)) {
        const existingChecksum = await fileChecksum(ref.hostPath);
        if (!parseStringValue(values.checksum).trim() || existingChecksum === parseStringValue(values.checksum).trim()) {
          const stats = statSync(ref.hostPath);
          return {
            output: {
              fileRef: {
                path: ref.path,
                hostPath: ref.hostPath,
                checksum: existingChecksum,
                size: stats.size,
                extension: extname(ref.path),
                scopedRoot: '/drive',
              },
              checksum: existingChecksum,
              size: stats.size,
              cached: true,
            },
            status: WorkflowNodeStatusEnum.Passed,
            logs: ['Shared drive file reused.'],
          };
        }
      }
      const requestContext = await graphContext(context);
      await sharedSpace(organizationId).workflowDrive(requestContext);
      const summary = await sharedSpace(organizationId).summary(requestContext);
      assertDriveWritable(
        { quotaBytes: summary.quotaBytes, root: context.settings.sharedDrive.path, usedBytes: summary.usedBytes },
        drivePath,
        statSync(localSource).size,
      );
      mkdirSync(dirname(ref.hostPath), { recursive: true, mode: 0o700 });
      await copySource(source, ref.hostPath, true);
      const stats = statSync(ref.hostPath);
      const checksum = await fileChecksum(ref.hostPath);
      if (parseStringValue(values.checksum).trim() && parseStringValue(values.checksum).trim() !== checksum)
        throw new Error('File checksum did not match.');
      return {
        output: {
          fileRef: { path: ref.path, hostPath: ref.hostPath, checksum, size: stats.size, extension: extname(ref.path), scopedRoot: '/drive' },
          checksum,
          size: stats.size,
          cached: false,
        },
        status: WorkflowNodeStatusEnum.Passed,
        logs: ['Shared drive file copied.'],
      };
    }
    const result = await sharedSpace(organizationId).downloadUrl(await graphContext(context), {
      path: drivePath,
      url: source,
      checksum: parseStringValue(values.checksum).trim(),
    });
    const ref = driveInfo(context, parseStringValue(result.path).trim());
    return {
      output: {
        fileRef: {
          path: ref.path,
          hostPath: ref.hostPath,
          checksum: result.checksum,
          size: result.size,
          extension: extname(ref.path),
          scopedRoot: '/drive',
        },
        checksum: result.checksum,
        size: result.size,
        cached: result.cached,
      },
      status: WorkflowNodeStatusEnum.Passed,
      logs: [`Shared drive file ${result.cached ? 'reused' : 'downloaded'}.`],
    };
  }
  const target = scopedPath(root, parseStringValue(values.fileName || basename(source)).trim());
  await copySource(source, target, flag(values.allowLocalFile));
  const stats = statSync(target);
  const checksum = await fileChecksum(target);
  return {
    output: { fileRef: { path: target, checksum, size: stats.size, extension: extname(target), scopedRoot: root }, checksum, size: stats.size },
    status: WorkflowNodeStatusEnum.Passed,
    logs: [`Downloaded ${stats.size} bytes into workflow scope.`],
  };
};

const fileRef = (context: Parameters<WorkflowNodeHandler>[0]) => {
  const values = props(context);
  const ref = parseRecordValue(values.fileRef);
  return { ...ref, path: parseStringValue(ref.path || values.path || values.sourceFile).trim() } as Record<string, unknown> & { path: string };
};

export const executeWorkflowFileInspectNode: WorkflowNodeHandler = async (context) => {
  const ref = fileRef(context);
  const values = props(context);
  const resolved = driveInfo(context, ref.path);
  if (!resolved.hostPath || !existsSync(resolved.hostPath))
    return { output: { error: 'fileRef path does not exist.' }, status: WorkflowNodeStatusEnum.Failed };
  const stats = statSync(resolved.hostPath);
  const maxBytes = parseNumberValue(values.maxBytes, 0);
  if (maxBytes > 0 && stats.size > maxBytes) throw new Error(`File exceeds maxBytes ${maxBytes}.`);
  const checksum = await fileChecksum(resolved.hostPath);
  const expected = parseStringValue(values.checksum || ref.checksum).trim();
  if (expected && expected !== checksum) throw new Error('File checksum did not match.');
  return {
    output: {
      fileRef: { ...ref, path: resolved.path, hostPath: resolved.hostPath, checksum, size: stats.size, extension: extname(resolved.path) },
      phiSafePolicy: values.phiSafe !== false,
    },
    status: WorkflowNodeStatusEnum.Passed,
  };
};

export const executeWorkflowArtifactPublishNode: WorkflowNodeHandler = async (context) => {
  const values = props(context);
  const bucket = parseStringValue(values.bucket || STORAGE_BUCKET).trim();
  const basePath = parseStringValue(values.basePath || `workflow/${context.workflow.metadata.id || 'workflow'}`).trim();
  const artifacts = parseRecordValue(values.artifacts || context.input);
  const files = [];
  for (const [name, value] of Object.entries(artifacts)) {
    const path = `${basePath}/${name.endsWith('.json') ? name : `${name}.json`}`;
    const payload = JSON.stringify(value, null, 2);
    const result = await AttachmentEntity.uploadStorageObject(context.requestContext.supabase, {
      bucket,
      path,
      body: payload,
      contentType: 'application/json',
      upsert: true,
    });
    files.push({ bucket, path, size: payload.length, fullPath: result?.fullPath || null });
  }
  return { output: { bucket, basePath, files, phiSafe: values.phiSafe !== false }, status: WorkflowNodeStatusEnum.Passed };
};
