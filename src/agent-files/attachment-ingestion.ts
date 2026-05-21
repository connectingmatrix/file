import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { EntityRequestContext } from '@connectingmatrix/orm/request-entity-context';

export type AgentAttachmentInput = {
  path: string;
  filename?: string | null;
  contentType?: string | null;
  mimeType?: string | null;
  bytes?: number | null;
  sizeBytes?: number | null;
  chatId?: string | null;
  metadata?: Record<string, unknown>;
};

export type AttachmentPlan = {
  mode: 'inline-ingest' | 'pdf-extract' | 'zip-tree' | 'stream-to-duckdb' | 'upload-only';
  reason: string;
  shouldUpload: boolean;
  shouldIngest: boolean;
  storagePath?: string | null;
};

const MB = 1024 * 1024;

export const planAttachmentIngestion = (input: {
  name?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
  bytes?: number | null;
}): AttachmentPlan => {
  const filename = String(input.filename || input.name || 'attachment').trim();
  const mime = String(input.mimeType || input.contentType || '').toLowerCase();
  const size = Number(input.sizeBytes || input.bytes || 0);
  const extension = path.extname(filename).toLowerCase();
  if (['.csv', '.tsv', '.xlsx', '.xls'].includes(extension) || /csv|excel|spreadsheet/.test(mime)) {
    if (size > 25 * MB)
      return { mode: 'stream-to-duckdb', reason: 'Large CSV/Excel files are uploaded and streamed into inline SQL/DuckDB for queries.', shouldUpload: true, shouldIngest: false };
    return { mode: 'inline-ingest', reason: 'Small spreadsheet can be sampled/ingested inline.', shouldUpload: true, shouldIngest: true };
  }
  if (extension === '.pdf' || /pdf/.test(mime))
    return { mode: 'pdf-extract', reason: 'PDF should be compressed/extracted/chunked before agent reasoning.', shouldUpload: true, shouldIngest: size <= 50 * MB };
  if (extension === '.zip' || /zip|archive/.test(mime))
    return { mode: 'zip-tree', reason: 'Zip files should be uploaded and expanded into a selectable file tree.', shouldUpload: true, shouldIngest: false };
  if (size > 10 * MB)
    return { mode: 'upload-only', reason: 'Large unknown file is uploaded with metadata and sampled by sandbox tools when needed.', shouldUpload: true, shouldIngest: false };
  return { mode: 'inline-ingest', reason: 'Small file can be uploaded and ingested inline.', shouldUpload: true, shouldIngest: true };
};

const inputAttachments = (input: Record<string, unknown>): AgentAttachmentInput[] => {
  const value = input.attachments || input.files || input.file;
  return Array.isArray(value) ? (value as AgentAttachmentInput[]) : value ? [value as AgentAttachmentInput] : [];
};

export const ingestAgentFiles = async (input: Record<string, unknown>) => {
  const ctx = EntityRequestContext.current();
  const chatId = String(input.chatId || input.chat_id || 'unknown-chat').trim();
  const files = [];
  for (const attachment of inputAttachments(input)) {
    const filename = String(attachment.filename || attachment.path?.split('/').pop() || 'attachment').trim();
    const plan = planAttachmentIngestion({
      filename,
      contentType: attachment.contentType,
      mimeType: attachment.mimeType,
      bytes: attachment.bytes,
      sizeBytes: attachment.sizeBytes,
    });
    files.push({
      id: randomUUID(),
      filename,
      sourcePath: attachment.path,
      plan,
      metadata: {
        ...(attachment.metadata || {}),
        ingestionStrategy: plan.mode,
        ingestionReason: plan.reason,
        originalPath: attachment.path,
      },
      uploaded: plan.shouldUpload,
      ingested: plan.shouldIngest,
    });
  }
  return { summary: `Prepared ${files.length} attachment(s) for ${chatId}.`, files, caller: ctx.caller.id || null };
};
