import { ingestSource } from '@gigav2/services/post/ingestion';
import { Post } from '@connectingmatrix/orm/entities/tree/Post';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IngestPostInput } from '@gigav2/types/post.types';

type IngestPostRow = {
  id: string;
  subject_id: string;
  title?: string | null;
  narrative?: string | null;
};

export async function ingestPost(supabase: SupabaseClient, input: IngestPostInput) {
  const postEntity = await Post.single(input.postId);
  if (!postEntity?.id) throw new Error('Post not found.');
  if (!postEntity.subject_id) throw new Error('Post has no subject_id.');
  const post = postEntity.extract() as IngestPostRow;

  const result = await ingestSource(supabase, {
    subjectId: String(post.subject_id),
    postId: String(post.id),
    sourceKind: 'post',
    content: String(post.narrative || ''),
    metadata: {
      post_title: String(post.title || '').trim() || null,
      source_table: 'ai_posts',
    },
    replaceExisting: input.replaceExisting,
    strict: input.strict || false,
    chunking: {
      maxChunkChars: input.chunkSize,
      overlapChars: input.chunkOverlap,
    },
  });

  return {
    source: {
      source_kind: 'post',
      post_id: String(post.id),
      subject_id: String(post.subject_id),
    },
    ...result,
  };
}
