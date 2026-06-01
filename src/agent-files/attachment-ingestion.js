"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestAgentFiles = exports.planAttachmentIngestion = void 0;
const node_crypto_1 = require("node:crypto");
const node_path_1 = __importDefault(require("node:path"));
const request_entity_context_1 = require("@connectingmatrix/orm/request-entity-context");
const MB = 1024 * 1024;
const planAttachmentIngestion = (input) => {
    const filename = String(input.filename || input.name || 'attachment').trim();
    const mime = String(input.mimeType || input.contentType || '').toLowerCase();
    const size = Number(input.sizeBytes || input.bytes || 0);
    const extension = node_path_1.default.extname(filename).toLowerCase();
    if (['.csv', '.tsv', '.xlsx', '.xls'].includes(extension) || /csv|excel|spreadsheet/.test(mime)) {
        if (size > 25 * MB)
            return { mode: 'stream-to-duckdb', reason: 'Large CSV/Excel files are uploaded and streamed into inline SQL/DuckDB for queries.', shouldUpload: true, shouldIngest: false };
        return { mode: 'inline-ingest', reason: 'Small spreadsheet can be sampled/ingested inline.', shouldUpload: true, shouldIngest: true };
    }
    if (extension === '.pdf' || /pdf/.test(mime))
        return { mode: 'pdf-extract', reason: 'PDF should be compressed/extracted/chunked before agent reasoning.', shouldUpload: true, shouldIngest: size <= 50 * MB };
    if (extension === '.zip' || /zip|archive/.test(mime))
        return { mode: 'zip-tree', reason: 'Zip files should be uploaded and expanded into a selectable file tree.', shouldUpload: true, shouldIngest: false };
    if (size > 10 * MB)
        return { mode: 'upload-only', reason: 'Large unknown file is uploaded with metadata and sampled by sandbox tools when needed.', shouldUpload: true, shouldIngest: false };
    return { mode: 'inline-ingest', reason: 'Small file can be uploaded and ingested inline.', shouldUpload: true, shouldIngest: true };
};
exports.planAttachmentIngestion = planAttachmentIngestion;
const inputAttachments = (input) => {
    const value = input.attachments || input.files || input.file;
    return Array.isArray(value) ? value : value ? [value] : [];
};
const ingestAgentFiles = async (input) => {
    var _a;
    const ctx = request_entity_context_1.EntityRequestContext.current();
    const chatId = String(input.chatId || input.chat_id || 'unknown-chat').trim();
    const files = [];
    for (const attachment of inputAttachments(input)) {
        const filename = String(attachment.filename || ((_a = attachment.path) === null || _a === void 0 ? void 0 : _a.split('/').pop()) || 'attachment').trim();
        const plan = (0, exports.planAttachmentIngestion)({
            filename,
            contentType: attachment.contentType,
            mimeType: attachment.mimeType,
            bytes: attachment.bytes,
            sizeBytes: attachment.sizeBytes,
        });
        files.push({
            id: (0, node_crypto_1.randomUUID)(),
            filename,
            sourcePath: attachment.path,
            plan,
            metadata: {
                ...(attachment.metadata || {}),
                ingestionStrategy: plan.mode,
                ingestionReason: plan.reason,
                originalPath: attachment.path,
            },
            uploaded: plan.shouldUpload,
            ingested: plan.shouldIngest,
        });
    }
    return { summary: `Prepared ${files.length} attachment(s) for ${chatId}.`, files, caller: ctx.caller.id || null };
};
exports.ingestAgentFiles = ingestAgentFiles;
