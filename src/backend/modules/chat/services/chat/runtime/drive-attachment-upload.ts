import { createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, extname, join, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BadRequestError } from 'routing-controllers';
import { OrganisationEntity } from '@connectingmatrix/orm/repositories/entities';
import { SHARED_SPACE_ROOT } from '@giga/general/services/shared-space/constants';
import type { GraphqlResolverContext } from '@giga/shared/types';
import type { ChatAttachmentUploadInput, ChatAttachmentUploadPayload } from '@giga/shared/types/contracts/chat.types';

type GraphqlUploadFile = {
  createReadStream?: () => Readable;
  filename?: string | null;
  mimetype?: string | null;
};

const safe = (value: string) => value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 160) || 'item';
const safeFilename = (name: string) => safe(basename(name || 'attachment'));
const ownerRoot = (userId: string, organizationId?: string | null) =>
  organizationId ? join(SHARED_SPACE_ROOT(), 'organizations', safe(organizationId)) : join(SHARED_SPACE_ROOT(), 'users', safe(userId));

const classify = (filename: string, mimeType?: string | null) => {
  const ext = extname(filename).toLowerCase();
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) return 'image';
  if (['.csv', '.tsv', '.xls', '.xlsx', '.parquet'].includes(ext)) return 'table';
  if (['.sqlite', '.sqlite3', '.duckdb', '.db'].includes(ext)) return 'file_database';
  if (['.zip', '.tar', '.gz', '.tgz'].includes(ext)) return 'archive';
  if (['.ts', '.tsx', '.js', '.jsx', '.py', '.sql', '.graphql', '.yaml', '.yml', '.json'].includes(ext)) return 'code';
  return 'document';
};

const sha256 = async (path: string) =>
  await new Promise<string>((resolveValue, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolveValue(hash.digest('hex')))
      .on('error', reject);
  });

const assertContained = (root: string, target: string) => {
  const base = resolve(root);
  const resolved = resolve(target);
  if (resolved !== base && !resolved.startsWith(`${base}${sep}`)) throw new BadRequestError('Drive path escaped the owner root.');
  let cursor = base;
  for (const part of resolved.slice(base.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new BadRequestError('Symbolic links are not allowed in Drive uploads.');
  }
};

const checkOrganizationMembership = async (context: GraphqlResolverContext, userId: string, organizationId?: string | null) => {
  if (!organizationId) return;
  const access = await OrganisationEntity.accessContext({ supabase: context.supabase, userId, organizationId, context: context as never });
  if (context.effectiveRoot !== true && !access.hasMembership) throw new BadRequestError('Organization membership is required for this Drive upload.');
};

export async function uploadChatAttachmentDrive(params: {
  context: GraphqlResolverContext;
  file: unknown;
  input: ChatAttachmentUploadInput;
  userId: string;
}): Promise<ChatAttachmentUploadPayload> {
  const uploaded = (await Promise.resolve(params.file)) as GraphqlUploadFile;
  const fileName = safeFilename(params.input.filename || uploaded.filename || 'attachment');
  const organizationId = String(params.input.organizationId || params.input.scope?.organizationId || '').trim() || null;
  await checkOrganizationMembership(params.context, params.userId, organizationId);
  const root = ownerRoot(params.userId, organizationId);
  const chatFolder = safe(params.input.chatId || params.input.scope?.id || 'new-chat');
  const drivePath = `/drive/chat-attachments/${chatFolder}/${Date.now()}-${fileName}`;
  const target = resolve(root, drivePath.replace(/^\/drive\/?/, ''));
  assertContained(root, target);
  mkdirSync(resolve(target, '..'), { recursive: true, mode: 0o700 });
  let written = 0;
  const maxBytes = Math.max(1, Number(params.input.byteSize || 0) || 1024 * 1024 * 100);
  const stream = uploaded.createReadStream?.();
  if (!stream) throw new BadRequestError('Upload stream was not provided.');
  const guard = new Transform({
    transform(chunk, _encoding, callback) {
      written += Buffer.byteLength(chunk);
      callback(written > maxBytes ? new BadRequestError('Attachment upload exceeded the declared size limit.') : null, chunk);
    },
  });
  try {
    await pipeline(stream, guard, createWriteStream(target, { mode: 0o600 }));
  } catch (error) {
    if (existsSync(target)) rmSync(target, { force: true });
    throw error;
  }
  return {
    checksum: await sha256(target),
    drivePath,
    fileName,
    kind: classify(fileName, params.input.mimeType || uploaded.mimetype || null),
    mimeType: params.input.mimeType || uploaded.mimetype || null,
    sizeBytes: written,
  };
}
