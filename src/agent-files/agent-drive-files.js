"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentDriveRoot = agentDriveRoot;
exports.agentDriveFolder = agentDriveFolder;
exports.agentArtifactFolder = agentArtifactFolder;
exports.writeAgentDriveFile = writeAgentDriveFile;
exports.writeAgentArtifactFile = writeAgentArtifactFile;
exports.writeAgentDriveFileStream = writeAgentDriveFileStream;
const node_crypto_1 = require("node:crypto");
const node_crypto_2 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_stream_1 = require("node:stream");
const promises_1 = require("node:stream/promises");
const routing_controllers_1 = require("routing-controllers");
const file_ops_1 = require("../services/shared-space/file-ops");
const path_1 = require("../services/shared-space/path");
const clean = (value) => value.replace(/[^a-zA-Z0-9_.-]/g, '_');
const safeFileName = (value) => clean((0, node_path_1.basename)(value || 'agent-file')) || 'agent-file';
function agentDriveRoot(scope) {
    const organizationId = clean(scope.organizationId || '');
    const userId = clean(scope.userId || '');
    if (!organizationId && !userId)
        throw new routing_controllers_1.BadRequestError('A user or organization scope is required for AI Agent Drive storage.');
    const driveScope = organizationId ? { kind: 'organization', organizationId } : { kind: 'user', userId };
    return { root: (0, path_1.getDriveRoot)(driveScope), scopeKind: driveScope.kind, scopeId: organizationId || userId };
}
function agentDriveFolder(scope, agentId) {
    const resolved = agentDriveRoot(scope);
    const folderPath = `/${resolved.scopeId}/agents/${clean(agentId)}/FILES`;
    const folderHostPath = (0, node_path_1.resolve)(resolved.root, folderPath.slice(1));
    const base = (0, node_path_1.resolve)(resolved.root);
    if (folderHostPath !== base && !folderHostPath.startsWith(`${base}${node_path_1.sep}`))
        throw new routing_controllers_1.BadRequestError('Agent Drive folder escaped the mounted drive.');
    (0, node_fs_1.mkdirSync)(folderHostPath, { recursive: true, mode: 0o700 });
    return { ...resolved, folderPath: `/drive${folderPath}`, folderHostPath, deletable: false };
}
function agentArtifactFolder(scope, agentId) {
    const resolved = agentDriveRoot(scope);
    const folderPath = `/${resolved.scopeId}/agents/${clean(agentId)}/artifacts/FILES`;
    const folderHostPath = (0, node_path_1.resolve)(resolved.root, folderPath.slice(1));
    const base = (0, node_path_1.resolve)(resolved.root);
    if (folderHostPath !== base && !folderHostPath.startsWith(`${base}${node_path_1.sep}`))
        throw new routing_controllers_1.BadRequestError('Agent artifact folder escaped the mounted drive.');
    (0, node_fs_1.mkdirSync)(folderHostPath, { recursive: true, mode: 0o700 });
    return { ...resolved, folderPath: `/drive${folderPath}`, folderHostPath, deletable: false };
}
async function writeAgentDriveFile(input) {
    if (!input.agentId)
        throw new routing_controllers_1.BadRequestError('agentId is required.');
    if (!input.scope.userId && !input.scope.organizationId)
        throw new routing_controllers_1.BadRequestError('A user or organization scope is required for AI Agent Drive upload.');
    const folder = agentDriveFolder(input.scope, input.agentId);
    const id = input.replaceAttachmentId || (0, node_crypto_1.randomUUID)();
    const fileName = `${id}-${safeFileName(input.fileName)}`;
    const drivePath = `${folder.folderPath}/${fileName}`;
    const hostPath = (0, node_path_1.join)(folder.folderHostPath, fileName);
    const base = (0, node_path_1.resolve)(folder.root);
    const target = (0, node_path_1.resolve)(hostPath);
    if (target !== base && !target.startsWith(`${base}${node_path_1.sep}`))
        throw new routing_controllers_1.BadRequestError('Agent Drive file escaped the mounted drive.');
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(target), { recursive: true, mode: 0o700 });
    const stat = (0, file_ops_1.writeBuffer)(folder.root, drivePath, input.body, { allowProtected: true });
    const detail = (0, node_fs_1.existsSync)(hostPath) ? await (0, file_ops_1.statFile)(folder.root, drivePath) : stat;
    return {
        id,
        scopeKind: folder.scopeKind,
        scopeId: folder.scopeId,
        agentId: input.agentId,
        folderPath: folder.folderPath,
        folderHostPath: folder.folderHostPath,
        folderDeletable: false,
        drivePath: detail.path || (0, path_1.publicPath)(folder.root, target),
        hostPath: target,
        fileName: safeFileName(input.fileName),
        mimeType: input.mimeType || 'application/octet-stream',
        sizeBytes: input.body.byteLength,
        checksum: detail.checksum || null,
        storageProvider: 'drive',
    };
}
async function writeAgentArtifactFile(input) {
    if (!input.agentId)
        throw new routing_controllers_1.BadRequestError('agentId is required.');
    if (!input.scope.userId && !input.scope.organizationId)
        throw new routing_controllers_1.BadRequestError('A user or organization scope is required for AI Agent artifact storage.');
    const folder = agentArtifactFolder(input.scope, input.agentId);
    const id = (0, node_crypto_1.randomUUID)();
    const fileName = `${id}-${safeFileName(input.fileName)}`;
    const drivePath = `${folder.folderPath}/${fileName}`;
    const hostPath = (0, node_path_1.join)(folder.folderHostPath, fileName);
    const base = (0, node_path_1.resolve)(folder.root);
    const target = (0, node_path_1.resolve)(hostPath);
    if (target !== base && !target.startsWith(`${base}${node_path_1.sep}`))
        throw new routing_controllers_1.BadRequestError('Agent artifact file escaped the mounted drive.');
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(target), { recursive: true, mode: 0o700 });
    const stat = (0, file_ops_1.writeBuffer)(folder.root, drivePath, input.body, { allowProtected: true });
    const detail = (0, node_fs_1.existsSync)(hostPath) ? await (0, file_ops_1.statFile)(folder.root, drivePath) : stat;
    return {
        id,
        scopeKind: folder.scopeKind,
        scopeId: folder.scopeId,
        agentId: input.agentId,
        folderPath: folder.folderPath,
        folderHostPath: folder.folderHostPath,
        folderDeletable: false,
        drivePath: detail.path || (0, path_1.publicPath)(folder.root, target),
        hostPath: target,
        fileName: safeFileName(input.fileName),
        mimeType: input.mimeType || 'text/plain',
        sizeBytes: input.body.byteLength,
        checksum: detail.checksum || null,
        storageProvider: 'drive',
    };
}
async function writeAgentDriveFileStream(input) {
    if (!input.agentId)
        throw new routing_controllers_1.BadRequestError('agentId is required.');
    if (!input.scope.userId && !input.scope.organizationId)
        throw new routing_controllers_1.BadRequestError('A user or organization scope is required for AI Agent Drive upload.');
    const folder = agentDriveFolder(input.scope, input.agentId);
    const id = input.replaceAttachmentId || (0, node_crypto_1.randomUUID)();
    const fileName = `${id}-${safeFileName(input.fileName)}`;
    const drivePath = `${folder.folderPath}/${fileName}`;
    const target = (0, node_path_1.resolve)((0, node_path_1.join)(folder.folderHostPath, fileName));
    const base = (0, node_path_1.resolve)(folder.root);
    if (target !== base && !target.startsWith(`${base}${node_path_1.sep}`))
        throw new routing_controllers_1.BadRequestError('Agent Drive file escaped the mounted drive.');
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(target), { recursive: true, mode: 0o700 });
    const hash = (0, node_crypto_2.createHash)('sha256');
    let sizeBytes = 0;
    const checksum = new node_stream_1.Transform({
        transform(chunk, _encoding, callback) {
            sizeBytes += chunk.byteLength;
            hash.update(chunk);
            callback(null, chunk);
        },
    });
    await (0, promises_1.pipeline)(input.stream, checksum, (0, node_fs_1.createWriteStream)(target, { mode: 0o600 }));
    const stat = (0, node_fs_1.lstatSync)(target);
    return {
        id,
        scopeKind: folder.scopeKind,
        scopeId: folder.scopeId,
        agentId: input.agentId,
        folderPath: folder.folderPath,
        folderHostPath: folder.folderHostPath,
        folderDeletable: false,
        drivePath: (0, path_1.publicPath)(folder.root, target),
        hostPath: target,
        fileName: safeFileName(input.fileName),
        mimeType: input.mimeType || 'application/octet-stream',
        sizeBytes: sizeBytes || stat.size || input.declaredSizeBytes || 0,
        checksum: hash.digest('hex'),
        storageProvider: 'drive',
    };
}
