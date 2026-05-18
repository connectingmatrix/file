export type FileStorageObject = {
  bucket: string;
  path: string;
  contentType?: string | null;
  bytes?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type FileStorageProvider = {
  name: string;
  put(input: FileStorageObject & { body: Buffer | Uint8Array | string }): Promise<FileStorageObject>;
  get(bucket: string, path: string): Promise<(FileStorageObject & { body: Buffer | Uint8Array | string }) | null>;
  remove(bucket: string, path: string): Promise<void>;
};
