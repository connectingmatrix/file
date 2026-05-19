import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { BadRequestError } from 'routing-controllers';
import { SHARED_SPACE_ROOT } from '../services/shared-space/constants';
import { writeBuffer, statFile } from '../services/shared-space/file-ops';
import { orgRoot, publicPath } from '../services/shared-space/path';

export type AgentDriveScope = {
  userId: string;
  organizationId?: string | null;
};

export type AgentDriveFileObject = {
  id: string;
  scopeKind: 'user' | 'organization';
  scopeId: string;
  agentId: string;
  folderPath: string;
  folderHostPath: string;
  folderDeletable: false;
  drivePath: string;
  hostPath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum?: string | null;
  storageProvider: 'drive';
};

const clean = (value: string) => value.replace(/[^a-zA-Z0-9_.-]/g, '_');
const safeFileName = (value: string) => clean(basename(value || 'agent-file')) || 'agent-file';

export function agentDriveRoot(scope: AgentDriveScope): { root: string; scopeKind: 'user' | 'organization'; scopeId: string } {
  if (scope.organizationId) return { root: orgRoot(scope.organizationId), scopeKind: 'organization', scopeId: scope.organizationId };
  const userId = clean(scope.userId || 'anonymous');
  const root = resolve(SHARED_SPACE_ROOT(), 'users', userId);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return { root, scopeKind: 'user', scopeId: userId };
}

export function agentDriveFolder(scope: AgentDriveScope, agentId: string): { root: string; folderPath: string; folderHostPath: string; scopeKind: 'user' | 'organization'; scopeId: string; deletable: false } {
  const resolved = agentDriveRoot(scope);
  const folderPath = `/ai-agents/${clean(agentId)}/files`;
  const folderHostPath = resolve(resolved.root, folderPath.slice(1));
  const base = resolve(resolved.root);
  if (folderHostPath !== base && !folderHostPath.startsWith(`${base}${sep}`)) throw new BadRequestError('Agent Drive folder escaped the mounted drive.');
  mkdirSync(folderHostPath, { recursive: true, mode: 0o700 });
  return { ...resolved, folderPath: `/drive${folderPath}`, folderHostPath, deletable: false };
}

export async function writeAgentDriveFile(input: {
  scope: AgentDriveScope;
  agentId: string;
  fileName: string;
  mimeType?: string | null;
  body: Buffer;
  replaceAttachmentId?: string | null;
}): Promise<AgentDriveFileObject> {
  if (!input.agentId) throw new BadRequestError('agentId is required.');
  if (!input.scope.userId && !input.scope.organizationId) throw new BadRequestError('A user or organization scope is required for AI Agent Drive upload.');
  const folder = agentDriveFolder(input.scope, input.agentId);
  const id = input.replaceAttachmentId || randomUUID();
  const fileName = `${id}-${safeFileName(input.fileName)}`;
  const drivePath = `${folder.folderPath}/${fileName}`;
  const hostPath = join(folder.folderHostPath, fileName);
  const base = resolve(folder.root);
  const target = resolve(hostPath);
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new BadRequestError('Agent Drive file escaped the mounted drive.');
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const stat = writeBuffer(folder.root, drivePath, input.body);
  const detail = existsSync(hostPath) ? await statFile(folder.root, drivePath) : stat;
  return {
    id,
    scopeKind: folder.scopeKind,
    scopeId: folder.scopeId,
    agentId: input.agentId,
    folderPath: folder.folderPath,
    folderHostPath: folder.folderHostPath,
    folderDeletable: false,
    drivePath: detail.path || publicPath(folder.root, target),
    hostPath: target,
    fileName: safeFileName(input.fileName),
    mimeType: input.mimeType || 'application/octet-stream',
    sizeBytes: input.body.byteLength,
    checksum: detail.checksum || null,
    storageProvider: 'drive',
  };
}
