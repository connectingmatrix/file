import { dirname } from 'node:path';
import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { BadRequestError } from 'routing-controllers';
import { readUserMatrixState } from '@gigav2/manifest/user-matrix';
import { OrganisationEntity } from '@connectingmatrix/orm/entities/OrganisationEntity';
import { readLimitMatrixValue } from '@gigav2/services/auth/permission-context';
import { getOrganizationAccessContext } from '@gigav2/services/organization/access';
import { SHARED_SPACE_BYTES, SHARED_SPACE_OS_QUOTA_ENFORCED } from './constants';
import {
  assertWritable,
  copyPath,
  download,
  makeFolder,
  movePath,
  removePath,
  statFile,
  writeBuffer,
  writeText,
} from './file-ops';
import { hostPath, orgRoot } from './path';
import { folderBytes, listFolder } from './usage';
import type { GraphqlResolverContext } from '@gigav2/types/graphql.types';
import type { WorkflowRuntimeSettings } from '@gigav2/types/workflow.types';
import type { Action } from '@gigav2/types/org.types';

type SharedSpaceContext = {
  supabase: unknown;
  userId?: string | null;
  effectiveRoot?: boolean | null;
  request?: unknown;
};

export class SharedSpaceEntity {
  private constructor(private readonly organizationIdValue: string) {}

  public static forOrganisation(organizationId: string) {
    const id = String(organizationId || '').trim();
    if (!id) throw new BadRequestError('organizationId is required.');
    return new SharedSpaceEntity(id);
  }

  private orgId() {
    const id = String(this.organizationIdValue || '').trim();
    if (!id) throw new BadRequestError('organizationId is required.');
    return id;
  }

  private root() {
    return orgRoot(this.orgId());
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

  private async access(context: SharedSpaceContext, action: Action) {
    const organizationId = this.orgId();
    const userId = String(context.userId || '').trim();
    if (!userId) throw new BadRequestError('userId is required.');
    const resolverContext = {
      effectiveRoot: context.effectiveRoot === true,
      request: context.request,
      supabase: context.supabase,
      userId,
    };
    const access = await getOrganizationAccessContext(context.supabase, userId, organizationId, resolverContext as GraphqlResolverContext);
    if (!resolverContext.effectiveRoot && !access.hasMembership) throw new BadRequestError('Organization membership is required.');
    OrganisationEntity.requirePermission(access, { module: 'SHARED_SPACE', action });
    const state = await readUserMatrixState(context.supabase, {
      effectiveRoot: resolverContext.effectiveRoot,
      organizationId,
      userId,
    });
    const quotaBytes = readLimitMatrixValue(state, 'ORG_SHARED_SPACE_BYTES') || SHARED_SPACE_BYTES;
    const root = this.root();
    const usedBytes = folderBytes(root);
    return {
      root,
      quotaBytes,
      usedBytes,
      remainingBytes: Math.max(0, quotaBytes - usedBytes),
      permissions: access.modulePermissions.SHARED_SPACE,
    };
  }

  private assertPathWritable(access: { quotaBytes: number; root: string; usedBytes: number }, path: string, bytes: number) {
    const usedBytes = Math.max(0, access.usedBytes - this.existingSize(path));
    assertWritable({ ...access, usedBytes }, bytes);
  }

  public async summary(context: SharedSpaceContext) {
    const access = await this.access(context, 'read');
    const writable = Boolean(access.permissions?.allowCreate || access.permissions?.allowUpdate);
    return {
      organizationId: this.orgId(),
      quotaBytes: access.quotaBytes,
      usedBytes: access.usedBytes,
      remainingBytes: access.remainingBytes,
      accessMode: writable ? 'readwrite' : 'read',
      mountPath: '/drive',
      mountAvailable: true,
      osQuotaEnforced: SHARED_SPACE_OS_QUOTA_ENFORCED(),
      permissions: access.permissions,
    };
  }

  public async files(context: SharedSpaceContext, input: { path?: string | null } = {}) {
    const access = await this.access(context, 'read');
    const path = hostPath(access.root, input.path || '/');
    if (!existsSync(path)) return [];
    if (lstatSync(path).isSymbolicLink()) throw new BadRequestError('Symbolic links are not allowed in shared space.');
    return listFolder(access.root, path);
  }

  public async stat(context: SharedSpaceContext, input: { path: string }) {
    const access = await this.access(context, 'read');
    return statFile(access.root, input.path);
  }

  public async createFolder(context: SharedSpaceContext, input: { path: string }) {
    const access = await this.access(context, 'create');
    return makeFolder(access.root, input.path);
  }

  public async deletePath(context: SharedSpaceContext, input: { path: string }) {
    const access = await this.access(context, 'delete');
    return removePath(access.root, input.path);
  }

  public async move(context: SharedSpaceContext, input: { fromPath: string; toPath: string }) {
    const access = await this.access(context, 'update');
    return movePath(access.root, input.fromPath, input.toPath);
  }

  public async copy(context: SharedSpaceContext, input: { fromPath: string; toPath: string }) {
    const sourceAccess = await this.access(context, 'read');
    const source = await statFile(sourceAccess.root, input.fromPath);
    const access = await this.access(context, this.writeAction(input.toPath));
    this.assertPathWritable(access, input.toPath, source.size);
    return copyPath(access.root, input.fromPath, input.toPath);
  }

  public async writeFile(context: SharedSpaceContext, input: { contentBase64?: string | null; json?: unknown; path: string }) {
    const access = await this.access(context, this.writeAction(input.path));
    if (input.contentBase64) {
      const content = Buffer.from(input.contentBase64, 'base64');
      this.assertPathWritable(access, input.path, content.byteLength);
      return writeBuffer(access.root, input.path, content);
    }
    const text = JSON.stringify(input.json ?? {}, null, 2);
    this.assertPathWritable(access, input.path, Buffer.byteLength(text));
    return writeText(access.root, input.path, text);
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
    return {
      access: writable ? 'readwrite' : 'read',
      organizationId: this.orgId(),
      path: this.root(),
      quotaBytes: access.quotaBytes,
      virtualPath: '/drive',
    };
  }
}
