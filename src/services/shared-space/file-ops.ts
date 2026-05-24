import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BadRequestError } from 'routing-controllers';
import { blockedName, hostPath, publicPath } from './path';
import { assertUserDrivePathAllowed } from './policy';

export const assertWritable = (limit: { quotaBytes: number; usedBytes: number }, bytes: number) => {
  if (limit.usedBytes + bytes > limit.quotaBytes) throw new BadRequestError('Drive quota exceeded.');
};

export const assertFileName = (path: string) => {
  if (blockedName(path)) throw new BadRequestError('Executable script files are not allowed in shared space.');
};

export const SHARED_SPACE_PREVIEW_BYTES = 30 * 1024 * 1024;

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  '.aac': 'audio/aac',
  '.avi': 'video/x-msvideo',
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.svg': 'image/svg+xml',
  '.tsv': 'text/tab-separated-values',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xml': 'application/xml',
};

const mimeTypeForName = (name: string) => MIME_TYPES_BY_EXTENSION[extname(name).toLowerCase()] || 'application/octet-stream';

const assertNoSymlinkPath = (root: string, target: string) => {
  let cursor = root;
  for (const part of relative(root, target).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new BadRequestError('Symbolic links are not allowed in shared space.');
  }
};

const assertNoHardlink = (stat: ReturnType<typeof lstatSync>) => {
  if (!stat.isDirectory() && stat.nlink > 1) throw new BadRequestError('Hard links are not allowed in shared space.');
};

const assertProtectedAgentFolder = (inputPath: string, stat: ReturnType<typeof lstatSync>) => {
  const normalized = inputPath.replace(/\\/g, '/').replace(/^\/drive\/?/, '/');
  if (stat.isDirectory() && /^\/[^/]+\/agents\/[^/]+\/(?:FILES|artifacts\/FILES)\/?$/.test(normalized)) {
    throw new BadRequestError('AI Agent Drive file folder is protected and cannot be deleted. Remove individual files from agent memory instead.');
  }
};

export const fileSha256 = async (path: string) =>
  await new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });

export const statFile = async (root: string, inputPath: string) => {
  const path = hostPath(root, inputPath);
  if (!existsSync(path)) throw new BadRequestError('Shared space file was not found.');
  assertNoSymlinkPath(root, path);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new BadRequestError('Symbolic links are not allowed in shared space.');
  assertNoHardlink(stat);
  return {
    name: basename(path),
    path: publicPath(root, path),
    kind: stat.isDirectory() ? 'folder' : 'file',
    size: stat.size,
    checksum: stat.isDirectory() ? null : await fileSha256(path),
    updatedAt: stat.mtime.toISOString(),
  };
};

export const readFilePreview = async (root: string, inputPath: string, maxPreviewBytes = SHARED_SPACE_PREVIEW_BYTES) => {
  const file = await statFile(root, inputPath);
  const mimeType = file.kind === 'folder' ? 'inode/directory' : mimeTypeForName(file.name);
  const metadata = { ...file, mimeType, sizeBytes: file.size };
  if (file.kind !== 'file' || file.size > maxPreviewBytes) return metadata;
  return { ...metadata, contentBase64: readFileSync(hostPath(root, file.path)).toString('base64') };
};

export const makeFolder = (root: string, inputPath: string) => {
  const path = hostPath(root, inputPath);
  assertNoSymlinkPath(root, path);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  return { name: basename(path), path: publicPath(root, path), kind: 'folder', size: 0, checksum: null, updatedAt: new Date().toISOString() };
};

export const removePath = (root: string, inputPath: string, options: { allowProtected?: boolean } = {}) => {
  if (options.allowProtected !== true) assertUserDrivePathAllowed(inputPath);
  const path = hostPath(root, inputPath);
  if (!existsSync(path)) return { name: basename(path), path: publicPath(root, path), kind: 'missing', size: 0, checksum: null, deleted: false };
  assertNoSymlinkPath(root, path);
  if (lstatSync(path).isSymbolicLink()) throw new BadRequestError('Symbolic links are not allowed in shared space.');
  const stat = lstatSync(path);
  assertNoHardlink(stat);
  assertProtectedAgentFolder(inputPath, stat);
  rmSync(path, { recursive: true, force: true });
  return {
    name: basename(path),
    path: publicPath(root, path),
    kind: stat.isDirectory() ? 'folder' : 'file',
    size: stat.size,
    checksum: null,
    deleted: true,
  };
};

export const movePath = (root: string, from: string, to: string) => {
  assertUserDrivePathAllowed(from);
  assertUserDrivePathAllowed(to);
  assertFileName(to);
  const source = hostPath(root, from);
  const target = hostPath(root, to);
  assertNoSymlinkPath(root, source);
  assertNoSymlinkPath(root, target);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  renameSync(source, target);
  const stat = lstatSync(target);
  assertNoHardlink(stat);
  return {
    from: publicPath(root, source),
    name: basename(target),
    path: publicPath(root, target),
    kind: stat.isDirectory() ? 'folder' : 'file',
    size: stat.size,
    checksum: null,
    updatedAt: stat.mtime.toISOString(),
  };
};

export const copyPath = (root: string, from: string, to: string) => {
  assertUserDrivePathAllowed(from);
  assertUserDrivePathAllowed(to);
  assertFileName(to);
  const source = hostPath(root, from);
  const target = hostPath(root, to);
  assertNoSymlinkPath(root, source);
  assertNoSymlinkPath(root, target);
  const sourceStat = lstatSync(source);
  if (sourceStat.isDirectory()) throw new BadRequestError('Folder copy is not supported in shared space v1.');
  assertNoHardlink(sourceStat);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  copyFileSync(source, target);
  const stat = lstatSync(target);
  return {
    from: publicPath(root, source),
    name: basename(target),
    path: publicPath(root, target),
    kind: 'file',
    size: stat.size,
    checksum: null,
    updatedAt: stat.mtime.toISOString(),
  };
};

export const writeText = (root: string, inputPath: string, text: string, options: { allowProtected?: boolean } = {}) => {
  if (options.allowProtected !== true) assertUserDrivePathAllowed(inputPath);
  assertFileName(inputPath);
  const path = hostPath(root, inputPath);
  assertNoSymlinkPath(root, path);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, text, { mode: 0o600 });
  return {
    name: basename(path),
    path: publicPath(root, path),
    kind: 'file',
    size: Buffer.byteLength(text),
    checksum: null,
    updatedAt: new Date().toISOString(),
  };
};

export const writeBuffer = (root: string, inputPath: string, content: Buffer, options: { allowProtected?: boolean } = {}) => {
  if (options.allowProtected !== true) assertUserDrivePathAllowed(inputPath);
  assertFileName(inputPath);
  const path = hostPath(root, inputPath);
  assertNoSymlinkPath(root, path);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { mode: 0o600 });
  return {
    name: basename(path),
    path: publicPath(root, path),
    kind: 'file',
    size: content.byteLength,
    checksum: null,
    updatedAt: new Date().toISOString(),
  };
};

export const download = async (root: string, url: string, inputPath: string, maxBytes = 0) => {
  assertUserDrivePathAllowed(inputPath);
  assertFileName(inputPath);
  const target = hostPath(root, inputPath);
  assertNoSymlinkPath(root, target);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new BadRequestError(`Download failed with status ${response.status}.`);
  const length = Number(response.headers.get('content-length') || 0);
  if (maxBytes > 0 && length > maxBytes) throw new BadRequestError('Download exceeds remaining shared space quota.');
  let written = 0;
  const guard = new Transform({
    transform(chunk, _encoding, callback) {
      written += Buffer.byteLength(chunk);
      callback(maxBytes > 0 && written > maxBytes ? new BadRequestError('Download exceeds remaining shared space quota.') : null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), guard, createWriteStream(target, { mode: 0o600 }));
  return statFile(root, publicPath(root, target));
};
