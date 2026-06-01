"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestPost = ingestPost;
const ingestion_1 = require("@gigav2/services/post/ingestion");
const Post_1 = require("@connectingmatrix/orm/entities/tree/Post");
async function ingestPost(supabase, input) {
    const postEntity = await Post_1.Post.single(input.postId);
    if (!(postEntity === null || postEntity === void 0 ? void 0 : postEntity.id))
        throw new Error('Post not found.');
    if (!postEntity.subject_id)
        throw new Error('Post has no subject_id.');
    const post = postEntity.extract();
    const result = await (0, ingestion_1.ingestSource)(supabase, {
        subjectId: String(post.subject_id),
        postId: String(post.id),
        sourceKind: 'post',
        content: String(post.narrative || ''),
        metadata: {
            post_title: String(post.title || '').trim() || null,
            source_table: 'ai_posts',
        },
        replaceExisting: input.replaceExisting,
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
