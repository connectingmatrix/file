import { ingestSource } from '@gigav2/services/post/ingestion';
import { AttachmentEntity, Post } from '@connectingmatrix/orm/entities';
import type { IngestAttachmentInput } from '@gigav2/types/post.types';

export async function ingestAttachment(supabase: any, input: IngestAttachmentInput) {
  const attachmentRow = await AttachmentEntity.find({ id: input.attachmentId })
    .select('id,post_id,file_name,mime_type,content_text,metadata')
    .single();
  const attachment = attachmentRow
    ? (attachmentRow.extract() as {
        id: string;
        post_id: string;
        file_name?: string | null;
        mime_type?: string | null;
        content_text?: string | null;
        metadata?: Record<string, unknown> | null;
      })
    : null;
  if (!attachment) throw new Error('Attachment not found.');
  if (!attachment.post_id) throw new Error('Attachment has no post_id.');

  const postRow = await Post.find({ id: String(attachment.post_id) })
    .select('id,subject_id')
    .single();
  const post = postRow ? (postRow.extract() as { id: string; subject_id: string }) : null;
  if (!post) throw new Error('Parent post not found.');
  if (!post.subject_id) throw new Error('Parent post has no subject_id.');

  const result = await ingestSource(supabase, {
    subjectId: post.subject_id,
    postId: post.id,
    attachmentId: attachment.id,
    sourceKind: 'attachment',
    content: attachment.content_text || '',
    metadata: {
      file_name: attachment.file_name || null,
      mime_type: attachment.mime_type || null,
      source_table: 'ai_attachments',
    },
    replaceExisting: input.replaceExisting,
    chunking: {
      maxChunkChars: input.chunkSize,
      overlapChars: input.chunkOverlap,
    },
  });

  return {
    source: {
      source_kind: 'attachment',
      attachment_id: attachment.id,
      post_id: post.id,
      subject_id: post.subject_id,
    },
    ...result,
  };
}
