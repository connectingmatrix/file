"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeWorkflowArtifactPublishNode = exports.executeWorkflowFileInspectNode = exports.executeWorkflowFileDownloadNode = void 0;
const node_fs_1 = require("node:fs");
const node_crypto_1 = require("node:crypto");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const node_stream_1 = require("node:stream");
const promises_1 = require("node:stream/promises");
const workflow_1 = require("giga-ai-helper/workflow");
const entities_1 = require("@connectingmatrix/orm/entities");
const shared_space_1 = require("../../shared-space");
const helper_1 = require("@gigav2/lib/helper");
const file_ops_1 = require("@gigav2/services/shared-space/file-ops");
const path_1 = require("@gigav2/services/shared-space/path");
const types_1 = require("@gigav2/services/workflow/types");
const STORAGE_BUCKET = 'storage';
const fileChecksum = async (path) => await new Promise((resolve, reject) => {
    const hash = (0, node_crypto_1.createHash)('sha256');
    (0, node_fs_1.createReadStream)(path)
        .on('data', (chunk) => hash.update(chunk))
        .on('error', reject)
        .on('end', () => resolve(hash.digest('hex')));
});
const scopedRoot = (context) => {
    const workflowId = (0, workflow_1.parseStringValue)(context.workflow.metadata.id || 'workflow').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const userId = (0, workflow_1.parseStringValue)(context.requestContext.userId || 'user').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const root = (0, node_path_1.join)((0, node_os_1.tmpdir)(), 'giga-workflow-files', userId, workflowId);
    (0, node_fs_1.mkdirSync)(root, { recursive: true });
    return root;
};
const scopedPath = (root, name) => {
    const path = (0, node_path_1.resolve)(root, (0, node_path_1.basename)(name || `artifact-${Date.now()}`));
    if (!path.startsWith((0, node_path_1.resolve)(root)))
        throw new Error('Workflow file path escaped the scoped folder.');
    return path;
};
const props = (context) => ({
    ...(0, workflow_1.parseRecordValue)(context.input),
    ...(0, workflow_1.parseRecordValue)(context.node.properties),
    ...(0, workflow_1.parseRecordValue)(context.node.runtime),
});
const flag = (value) => value === true || (0, workflow_1.parseStringValue)(value).toLowerCase() === 'true';
const driveInfo = (context, path) => {
    const drive = context.settings.sharedDrive;
    if (!drive || !path.startsWith('/drive'))
        return { path, hostPath: path };
    return { path, hostPath: (0, path_1.hostPath)(drive.path, path) };
};
const driveWriteAction = (context, path) => {
    const drive = context.settings.sharedDrive;
    return drive && (0, node_fs_1.existsSync)((0, path_1.hostPath)(drive.path, path)) ? 'update' : 'create';
};
const assertDriveWritable = (access, path, bytes) => {
    const target = (0, path_1.hostPath)(access.root, path);
    const current = (0, node_fs_1.existsSync)(target) ? (0, node_fs_1.statSync)(target).size : 0;
    (0, file_ops_1.assertWritable)({ ...access, usedBytes: Math.max(0, access.usedBytes - current) }, bytes);
};
const graphContext = async (context) => ({
    effectiveRoot: await (0, helper_1.isCurrentUserRootUser)(context.requestContext.supabase),
    request: context.requestContext.request,
    supabase: context.requestContext.supabase,
    userId: context.requestContext.userId,
});
const workflowOrganizationId = (context) => (0, workflow_1.parseStringValue)(context.workflow.metadata.organizationId || (0, workflow_1.parseRecordValue)(context.workflow.metadata.scope).organizationId).trim();
const sharedSpace = (organizationId) => shared_space_1.SharedSpaceEntity.forOrganisation(organizationId);
const copySource = async (source, target, allowLocalFile) => {
    if (source.startsWith('http://') || source.startsWith('https://')) {
        const response = await fetch(source);
        if (!response.ok || !response.body)
            throw new Error(`Download failed with status ${response.status}.`);
        await (0, promises_1.pipeline)(node_stream_1.Readable.fromWeb(response.body), (0, node_fs_1.createWriteStream)(target));
        return;
    }
    const path = source.startsWith('file://') ? new URL(source).pathname : source;
    if (!allowLocalFile || !(0, node_fs_1.existsSync)(path))
        throw new Error('Workflow File Download requires an http(s) URL or allowed local file.');
    await (0, promises_1.pipeline)((0, node_fs_1.createReadStream)(path), (0, node_fs_1.createWriteStream)(target));
};
const executeWorkflowFileDownloadNode = async (context) => {
    const values = props(context);
    const source = (0, workflow_1.parseStringValue)(values.url || values.sourceUrl || values.sourceFile).trim();
    if (!source)
        return { output: { error: 'url is required.' }, status: types_1.WorkflowNodeStatusEnum.Failed, logs: ['url is required.'] };
    const root = scopedRoot(context);
    if ((0, workflow_1.parseStringValue)(values.destination || values.target).trim() === 'drive') {
        if (!context.settings.sharedDrive)
            throw new Error('Workflow shared drive mount is not available.');
        const organizationId = (0, workflow_1.parseStringValue)(values.organizationId || workflowOrganizationId(context)).trim();
        const drivePath = (0, workflow_1.parseStringValue)(values.drivePath || values.path || `/drive/${(0, workflow_1.parseStringValue)(values.fileName || (0, node_path_1.basename)(source)).trim()}`).trim();
        if (!source.startsWith('http://') && !source.startsWith('https://')) {
            (0, file_ops_1.assertFileName)(drivePath);
            const ref = driveInfo(context, drivePath);
            const localSource = source.startsWith('file://') ? new URL(source).pathname : source;
            if (!flag(values.allowLocalFile) || !(0, node_fs_1.existsSync)(localSource))
                throw new Error('Workflow File Download requires an http(s) URL or allowed local file.');
            if ((0, node_fs_1.existsSync)(ref.hostPath)) {
                const existingChecksum = await fileChecksum(ref.hostPath);
                if (!(0, workflow_1.parseStringValue)(values.checksum).trim() || existingChecksum === (0, workflow_1.parseStringValue)(values.checksum).trim()) {
                    const stats = (0, node_fs_1.statSync)(ref.hostPath);
                    return {
                        output: {
                            fileRef: {
                                path: ref.path,
                                hostPath: ref.hostPath,
                                checksum: existingChecksum,
                                size: stats.size,
                                extension: (0, node_path_1.extname)(ref.path),
                                scopedRoot: '/drive',
                            },
                            checksum: existingChecksum,
                            size: stats.size,
                            cached: true,
                        },
                        status: types_1.WorkflowNodeStatusEnum.Passed,
                        logs: ['Shared drive file reused.'],
                    };
                }
            }
            const requestContext = await graphContext(context);
            await sharedSpace(organizationId).workflowDrive(requestContext);
            const summary = await sharedSpace(organizationId).summary(requestContext);
            assertDriveWritable({ quotaBytes: summary.quotaBytes, root: context.settings.sharedDrive.path, usedBytes: summary.usedBytes }, drivePath, (0, node_fs_1.statSync)(localSource).size);
            (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(ref.hostPath), { recursive: true, mode: 0o700 });
            await copySource(source, ref.hostPath, true);
            const stats = (0, node_fs_1.statSync)(ref.hostPath);
            const checksum = await fileChecksum(ref.hostPath);
            if ((0, workflow_1.parseStringValue)(values.checksum).trim() && (0, workflow_1.parseStringValue)(values.checksum).trim() !== checksum)
                throw new Error('File checksum did not match.');
            return {
                output: {
                    fileRef: { path: ref.path, hostPath: ref.hostPath, checksum, size: stats.size, extension: (0, node_path_1.extname)(ref.path), scopedRoot: '/drive' },
                    checksum,
                    size: stats.size,
                    cached: false,
                },
                status: types_1.WorkflowNodeStatusEnum.Passed,
                logs: ['Shared drive file copied.'],
            };
        }
        const result = await sharedSpace(organizationId).downloadUrl(await graphContext(context), {
            path: drivePath,
            url: source,
            checksum: (0, workflow_1.parseStringValue)(values.checksum).trim(),
        });
        const ref = driveInfo(context, (0, workflow_1.parseStringValue)(result.path).trim());
        return {
            output: {
                fileRef: {
                    path: ref.path,
                    hostPath: ref.hostPath,
                    checksum: result.checksum,
                    size: result.size,
                    extension: (0, node_path_1.extname)(ref.path),
                    scopedRoot: '/drive',
                },
                checksum: result.checksum,
                size: result.size,
                cached: result.cached,
            },
            status: types_1.WorkflowNodeStatusEnum.Passed,
            logs: [`Shared drive file ${result.cached ? 'reused' : 'downloaded'}.`],
        };
    }
    const target = scopedPath(root, (0, workflow_1.parseStringValue)(values.fileName || (0, node_path_1.basename)(source)).trim());
    await copySource(source, target, flag(values.allowLocalFile));
    const stats = (0, node_fs_1.statSync)(target);
    const checksum = await fileChecksum(target);
    return {
        output: { fileRef: { path: target, checksum, size: stats.size, extension: (0, node_path_1.extname)(target), scopedRoot: root }, checksum, size: stats.size },
        status: types_1.WorkflowNodeStatusEnum.Passed,
        logs: [`Downloaded ${stats.size} bytes into workflow scope.`],
    };
};
exports.executeWorkflowFileDownloadNode = executeWorkflowFileDownloadNode;
const fileRef = (context) => {
    const values = props(context);
    const ref = (0, workflow_1.parseRecordValue)(values.fileRef);
    return { ...ref, path: (0, workflow_1.parseStringValue)(ref.path || values.path || values.sourceFile).trim() };
};
const executeWorkflowFileInspectNode = async (context) => {
    const ref = fileRef(context);
    const values = props(context);
    const resolved = driveInfo(context, ref.path);
    if (!resolved.hostPath || !(0, node_fs_1.existsSync)(resolved.hostPath))
        return { output: { error: 'fileRef path does not exist.' }, status: types_1.WorkflowNodeStatusEnum.Failed };
    const stats = (0, node_fs_1.statSync)(resolved.hostPath);
    const maxBytes = (0, workflow_1.parseNumberValue)(values.maxBytes, 0);
    if (maxBytes > 0 && stats.size > maxBytes)
        throw new Error(`File exceeds maxBytes ${maxBytes}.`);
    const checksum = await fileChecksum(resolved.hostPath);
    const expected = (0, workflow_1.parseStringValue)(values.checksum || ref.checksum).trim();
    if (expected && expected !== checksum)
        throw new Error('File checksum did not match.');
    return {
        output: {
            fileRef: { ...ref, path: resolved.path, hostPath: resolved.hostPath, checksum, size: stats.size, extension: (0, node_path_1.extname)(resolved.path) },
            phiSafePolicy: values.phiSafe !== false,
        },
        status: types_1.WorkflowNodeStatusEnum.Passed,
    };
};
exports.executeWorkflowFileInspectNode = executeWorkflowFileInspectNode;
const executeWorkflowArtifactPublishNode = async (context) => {
    const values = props(context);
    const bucket = (0, workflow_1.parseStringValue)(values.bucket || STORAGE_BUCKET).trim();
    const basePath = (0, workflow_1.parseStringValue)(values.basePath || `workflow/${context.workflow.metadata.id || 'workflow'}`).trim();
    const artifacts = (0, workflow_1.parseRecordValue)(values.artifacts || context.input);
    const files = [];
    for (const [name, value] of Object.entries(artifacts)) {
        const path = `${basePath}/${name.endsWith('.json') ? name : `${name}.json`}`;
        const payload = JSON.stringify(value, null, 2);
        const result = await entities_1.AttachmentEntity.uploadStorageObject(context.requestContext.supabase, {
            bucket,
            path,
            body: payload,
            contentType: 'application/json',
            upsert: true,
        });
        files.push({ bucket, path, size: payload.length, fullPath: (result === null || result === void 0 ? void 0 : result.fullPath) || null });
    }
    return { output: { bucket, basePath, files, phiSafe: values.phiSafe !== false }, status: types_1.WorkflowNodeStatusEnum.Passed };
};
exports.executeWorkflowArtifactPublishNode = executeWorkflowArtifactPublishNode;
