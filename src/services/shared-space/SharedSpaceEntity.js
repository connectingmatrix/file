"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SharedSpaceEntity = void 0;
const node_path_1 = require("node:path");
const node_fs_1 = require("node:fs");
const routing_controllers_1 = require("routing-controllers");
const user_matrix_1 = require("@gigav2/manifest/user-matrix");
const OrganisationEntity_1 = require("@connectingmatrix/orm/entities/OrganisationEntity");
const permission_context_1 = require("@gigav2/services/auth/permission-context");
const access_1 = require("@gigav2/services/organization/access");
const constants_1 = require("./constants");
const file_ops_1 = require("./file-ops");
const policy_1 = require("./policy");
const path_1 = require("./path");
const ticket_1 = require("./ticket");
const usage_1 = require("./usage");
const cleanId = (value) => String(value || '').trim();
const uploadPath = (folder, fileName) => {
    const base = (0, path_1.drivePath)(folder);
    const prefix = base === '/' ? constants_1.DRIVE_ROOT : `${constants_1.DRIVE_ROOT}${base}`;
    return `${prefix}/${(0, node_path_1.basename)(fileName || 'upload')}`;
};
class SharedSpaceEntity {
    constructor(scope) {
        this.scope = scope;
    }
    static forOrganisation(organizationId) {
        const id = cleanId(organizationId);
        if (!id)
            throw new routing_controllers_1.BadRequestError('organizationId is required.');
        return new SharedSpaceEntity({ kind: 'organization', organizationId: id });
    }
    static forUser(userId) {
        const id = cleanId(userId);
        if (!id)
            throw new routing_controllers_1.BadRequestError('userId is required.');
        return new SharedSpaceEntity({ kind: 'user', userId: id });
    }
    scopeId() {
        return this.scope.kind === 'organization' ? this.scope.organizationId : this.scope.userId;
    }
    root() {
        return (0, path_1.getDriveRoot)(this.scope);
    }
    existingSize(path) {
        const target = (0, path_1.hostPath)(this.root(), path);
        if (!(0, node_fs_1.existsSync)(target))
            return 0;
        const stat = (0, node_fs_1.lstatSync)(target);
        return stat.isDirectory() ? 0 : stat.size;
    }
    writeAction(path) {
        return (0, node_fs_1.existsSync)((0, path_1.hostPath)(this.root(), path)) ? 'update' : 'create';
    }
    async access(context, action) {
        const userId = cleanId(context.userId || '');
        if (!userId)
            throw new routing_controllers_1.BadRequestError('userId is required.');
        const root = this.root();
        const usedBytes = (0, usage_1.folderBytes)(root);
        if (this.scope.kind === 'user') {
            if (context.effectiveRoot !== true && userId !== this.scope.userId)
                throw new routing_controllers_1.BadRequestError('User Drive access is required.');
            const state = await (0, user_matrix_1.readUserMatrixState)(context.supabase, { effectiveRoot: context.effectiveRoot === true, organizationId: null, userId });
            const quotaBytes = (0, permission_context_1.readLimitMatrixValue)(state, 'USER_DRIVE_BYTES') || constants_1.SHARED_SPACE_BYTES;
            return { root, quotaBytes, usedBytes, remainingBytes: Math.max(0, quotaBytes - usedBytes), permissions: { allowCreate: true, allowRead: true, allowUpdate: true, allowDelete: true } };
        }
        const resolverContext = { effectiveRoot: context.effectiveRoot === true, request: context.request, supabase: context.supabase, userId };
        const access = await (0, access_1.getOrganizationAccessContext)(context.supabase, userId, this.scope.organizationId, resolverContext);
        if (!resolverContext.effectiveRoot && !access.hasMembership)
            throw new routing_controllers_1.BadRequestError('Organization membership is required.');
        OrganisationEntity_1.OrganisationEntity.requirePermission(access, { module: 'SHARED_SPACE', action });
        const state = await (0, user_matrix_1.readUserMatrixState)(context.supabase, { effectiveRoot: resolverContext.effectiveRoot, organizationId: this.scope.organizationId, userId });
        const quotaBytes = (0, permission_context_1.readLimitMatrixValue)(state, 'ORG_SHARED_SPACE_BYTES') || constants_1.SHARED_SPACE_BYTES;
        return { root, quotaBytes, usedBytes, remainingBytes: Math.max(0, quotaBytes - usedBytes), permissions: access.modulePermissions.SHARED_SPACE };
    }
    assertPathWritable(access, path, bytes) {
        const usedBytes = Math.max(0, access.usedBytes - this.existingSize(path));
        (0, file_ops_1.assertWritable)({ ...access, usedBytes }, bytes);
    }
    async summary(context) {
        var _a, _b;
        const access = await this.access(context, 'read');
        const writable = Boolean(((_a = access.permissions) === null || _a === void 0 ? void 0 : _a.allowCreate) || ((_b = access.permissions) === null || _b === void 0 ? void 0 : _b.allowUpdate));
        return { scopeKind: this.scope.kind, scopeId: this.scopeId(), quotaBytes: access.quotaBytes, usedBytes: access.usedBytes, remainingBytes: access.remainingBytes, accessMode: writable ? 'readwrite' : 'read', mountPath: constants_1.DRIVE_ROOT, mountAvailable: true, osQuotaEnforced: (0, constants_1.SHARED_SPACE_OS_QUOTA_ENFORCED)(), permissions: access.permissions };
    }
    async files(context, input = {}) {
        const access = await this.access(context, 'read');
        const path = (0, path_1.hostPath)(access.root, input.path || constants_1.DRIVE_ROOT);
        if (!(0, node_fs_1.existsSync)(path))
            return [];
        if ((0, node_fs_1.lstatSync)(path).isSymbolicLink())
            throw new routing_controllers_1.BadRequestError('Symbolic links are not allowed in Drive.');
        return (0, usage_1.listFolder)(access.root, path);
    }
    async stat(context, input) {
        const access = await this.access(context, 'read');
        return (0, file_ops_1.statFile)(access.root, input.path);
    }
    async readFile(context, input) {
        const access = await this.access(context, 'read');
        return (0, file_ops_1.readFilePreview)(access.root, input.path, input.maxPreviewBytes || undefined);
    }
    async createFolder(context, input) {
        (0, policy_1.assertUserDrivePathAllowed)(input.path);
        const access = await this.access(context, 'create');
        return (0, file_ops_1.makeFolder)(access.root, input.path);
    }
    async deletePath(context, input) {
        const access = await this.access(context, 'delete');
        return (0, file_ops_1.removePath)(access.root, input.path);
    }
    async move(context, input) {
        const { fromPath, toPath } = input;
        const access = await this.access(context, 'update');
        return (0, file_ops_1.movePath)(access.root, fromPath, toPath);
    }
    async copy(context, input) {
        const { fromPath, toPath } = input;
        const sourceAccess = await this.access(context, 'read');
        const source = await (0, file_ops_1.statFile)(sourceAccess.root, fromPath);
        const access = await this.access(context, this.writeAction(toPath));
        this.assertPathWritable(access, toPath, source.size);
        return (0, file_ops_1.copyPath)(access.root, fromPath, toPath);
    }
    async writeFile(context, input) {
        const access = await this.access(context, this.writeAction(input.path));
        if (input.contentBase64) {
            const content = Buffer.from(input.contentBase64, 'base64');
            this.assertPathWritable(access, input.path, content.byteLength);
            return (0, file_ops_1.writeBuffer)(access.root, input.path, content);
        }
        if (input.content === null || input.content === undefined)
            throw new routing_controllers_1.BadRequestError('Drive file content is required.');
        this.assertPathWritable(access, input.path, Buffer.byteLength(input.content));
        return (0, file_ops_1.writeText)(access.root, input.path, input.content);
    }
    async preflightUpload(context, input) {
        const path = uploadPath(input.path, input.fileName);
        if (input.purpose !== 'ai-agent')
            (0, policy_1.assertUserDrivePathAllowed)(path);
        const access = await this.access(context, this.writeAction(path));
        this.assertPathWritable(access, path, input.sizeBytes);
        const userId = cleanId(context.userId || '');
        const expiresAt = Date.now() + 10 * 60 * 1000;
        const ticket = (0, ticket_1.createDriveUploadTicket)({ purpose: input.purpose || 'drive', scopeKind: this.scope.kind, scopeId: this.scopeId(), userId, organizationId: this.scope.kind === 'organization' ? this.scope.organizationId : input.organizationId || null, path, fileName: input.fileName, mimeType: input.mimeType || 'application/octet-stream', maxBytes: input.sizeBytes, expiresAt });
        return { uploadUrl: '/api/v2/drive/upload', ticket, path, expiresAt, maxBytes: input.sizeBytes };
    }
    async writeUploadTicketFile(context, input) {
        const access = await this.access(context, this.writeAction(input.path));
        this.assertPathWritable(access, input.path, input.content.byteLength);
        return (0, file_ops_1.writeBuffer)(access.root, input.path, input.content);
    }
    async downloadUrl(context, input) {
        const root = this.root();
        const exists = (0, node_fs_1.existsSync)((0, path_1.hostPath)(root, input.path));
        if (exists) {
            const readAccess = await this.access(context, 'read');
            const existing = await (0, file_ops_1.statFile)(readAccess.root, input.path);
            if (!input.checksum || existing.checksum === input.checksum)
                return { ...existing, cached: true };
        }
        const access = await this.access(context, exists ? 'update' : 'create');
        (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)((0, path_1.hostPath)(access.root, input.path)), { recursive: true, mode: 0o700 });
        if (!input.url.startsWith('https://') && !input.url.startsWith('http://'))
            throw new routing_controllers_1.BadRequestError('Only http(s) URLs can be downloaded.');
        const result = await (0, file_ops_1.download)(access.root, input.url, input.path, access.remainingBytes + this.existingSize(input.path));
        return { ...result, cached: false };
    }
}
exports.SharedSpaceEntity = SharedSpaceEntity;
