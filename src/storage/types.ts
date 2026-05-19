export type FileStorageBody = Buffer | Uint8Array | string;

export type FileStorageObject = {
  bucket: string;
  path: string;
  contentType?: string | null;
  bytes?: number | null;
  checksum?: string | null;
  checksumAlgorithm?: 'sha256' | string | null;
  metadata?: Record<string, unknown> | null;
};

export type FileSignedUrlInput = {
  bucket: string;
  path: string;
  expiresInSeconds?: number;
  operation?: 'download' | 'upload';
  contentType?: string | null;
};

export type FileSignedUrlResult = {
  bucket: string;
  path: string;
  url: string;
  expiresInSeconds: number;
  operation: 'download' | 'upload';
  token?: string | null;
};

export type FileResumableUploadInput = {
  bucket: string;
  path: string;
  sizeBytes?: number | null;
  contentType?: string | null;
  checksum?: string | null;
  metadata?: Record<string, unknown> | null;
  endpoint?: string | null;
};

export type FileResumableUploadSession = {
  provider: string;
  protocol: 'tus';
  bucket: string;
  path: string;
  endpoint: string;
  headers: Record<string, string>;
  metadata: Record<string, string>;
  expiresAt?: string | null;
};

export type FileStorageProvider = {
  name: string;
  put(input: FileStorageObject & { body: FileStorageBody }): Promise<FileStorageObject>;
  get(bucket: string, path: string): Promise<(FileStorageObject & { body: FileStorageBody }) | null>;
  remove(bucket: string, path: string): Promise<void>;
  signUrl?(input: FileSignedUrlInput): Promise<FileSignedUrlResult>;
  createResumableUpload?(input: FileResumableUploadInput): Promise<FileResumableUploadSession>;
};
