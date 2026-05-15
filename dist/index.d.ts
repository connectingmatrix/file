import { type BaseRecord } from './entity/repository.js';
import { type PackageHealth, type PackageModule, type RequestContext } from './contracts.js';
export type StorageProviderName = 'supabase' | 'drive' | 'memory';
export interface StoredFile extends BaseRecord {
    path: string;
    fileName: string;
    contentType?: string;
    size: number;
    provider: StorageProviderName;
    base64?: string;
    metadata?: Record<string, unknown>;
}
export interface UploadInput {
    path?: string;
    fileName: string;
    content: string | Uint8Array | ArrayBuffer;
    contentType?: string;
    provider?: StorageProviderName;
    metadata?: Record<string, unknown>;
}
export interface StorageProvider {
    name: StorageProviderName;
    upload(input: UploadInput, context?: RequestContext): Promise<StoredFile>;
    download(path: string, context?: RequestContext): Promise<Uint8Array>;
    delete(path: string, context?: RequestContext): Promise<boolean>;
}
export interface SupabaseStorageClientLike {
    storage: {
        from(bucket: string): {
            upload(path: string, body: Uint8Array | ArrayBuffer | Blob | string, options?: Record<string, unknown>): Promise<{
                data?: {
                    path?: string;
                    fullPath?: string;
                };
                error?: {
                    message?: string;
                } | null;
            }>;
            download(path: string): Promise<{
                data?: Blob | ArrayBuffer | Uint8Array | string | null;
                error?: {
                    message?: string;
                } | null;
            }>;
            remove(paths: string[]): Promise<{
                data?: unknown;
                error?: {
                    message?: string;
                } | null;
            }>;
        };
    };
}
export declare function createSupabaseStorageProvider(options: {
    client: SupabaseStorageClientLike;
    bucket: string;
    upsert?: boolean;
}): StorageProvider;
export interface ZipSourceFile {
    path: string;
    content: string | Uint8Array;
}
export declare const File: {
    registerProvider(provider: StorageProvider): /*elided*/ any;
    upload(input: UploadInput, context?: RequestContext): Promise<StoredFile>;
    download(path: string, provider?: StorageProviderName, context?: RequestContext): Promise<Uint8Array<ArrayBufferLike>>;
    remove(path: string, provider?: StorageProviderName, context?: RequestContext): Promise<boolean>;
    list(context?: RequestContext): import("./contracts.js").ListResult<StoredFile>;
    zip(filesToZip: ZipSourceFile[]): Promise<Uint8Array>;
    unzip(archive: Uint8Array | ArrayBuffer | string): Promise<ZipSourceFile[]>;
    health(): PackageHealth;
};
export declare const graphql: {
    namespace: string;
    typeDefs: string;
    resolvers: {
        Query: {
            fileHealth: () => "ok" | "degraded" | "down";
            fileList: (_: unknown, __: unknown, ctx: RequestContext) => StoredFile[];
        };
        Mutation: {
            fileUploadText: (_: unknown, args: {
                input: UploadInput;
            }, ctx: RequestContext) => Promise<StoredFile>;
            fileDelete: (_: unknown, args: {
                path: string;
            }, ctx: RequestContext) => Promise<boolean>;
        };
    };
    migrations: string[];
};
export declare function createPackage(): PackageModule;
export * from './contracts.js';
