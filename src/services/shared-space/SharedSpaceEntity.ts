import { basename, dirname } from 'node:path';
import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { BadRequestError } from 'routing-controllers';
import { readUserMatrixState } from '@gigav2/manifest/user-matrix';
import { OrganisationEntity } from '@connectingmatrix/orm/entities/OrganisationEntity';
import { readLimitMatrixValue } from '@gigav2/services/auth/permission-context';
import { getOrganizationAccessContext } from '@gigav2/services/organization/access';
import { DRIVE_ROOT, SHARED_SPACE_BYTES, SHARED_SPACE_OS_QUOTA_ENFORCED } from './constants';
import { assertWritable, copyPath, download, makeFolder, movePath, readFilePreview, removePath, statFile, writeBuffer, writeText } from './file-ops';
import { assertUserDrivePathAllowed } from './policy';
import { drivePath, getDriveRoot, hostPath, type DriveScope } from './path';
import { createDriveUploadTicket, type DriveUploadPreflightResult, type DriveUploadPurpose } from './ticket';
import { folderBytes, listFolder } from './usage';
import type { GraphqlResolverContext } from '@gigav2/types/graphql.types';
import type { WorkflowRuntimeSettings } from '@gigav2/types/workflow.types';
import type { Action } from '@gigav2/types/org.types';

type SharedSpaceContext = Pick<GraphqlResolverContext, 'supabase'> & Partial<Pick<GraphqlResolverContext, 'effectiveRoot' | 'request' | 'userId'>>;
type Access = { root: string; quotaBytes: number; usedBytes: number; remainingBytes: number; permissions?: { allowCreate?: boolean; allowRead?: boolean; allowUpdate?: boolean; allowDelete?: boolean } | null };
type PreflightInput = { fileName: string; mimeType?: string | null; organizationId?: string | null; path: string; sizeBytes: number; purpose?: DriveUploadPurpose };

const cleanId = (value: string) => String(value || '').trim();
const uploadPath = (folder: string, fileName: string) => {
  const base = drivePath(folder);
  const prefix = base === '/' ? DRIVE_ROOT : `${DRIVE_ROOT}${base}`;
  return `${prefix}/${basename(fileName || 'upload')}`;
};

export class SharedSpaceEntity {
  private constructor(private readonly scope: DriveScope) {}

  public static forOrganisation(organizationId: string) {
    const id = cleanId(organizationId);
    if (!id) throw new BadRequestError('organizationId is required.');
    return new SharedSpaceEntity({ kind: 'organization', organizationId: id });
  }

  public static forUser(userId: string) {
    const id = cleanId(userId);
    if (!id) throw new BadRequestError('userId is required.');
    return new SharedSpaceEntity({ kind: 'user', userId: id });
  }

  private scopeId() {
    return this.scope.kind === 'organization' ? this.scope.organizationId : this.scope.userId;
  }

  private root() {
    return getDriveRoot(this.scope);
  }

  private existingSize(path: string) {
    const target = hostPath(this.root(), path);
    if (!existsSync(target)) return 0;
    const stat = lstatSync(target);
    return stat.isDirectory() ? 0 : stat.size;
  }

  private writeAction(path: string): Action {
    return existsSync(hostPath(this.root(), path)) ? 'update' : 'create';
  }

  private async access(context: SharedSpaceContext, action: Action): Promise<Access> {
    const userId = cleanId(context.userId || '');
    if (!userId) throw new BadRequestError('userId is required.');
    const root = this.root();
    const usedBytes = folderBytes(root);
    if (this.scope.kind === 'user') {
      if (context.effectiveRoot !== true && userId !== this.scope.userId) throw new BadRequestError('User Drive access is required.');
      const state = await readUserMatrixState(context.supabase, { effectiveRoot: context.effectiveRoot === true, organizationId: null, userId });
      const quotaBytes = readLimitMatrixValue(state, 'USER_DRIVE_BYTES') || SHARED_SPACE_BYTES;
      return { root, quotaBytes, usedBytes, remainingBytes: Math.max(0, quotaBytes - usedBytes), permissions: { allowCreate: true, allowRead: true, allowUpdate: true, allowDelete: true } };
    }
    const resolverContext = { effectiveRoot: context.effectiveRoot === true, request: context.request, supabase: context.supabase, userId };
    const access = await getOrganizationAccessContext(context.supabase, userId, this.scope.organizationId, resolverContext as GraphqlResolverContext);
    if (!resolverContext.effectiveRoot && !access.hasMembership) throw new BadRequestError('Organization membership is required.');
    OrganisationEntity.requirePermission(access, { module: 'SHARED_SPACE', action });
    const state = await readUserMatrixState(context.supabase, { effectiveRoot: resolverContext.effectiveRoot, organizationId: this.scope.organizationId, userId });
    const quotaBytes = readLimitMatrixValue(state, 'ORG_SHARED_SPACE_BYTES') || SHARED_SPACE_BYTES;
    return { root, quotaBytes, usedBytes, remainingBytes: Math.max(0, quotaBytes - usedBytes), permissions: access.modulePermissions.SHARED_SPACE };
  }

  private assertPathWritable(access: Access, path: string, bytes: number) {
    const usedBytes = Math.max(0, access.usedBytes - this.existingSize(path));
    assertWritable({ ...access, usedBytes }, bytes);
  }

  public async summary(context: SharedSpaceContext) {
    const access = await this.access(context, 'read');
    const writable = Boolean(access.permissions?.allowCreate || access.permissions?.allowUpdate);
    return { scopeKind: this.scope.kind, scopeId: this.scopeId(), quotaBytes: access.quotaBytes, usedBytes: access.usedBytes, remainingBytes: access.remainingBytes, accessMode: writable ? 'readwrite' : 'read', mountPath: DRIVE_ROOT, mountAvailable: true, osQuotaEnforced: SHARED_SPACE_OS_QUOTA_ENFORCED(), permissions: access.permissions };
  }

  public async files(context: SharedSpaceContext, input: { path?: string | null } = {}) {
    const access = await this.access(context, 'read');
    const path = hostPath(access.root, input.path || DRIVE_ROOT);
    if (!existsSync(path)) return [];
    if (lstatSync(path).isSymbolicLink()) throw new BadRequestError('Symbolic links are not allowed in Drive.');
    return listFolder(access.root, path);
  }

  public async stat(context: SharedSpaceContext, input: { path: string }) {
    const access = await this.access(context, 'read');
    return statFile(access.root, input.path);
  }

  public async readFile(context: SharedSpaceContext, input: { maxPreviewBytes?: number | null; path: string }) {
    const access = await this.access(context, 'read');
    return readFilePreview(access.root, input.path, input.maxPreviewBytes || undefined);
  }

  public async createFolder(context: SharedSpaceContext, input: { path: string }) {
    assertUserDrivePathAllowed(input.path);
    const access = await this.access(context, 'create');
    return makeFolder(access.root, input.path);
  }

  public async deletePath(context: SharedSpaceContext, input: { path: string }) {
    const access = await this.access(context, 'delete');
    return removePath(access.root, input.path);
  }

  public async move(context: SharedSpaceContext, input: { fromPath: string; toPath: string }) {
    const { fromPath, toPath } = input;
    const access = await this.access(context, 'update');
    return movePath(access.root, fromPath, toPath);
  }

  public async copy(context: SharedSpaceContext, input: { fromPath: string; toPath: string }) {
    const { fromPath, toPath } = input;
    const sourceAccess = await this.access(context, 'read');
    const source = await statFile(sourceAccess.root, fromPath);
    const access = await this.access(context, this.writeAction(toPath));
    this.assertPathWritable(access, toPath, source.size);
    return copyPath(access.root, fromPath, toPath);
  }

  public async writeFile(context: SharedSpaceContext, input: { content?: string | null; contentBase64?: string | null; path: string }) {
    const access = await this.access(context, this.writeAction(input.path));
    if (input.contentBase64) {
      const content = Buffer.from(input.contentBase64, 'base64');
      this.assertPathWritable(access, input.path, content.byteLength);
      return writeBuffer(access.root, input.path, content);
    }
    if (input.content === null || input.content === undefined) throw new BadRequestError('Drive file content is required.');
    this.assertPathWritable(access, input.path, Buffer.byteLength(input.content));
    return writeText(access.root, input.path, input.content);
  }

  public async preflightUpload(context: SharedSpaceContext, input: PreflightInput): Promise<DriveUploadPreflightResult> {
    const path = uploadPath(input.path, input.fileName);
    if (input.purpose !== 'ai-agent') assertUserDrivePathAllowed(path);
    const access = await this.access(context, this.writeAction(path));
    this.assertPathWritable(access, path, input.sizeBytes);
    const userId = cleanId(context.userId || '');
    const expiresAt = Date.now() + 10 * 60 * 1000;
    const ticket = createDriveUploadTicket({ purpose: input.purpose || 'drive', scopeKind: this.scope.kind, scopeId: this.scopeId(), userId, organizationId: this.scope.kind === 'organization' ? this.scope.organizationId : input.organizationId || null, path, fileName: input.fileName, mimeType: input.mimeType || 'application/octet-stream', maxBytes: input.sizeBytes, expiresAt });
    return { uploadUrl: '/api/v2/drive/upload', ticket, path, expiresAt, maxBytes: input.sizeBytes };
  }

  public async writeUploadTicketFile(context: SharedSpaceContext, input: { content: Buffer; path: string }) {
    const access = await this.access(context, this.writeAction(input.path));
    this.assertPathWritable(access, input.path, input.content.byteLength);
    return writeBuffer(access.root, input.path, input.content);
  }

  public async downloadUrl(context: SharedSpaceContext, input: { checksum?: string | null; path: string; url: string }) {
    const root = this.root();
    const exists = existsSync(hostPath(root, input.path));
    if (exists) {
      const readAccess = await this.access(context, 'read');
      const existing = await statFile(readAccess.root, input.path);
      if (!input.checksum || existing.checksum === input.checksum) return { ...existing, cached: true };
    }
    const access = await this.access(context, exists ? 'update' : 'create');
    mkdirSync(dirname(hostPath(access.root, input.path)), { recursive: true, mode: 0o700 });
    if (!input.url.startsWith('https://') && !input.url.startsWith('http://')) throw new BadRequestError('Only http(s) URLs can be downloaded.');
    const result = await download(access.root, input.url, input.path, access.remainingBytes + this.existingSize(input.path));
    return { ...result, cached: false };
  }

  public async workflowDrive(context: SharedSpaceContext): Promise<WorkflowRuntimeSettings['sharedDrive']> {
    const access = await this.access(context, 'read');
    const readable = access.permissions?.allowRead === true;
    const writable = access.permissions?.allowCreate === true || access.permissions?.allowUpdate === true;
    if (!readable && !writable) return null;
    return { access: writable ? 'readwrite' : 'read', organizationId: this.scope.kind === 'organization' ? this.scope.organizationId : null, path: this.root(), quotaBytes: access.quotaBytes, virtualPath: DRIVE_ROOT };
  }
}
