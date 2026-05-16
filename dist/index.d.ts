import { type BaseRecord } from './entity/repository.js';
import { type PackageHealth, type PackageModule, type RequestContext } from './contracts.js';
export type StorageProviderName = 'memory' | 'supabase' | string;
export interface StoredFile extends BaseRecord {
    path: string;
    fileName: string;
    contentType: string;
    size: number;
    provider: string;
    metadata?: Record<string, unknown>;
}
export interface ProcessedFile extends BaseRecord {
    fileId: string;
    fileName: string;
    contentType: string;
    processor: string;
    text?: string;
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
export interface FileProcessor {
    name: string;
    contentTypes: string[];
    process(input: {
        file: StoredFile;
        bytes: Uint8Array;
        text?: string;
        context: RequestContext;
    }): Promise<Partial<ProcessedFile>> | Partial<ProcessedFile>;
}
export interface ZipSourceFile {
    path: string;
    content: string | Uint8Array;
}
export declare function detectMimeType(fileName: string, data?: Uint8Array): string;
export interface SupabaseStorageClientLike {
    storage: {
        from(bucket: string): {
            upload(path: string, data: Uint8Array, options?: Record<string, unknown>): Promise<{
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
export declare const File: {
    registerProvider(provider: StorageProvider): /*elided*/ any;
    registerProcessor(processor: FileProcessor): /*elided*/ any;
    detectMimeType: typeof detectMimeType;
    upload(input: UploadInput, context?: RequestContext): Promise<StoredFile>;
    download(path: string, provider?: StorageProviderName, context?: RequestContext): Promise<Uint8Array<ArrayBufferLike>>;
    remove(path: string, provider?: StorageProviderName, context?: RequestContext): Promise<boolean>;
    list(context?: RequestContext): import("./contracts.js").ListResult<StoredFile>;
    processed(context?: RequestContext): import("./contracts.js").ListResult<ProcessedFile>;
    process(path: string, provider?: StorageProviderName, context?: RequestContext, processorName?: string): Promise<ProcessedFile>;
    zip(filesToZip: ZipSourceFile[]): Promise<Uint8Array>;
    unzip(archive: Uint8Array | ArrayBuffer | string): Promise<ZipSourceFile[]>;
    createSourceArchiveAdapter(provider?: StorageProviderName): {
        createArchive: (entries: ZipSourceFile[]) => Promise<Uint8Array<ArrayBufferLike>>;
        extractArchive: (archive: Uint8Array | string) => Promise<ZipSourceFile[]>;
        upload: (name: string, archive: Uint8Array, context?: RequestContext) => Promise<{
            path: string;
            provider: string;
            size: number;
        }>;
        download: (path: string, context?: RequestContext) => Promise<Uint8Array<ArrayBufferLike>>;
    };
    createNodePackageAdapter(provider?: StorageProviderName): {
        createNodePackage: (manifest: Record<string, unknown>) => Promise<Uint8Array<ArrayBufferLike>>;
        extractNodePackage: (archive: Uint8Array | string) => Promise<Record<string, unknown>>;
        uploadNodePackage: (name: string, archive: Uint8Array, context?: RequestContext) => Promise<{
            path: string;
            provider: string;
            size: number;
        }>;
    };
    launcher: typeof import("./launcher.js").createConnectingmatrixFileStubLauncher;
    health(): PackageHealth;
};
export declare const graphql: {
    namespace: string;
    typeDefs: string;
    resolvers: {
        Query: {
            fileHealth: () => "ok" | "degraded" | "down";
            fileList: (_: unknown, __: unknown, ctx: RequestContext) => StoredFile[];
            fileProcessedList: (_: unknown, __: unknown, ctx: RequestContext) => ProcessedFile[];
            fileDetectMime: (_: unknown, args: {
                fileName: string;
            }) => string;
            fileLauncher: (_: unknown, __: unknown, ctx: RequestContext) => string;
        };
        Mutation: {
            fileUploadText: (_: unknown, args: {
                input: UploadInput;
            }, ctx: RequestContext) => Promise<StoredFile>;
            fileProcess: (_: unknown, args: {
                path: string;
                provider?: StorageProviderName;
            }, ctx: RequestContext) => Promise<ProcessedFile>;
            fileDelete: (_: unknown, args: {
                path: string;
                provider?: StorageProviderName;
            }, ctx: RequestContext) => Promise<boolean>;
        };
    };
    migrations: string[];
};
export declare function createPackage(): PackageModule;
export * from './contracts.js';
export * from './package-structure.js';
export * from './observability.js';
export * from './launcher.js';
export * from './observability.js';
