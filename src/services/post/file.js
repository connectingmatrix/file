"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadAttachmentFile = uploadAttachmentFile;
exports.insertAttachmentRecord = insertAttachmentRecord;
exports.preparePostAttachment = preparePostAttachment;
exports.preparePostAttachments = preparePostAttachments;
exports.removeUploadedAttachmentFiles = removeUploadedAttachmentFiles;
exports.processPostAttachment = processPostAttachment;
exports.managePostAttachments = managePostAttachments;
const crypto_1 = require("crypto");
const lodash_1 = require("lodash");
const giga_ai_helper_1 = require("giga-ai-helper");
const constant_1 = require("@gigav2/lib/constant");
const entities_1 = require("@connectingmatrix/orm/entities");
function buildStoredFileName(file) {
    const extension = (0, giga_ai_helper_1.getExtensionFromMimeType)(file, giga_ai_helper_1.DEFAULT_MIME_EXTENSION_MAP);
    return `${(0, crypto_1.randomUUID)()}.${extension}`;
}
function buildUploadPath(bucketPathPrefix, storedFileName) {
    return `${(0, giga_ai_helper_1.normalizeBucketPathPrefix)(bucketPathPrefix)}/${storedFileName}`;
}
function buildAttachmentPayload(params) {
    return {
        post_id: params.postId,
        file_name: params.storedFileName,
        mime_type: params.file.mimetype || null,
        storage_path: params.storagePath,
        content_text: params.contentText,
        metadata: {
            ...(params.baseMetadata || {}),
            file_size: params.file.size || null,
            original_file_name: params.file.originalname || null,
        },
    };
}
async function uploadAttachmentFile(supabase, file, storedFileName, bucketName = constant_1.AI_POST_ATTACHMENT_BUCKET, bucketPathPrefix = constant_1.AI_POST_ATTACHMENT_BUCKET_PATH) {
    const normalizedStoredFileName = storedFileName || buildStoredFileName(file);
    const uploadPath = buildUploadPath(bucketPathPrefix, normalizedStoredFileName);
    const data = await entities_1.AttachmentEntity.uploadStorageObject(supabase, {
        bucket: bucketName,
        path: uploadPath,
        body: file.buffer,
        contentType: file.mimetype || undefined,
    });
    return {
        storagePath: (data === null || data === void 0 ? void 0 : data.fullPath) || uploadPath,
        storedFileName: normalizedStoredFileName,
    };
}
async function insertAttachmentRecord(_supabase, _attachmentTableName, payload) {
    return entities_1.AttachmentEntity.create(payload);
}
async function preparePostAttachment(file) {
    return {
        contentText: await (0, giga_ai_helper_1.extractTextFromFile)(file),
        file,
        storedFileName: buildStoredFileName(file),
    };
}
async function preparePostAttachments(files) {
    if ((0, lodash_1.isEmpty)(files))
        return [];
    const prepared = [];
    for (const file of files) {
        prepared.push(await preparePostAttachment(file));
    }
    return prepared;
}
async function removeUploadedAttachmentFiles(supabase, storagePaths, bucketName = constant_1.AI_POST_ATTACHMENT_BUCKET) {
    await entities_1.AttachmentEntity.removeStorageObjects(supabase, {
        bucket: bucketName,
        paths: storagePaths,
    });
}
async function processPostAttachment(params) {
    const uploadedFile = await uploadAttachmentFile(params.supabase, params.prepared.file, params.prepared.storedFileName, params.bucketName, params.bucketPathPrefix);
    return insertAttachmentRecord(params.supabase, params.attachmentTableName, buildAttachmentPayload({
        postId: params.postId,
        file: params.prepared.file,
        storedFileName: uploadedFile.storedFileName,
        storagePath: uploadedFile.storagePath,
        contentText: params.prepared.contentText,
        baseMetadata: params.baseMetadata,
    }));
}
async function managePostAttachments({ supabase, postId, files, attachmentTableName = 'ai_attachments', bucketName = constant_1.AI_POST_ATTACHMENT_BUCKET, bucketPathPrefix = constant_1.AI_POST_ATTACHMENT_BUCKET_PATH, baseMetadata = null, }) {
    if ((0, lodash_1.isEmpty)(files))
        return [];
    const preparedFiles = await preparePostAttachments(files);
    const createdAttachments = [];
    for (const prepared of preparedFiles) {
        const createdAttachment = await processPostAttachment({
            supabase,
            postId,
            prepared,
            attachmentTableName,
            bucketName,
            bucketPathPrefix,
            baseMetadata,
        });
        createdAttachments.push(createdAttachment);
    }
    return createdAttachments;
}
