"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadAgentFilesOperation = uploadAgentFilesOperation;
exports.deleteAiAgentFileOperation = deleteAiAgentFileOperation;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const agent_drive_files_1 = require("./agent-drive-files");
const agent_file_ingestion_hooks_1 = require("./agent-file-ingestion-hooks");
const AIAgentAttachmentEntity_1 = require("@connectingmatrix/orm/entities/AIAgentAttachmentEntity");
const emptyPayload = (agentId, status, message) => ({
    agentId,
    status,
    processId: null,
    attachmentIds: [],
    fileIds: [],
    fileNames: [],
    storagePaths: [],
    driveLinks: [],
    modes: [],
    requestedModes: [],
    fileShapeIds: [],
    fileShapeNames: [],
    deletedAttachmentIds: [],
    removedFromMemory: false,
    driveFilesDeleted: false,
    folderProtected: true,
    message,
});
const objectValue = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const textValue = (value) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value).trim() : '';
const boolValue = (value) => value === true || textValue(value).toLowerCase() === 'true';
const listText = (value) => {
    if (Array.isArray(value))
        return value.map((item) => textValue(item)).filter(Boolean);
    const raw = textValue(value);
    return raw ? raw.split(',').map((item) => item.trim()).filter(Boolean) : [];
};
const firstHeader = (headers, key) => {
    const direct = (headers === null || headers === void 0 ? void 0 : headers[key]) || (headers === null || headers === void 0 ? void 0 : headers[key.toLowerCase()]) || (headers === null || headers === void 0 ? void 0 : headers[key.toUpperCase()]);
    return Array.isArray(direct) ? textValue(direct[0]) : textValue(direct);
};
const contextUserId = (context, input) => {
    var _a, _b, _c;
    return textValue(context.userId) ||
        textValue((_a = context.ormRequestContext) === null || _a === void 0 ? void 0 : _a.user_id) ||
        firstHeader((_b = context.request) === null || _b === void 0 ? void 0 : _b.headers, 'x-giga-user-id') ||
        firstHeader((_c = context.request) === null || _c === void 0 ? void 0 : _c.headers, 'x-user-id') ||
        textValue(input.userId) ||
        textValue(input.user_id) ||
        'system';
};
const contextOrganizationId = (context, input) => {
    var _a, _b, _c, _d;
    return textValue(context.organizationId) ||
        textValue(context.organisationId) ||
        textValue((_a = context.ormRequestContext) === null || _a === void 0 ? void 0 : _a.organization_id) ||
        textValue((_b = context.ormRequestContext) === null || _b === void 0 ? void 0 : _b.organisation_id) ||
        firstHeader((_c = context.request) === null || _c === void 0 ? void 0 : _c.headers, 'x-giga-organization-id') ||
        firstHeader((_d = context.request) === null || _d === void 0 ? void 0 : _d.headers, 'x-organization-id') ||
        textValue(input.organizationId) ||
        textValue(input.organisationId) ||
        textValue(input.organization_id) ||
        null;
};
const fileModesAt = (input, index, fallback) => {
    const fileModes = Array.isArray(input.fileModes) ? input.fileModes : [];
    const candidate = objectValue(fileModes[index]);
    const modes = listText(candidate.modes || candidate.ingestionModes || candidate.ingestion_modes);
    return modes.length ? modes : fallback;
};
const uploadList = (files) => {
    if (!files)
        return [];
    return Array.isArray(files) ? files : [files];
};
async function readUpload(slot) {
    const file = await slot;
    const fileName = textValue(file.filename || file.name) || `agent-file-${(0, node_crypto_1.randomUUID)()}`;
    const mimeType = textValue(file.mimetype || file.type) || 'application/octet-stream';
    if (file.buffer) {
        const body = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer);
        return { fileName, mimeType, sizeBytes: Number(file.size || body.byteLength), body };
    }
    if (file.arrayBuffer) {
        const body = Buffer.from(await file.arrayBuffer());
        return { fileName, mimeType, sizeBytes: Number(file.size || body.byteLength), body };
    }
    if (file.createReadStream) {
        return { fileName, mimeType, sizeBytes: Number(file.size || 0), stream: file.createReadStream() };
    }
    if (file.stream) {
        return { fileName, mimeType, sizeBytes: Number(file.size || 0), stream: file.stream() };
    }
    throw new Error(`Unable to read upload ${fileName}.`);
}
const rowMetadata = (row) => objectValue(row.ingestion_metadata).driveFile
    ? objectValue(row.ingestion_metadata)
    : { driveFile: objectValue(row.drive_file) };
const rowDriveFile = (row) => {
    const metadata = rowMetadata(row);
    return objectValue((metadata.driveFile || metadata.drive_file || row.drive_file));
};
function removeHostFile(row) {
    const driveFile = rowDriveFile(row);
    const hostPath = textValue(driveFile.hostPath || driveFile.physicalPath);
    if (!hostPath)
        return false;
    const stat = (0, node_fs_1.lstatSync)(hostPath);
    if (stat.isDirectory() || stat.isSymbolicLink())
        return false;
    (0, node_fs_1.rmSync)(hostPath, { force: true });
    return true;
}
async function uploadAgentFilesOperation(input, files, context = {}) {
    const agentId = textValue(input.agentId || input.agent_id) || null;
    const draftId = textValue(input.draftId || input.draft_id);
    const storageAgentId = agentId || draftId;
    if (!storageAgentId)
        throw new Error('AI Agent file upload requires agentId or draftId.');
    const slots = uploadList(files);
    if (!slots.length)
        throw new Error('AI Agent file upload requires at least one file.');
    const ownerUserId = contextUserId(context, input);
    const organizationId = contextOrganizationId(context, input);
    const temporary = boolValue(input.temporary) || !agentId;
    const fileRole = textValue(input.fileRole || input.file_role) || 'DRIVE';
    const baseModes = listText(input.modes || input.ingestionModes || input.ingestion_modes);
    const modes = baseModes.length ? baseModes : ['AUTO'];
    const payload = emptyPayload(agentId, 'queued', 'AI Agent file upload queued.');
    const uploaded = [];
    for (let index = 0; index < slots.length; index += 1) {
        const upload = await readUpload(slots[index]);
        const selectedModes = fileModesAt(input, index, modes);
        const attachmentId = textValue(input.replaceAttachmentId || input.attachmentId || input.attachment_id) || (0, node_crypto_1.randomUUID)();
        const driveFile = upload.stream
            ? await (0, agent_drive_files_1.writeAgentDriveFileStream)({
                scope: { userId: ownerUserId, organizationId },
                agentId: storageAgentId,
                fileName: upload.fileName,
                mimeType: upload.mimeType,
                stream: upload.stream,
                replaceAttachmentId: attachmentId,
                declaredSizeBytes: upload.sizeBytes || null,
            })
            : await (0, agent_drive_files_1.writeAgentDriveFile)({
                scope: { userId: ownerUserId, organizationId },
                agentId: storageAgentId,
                fileName: upload.fileName,
                mimeType: upload.mimeType,
                body: upload.body || Buffer.alloc(0),
                replaceAttachmentId: attachmentId,
            });
        const storageBucket = driveFile.scopeKind === 'organization' ? 'organization-drive' : 'user-drive';
        const attachmentRow = {
            id: attachmentId,
            agent_id: agentId,
            shared_space_id: driveFile.scopeId,
            file_id: driveFile.id,
            storage_bucket: storageBucket,
            storage_path: driveFile.drivePath,
            filename: driveFile.fileName,
            mime_type: driveFile.mimeType,
            byte_size: driveFile.sizeBytes,
            ingestion_status: temporary ? 'temporary' : 'queued',
            drive_file: driveFile,
            folder_protected: true,
            ingestion_modes: selectedModes,
            created_by: ownerUserId,
            ingestion_metadata: {
                fileRole,
                modes: selectedModes,
                requestedModes: selectedModes,
                driveFile,
                folderProtected: true,
                temporary,
                draftId: draftId || null,
                deletionPolicy: 'agent-folder-protected-file-removable-from-memory',
            },
        };
        const existingAttachment = await AIAgentAttachmentEntity_1.AIAgentAttachmentEntity.findById(attachmentId);
        if (existingAttachment)
            await existingAttachment.update(attachmentRow);
        else
            await AIAgentAttachmentEntity_1.AIAgentAttachmentEntity.create(attachmentRow);
        payload.attachmentIds.push(attachmentId);
        payload.fileIds.push(driveFile.id);
        payload.fileNames.push(driveFile.fileName);
        payload.storagePaths.push(driveFile.drivePath);
        payload.driveLinks.push(driveFile.drivePath);
        for (const mode of selectedModes)
            if (!payload.modes.includes(mode))
                payload.modes.push(mode);
        for (const mode of selectedModes)
            if (!payload.requestedModes.includes(mode))
                payload.requestedModes.push(mode);
        uploaded.push({
            attachmentId,
            agentId: storageAgentId,
            fileId: driveFile.id,
            fileName: driveFile.fileName,
            mimeType: driveFile.mimeType,
            sizeBytes: driveFile.sizeBytes,
            hostPath: driveFile.hostPath,
            drivePath: driveFile.drivePath,
            storageBucket,
            modes: selectedModes,
            requestedModes: selectedModes,
        });
    }
    if (agentId && uploaded.length && !temporary && !['SKILL', 'MANIFEST'].includes(fileRole)) {
        const hookResult = await (0, agent_file_ingestion_hooks_1.runAgentFileUploadIngestionHook)({ agentId, ownerUserId, organizationId, temporary, files: uploaded });
        payload.processId = hookResult.processId;
        payload.status = hookResult.status;
        payload.fileShapeIds = hookResult.fileShapeIds;
        payload.fileShapeNames = hookResult.fileShapeNames;
    }
    else if (agentId && uploaded.length && !temporary) {
        payload.status = 'uploaded';
        payload.message = 'AI Agent control file uploaded.';
    }
    return payload;
}
async function deleteAiAgentFileOperation(input) {
    const agentId = textValue(input.agentId || input.agent_id) || null;
    const attachmentIds = listText(input.attachmentIds || input.attachment_ids);
    const singleId = textValue(input.attachmentId || input.attachment_id);
    if (singleId && !attachmentIds.includes(singleId))
        attachmentIds.push(singleId);
    if (!attachmentIds.length)
        throw new Error('deleteAiAgentFile requires attachmentId or attachmentIds.');
    const deleteDriveFiles = boolValue(input.deleteDriveFiles || input.delete_drive_files);
    const payload = emptyPayload(agentId, 'deleted', 'AI Agent file attachment deleted.');
    payload.driveFilesDeleted = deleteDriveFiles;
    for (const attachmentId of attachmentIds) {
        const existing = await AIAgentAttachmentEntity_1.AIAgentAttachmentEntity.single(attachmentId);
        if (!existing)
            continue;
        const row = existing.extract();
        if (deleteDriveFiles) {
            try {
                removeHostFile(row);
            }
            catch (error) {
                payload.message = error instanceof Error ? error.message : 'Drive file deletion failed.';
            }
        }
        const metadata = { ...rowMetadata(row), detachedAt: new Date().toISOString(), detachedFrom: 'drive-delete' };
        await existing.update({ ingestion_status: 'deleted', ingestion_metadata: metadata });
        payload.deletedAttachmentIds.push(attachmentId);
        payload.attachmentIds.push(attachmentId);
    }
    return payload;
}
