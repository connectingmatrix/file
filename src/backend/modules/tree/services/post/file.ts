import { randomUUID } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { isEmpty } from 'lodash';
import { DEFAULT_MIME_EXTENSION_MAP, extractTextFromFile, getExtensionFromMimeType, normalizeBucketPathPrefix } from 'giga-ai-helper';
import { AI_POST_ATTACHMENT_BUCKET, AI_POST_ATTACHMENT_BUCKET_PATH } from '@giga/shared/lib/constant';
import { AttachmentEntity } from '@connectingmatrix/orm/repositories/entities';
import type { AttachmentInsertPayload, ManagePostAttachmentsParams } from '@giga/shared/types/contracts/post.types';

export type PreparedPostAttachment = {
  contentText: string;
  file: Express.Multer.File;
  storedFileName: string;
};

function buildStoredFileName(file: Express.Multer.File) {
  const extension = getExtensionFromMimeType(file, DEFAULT_MIME_EXTENSION_MAP);
  return `${randomUUID()}.${extension}`;
}

function buildUploadPath(bucketPathPrefix: string, storedFileName: string) {
  return `${normalizeBucketPathPrefix(bucketPathPrefix)}/${storedFileName}`;
}

function buildAttachmentPayload(params: {
  postId: string;
  file: Express.Multer.File;
  storedFileName: string;
  storagePath: string;
  contentText: string;
  baseMetadata?: Record<string, any> | null;
}): AttachmentInsertPayload {
  return {
    post_id: params.postId,
    file_name: params.storedFileName,
    mime_type: params.file.mimetype || null,
    storage_path: params.storagePath,
    content_text: params.contentText,
    metadata: {
      ...(params.baseMetadata || {}),
      file_size: params.file.size || null,
      original_file_name: params.file.originalname || null,
    },
  };
}

export async function uploadAttachmentFile(
  supabase: SupabaseClient,
  file: Express.Multer.File,
  storedFileName?: string,
  bucketName = AI_POST_ATTACHMENT_BUCKET,
  bucketPathPrefix = AI_POST_ATTACHMENT_BUCKET_PATH,
): Promise<{ storagePath: string; storedFileName: string }> {
  const normalizedStoredFileName = storedFileName || buildStoredFileName(file);
  const uploadPath = buildUploadPath(bucketPathPrefix, normalizedStoredFileName);

  const data = await AttachmentEntity.uploadStorageObject(supabase, {
    bucket: bucketName,
    path: uploadPath,
    body: file.buffer,
    contentType: file.mimetype || undefined,
  });
  return {
    storagePath: data?.fullPath || uploadPath,
    storedFileName: normalizedStoredFileName,
  };
}

export async function insertAttachmentRecord(_supabase: SupabaseClient, _attachmentTableName: string, payload: AttachmentInsertPayload) {
  return AttachmentEntity.create(payload as Record<string, unknown>);
}

export async function preparePostAttachment(file: Express.Multer.File): Promise<PreparedPostAttachment> {
  return {
    contentText: await extractTextFromFile(file),
    file,
    storedFileName: buildStoredFileName(file),
  };
}

export async function preparePostAttachments(files: Express.Multer.File[]): Promise<PreparedPostAttachment[]> {
  if (isEmpty(files)) return [];

  const prepared: PreparedPostAttachment[] = [];
  for (const file of files) {
    prepared.push(await preparePostAttachment(file));
  }
  return prepared;
}

export async function removeUploadedAttachmentFiles(supabase: SupabaseClient, storagePaths: string[], bucketName = AI_POST_ATTACHMENT_BUCKET) {
  await AttachmentEntity.removeStorageObjects(supabase, {
    bucket: bucketName,
    paths: storagePaths,
  });
}

export async function processPostAttachment(params: {
  supabase: SupabaseClient;
  postId: string;
  prepared: PreparedPostAttachment;
  attachmentTableName: string;
  bucketName?: string;
  bucketPathPrefix?: string;
  baseMetadata?: Record<string, any> | null;
}) {
  const uploadedFile = await uploadAttachmentFile(
    params.supabase,
    params.prepared.file,
    params.prepared.storedFileName,
    params.bucketName,
    params.bucketPathPrefix,
  );

  return insertAttachmentRecord(
    params.supabase,
    params.attachmentTableName,
    buildAttachmentPayload({
      postId: params.postId,
      file: params.prepared.file,
      storedFileName: uploadedFile.storedFileName,
      storagePath: uploadedFile.storagePath,
      contentText: params.prepared.contentText,
      baseMetadata: params.baseMetadata,
    }),
  );
}

export async function managePostAttachments({
  supabase,
  postId,
  files,
  attachmentTableName = 'ai_attachments',
  bucketName = AI_POST_ATTACHMENT_BUCKET,
  bucketPathPrefix = AI_POST_ATTACHMENT_BUCKET_PATH,
  baseMetadata = null,
}: ManagePostAttachmentsParams) {
  if (isEmpty(files)) return [];

  const preparedFiles = await preparePostAttachments(files);
  const createdAttachments: any[] = [];
  for (const prepared of preparedFiles) {
    const createdAttachment = await processPostAttachment({
      supabase,
      postId,
      prepared,
      attachmentTableName,
      bucketName,
      bucketPathPrefix,
      baseMetadata,
    });
    createdAttachments.push(createdAttachment);
  }

  return createdAttachments;
}
