import JSZip from 'jszip';
import { BadRequestError } from 'routing-controllers';
import { toSafeString } from 'giga-ai-helper';
import { reviewWorkflowNodePackageRules } from '../runtime/rules';
import { NODE_PACKAGE_MAX_BYTES, NODE_PACKAGE_TYPE, NODE_PACKAGE_VERSION } from '../contracts/package-types';
import type { WorkflowNodePackage, WorkflowNodePackageManifest } from '../contracts/package-types';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const safePath = (value: unknown) => {
  const path = toSafeString(value).replace(/\\/g, '/').trim();
  if (!path || path.startsWith('/') || path.includes('..') || !/\.(ts|json)$/.test(path)) return '';
  return path;
};

const readManifest = async (zip: JSZip): Promise<WorkflowNodePackageManifest> => {
  const file = zip.file('node.json');
  if (!file) throw new BadRequestError('node.json is required in .node package.');
  const manifest = record(JSON.parse(await file.async('string')));
  const sourceFiles = Array.isArray(manifest.sourceFiles) ? manifest.sourceFiles.map(safePath).filter(Boolean) : [];
  const nodeSchema = record(manifest.nodeSchema);
  if (manifest.packageType !== NODE_PACKAGE_TYPE) throw new BadRequestError('Unsupported .node package type.');
  if (Number(manifest.version) !== NODE_PACKAGE_VERSION) throw new BadRequestError('Unsupported .node package version.');
  if (!toSafeString(manifest.name) || !toSafeString(manifest.slug)) throw new BadRequestError('Package name and slug are required.');
  if (!nodeSchema.id) throw new BadRequestError('Package nodeSchema.id is required.');
  if (!sourceFiles.includes('worker.ts')) throw new BadRequestError('Package sourceFiles must include worker.ts.');
  return {
    packageType: NODE_PACKAGE_TYPE,
    version: NODE_PACKAGE_VERSION,
    name: toSafeString(manifest.name),
    slug: toSafeString(manifest.slug),
    description: toSafeString(manifest.description) || null,
    groupName: toSafeString(manifest.groupName) || null,
    nodeSchema,
    sourceFiles,
  };
};

export const readWorkflowNodePackage = async (packageBase64: string, fileName?: string): Promise<WorkflowNodePackage> => {
  const buffer = Buffer.from(toSafeString(packageBase64), 'base64');
  if (!buffer.byteLength) throw new BadRequestError('packageBase64 is required.');
  if (buffer.byteLength > NODE_PACKAGE_MAX_BYTES) throw new BadRequestError('Node package exceeds maximum size.');
  const zip = await JSZip.loadAsync(buffer);
  for (const path of Object.keys(zip.files)) if (!safePath(path) && path !== 'node.json') throw new BadRequestError(`Unsafe package path: ${path}`);
  const manifest = await readManifest(zip);
  const sourceFiles: Record<string, string> = {};
  for (const path of manifest.sourceFiles) {
    const file = zip.file(path);
    if (!file) throw new BadRequestError(`Package source file is missing: ${path}`);
    sourceFiles[path] = await file.async('string');
  }
  const report = reviewWorkflowNodePackageRules({ nodeSchema: manifest.nodeSchema, sourceFiles });
  return { fileName, manifest, report, sourceFiles };
};
