import type { FileStorageObject, FileStorageProvider } from './types';

export class DriveStorageProvider implements FileStorageProvider {
  public readonly name = 'drive';

  public async put(input: FileStorageObject & { body: Buffer | Uint8Array | string }): Promise<FileStorageObject> {
    return { bucket: input.bucket, path: input.path, contentType: input.contentType || null, bytes: input.bytes || null, metadata: input.metadata || null };
  }

  public async get(_bucket: string, _path: string): Promise<(FileStorageObject & { body: Buffer }) | null> {
    return null;
  }

  public async remove(_bucket: string, _path: string): Promise<void> {}
}
