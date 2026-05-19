import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  FileResumableUploadSession,
  FileSignedUrlResult,
  FileStorageBody,
  FileStorageObject,
  FileStorageProvider,
} from './types';

export type FileArtifactKind = 'agent-attachment' | 'project-source' | 'project-build' | 'database-file' | 'node-package' | string;

export type FileArtifactManifest = FileStorageObject & {
  id: string;
  kind: FileArtifactKind;
  filename: string;
  ownerId?: string | null;
  projectId?: string | null;
  createdAt: string;
};

export type PutFileArtifactInput = {
  storage: FileStorageProvider;
  bucket: string;
  body: FileStorageBody;
  filename: string;
  kind: FileArtifactKind;
  contentType?: string | null;
  ownerId?: string | null;
  projectId?: string | null;
  path?: string | null;
  metadata?: Record<string, unknown> | null;
};

const bodyBuffer = (body: FileStorageBody): Buffer => {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  return Buffer.from(body);
};

export const checksumSha256 = (body: FileStorageBody): string => createHash('sha256').update(bodyBuffer(body)).digest('hex');

export const safeArtifactFilename = (filename: string): string =>
  path.basename(filename || 'artifact.bin').replace(/[^a-zA-Z0-9._-]/g, '_') || 'artifact.bin';

export const artifactStoragePath = (input: {
  kind: FileArtifactKind;
  ownerId?: string | null;
  projectId?: string | null;
  filename: string;
  id?: string;
}): string => {
  const id = input.id || randomUUID();
  const owner = input.ownerId ? `owners/${safeArtifactFilename(input.ownerId)}` : 'owners/system';
  const project = input.projectId ? `/projects/${safeArtifactFilename(input.projectId)}` : '';
  return `${owner}${project}/${safeArtifactFilename(input.kind)}/${id}-${safeArtifactFilename(input.filename)}`;
};

export async function putFileArtifact(input: PutFileArtifactInput): Promise<FileArtifactManifest> {
  const id = randomUUID();
  const body = bodyBuffer(input.body);
  const checksum = checksumSha256(body);
  const storagePath = input.path || artifactStoragePath({ ...input, id });
  const stored = await input.storage.put({
    bucket: input.bucket,
    path: storagePath,
    body,
    contentType: input.contentType || 'application/octet-stream',
    bytes: body.byteLength,
    checksum,
    checksumAlgorithm: 'sha256',
    metadata: {
      ...(input.metadata || {}),
      artifactKind: input.kind,
      filename: input.filename,
      ownerId: input.ownerId || null,
      projectId: input.projectId || null,
    },
  });

  return {
    id,
    kind: input.kind,
    filename: safeArtifactFilename(input.filename),
    ownerId: input.ownerId || null,
    projectId: input.projectId || null,
    createdAt: new Date().toISOString(),
    ...stored,
    checksum,
    checksumAlgorithm: 'sha256',
    bytes: body.byteLength,
  };
}

export async function signedArtifactUrl(
  storage: FileStorageProvider,
  artifact: Pick<FileArtifactManifest, 'bucket' | 'path'>,
  expiresInSeconds = 15 * 60,
): Promise<FileSignedUrlResult> {
  if (!storage.signUrl) throw new Error(`${storage.name} storage does not support signed URLs`);
  return storage.signUrl({ bucket: artifact.bucket, path: artifact.path, expiresInSeconds, operation: 'download' });
}

export async function createArtifactUploadSession(input: {
  storage: FileStorageProvider;
  bucket: string;
  path: string;
  filename: string;
  sizeBytes?: number | null;
  contentType?: string | null;
  checksum?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<FileResumableUploadSession> {
  if (!input.storage.createResumableUpload) throw new Error(`${input.storage.name} storage does not support resumable uploads`);
  return input.storage.createResumableUpload({
    bucket: input.bucket,
    path: input.path,
    sizeBytes: input.sizeBytes,
    contentType: input.contentType,
    checksum: input.checksum,
    metadata: { ...(input.metadata || {}), filename: input.filename },
  });
}
