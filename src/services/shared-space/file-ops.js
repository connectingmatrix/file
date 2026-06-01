"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.download = exports.writeBuffer = exports.writeText = exports.copyPath = exports.movePath = exports.removePath = exports.makeFolder = exports.readFilePreview = exports.statFile = exports.fileSha256 = exports.SHARED_SPACE_PREVIEW_BYTES = exports.assertFileName = exports.assertWritable = void 0;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_stream_1 = require("node:stream");
const promises_1 = require("node:stream/promises");
const routing_controllers_1 = require("routing-controllers");
const path_1 = require("./path");
const policy_1 = require("./policy");
const assertWritable = (limit, bytes) => {
    if (limit.usedBytes + bytes > limit.quotaBytes)
        throw new routing_controllers_1.BadRequestError('Drive quota exceeded.');
};
exports.assertWritable = assertWritable;
const assertFileName = (path) => {
    if ((0, path_1.blockedName)(path))
        throw new routing_controllers_1.BadRequestError('Executable script files are not allowed in shared space.');
};
exports.assertFileName = assertFileName;
exports.SHARED_SPACE_PREVIEW_BYTES = 30 * 1024 * 1024;
const MIME_TYPES_BY_EXTENSION = {
    '.aac': 'audio/aac',
    '.avi': 'video/x-msvideo',
    '.csv': 'text/csv',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.gif': 'image/gif',
    '.html': 'text/html',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.ogg': 'audio/ogg',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.svg': 'image/svg+xml',
    '.tsv': 'text/tab-separated-values',
    '.txt': 'text/plain',
    '.wav': 'audio/wav',
    '.webm': 'video/webm',
    '.webp': 'image/webp',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xml': 'application/xml',
};
const mimeTypeForName = (name) => MIME_TYPES_BY_EXTENSION[(0, node_path_1.extname)(name).toLowerCase()] || 'application/octet-stream';
const assertNoSymlinkPath = (root, target) => {
    let cursor = root;
    for (const part of (0, node_path_1.relative)(root, target).split(node_path_1.sep).filter(Boolean)) {
        cursor = (0, node_path_1.join)(cursor, part);
        if ((0, node_fs_1.existsSync)(cursor) && (0, node_fs_1.lstatSync)(cursor).isSymbolicLink())
            throw new routing_controllers_1.BadRequestError('Symbolic links are not allowed in shared space.');
    }
};
const assertNoHardlink = (stat) => {
    if (!stat.isDirectory() && stat.nlink > 1)
        throw new routing_controllers_1.BadRequestError('Hard links are not allowed in shared space.');
};
const assertProtectedAgentFolder = (inputPath, stat) => {
    const normalized = inputPath.replace(/\\/g, '/').replace(/^\/drive\/?/, '/');
    if (stat.isDirectory() && /^\/[^/]+\/agents\/[^/]+\/(?:FILES|artifacts\/FILES)\/?$/.test(normalized)) {
        throw new routing_controllers_1.BadRequestError('AI Agent Drive file folder is protected and cannot be deleted. Remove individual files from agent memory instead.');
    }
};
const fileSha256 = async (path) => await new Promise((resolve, reject) => {
    const hash = (0, node_crypto_1.createHash)('sha256');
    (0, node_fs_1.createReadStream)(path)
        .on('data', (chunk) => hash.update(chunk))
        .on('end', () => resolve(hash.digest('hex')))
        .on('error', reject);
});
exports.fileSha256 = fileSha256;
const statFile = async (root, inputPath) => {
    const path = (0, path_1.hostPath)(root, inputPath);
    if (!(0, node_fs_1.existsSync)(path))
        throw new routing_controllers_1.BadRequestError('Shared space file was not found.');
    assertNoSymlinkPath(root, path);
    const stat = (0, node_fs_1.lstatSync)(path);
    if (stat.isSymbolicLink())
        throw new routing_controllers_1.BadRequestError('Symbolic links are not allowed in shared space.');
    assertNoHardlink(stat);
    return {
        name: (0, node_path_1.basename)(path),
        path: (0, path_1.publicPath)(root, path),
        kind: stat.isDirectory() ? 'folder' : 'file',
        size: stat.size,
        checksum: stat.isDirectory() ? null : await (0, exports.fileSha256)(path),
        updatedAt: stat.mtime.toISOString(),
    };
};
exports.statFile = statFile;
const readFilePreview = async (root, inputPath, maxPreviewBytes = exports.SHARED_SPACE_PREVIEW_BYTES) => {
    const file = await (0, exports.statFile)(root, inputPath);
    const mimeType = file.kind === 'folder' ? 'inode/directory' : mimeTypeForName(file.name);
    const metadata = { ...file, mimeType, sizeBytes: file.size };
    if (file.kind !== 'file' || file.size > maxPreviewBytes)
        return metadata;
    return { ...metadata, contentBase64: (0, node_fs_1.readFileSync)((0, path_1.hostPath)(root, file.path)).toString('base64') };
};
exports.readFilePreview = readFilePreview;
const makeFolder = (root, inputPath) => {
    const path = (0, path_1.hostPath)(root, inputPath);
    assertNoSymlinkPath(root, path);
    (0, node_fs_1.mkdirSync)(path, { recursive: true, mode: 0o700 });
    return { name: (0, node_path_1.basename)(path), path: (0, path_1.publicPath)(root, path), kind: 'folder', size: 0, checksum: null, updatedAt: new Date().toISOString() };
};
exports.makeFolder = makeFolder;
const removePath = (root, inputPath, options = {}) => {
    if (options.allowProtected !== true)
        (0, policy_1.assertUserDrivePathAllowed)(inputPath);
    const path = (0, path_1.hostPath)(root, inputPath);
    if (!(0, node_fs_1.existsSync)(path))
        return { name: (0, node_path_1.basename)(path), path: (0, path_1.publicPath)(root, path), kind: 'missing', size: 0, checksum: null, deleted: false };
    assertNoSymlinkPath(root, path);
    if ((0, node_fs_1.lstatSync)(path).isSymbolicLink())
        throw new routing_controllers_1.BadRequestError('Symbolic links are not allowed in shared space.');
    const stat = (0, node_fs_1.lstatSync)(path);
    assertNoHardlink(stat);
    assertProtectedAgentFolder(inputPath, stat);
    (0, node_fs_1.rmSync)(path, { recursive: true, force: true });
    return {
        name: (0, node_path_1.basename)(path),
        path: (0, path_1.publicPath)(root, path),
        kind: stat.isDirectory() ? 'folder' : 'file',
        size: stat.size,
        checksum: null,
        deleted: true,
    };
};
exports.removePath = removePath;
const movePath = (root, from, to) => {
    (0, policy_1.assertUserDrivePathAllowed)(from);
    (0, policy_1.assertUserDrivePathAllowed)(to);
    (0, exports.assertFileName)(to);
    const source = (0, path_1.hostPath)(root, from);
    const target = (0, path_1.hostPath)(root, to);
    assertNoSymlinkPath(root, source);
    assertNoSymlinkPath(root, target);
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(target), { recursive: true, mode: 0o700 });
    (0, node_fs_1.renameSync)(source, target);
    const stat = (0, node_fs_1.lstatSync)(target);
    assertNoHardlink(stat);
    return {
        from: (0, path_1.publicPath)(root, source),
        name: (0, node_path_1.basename)(target),
        path: (0, path_1.publicPath)(root, target),
        kind: stat.isDirectory() ? 'folder' : 'file',
        size: stat.size,
        checksum: null,
        updatedAt: stat.mtime.toISOString(),
    };
};
exports.movePath = movePath;
const copyPath = (root, from, to) => {
    (0, policy_1.assertUserDrivePathAllowed)(from);
    (0, policy_1.assertUserDrivePathAllowed)(to);
    (0, exports.assertFileName)(to);
    const source = (0, path_1.hostPath)(root, from);
    const target = (0, path_1.hostPath)(root, to);
    assertNoSymlinkPath(root, source);
    assertNoSymlinkPath(root, target);
    const sourceStat = (0, node_fs_1.lstatSync)(source);
    if (sourceStat.isDirectory())
        throw new routing_controllers_1.BadRequestError('Folder copy is not supported in shared space v1.');
    assertNoHardlink(sourceStat);
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(target), { recursive: true, mode: 0o700 });
    (0, node_fs_1.copyFileSync)(source, target);
    const stat = (0, node_fs_1.lstatSync)(target);
    return {
        from: (0, path_1.publicPath)(root, source),
        name: (0, node_path_1.basename)(target),
        path: (0, path_1.publicPath)(root, target),
        kind: 'file',
        size: stat.size,
        checksum: null,
        updatedAt: stat.mtime.toISOString(),
    };
};
exports.copyPath = copyPath;
const writeText = (root, inputPath, text, options = {}) => {
    if (options.allowProtected !== true)
        (0, policy_1.assertUserDrivePathAllowed)(inputPath);
    (0, exports.assertFileName)(inputPath);
    const path = (0, path_1.hostPath)(root, inputPath);
    assertNoSymlinkPath(root, path);
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(path), { recursive: true, mode: 0o700 });
    (0, node_fs_1.writeFileSync)(path, text, { mode: 0o600 });
    return {
        name: (0, node_path_1.basename)(path),
        path: (0, path_1.publicPath)(root, path),
        kind: 'file',
        size: Buffer.byteLength(text),
        checksum: null,
        updatedAt: new Date().toISOString(),
    };
};
exports.writeText = writeText;
const writeBuffer = (root, inputPath, content, options = {}) => {
    if (options.allowProtected !== true)
        (0, policy_1.assertUserDrivePathAllowed)(inputPath);
    (0, exports.assertFileName)(inputPath);
    const path = (0, path_1.hostPath)(root, inputPath);
    assertNoSymlinkPath(root, path);
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(path), { recursive: true, mode: 0o700 });
    (0, node_fs_1.writeFileSync)(path, content, { mode: 0o600 });
    return {
        name: (0, node_path_1.basename)(path),
        path: (0, path_1.publicPath)(root, path),
        kind: 'file',
        size: content.byteLength,
        checksum: null,
        updatedAt: new Date().toISOString(),
    };
};
exports.writeBuffer = writeBuffer;
const download = async (root, url, inputPath, maxBytes = 0) => {
    (0, policy_1.assertUserDrivePathAllowed)(inputPath);
    (0, exports.assertFileName)(inputPath);
    const target = (0, path_1.hostPath)(root, inputPath);
    assertNoSymlinkPath(root, target);
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(target), { recursive: true, mode: 0o700 });
    const response = await fetch(url);
    if (!response.ok || !response.body)
        throw new routing_controllers_1.BadRequestError(`Download failed with status ${response.status}.`);
    const length = Number(response.headers.get('content-length') || 0);
    if (maxBytes > 0 && length > maxBytes)
        throw new routing_controllers_1.BadRequestError('Download exceeds remaining shared space quota.');
    let written = 0;
    const guard = new node_stream_1.Transform({
        transform(chunk, _encoding, callback) {
            written += Buffer.byteLength(chunk);
            callback(maxBytes > 0 && written > maxBytes ? new routing_controllers_1.BadRequestError('Download exceeds remaining shared space quota.') : null, chunk);
        },
    });
    await (0, promises_1.pipeline)(node_stream_1.Readable.fromWeb(response.body), guard, (0, node_fs_1.createWriteStream)(target, { mode: 0o600 }));
    return (0, exports.statFile)(root, (0, path_1.publicPath)(root, target));
};
exports.download = download;
