import type { FileStorageObject, FileStorageProvider } from './types';

type SupabaseStorageClient = {
  storage: {
    from(bucket: string): {
      upload(path: string, body: Buffer | Uint8Array | string, options?: { contentType?: string | null; upsert?: boolean }): Promise<{ data: unknown; error: Error | null }>;
      download(path: string): Promise<{ data: { arrayBuffer(): Promise<ArrayBuffer> } | null; error: Error | null }>;
      remove(paths: string[]): Promise<{ data: unknown; error: Error | null }>;
    };
  };
};

export class SupabaseStorageProvider implements FileStorageProvider {
  public readonly name = 'supabase';

  public constructor(private readonly client: SupabaseStorageClient) {}

  public async put(input: FileStorageObject & { body: Buffer | Uint8Array | string }): Promise<FileStorageObject> {
    const result = await this.client.storage.from(input.bucket).upload(input.path, input.body, { contentType: input.contentType, upsert: true });
    if (result.error) throw result.error;
    return { bucket: input.bucket, path: input.path, contentType: input.contentType || null, bytes: input.bytes || null, metadata: input.metadata || null };
  }

  public async get(bucket: string, path: string): Promise<(FileStorageObject & { body: Buffer }) | null> {
    const result = await this.client.storage.from(bucket).download(path);
    if (result.error) throw result.error;
    if (!result.data) return null;
    return { bucket, path, body: Buffer.from(await result.data.arrayBuffer()) };
  }

  public async remove(bucket: string, path: string): Promise<void> {
    const result = await this.client.storage.from(bucket).remove([path]);
    if (result.error) throw result.error;
  }
}
