"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestSource = ingestSource;
const object_hash_1 = __importDefault(require("object-hash"));
const chunking_1 = require("giga-ai-helper/chunking");
const embeddings_1 = require("giga-ai-helper/embeddings");
const entities_1 = require("@connectingmatrix/orm/entities");
const INSERT_BATCH_SIZE = 100;
function baseSourceQuery(_supabase, input) {
    if (input.sourceKind === 'attachment' && !input.attachmentId)
        throw new Error('attachmentId is required for attachment chunk ingestion.');
    return entities_1.ChunkEntity.findBySource({
        subjectId: input.subjectId,
        postId: input.postId,
        sourceKind: input.sourceKind,
        attachmentId: input.attachmentId,
    });
}
function deleteSourceChunks(_supabase, input) {
    return entities_1.ChunkEntity.deleteBySource({
        subjectId: input.subjectId,
        postId: input.postId,
        sourceKind: input.sourceKind,
        attachmentId: input.attachmentId,
    });
}
async function insertChunksInBatches(_supabase, rows) {
    let inserted = 0;
    for (let start = 0; start < rows.length; start += INSERT_BATCH_SIZE) {
        const batch = rows.slice(start, start + INSERT_BATCH_SIZE);
        for (const row of batch)
            await entities_1.ChunkEntity.create(row);
        inserted += batch.length;
    }
    return inserted;
}
async function ingestSource(supabase, input) {
    const content = input.content.trim();
    if (!content) {
        if (input.strict)
            throw new Error('ingestSource requires non-empty content in strict mode.');
        return {
            status: 'skipped',
            sourceKind: input.sourceKind,
            totalChunks: 0,
            insertedChunks: 0,
            deletedChunks: 0,
            sourceHash: '',
        };
    }
    const sourceHash = (0, object_hash_1.default)({
        content,
        sourceKind: input.sourceKind,
        subjectId: input.subjectId,
        postId: input.postId,
        attachmentId: input.attachmentId,
    });
    const chunks = (0, chunking_1.chunkText)(content, input.chunking);
    if (!chunks.length) {
        if (input.strict)
            throw new Error('ingestSource requires non-empty chunk result in strict mode.');
        return {
            status: 'skipped',
            sourceKind: input.sourceKind,
            totalChunks: 0,
            insertedChunks: 0,
            deletedChunks: 0,
            sourceHash,
        };
    }
    const existing = await baseSourceQuery(supabase, input);
    const existingHashes = new Set(existing.map((row) => { var _a; return String(((_a = row.metadata) === null || _a === void 0 ? void 0 : _a.source_hash) || ''); }).filter(Boolean));
    if (existing.length > 0 && existingHashes.size === 1 && existingHashes.has(sourceHash)) {
        if (input.strict)
            throw new Error('ingestSource skipped due to unchanged source content in strict mode.');
        return {
            status: 'skipped',
            sourceKind: input.sourceKind,
            totalChunks: chunks.length,
            insertedChunks: 0,
            deletedChunks: 0,
            sourceHash,
        };
    }
    let deletedChunks = 0;
    const replaceExisting = input.replaceExisting !== false;
    if (replaceExisting && existing.length > 0) {
        await deleteSourceChunks(supabase, input);
        deletedChunks = existing.length;
    }
    const embeddingResults = await (0, embeddings_1.createEmbeddings)(chunks.map((chunk) => chunk.content));
    if (input.strict) {
        if (embeddingResults.length !== chunks.length) throw new Error('Embedding generation count does not match chunk count in strict mode.');
        if (embeddingResults.some((entry) => !(entry === null || entry === void 0 ? void 0 : entry.pgVector)))
            throw new Error('Embedding generation returned missing vectors in strict mode.');
    }
    const rows = chunks.map((chunk, index) => ({
        subject_id: input.subjectId,
        post_id: input.postId,
        attachment_id: input.sourceKind === 'attachment' ? input.attachmentId : null,
        source_kind: input.sourceKind,
        chunk_index: chunk.chunkIndex,
        token_count: chunk.tokenCount,
        content: chunk.content,
        embedding: embeddingResults[index].pgVector,
        metadata: {
            ...(input.metadata || {}),
            source_hash: sourceHash,
            ingested_at: new Date().toISOString(),
            total_chunks: chunks.length,
        },
    }));
    const insertedChunks = await insertChunksInBatches(supabase, rows);
    if (input.strict) {
        if (insertedChunks !== chunks.length)
            throw new Error('Inserted chunk count does not match expected chunk count in strict mode.');
        for (const row of rows) {
            const value = String((row.metadata || {}).source_hash || '').trim();
            if (!value)
                throw new Error('Missing source_hash for inserted chunk in strict mode.');
        }
    }
    return {
        status: 'inserted',
        sourceKind: input.sourceKind,
        totalChunks: chunks.length,
        insertedChunks,
        deletedChunks,
        sourceHash,
    };
}
