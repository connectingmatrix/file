import { SupabaseClient } from '@supabase/supabase-js';
import { Post } from '@connectingmatrix/orm/entities';

export function getPostsBySubjectIds(_supabase: SupabaseClient, subjectIds: string[]) {
  if (!subjectIds?.length) {
    throw new Error('One or more subject_ids are required.');
  }
  return Post.find()
    .whereIn('subject_id', subjectIds)
    .many()
    .then(async (posts) => {
      const data = [];
      for (const post of posts) {
        const attachments = await post.attachments.list();
        data.push({
          ...(post.extract() as Record<string, unknown>),
          ai_attachments: attachments.map((attachment) => attachment.extract()),
        });
      }
      return { data, error: null };
    });
}
