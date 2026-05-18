import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { EntityRequestContext } from '@connectingmatrix/orm/request-entity-context';
import { publishAgentArtifacts } from '@gigav2/services/agent/artifacts/artifact-publisher';

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
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const list = (value: unknown): AgentAttachmentInput[] =>
  Array.isArray(value) ? value.map((item) => record(item) as AgentAttachmentInput) : value ? [record(value) as AgentAttachmentInput] : [];
const text = (value: unknown): string => String(value ?? '').trim();
const ext = (name: string): string => path.extname(name).toLowerCase();
const attachmentBucketPath = (chatId: string, filename: string) =>
  `${chatId}/attachments/${randomUUID()}-${path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_')}`;

export const planAttachmentIngestion = (input: {
  name?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
  bytes?: number | null;
}): AttachmentPlan => {
  const filename = text(input.filename || input.name || 'attachment');
  const mime = text(input.mimeType || input.contentType).toLowerCase();
  const size = Number(input.sizeBytes || input.bytes || 0);
  const e = ext(filename);
  if (['.csv', '.tsv', '.xlsx', '.xls'].includes(e) || /csv|excel|spreadsheet/.test(mime)) {
    if (size > 25 * MB)
      return {
        mode: 'stream-to-duckdb',
        reason: 'Large CSV/Excel files are uploaded and streamed into inline SQL/DuckDB for queries.',
        shouldUpload: true,
        shouldIngest: false,
      };
    return { mode: 'inline-ingest', reason: 'Small spreadsheet can be sampled/ingested inline.', shouldUpload: true, shouldIngest: true };
  }
  if (e === '.pdf' || /pdf/.test(mime))
    return {
      mode: 'pdf-extract',
      reason: 'PDF should be compressed/extracted/chunked before agent reasoning.',
      shouldUpload: true,
      shouldIngest: size <= 50 * MB,
    };
  if (e === '.zip' || /zip|archive/.test(mime))
    return {
      mode: 'zip-tree',
      reason: 'Zip files should be uploaded and expanded into a selectable file tree.',
      shouldUpload: true,
      shouldIngest: false,
    };
  if (size > 10 * MB)
    return {
      mode: 'upload-only',
      reason: 'Large unknown file is uploaded with metadata and sampled by sandbox tools when needed.',
      shouldUpload: true,
      shouldIngest: false,
    };
  return { mode: 'inline-ingest', reason: 'Small file can be uploaded and ingested inline.', shouldUpload: true, shouldIngest: true };
};

export const ingestAgentFiles = async (input: Record<string, unknown>) => {
  const ctx = EntityRequestContext.current();
  const chatId = text(input.chatId || input.chat_id || record(input.context).chatId || 'unknown-chat');
  const attachments = list(input.attachments || input.files || input.file);
  const results: Record<string, unknown>[] = [];
  for (const attachment of attachments) {
    const filename = text(attachment.filename || attachment.path?.split('/').pop() || 'attachment');
    const storagePath = attachmentBucketPath(chatId, filename);
    const plan = planAttachmentIngestion({
      filename,
      contentType: attachment.contentType,
      mimeType: attachment.mimeType,
      bytes: attachment.bytes,
      sizeBytes: attachment.sizeBytes,
    });
    results.push({
      id: randomUUID(),
      filename,
      sourcePath: attachment.path,
      storagePath,
      plan,
      metadata: {
        ...record(attachment.metadata),
        ingestionStrategy: plan.mode,
        ingestionReason: plan.reason,
        originalPath: attachment.path,
        storagePath,
      },
      uploaded: plan.shouldUpload,
      ingested: plan.shouldIngest,
      inlineSql: plan.mode === 'stream-to-duckdb' ? { status: 'pending', engine: 'duckdb', reason: plan.reason } : null,
      zipTree: plan.mode === 'zip-tree' ? { status: 'pending', reason: plan.reason } : null,
      pdfExtraction: plan.mode === 'pdf-extract' ? { status: 'pending', reason: plan.reason } : null,
    });
  }
  if (input.publish === true && results.length) await publishAgentArtifacts({ ...input, files: results, chatId });
  return { summary: `Prepared ${results.length} attachment(s) for ${chatId}.`, files: results, caller: ctx.caller?.id || null };
};
