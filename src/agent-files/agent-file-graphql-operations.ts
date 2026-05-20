import { randomUUID } from 'node:crypto';
import { lstatSync, rmSync } from 'node:fs';
import { writeAgentDriveFile, writeAgentDriveFileStream } from './agent-drive-files';
import { runAgentFileUploadIngestionHook } from './agent-file-ingestion-hooks';
import { AIAgentAttachmentEntity, type AIAgentAttachmentRow } from '../entities/AIAgentAttachmentEntity';
import type {
  AgentFileGraphqlUpload,
  AgentFileGraphqlUploadSlot,
  AgentFileHeaderBag,
  AgentFileJsonObject,
  AgentFileJsonValue,
  AgentFileOperationPayload,
  AgentFileResolverContext,
  AgentFileUploadRecord,
} from './graphql-types';

type UploadFileDetail = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  body?: Buffer;
  stream?: NodeJS.ReadableStream;
};

const emptyPayload = (agentId: string | null, status: string, message: string): AgentFileOperationPayload => ({
  agentId,
  status,
  processId: null,
  attachmentIds: [],
  fileIds: [],
  fileNames: [],
  storagePaths: [],
  driveLinks: [],
  modes: [],
  fileShapeIds: [],
  fileShapeNames: [],
  deletedAttachmentIds: [],
  removedFromMemory: false,
  driveFilesDeleted: false,
  folderProtected: true,
  message,
});

const objectValue = (value: AgentFileJsonValue | null | undefined): AgentFileJsonObject =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as AgentFileJsonObject) : {};

const textValue = (value: AgentFileJsonValue | string | number | boolean | null | undefined): string =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value).trim() : '';

const boolValue = (value: AgentFileJsonValue | null | undefined): boolean => value === true || textValue(value).toLowerCase() === 'true';

const listText = (value: AgentFileJsonValue | null | undefined): string[] => {
  if (Array.isArray(value)) return value.map((item) => textValue(item)).filter(Boolean);
  const raw = textValue(value);
  return raw ? raw.split(',').map((item) => item.trim()).filter(Boolean) : [];
};

const firstHeader = (headers: AgentFileHeaderBag | undefined, key: string): string => {
  const direct = headers?.[key] || headers?.[key.toLowerCase()] || headers?.[key.toUpperCase()];
  return Array.isArray(direct) ? textValue(direct[0]) : textValue(direct);
};

const contextUserId = (context: AgentFileResolverContext, input: AgentFileJsonObject): string =>
  textValue(context.userId) ||
  textValue(context.ormRequestContext?.user_id) ||
  firstHeader(context.request?.headers, 'x-giga-user-id') ||
  firstHeader(context.request?.headers, 'x-user-id') ||
  textValue(input.userId) ||
  textValue(input.user_id) ||
  'system';

const contextOrganizationId = (context: AgentFileResolverContext, input: AgentFileJsonObject): string | null =>
  textValue(context.organizationId) ||
  textValue(context.organisationId) ||
  textValue(context.ormRequestContext?.organization_id) ||
  textValue(context.ormRequestContext?.organisation_id) ||
  firstHeader(context.request?.headers, 'x-giga-organization-id') ||
  firstHeader(context.request?.headers, 'x-organization-id') ||
  textValue(input.organizationId) ||
  textValue(input.organisationId) ||
  textValue(input.organization_id) ||
  null;

const fileModesAt = (input: AgentFileJsonObject, index: number, fallback: string[]): string[] => {
  const fileModes = Array.isArray(input.fileModes) ? input.fileModes : [];
  const candidate = objectValue(fileModes[index]);
  const modes = listText(candidate.modes || candidate.ingestionModes || candidate.ingestion_modes);
  return modes.length ? modes : fallback;
};

const uploadList = (files: AgentFileGraphqlUploadSlot[] | AgentFileGraphqlUploadSlot | null | undefined): AgentFileGraphqlUploadSlot[] => {
  if (!files) return [];
  return Array.isArray(files) ? files : [files];
};

async function readUpload(slot: AgentFileGraphqlUploadSlot): Promise<UploadFileDetail> {
  const file: AgentFileGraphqlUpload = await slot;
  const fileName = textValue(file.filename || file.name) || `agent-file-${randomUUID()}`;
  const mimeType = textValue(file.mimetype || file.type) || 'application/octet-stream';
  if (file.buffer) {
    const body = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer);
    return { fileName, mimeType, sizeBytes: Number(file.size || body.byteLength), body };
  }
  if (file.arrayBuffer) {
    const body = Buffer.from(await file.arrayBuffer());
    return { fileName, mimeType, sizeBytes: Number(file.size || body.byteLength), body };
  }
  if (file.createReadStream) {
    return { fileName, mimeType, sizeBytes: Number(file.size || 0), stream: file.createReadStream() };
  }
  if (file.stream) {
    return { fileName, mimeType, sizeBytes: Number(file.size || 0), stream: file.stream() };
  }
  throw new Error(`Unable to read upload ${fileName}.`);
}

const rowMetadata = (row: AIAgentAttachmentRow): AgentFileJsonObject =>
  objectValue(row.ingestion_metadata as AgentFileJsonValue).driveFile
    ? objectValue(row.ingestion_metadata as AgentFileJsonValue)
    : { driveFile: objectValue(row.drive_file as AgentFileJsonValue) };

const rowDriveFile = (row: AIAgentAttachmentRow): AgentFileJsonObject => {
  const metadata = rowMetadata(row);
  return objectValue((metadata.driveFile || metadata.drive_file || row.drive_file) as AgentFileJsonValue);
};

function removeHostFile(row: AIAgentAttachmentRow): boolean {
  const driveFile = rowDriveFile(row);
  const hostPath = textValue(driveFile.hostPath || driveFile.physicalPath);
  if (!hostPath) return false;
  const stat = lstatSync(hostPath);
  if (stat.isDirectory() || stat.isSymbolicLink()) return false;
  rmSync(hostPath, { force: true });
  return true;
}

export async function uploadAiAgentFilesOperation(
  input: AgentFileJsonObject,
  files: AgentFileGraphqlUploadSlot[] | AgentFileGraphqlUploadSlot | null | undefined,
  context: AgentFileResolverContext = {},
): Promise<AgentFileOperationPayload> {
  const agentId = textValue(input.agentId || input.agent_id) || null;
  const draftId = textValue(input.draftId || input.draft_id);
  const storageAgentId = agentId || draftId;
  if (!storageAgentId) throw new Error('uploadAiAgentFiles requires agentId or draftId.');

  const slots = uploadList(files);
  if (!slots.length) throw new Error('uploadAiAgentFiles requires at least one file.');

  const ownerUserId = contextUserId(context, input);
  const organizationId = contextOrganizationId(context, input);
  const temporary = boolValue(input.temporary) || !agentId;
  const baseModes = listText(input.modes || input.ingestionModes || input.ingestion_modes);
  const modes = baseModes.length ? baseModes : ['AUTO'];
  const payload = emptyPayload(agentId, 'queued', 'AI Agent file upload queued.');
  const uploaded: AgentFileUploadRecord[] = [];

  for (let index = 0; index < slots.length; index += 1) {
    const upload = await readUpload(slots[index]);
    const selectedModes = fileModesAt(input, index, modes);
    const attachmentId = textValue(input.replaceAttachmentId || input.attachmentId || input.attachment_id) || randomUUID();
    const driveFile = upload.stream
      ? await writeAgentDriveFileStream({
          scope: { userId: ownerUserId, organizationId },
          agentId: storageAgentId,
          fileName: upload.fileName,
          mimeType: upload.mimeType,
          stream: upload.stream,
          replaceAttachmentId: attachmentId,
          declaredSizeBytes: upload.sizeBytes || null,
        })
      : await writeAgentDriveFile({
          scope: { userId: ownerUserId, organizationId },
          agentId: storageAgentId,
          fileName: upload.fileName,
          mimeType: upload.mimeType,
          body: upload.body || Buffer.alloc(0),
          replaceAttachmentId: attachmentId,
        });
    const storageBucket = driveFile.scopeKind === 'organization' ? 'organization-drive' : 'user-drive';
    await AIAgentAttachmentEntity.create({
      id: attachmentId,
      agent_id: agentId,
      shared_space_id: driveFile.scopeId,
      file_id: driveFile.id,
      storage_bucket: storageBucket,
      storage_path: driveFile.drivePath,
      filename: driveFile.fileName,
      mime_type: driveFile.mimeType,
      byte_size: driveFile.sizeBytes,
      ingestion_status: temporary ? 'temporary' : 'queued',
      drive_file: driveFile,
      folder_protected: true,
      ingestion_modes: selectedModes,
      created_by: ownerUserId,
      ingestion_metadata: {
        modes: selectedModes,
        driveFile,
        folderProtected: true,
        temporary,
        draftId: draftId || null,
        deletionPolicy: 'agent-folder-protected-file-removable-from-memory',
      },
    });
    payload.attachmentIds.push(attachmentId);
    payload.fileIds.push(driveFile.id);
    payload.fileNames.push(driveFile.fileName);
    payload.storagePaths.push(driveFile.drivePath);
    payload.driveLinks.push(driveFile.drivePath);
    for (const mode of selectedModes) if (!payload.modes.includes(mode)) payload.modes.push(mode);
    uploaded.push({
      attachmentId,
      agentId: storageAgentId,
      fileId: driveFile.id,
      fileName: driveFile.fileName,
      mimeType: driveFile.mimeType,
      sizeBytes: driveFile.sizeBytes,
      hostPath: driveFile.hostPath,
      drivePath: driveFile.drivePath,
      storageBucket,
      modes: selectedModes,
    });
  }

  if (agentId && uploaded.length && !temporary) {
    const hookResult = await runAgentFileUploadIngestionHook({ agentId, ownerUserId, organizationId, temporary, files: uploaded });
    payload.processId = hookResult.processId;
    payload.status = hookResult.status;
    payload.fileShapeIds = hookResult.fileShapeIds;
    payload.fileShapeNames = hookResult.fileShapeNames;
  }

  return payload;
}

export async function deleteAiAgentFileOperation(input: AgentFileJsonObject): Promise<AgentFileOperationPayload> {
  const agentId = textValue(input.agentId || input.agent_id) || null;
  const attachmentIds = listText(input.attachmentIds || input.attachment_ids);
  const singleId = textValue(input.attachmentId || input.attachment_id);
  if (singleId && !attachmentIds.includes(singleId)) attachmentIds.push(singleId);
  if (!attachmentIds.length) throw new Error('deleteAiAgentFile requires attachmentId or attachmentIds.');

  const deleteDriveFiles = boolValue(input.deleteDriveFiles || input.delete_drive_files);
  const payload = emptyPayload(agentId, 'deleted', 'AI Agent file attachment deleted.');
  payload.driveFilesDeleted = deleteDriveFiles;

  for (const attachmentId of attachmentIds) {
    const existing = await AIAgentAttachmentEntity.single(attachmentId);
    if (!existing) continue;
    const row = existing.extract() as AIAgentAttachmentRow;
    if (deleteDriveFiles) {
      try {
        removeHostFile(row);
      } catch (error) {
        payload.message = error instanceof Error ? error.message : 'Drive file deletion failed.';
      }
    }
    const metadata = { ...rowMetadata(row), detachedAt: new Date().toISOString(), detachedFrom: 'drive-delete' };
    await existing.update({ ingestion_status: 'deleted', ingestion_metadata: metadata });
    payload.deletedAttachmentIds.push(attachmentId);
    payload.attachmentIds.push(attachmentId);
  }

  return payload;
}
