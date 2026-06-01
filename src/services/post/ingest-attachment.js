"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestAttachment = ingestAttachment;
const ingestion_1 = require("@gigav2/services/post/ingestion");
const entities_1 = require("@connectingmatrix/orm/entities");
async function ingestAttachment(supabase, input) {
    const attachmentRow = await entities_1.AttachmentEntity.find({ id: input.attachmentId })
        .select('id,post_id,file_name,mime_type,content_text,metadata')
        .single();
    const attachment = attachmentRow
        ? attachmentRow.extract()
        : null;
    if (!attachment)
        throw new Error('Attachment not found.');
    if (!attachment.post_id)
        throw new Error('Attachment has no post_id.');
    const postRow = await entities_1.Post.find({ id: String(attachment.post_id) })
        .select('id,subject_id')
        .single();
    const post = postRow ? postRow.extract() : null;
    if (!post)
        throw new Error('Parent post not found.');
    if (!post.subject_id)
        throw new Error('Parent post has no subject_id.');
    const result = await (0, ingestion_1.ingestSource)(supabase, {
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
