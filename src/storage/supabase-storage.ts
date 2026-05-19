import type {
  FileResumableUploadInput,
  FileResumableUploadSession,
  FileSignedUrlInput,
  FileSignedUrlResult,
  FileStorageObject,
  FileStorageProvider,
} from './types';

type SupabaseStorageBucket = {
  upload(path: string, body: Buffer | Uint8Array | string, options?: { contentType?: string | null; upsert?: boolean }): Promise<{ data: unknown; error: Error | null }>;
  download(path: string): Promise<{ data: { arrayBuffer(): Promise<ArrayBuffer> } | null; error: Error | null }>;
  remove(paths: string[]): Promise<{ data: unknown; error: Error | null }>;
  createSignedUrl?(path: string, expiresIn: number, options?: Record<string, unknown>): Promise<{ data: { signedUrl: string } | null; error: Error | null }>;
  createSignedUploadUrl?(path: string): Promise<{ data: { signedUrl: string; token?: string | null; path?: string | null } | null; error: Error | null }>;
};

type SupabaseStorageClient = {
  storage: {
    from(bucket: string): SupabaseStorageBucket;
  };
};

const defaultSignedUrlTtl = 15 * 60;

const normalizeTtl = (value: number | undefined): number => {
  const ttl = Number(value || defaultSignedUrlTtl);
  if (!Number.isFinite(ttl) || ttl <= 0) return defaultSignedUrlTtl;
  return Math.min(Math.floor(ttl), 7 * 24 * 60 * 60);
};

const encodeTusMetadata = (metadata: Record<string, string>): string =>
  Object.entries(metadata)
    .map(([key, value]) => `${key} ${Buffer.from(value).toString('base64')}`)
    .join(',');

export class SupabaseStorageProvider implements FileStorageProvider {
  public readonly name = 'supabase';

  public constructor(
    private readonly client: SupabaseStorageClient,
    private readonly options: { tusEndpoint?: string | null; uploadHeaders?: Record<string, string> } = {},
  ) {}

  public async put(input: FileStorageObject & { body: Buffer | Uint8Array | string }): Promise<FileStorageObject> {
    const result = await this.client.storage.from(input.bucket).upload(input.path, input.body, { contentType: input.contentType, upsert: true });
    if (result.error) throw result.error;
    return {
      bucket: input.bucket,
      path: input.path,
      contentType: input.contentType || null,
      bytes: input.bytes || null,
      checksum: input.checksum || null,
      checksumAlgorithm: input.checksumAlgorithm || null,
      metadata: input.metadata || null,
    };
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

  public async signUrl(input: FileSignedUrlInput): Promise<FileSignedUrlResult> {
    const operation = input.operation || 'download';
    const expiresInSeconds = normalizeTtl(input.expiresInSeconds);
    const bucket = this.client.storage.from(input.bucket);

    if (operation === 'upload') {
      if (!bucket.createSignedUploadUrl) throw new Error('Supabase signed upload URLs are not available on this storage client');
      const result = await bucket.createSignedUploadUrl(input.path);
      if (result.error) throw result.error;
      if (!result.data?.signedUrl) throw new Error('Supabase did not return a signed upload URL');
      return { bucket: input.bucket, path: input.path, url: result.data.signedUrl, token: result.data.token || null, expiresInSeconds, operation };
    }

    if (!bucket.createSignedUrl) throw new Error('Supabase signed download URLs are not available on this storage client');
    const result = await bucket.createSignedUrl(input.path, expiresInSeconds, input.contentType ? { download: false } : undefined);
    if (result.error) throw result.error;
    if (!result.data?.signedUrl) throw new Error('Supabase did not return a signed download URL');
    return { bucket: input.bucket, path: input.path, url: result.data.signedUrl, expiresInSeconds, operation };
  }

  public async createResumableUpload(input: FileResumableUploadInput): Promise<FileResumableUploadSession> {
    const endpoint = input.endpoint || this.options.tusEndpoint || process.env.SUPABASE_STORAGE_TUS_ENDPOINT || null;
    if (!endpoint) throw new Error('Supabase TUS endpoint is required to create a resumable upload session');

    const metadata: Record<string, string> = {
      bucketName: input.bucket,
      objectName: input.path,
      contentType: input.contentType || 'application/octet-stream',
    };
    if (input.checksum) metadata.checksum = input.checksum;
    for (const [key, value] of Object.entries(input.metadata || {})) {
      if (value !== undefined && value !== null) metadata[key] = String(value);
    }

    return {
      provider: this.name,
      protocol: 'tus',
      bucket: input.bucket,
      path: input.path,
      endpoint,
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Metadata': encodeTusMetadata(metadata),
        ...(input.sizeBytes ? { 'Upload-Length': String(input.sizeBytes) } : {}),
        ...(this.options.uploadHeaders || {}),
      },
      metadata,
      expiresAt: null,
    };
  }
}
