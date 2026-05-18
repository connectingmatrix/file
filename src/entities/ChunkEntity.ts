import { cosineSimilarity, parseEmbeddingValue } from 'giga-ai-helper';
import { ENTITY, FIELD, PERMISSIONS, Entity } from '@connectingmatrix/orm';

export type ChunkRow = {
  id?: number;
  subject_id?: string | null;
  post_id?: string | null;
  attachment_id?: string | null;
  source_kind?: string | null;
  chunk_index?: number | null;
  token_count?: number | null;
  content?: string | null;
  embedding?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
};

type ChunkSourceInput = {
  subjectId: string;
  postId: string;
  sourceKind: string;
  attachmentId?: string | null;
};

type ChunkSourceRow = {
  id: number;
  metadata: Record<string, unknown> | null;
};

type RetrieveByEmbeddingInput = {
  queryEmbedding: number[];
  topK: number;
  subjectIds?: string[] | null;
  postIds?: string[] | null;
};

@ENTITY({ table: 'ai_chunks', label: 'Chunk', store: 'supabase', primaryKey: 'id' })
@PERMISSIONS({ read: 'CHUNK_READ', list: 'CHUNK_LIST', create: 'CHUNK_CREATE', delete: 'CHUNK_DELETE' })
export class ChunkEntity extends Entity<ChunkRow> {
  @FIELD({ type: 'number', index: true }) public declare id: number | null;

  @FIELD({ type: 'string', index: true }) public declare subject_id: string | null;

  @FIELD({ type: 'string', index: true }) public declare post_id: string | null;

  @FIELD({ type: 'string', index: true }) public declare attachment_id: string | null;

  @FIELD({ type: 'string' }) public declare source_kind: string | null;

  @FIELD({ type: 'number' }) public declare chunk_index: number | null;

  @FIELD({ type: 'number' }) public declare token_count: number | null;

  @FIELD({ type: 'string' }) public declare content: string | null;

  @FIELD({ type: 'string' }) public declare embedding: string | null;

  @FIELD({ type: 'object', default: {} }) public declare metadata: Record<string, unknown> | null;

  @FIELD({ type: 'string' }) public declare created_at: string | null;

  public static async findBySource(input: ChunkSourceInput): Promise<ChunkSourceRow[]> {
    let query = this.find({ subject_id: input.subjectId, post_id: input.postId, source_kind: input.sourceKind }).select('id,metadata');
    query = input.sourceKind === 'attachment' ? query.where({ attachment_id: input.attachmentId }) : query.whereNull('attachment_id');
    const rows = await query.many();
    return rows.filter((row) => row.id !== null).map((row) => ({ id: row.id as number, metadata: row.metadata || null }));
  }

  public static async deleteBySource(input: ChunkSourceInput): Promise<void> {
    if (input.sourceKind === 'attachment') {
      await this.deleteMany({
        subject_id: input.subjectId,
        post_id: input.postId,
        source_kind: input.sourceKind,
        attachment_id: input.attachmentId,
      });
      return;
    }
    await this.deleteMany({
      subject_id: input.subjectId,
      post_id: input.postId,
      source_kind: input.sourceKind,
      is: { attachment_id: null },
    });
  }

  public static async deleteByPostId(postId: string): Promise<void> {
    if (!postId) return;
    await this.deleteMany({ post_id: postId });
  }

  public static async listFallbackCandidates(input: {
    limit: number;
    subjectIds?: string[] | null;
    postIds?: string | string[] | null;
  }): Promise<Array<Record<string, unknown>>> {
    let query = this.find().limit(Math.max(1, Number(input.limit || 250)));
    const subjectIds = Array.isArray(input.subjectIds) ? input.subjectIds.map((value) => String(value || '').trim()).filter(Boolean) : [];
    if (subjectIds.length) query = query.whereIn('subject_id', subjectIds);
    const postIds = Array.isArray(input.postIds)
      ? input.postIds.map((value) => String(value || '').trim()).filter(Boolean)
      : input.postIds
        ? [String(input.postIds).trim()].filter(Boolean)
        : [];
    if (postIds.length) query = query.whereIn('post_id', postIds);
    const rows = await query.many();
    return rows.map((row) => row.extract());
  }

  public static async retrieveByEmbedding(input: RetrieveByEmbeddingInput): Promise<Array<Record<string, unknown>>> {
    const topK = Math.max(1, Number(input.topK || 8));
    const candidates = await this.listFallbackCandidates({
      limit: Math.max(250, topK * 20),
      subjectIds: input.subjectIds || null,
      postIds: input.postIds || null,
    });
    return candidates
      .map((row) => {
        const embedding = parseEmbeddingValue(row.embedding);
        if (!embedding) return null;
        return { ...row, similarity: cosineSimilarity(input.queryEmbedding, embedding) };
      })
      .filter((row) => row !== null)
      .sort((left, right) => Number(right.similarity || 0) - Number(left.similarity || 0))
      .slice(0, topK) as Array<Record<string, unknown>>;
  }
}
