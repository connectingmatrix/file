import hash from 'object-hash';
import { chunkText } from 'giga-ai-helper/chunking';
import { createEmbeddings } from 'giga-ai-helper/embeddings';
import { IngestSourceInput, IngestionResult } from '@gigav2/types/graphql.types';
import { ChunkEntity } from '@gigav2/repositories/entities';
import type { ChunkRow } from '@gigav2/repositories/entities/ChunkEntity';
import type { SupabaseClient } from '@supabase/supabase-js';

const INSERT_BATCH_SIZE = 100;

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

  const chunks = chunkText(content, input.chunking);
  if (!chunks.length) {
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

  if (existing.length > 0 && existingHashes.size === 1 && existingHashes.has(sourceHash)) {
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

  const embeddingResults = await createEmbeddings(chunks.map((chunk) => chunk.content));

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

  return {
    status: 'inserted',
    sourceKind: input.sourceKind,
    totalChunks: chunks.length,
    insertedChunks,
    deletedChunks,
    sourceHash,
  };
}
