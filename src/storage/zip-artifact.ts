import JSZip from 'jszip';
import type { FileStorageBody } from './types';

export type ZipArtifactFile = {
  path: string;
  body: FileStorageBody;
  mode?: number;
  date?: Date;
};

const safeZipPath = (value: string): string =>
  value
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');

const toZipBody = (body: FileStorageBody): Buffer | Uint8Array | string => {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return body;
  return body;
};

export async function createZipArtifactBody(
  files: ZipArtifactFile[],
  manifest: Record<string, unknown> = {},
): Promise<Buffer> {
  const zip = new JSZip();
  const added: string[] = [];
  for (const file of files) {
    const filePath = safeZipPath(file.path);
    if (!filePath) continue;
    zip.file(filePath, toZipBody(file.body), { date: file.date, unixPermissions: file.mode });
    added.push(filePath);
  }
  zip.file('artifact-manifest.json', JSON.stringify({ ...manifest, files: added, createdAt: new Date().toISOString() }, null, 2));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
