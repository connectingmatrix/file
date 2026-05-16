import { InMemoryRepository } from './entity/repository.js';
import { makeId, nowIso } from './contracts.js';
import { createStubLauncher } from './launcher.js';
import { PackageObservability } from './observability.js';
const files = new InMemoryRepository('file');
const processedFiles = new InMemoryRepository('processed_file');
const memoryStore = new Map();
const providers = new Map();
const processors = new Map();
function bytes(input) { if (typeof input === 'string')
    return new Uint8Array(Buffer.from(input)); if (input instanceof Uint8Array)
    return input; return new Uint8Array(input); }
function toText(input) { return typeof input === 'string' ? input : Buffer.from(input).toString('utf8'); }
export function detectMimeType(fileName, data) { const lower = fileName.toLowerCase(); if (lower.endsWith('.node'))
    return 'application/x-connectingmatrix-node'; if (lower.endsWith('.zip'))
    return 'application/zip'; if (lower.endsWith('.json'))
    return 'application/json'; if (lower.endsWith('.csv'))
    return 'text/csv'; if (lower.endsWith('.md'))
    return 'text/markdown'; if (lower.endsWith('.txt'))
    return 'text/plain'; if (lower.endsWith('.html'))
    return 'text/html'; if (lower.endsWith('.ts') || lower.endsWith('.tsx'))
    return 'text/typescript'; if (lower.endsWith('.js') || lower.endsWith('.jsx'))
    return 'text/javascript'; if (lower.endsWith('.pdf'))
    return 'application/pdf'; if (lower.endsWith('.png'))
    return 'image/png'; if (lower.endsWith('.jpg') || lower.endsWith('.jpeg'))
    return 'image/jpeg'; if (data?.[0] === 0x50 && data?.[1] === 0x4b)
    return 'application/zip'; return 'application/octet-stream'; }
const memoryProvider = { name: 'memory', async upload(input, context = {}) { const data = bytes(input.content); const path = input.path ?? `${context.organizationId ?? context.userId ?? 'anonymous'}/${makeId('file')}/${input.fileName}`; memoryStore.set(path, data); return files.create({ path, fileName: input.fileName, contentType: input.contentType ?? detectMimeType(input.fileName, data), size: data.byteLength, provider: 'memory', metadata: input.metadata }, context); }, async download(path, context = {}) { const item = files.list(context, { limit: 500 }).items.find((file) => file.path === path && file.provider === 'memory'); if (!item)
        throw new Error(`File not found in current scope: ${path}`); const data = memoryStore.get(path); if (!data)
        throw new Error(`Memory file missing: ${path}`); return data; }, async delete(path, context = {}) { const item = files.list(context, { limit: 500 }).items.find((file) => file.path === path && file.provider === 'memory'); if (!item)
        return false; memoryStore.delete(path); files.delete(item.id, context); return true; } };
providers.set('memory', memoryProvider);
export function createSupabaseStorageProvider(options) { return { name: 'supabase', async upload(input, context = {}) { const data = bytes(input.content); const path = input.path ?? `${context.organizationId ?? context.userId ?? 'anonymous'}/${makeId('file')}/${input.fileName}`; const result = await options.client.storage.from(options.bucket).upload(path, data, { contentType: input.contentType ?? detectMimeType(input.fileName, data), upsert: options.upsert ?? true }); if (result.error)
        throw new Error(result.error.message ?? 'Supabase upload failed'); return files.create({ path: result.data?.path ?? path, fileName: input.fileName, contentType: input.contentType ?? detectMimeType(input.fileName, data), size: data.byteLength, provider: 'supabase', metadata: { ...input.metadata, bucket: options.bucket, fullPath: result.data?.fullPath } }, context); }, async download(path, context = {}) { const item = files.list(context, { limit: 500 }).items.find((file) => file.path === path && file.provider === 'supabase'); if (!item)
        throw new Error(`Supabase file not found in current scope: ${path}`); const result = await options.client.storage.from(options.bucket).download(path); if (result.error || result.data == null)
        throw new Error(result.error?.message ?? `Supabase file not found: ${path}`); if (typeof result.data === 'string')
        return bytes(result.data); if (result.data instanceof Uint8Array)
        return result.data; if (result.data instanceof ArrayBuffer)
        return new Uint8Array(result.data); return new Uint8Array(await result.data.arrayBuffer()); }, async delete(path, context = {}) { const item = files.list(context, { limit: 500 }).items.find((file) => file.path === path && file.provider === 'supabase'); if (!item)
        return false; const result = await options.client.storage.from(options.bucket).remove([path]); if (result.error)
        throw new Error(result.error.message ?? 'Supabase delete failed'); files.delete(item.id, context); return true; } }; }
async function loadJSZip() { try {
    const mod = await import('jszip');
    return mod.default ?? mod;
}
catch {
    return undefined;
} }
function fallbackZip(filesToZip) { return bytes(JSON.stringify({ format: 'connectingmatrix-fallback-zip-v1', files: filesToZip.map((f) => ({ path: f.path, content: typeof f.content === 'string' ? f.content : Buffer.from(f.content).toString('base64'), encoding: typeof f.content === 'string' ? 'utf8' : 'base64' })) })); }
function fallbackUnzip(data) { try {
    const parsed = JSON.parse(toText(data));
    if (parsed?.format !== 'connectingmatrix-fallback-zip-v1')
        return undefined;
    return parsed.files.map((f) => ({ path: f.path, content: f.encoding === 'base64' ? new Uint8Array(Buffer.from(f.content, 'base64')) : f.content }));
}
catch {
    return undefined;
} }
function registerDefaultProcessors() { processors.set('text', { name: 'text', contentTypes: ['text/plain', 'text/markdown', 'text/csv', 'text/html', 'application/json', 'text/typescript', 'text/javascript'], process: ({ bytes: data, file }) => ({ text: toText(data), metadata: { lineCount: toText(data).split(/\r?\n/).length, fileName: file.fileName } }) }); processors.set('binary-summary', { name: 'binary-summary', contentTypes: ['application/octet-stream', 'application/pdf', 'image/png', 'image/jpeg', 'application/zip', 'application/x-connectingmatrix-node'], process: ({ file, bytes: data }) => ({ text: '', metadata: { byteLength: data.byteLength, contentType: file.contentType, extractedTextAvailable: false } }) }); }
registerDefaultProcessors();
export const File = { registerProvider(provider) { providers.set(provider.name, provider); return File; }, registerProcessor(processor) { processors.set(processor.name, processor); return File; }, detectMimeType, async upload(input, context = {}) { const provider = providers.get(input.provider ?? 'memory') ?? memoryProvider; return provider.upload(input, context); }, async download(path, provider = 'memory', context = {}) { return (providers.get(provider) ?? memoryProvider).download(path, context); }, async remove(path, provider = 'memory', context = {}) { return (providers.get(provider) ?? memoryProvider).delete(path, context); }, list(context = {}) { return files.list(context, { limit: 500 }); }, processed(context = {}) { return processedFiles.list(context, { limit: 500 }); }, async process(path, provider = 'memory', context = {}, processorName) { const file = files.list(context, { limit: 500 }).items.find((item) => item.path === path && item.provider === provider); if (!file)
        throw new Error(`File not found in current scope: ${path}`); const data = await File.download(path, provider, context); const processor = processorName ? processors.get(processorName) : [...processors.values()].find((candidate) => candidate.contentTypes.includes(file.contentType)) ?? processors.get('binary-summary'); if (!processor)
        throw new Error(`No processor registered for ${file.contentType}`); const output = await processor.process({ file, bytes: data, text: file.contentType.startsWith('text/') ? toText(data) : undefined, context }); return processedFiles.create({ fileId: file.id, fileName: file.fileName, contentType: file.contentType, processor: processor.name, ...output }, context); }, async zip(filesToZip) { const JSZip = await loadJSZip(); if (!JSZip)
        return fallbackZip(filesToZip); const zip = new JSZip(); for (const file of filesToZip)
        zip.file(file.path, file.content); return await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } }); }, async unzip(archive) { const archiveBytes = typeof archive === 'string' ? new Uint8Array(Buffer.from(archive, 'base64')) : archive instanceof Uint8Array ? archive : new Uint8Array(archive); const fallback = fallbackUnzip(archiveBytes); if (fallback)
        return fallback; const JSZip = await loadJSZip(); if (!JSZip || typeof JSZip.loadAsync !== 'function')
        throw new Error('JSZip is required to read standard zip archives'); const zip = await JSZip.loadAsync(archiveBytes); const out = []; for (const name of Object.keys(zip.files).filter((key) => !zip.files[key].dir)) {
        const content = await zip.files[name].async('string');
        out.push({ path: name, content: typeof content === 'string' ? content : toText(content) });
    } return out; }, createSourceArchiveAdapter(provider = 'memory') { return { createArchive: (entries) => File.zip(entries), extractArchive: (archive) => File.unzip(archive), upload: async (name, archive, context) => { const record = await File.upload({ fileName: name, content: archive, provider, contentType: 'application/zip' }, context); return { path: record.path, provider: record.provider, size: record.size }; }, download: (path, context) => File.download(path, provider, context) }; }, createNodePackageAdapter(provider = 'memory') { return { createNodePackage: async (manifest) => File.zip([{ path: 'node.json', content: JSON.stringify({ format: 'connectingmatrix-node-package-v1', ...manifest }, null, 2) }]), extractNodePackage: async (archive) => { const entries = await File.unzip(archive); const manifest = entries.find((entry) => entry.path === 'node.json' || entry.path.endsWith('/node.json')); if (!manifest)
            throw new Error('Invalid .node package: node.json not found'); const text = typeof manifest.content === 'string' ? manifest.content : Buffer.from(manifest.content).toString('utf8'); return JSON.parse(text); }, uploadNodePackage: async (name, archive, context) => { const fileName = name.endsWith('.node') ? name : `${name}.node`; const record = await File.upload({ fileName, content: archive, provider, contentType: 'application/x-connectingmatrix-node', metadata: { nodePackage: true } }, context); return { path: record.path, provider: record.provider, size: record.size }; } }; }, launcher: createStubLauncher, health() { return { name: '@connectingmatrix/file', status: 'ok', checkedAt: nowIso(), details: { providers: [...providers.keys()], processors: [...processors.keys()], files: files.list({ root: true }).total, processed: processedFiles.list({ root: true }).total, ownsZipAndMimeProcessing: true, ...PackageObservability.healthDetails() } }; } };
export const graphql = { namespace: 'file', typeDefs: `type StoredFile { id: ID!, path: String!, fileName: String!, contentType: String!, size: Int!, provider: String!, createdAt: String!, updatedAt: String! } type ProcessedFile { id: ID!, fileId: ID!, fileName: String!, contentType: String!, processor: String!, text: String, createdAt: String!, updatedAt: String! } input UploadTextFileInput { path: String, fileName: String!, content: String!, contentType: String, provider: String } type Query { fileHealth: String!, fileList: [StoredFile!]!, fileProcessedList: [ProcessedFile!]!, fileDetectMime(fileName: String!): String!, fileLauncher: String! } type Mutation { fileUploadText(input: UploadTextFileInput!): StoredFile!, fileProcess(path: String!, provider: String): ProcessedFile!, fileDelete(path: String!, provider: String): Boolean! }`, resolvers: { Query: { fileHealth: () => File.health().status, fileList: (_, __, ctx) => File.list(ctx).items, fileProcessedList: (_, __, ctx) => File.processed(ctx).items, fileDetectMime: (_, args) => File.detectMimeType(args.fileName), fileLauncher: (_, __, ctx) => JSON.stringify(createStubLauncher(ctx)) }, Mutation: { fileUploadText: (_, args, ctx) => File.upload(args.input, ctx), fileProcess: (_, args, ctx) => File.process(args.path, args.provider ?? 'memory', ctx), fileDelete: (_, args, ctx) => File.remove(args.path, args.provider ?? 'memory', ctx) } }, migrations: ['migrations/0001_init.sql'] };
export function createPackage() { return { name: '@connectingmatrix/file', version: '0.2.0', health: () => File.health(), graphql, migrations: graphql.migrations, launcher: createStubLauncher, runtime: { File, observability: PackageObservability }, routes: [{ method: 'GET', path: '/file/health', handler: () => File.health() }, { method: 'GET', path: '/file/launcher', handler: (request) => createStubLauncher(request.context ?? {}) }, { method: 'POST', path: '/file/process', handler: (request) => File.process(String(request.body?.path ?? '')) }] }; }
export * from './contracts.js';
export * from './package-structure.js';
export * from './observability.js';
export * from './launcher.js';
export * from './observability.js';
