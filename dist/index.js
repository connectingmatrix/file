import { InMemoryRepository } from './entity/repository.js';
import { makeId, nowIso } from './contracts.js';
const files = new InMemoryRepository('file');
const providers = new Map();
function bytes(input) {
    if (typeof input === 'string')
        return new TextEncoder().encode(input);
    if (input instanceof Uint8Array)
        return input;
    return new Uint8Array(input);
}
function toBase64(data) {
    return Buffer.from(data).toString('base64');
}
function fromBase64(data) {
    return new Uint8Array(Buffer.from(data, 'base64'));
}
const memoryProvider = {
    name: 'memory',
    async upload(input, context = {}) {
        const data = bytes(input.content);
        return files.create({
            path: input.path ?? `memory/${makeId('file')}/${input.fileName}`,
            fileName: input.fileName,
            contentType: input.contentType,
            size: data.byteLength,
            provider: 'memory',
            base64: toBase64(data),
            metadata: input.metadata,
        }, context);
    },
    async download(path, context = {}) {
        const item = files.list(context, { limit: 500 }).items.find((file) => file.path === path);
        if (!item?.base64)
            throw new Error(`File not found: ${path}`);
        return fromBase64(item.base64);
    },
    async delete(path, context = {}) {
        const item = files.list(context, { limit: 500 }).items.find((file) => file.path === path);
        return item ? files.delete(item.id, context) : false;
    },
};
providers.set('memory', memoryProvider);
async function loadJSZip() {
    try {
        const mod = await import('jszip');
        return (mod.default ?? mod);
    }
    catch {
        return undefined;
    }
}
const FALLBACK_ARCHIVE_PREFIX = 'CMZIP1:';
function fallbackZip(filesToZip) {
    const payload = filesToZip.map((file) => ({ path: file.path, content: typeof file.content === 'string' ? file.content : toBase64(bytes(file.content)), binary: typeof file.content !== 'string' }));
    return new TextEncoder().encode(FALLBACK_ARCHIVE_PREFIX + JSON.stringify(payload));
}
function fallbackUnzip(archive) {
    const text = new TextDecoder().decode(archive);
    if (!text.startsWith(FALLBACK_ARCHIVE_PREFIX))
        return undefined;
    const payload = JSON.parse(text.slice(FALLBACK_ARCHIVE_PREFIX.length));
    return payload.map((entry) => ({ path: entry.path, content: entry.binary ? fromBase64(entry.content) : entry.content }));
}
export function createSupabaseStorageProvider(options) {
    return {
        name: 'supabase',
        async upload(input, context = {}) {
            const data = bytes(input.content);
            const path = input.path ?? `${context.organizationId ?? context.userId ?? 'anonymous'}/${makeId('file')}/${input.fileName}`;
            const result = await options.client.storage.from(options.bucket).upload(path, data, {
                contentType: input.contentType,
                upsert: options.upsert ?? true,
            });
            if (result.error)
                throw new Error(result.error.message ?? 'Supabase upload failed');
            return files.create({
                path: result.data?.path ?? path,
                fileName: input.fileName,
                contentType: input.contentType,
                size: data.byteLength,
                provider: 'supabase',
                metadata: { ...input.metadata, bucket: options.bucket, fullPath: result.data?.fullPath },
            }, context);
        },
        async download(path, context = {}) {
            const item = files.list(context, { limit: 500 }).items.find((file) => file.path === path && file.provider === 'supabase');
            if (!item)
                throw new Error(`Supabase file not found in current scope: ${path}`);
            const result = await options.client.storage.from(options.bucket).download(path);
            if (result.error || result.data == null)
                throw new Error(result.error?.message ?? `Supabase file not found: ${path}`);
            if (typeof result.data === 'string')
                return bytes(result.data);
            if (result.data instanceof Uint8Array)
                return result.data;
            if (result.data instanceof ArrayBuffer)
                return new Uint8Array(result.data);
            return new Uint8Array(await result.data.arrayBuffer());
        },
        async delete(path, context = {}) {
            const item = files.list(context, { limit: 500 }).items.find((file) => file.path === path && file.provider === 'supabase');
            if (!item)
                return false;
            const result = await options.client.storage.from(options.bucket).remove([path]);
            if (result.error)
                throw new Error(result.error.message ?? 'Supabase delete failed');
            files.delete(item.id, context);
            return true;
        },
    };
}
export const File = {
    registerProvider(provider) { providers.set(provider.name, provider); return File; },
    async upload(input, context = {}) {
        const provider = providers.get(input.provider ?? 'memory') ?? memoryProvider;
        return provider.upload(input, context);
    },
    async download(path, provider = 'memory', context = {}) {
        return (providers.get(provider) ?? memoryProvider).download(path, context);
    },
    async remove(path, provider = 'memory', context = {}) {
        return (providers.get(provider) ?? memoryProvider).delete(path, context);
    },
    list(context = {}) { return files.list(context, { limit: 500 }); },
    async zip(filesToZip) {
        const JSZip = await loadJSZip();
        if (!JSZip)
            return fallbackZip(filesToZip);
        const zip = new JSZip();
        for (const file of filesToZip)
            zip.file(file.path, file.content);
        return await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } });
    },
    async unzip(archive) {
        const bytesArchive = typeof archive === 'string' ? new Uint8Array(Buffer.from(archive, 'base64')) : archive instanceof Uint8Array ? archive : new Uint8Array(archive);
        const fallback = fallbackUnzip(bytesArchive);
        if (fallback)
            return fallback;
        const JSZip = await loadJSZip();
        if (!JSZip || !('loadAsync' in JSZip) || typeof JSZip.loadAsync !== 'function')
            throw new Error('JSZip is required to read standard zip archives');
        const zip = await JSZip.loadAsync(bytesArchive);
        const out = [];
        const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
        for (const name of names)
            out.push({ path: name, content: await zip.files[name].async('string') });
        return out;
    },
    health() { return { name: '@connectingmatrix/file', status: 'ok', checkedAt: nowIso(), details: { providers: [...providers.keys()], files: files.list({ root: true }).total } }; },
};
export const graphql = {
    namespace: 'file',
    typeDefs: `
    type StoredFile { id: ID!, path: String!, fileName: String!, contentType: String, size: Int!, provider: String!, createdAt: String!, updatedAt: String! }
    input UploadTextFileInput { path: String, fileName: String!, content: String!, contentType: String }
    type Query { fileHealth: String!, fileList: [StoredFile!]! }
    type Mutation { fileUploadText(input: UploadTextFileInput!): StoredFile!, fileDelete(path: String!): Boolean! }
  `,
    resolvers: {
        Query: { fileHealth: () => File.health().status, fileList: (_, __, ctx) => File.list(ctx).items },
        Mutation: {
            fileUploadText: (_, args, ctx) => File.upload(args.input, ctx),
            fileDelete: (_, args, ctx) => File.remove(args.path, 'memory', ctx),
        },
    },
    migrations: ['migrations/0001_init.sql'],
};
export function createPackage() {
    return { name: '@connectingmatrix/file', version: '0.1.0', health: () => File.health(), graphql, migrations: graphql.migrations, routes: [{ method: 'GET', path: '/file/health', handler: () => File.health() }] };
}
export * from './contracts.js';
