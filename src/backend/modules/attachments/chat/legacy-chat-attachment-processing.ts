import { createHash } from 'node:crypto';
import { createImageOperationSpec } from '@connectingmatrix/ai-agents/services/ai-agents/advanced/runtime/image-operations-v2';

type AttachmentRecord = Record<string, unknown>;

type AttachmentProcessingInput = {
  attachments: AttachmentRecord[];
  chatId: string;
  emitDebug?: (stage: string, status: 'started' | 'progress' | 'completed' | 'failed', message: string, meta?: Record<string, unknown>, chatId?: string | null) => void;
  message: string;
  userId: string;
};

export type ChatAttachmentProcessingResult = {
  attachmentContext: string;
  imageOperations: Record<string, unknown>[];
  message: string;
  processedAttachments: Record<string, unknown>[];
};

const text = (value: unknown): string => String(value || '').trim();
const numberValue = (value: unknown): number => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const metadata = (attachment: AttachmentRecord): AttachmentRecord =>
  attachment.metadata && typeof attachment.metadata === 'object' ? (attachment.metadata as AttachmentRecord) : {};
const hash = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 16);
const fileName = (attachment: AttachmentRecord): string => {
  const meta = metadata(attachment);
  return text(attachment.fileName || attachment.file_name || attachment.name || meta.fileName || meta.file_name || meta.name) || `attachment-${hash(JSON.stringify(attachment))}`;
};
const mimeType = (attachment: AttachmentRecord): string => {
  const meta = metadata(attachment);
  return text(attachment.mimeType || attachment.mime_type || attachment.mimetype || meta.mimeType || meta.mime_type || meta.mimetype) || 'application/octet-stream';
};
const sizeBytes = (attachment: AttachmentRecord): number => {
  const meta = metadata(attachment);
  return numberValue(attachment.sizeBytes || attachment.size_bytes || attachment.byteSize || attachment.byte_size || meta.sizeBytes || meta.size_bytes || meta.byteSize || meta.byte_size);
};
const contentRef = (attachment: AttachmentRecord): string => {
  const meta = metadata(attachment);
  return text(attachment.storagePath || attachment.storage_path || attachment.previewUrl || attachment.preview_url || attachment.url || meta.storagePath || meta.storage_path || meta.previewUrl || meta.preview_url || meta.url || attachment.id || meta.id);
};
const extension = (name: string): string => name.toLowerCase().split('.').pop() || '';
const isImage = (name: string, mime: string): boolean => mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'heic', 'avif'].includes(extension(name));
const allowedKind = (name: string, mime: string): string => {
  const ext = extension(name);
  if (isImage(name, mime)) return 'image';
  if (['pdf', 'txt', 'md', 'json', 'jsonl', 'csv', 'tsv', 'xlsx', 'xls', 'doc', 'docx', 'zip', 'sql', 'sqlite', 'sqlite3', 'db', 'duckdb', 'parquet', 'yml', 'yaml', 'graphql', 'gql'].includes(ext)) return 'document';
  if (/pdf|text|json|csv|spreadsheet|excel|zip|sqlite|sql|parquet|word/.test(mime)) return 'document';
  return 'unsupported';
};

export function processChatAttachmentsForMessage(input: AttachmentProcessingInput): ChatAttachmentProcessingResult {
  if (!input.attachments.length) return { attachmentContext: '', imageOperations: [], message: input.message, processedAttachments: [] };
  input.emitDebug?.('chat.attachments', 'started', 'Processing chat attachments before routing.', { attachments: input.attachments.length }, input.chatId);
  const imageOperations: Record<string, unknown>[] = [];
  const lines: string[] = ['\n\n---', 'Chat attachment context:'];
  const processedAttachments = input.attachments.map((attachment, index) => {
    const name = fileName(attachment);
    const mime = mimeType(attachment);
    const bytes = sizeBytes(attachment);
    const kind = allowedKind(name, mime);
    const ref = contentRef(attachment);
    const ingestionMode = text(attachment.ingestionMode || attachment.ingestion_mode || metadata(attachment).ingestionMode || metadata(attachment).ingestion_mode || 'AUTO');
    const processed: Record<string, unknown> = { ...attachment, fileName: name, mimeType: mime, sizeBytes: bytes, attachmentKind: kind, ingestionMode, contentRef: ref };
    if (kind === 'image') {
      const spec = createImageOperationSpec({
        agentId: `chat-image-processing-${input.chatId}`,
        operation: 'edit',
        outputFormat: 'png',
        prompt: `Analyze image attachment ${name} for the current chat message. Return concise visual findings, text/OCR observations when visible, and risks or follow-up questions.`,
        sourceUri: ref || name,
      });
      imageOperations.push({ ...spec, attachmentIndex: index, fileName: name, mimeType: mime });
      processed.processingAgent = 'image-processing-agent';
      lines.push(`- ${name} (${mime}, ${bytes || 'unknown'} bytes): invoke Image Processing Agent with ${ingestionMode} context before answering.`);
    } else if (kind === 'document') {
      lines.push(`- ${name} (${mime}, ${bytes || 'unknown'} bytes): process as message attachment using ${ingestionMode} ingestion hints.`);
    } else {
      lines.push(`- ${name} (${mime}): unsupported attachment type; do not ingest content unless a later upload validates it.`);
    }
    return processed;
  });
  if (imageOperations.length) lines.push(`Image Processing Agent operations queued: ${imageOperations.length}.`);
  lines.push('Use attachments only for this message unless the user explicitly uploads them into AI Agent Memory/Skills.');
  input.emitDebug?.('chat.attachments', 'completed', 'Chat attachments prepared for runtime routing.', { attachments: input.attachments.length, image_operations: imageOperations.length }, input.chatId);
  const attachmentContext = lines.join('\n');
  return { attachmentContext, imageOperations, message: `${input.message}${attachmentContext}`, processedAttachments };
}
