import hash from 'object-hash';
import { chunkText } from 'giga-ai-helper/chunking';
import { createEmbeddings } from 'giga-ai-helper/embeddings';
import { IngestSourceInput, IngestionResult } from '@gigav2/types/graphql.types';
import { ChunkEntity } from '@connectingmatrix/orm/entities';
import type { ChunkRow } from '@connectingmatrix/orm/entities/ChunkEntity';
import type { SupabaseClient } from '@supabase/supabase-js';

const INSERT_BATCH_SIZE = 100;
const EMBEDDING_BATCH_SIZE = 64;
const DEFAULT_MAX_CHUNK_CHARS = 1200;

type SourceChunk = ReturnType<typeof chunkText>[number];

function estimateTokenCount(content: string): number {
  return Math.max(1, Math.ceil(content.trim().length / 4));
}

function enforceChunkCharLimit(chunks: SourceChunk[], maxChunkChars: number): SourceChunk[] {
  const output: SourceChunk[] = [];
  for (const chunk of chunks) {
    if (chunk.content.length <= maxChunkChars) {
      output.push({ ...chunk, chunkIndex: output.length });
      continue;
    }
    for (let start = 0; start < chunk.content.length; start += maxChunkChars) {
      const content = chunk.content.slice(start, start + maxChunkChars).trim();
      if (content) output.push({ chunkIndex: output.length, content, tokenCount: estimateTokenCount(content) });
    }
  }
  return output;
}

function baseSourceQuery(_supabase: SupabaseClient, input: IngestSourceInput) {
  if (input.sourceKind === 'attachment' && !input.attachmentId) throw new Error('attachmentId is required for attachment chunk ingestion.');
  return ChunkEntity.findBySource({
    subjectId: input.subjectId,
    postId: input.postId,
    sourceKind: input.sourceKind,
    attachmentId: input.attachmentId,
  });
}

function deleteSourceChunks(_supabase: SupabaseClient, input: IngestSourceInput) {
  return ChunkEntity.deleteBySource({
    subjectId: input.subjectId,
    postId: input.postId,
    sourceKind: input.sourceKind,
    attachmentId: input.attachmentId,
  });
}

type ChunkInsertRow = Pick<
  ChunkRow,
  'subject_id' | 'post_id' | 'attachment_id' | 'source_kind' | 'chunk_index' | 'token_count' | 'content' | 'embedding' | 'metadata'
>;

async function insertChunksInBatches(_supabase: SupabaseClient, rows: ChunkInsertRow[]) {
  let inserted = 0;
  for (let start = 0; start < rows.length; start += INSERT_BATCH_SIZE) {
    const batch = rows.slice(start, start + INSERT_BATCH_SIZE);
    for (const row of batch) await ChunkEntity.create(row);
    inserted += batch.length;
  }
  return inserted;
}

export async function ingestSource(supabase: SupabaseClient, input: IngestSourceInput): Promise<IngestionResult> {
  const content = input.content.trim();
  if (!content) {
    if (input.strict) throw new Error('ingestSource requires non-empty content in strict mode.');
    return {
      status: 'skipped',
      sourceKind: input.sourceKind,
      totalChunks: 0,
      insertedChunks: 0,
      deletedChunks: 0,
      sourceHash: '',
    };
  }

  const sourceHash = hash({
    content,
    sourceKind: input.sourceKind,
    subjectId: input.subjectId,
    postId: input.postId,
    attachmentId: input.attachmentId,
  });

  const chunks = enforceChunkCharLimit(chunkText(content, input.chunking), input.chunking?.maxChunkChars || DEFAULT_MAX_CHUNK_CHARS);
  if (!chunks.length) {
    if (input.strict) throw new Error('ingestSource requires non-empty chunk result in strict mode.');
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
  const existingHashes = new Set(existing.map((row) => String(row.metadata?.source_hash || '')).filter(Boolean));
  const hasExistingHash = existingHashes.size === 1 && existingHashes.has(sourceHash);
  const replaceExisting = input.replaceExisting !== false;

  if (existing.length > 0 && hasExistingHash && !replaceExisting) {
    if (input.strict) throw new Error('ingestSource skipped due to unchanged source content in strict mode.');
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
  if (replaceExisting && existing.length > 0) {
    await deleteSourceChunks(supabase, input);
    deletedChunks = existing.length;
  }

  const embeddingResults: Awaited<ReturnType<typeof createEmbeddings>> = [];
  for (let start = 0; start < chunks.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(start, start + EMBEDDING_BATCH_SIZE);
    embeddingResults.push(...(await createEmbeddings(batch.map((chunk) => chunk.content))));
  }
  if (input.strict) {
    if (embeddingResults.length !== chunks.length) throw new Error('Embedding generation count does not match chunk count in strict mode.');
    if (embeddingResults.some((entry) => !entry?.pgVector)) throw new Error('Embedding generation returned missing vectors in strict mode.');
    if (chunks.some((entry) => !String(entry.content || '').trim())) throw new Error('ingestSource contains empty chunk content in strict mode.');
  }

  const rows: ChunkInsertRow[] = chunks.map((chunk, index) => ({
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
    if (insertedChunks !== chunks.length) throw new Error('Inserted chunk count does not match expected chunk count in strict mode.');
    for (const row of rows) {
      const value = String(row.metadata?.source_hash || '').trim();
      if (!value) throw new Error('Missing source_hash for inserted chunk in strict mode.');
    }
  }

  if (sourceHash !== rows[0]?.metadata?.source_hash) throw new Error('source_hash mismatch on insertion.');

  return {
    status: 'inserted',
    sourceKind: input.sourceKind,
    totalChunks: chunks.length,
    insertedChunks,
    deletedChunks,
    sourceHash,
  };
}
