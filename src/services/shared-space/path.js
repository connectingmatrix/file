"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicPath = exports.blockedName = exports.hostPath = exports.drivePath = exports.driveRootFor = exports.getDriveRoot = exports.orgRoot = exports.userRoot = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const constants_1 = require("./constants");
const cleanScope = (value) => value.replace(/[^a-zA-Z0-9_.-]/g, '_');
const ensureRoot = (root) => {
    (0, node_fs_1.mkdirSync)(root, { recursive: true, mode: 0o700 });
    return root;
};
const userRoot = (userId) => ensureRoot((0, node_path_1.resolve)((0, constants_1.DRIVE_PATH)(), 'users', cleanScope(userId), 'drive'));
exports.userRoot = userRoot;
const orgRoot = (organizationId) => ensureRoot((0, node_path_1.resolve)((0, constants_1.DRIVE_PATH)(), 'orgs', cleanScope(organizationId), 'drive'));
exports.orgRoot = orgRoot;
const getDriveRoot = (scope) => (scope.kind === 'organization' ? (0, exports.orgRoot)(scope.organizationId) : (0, exports.userRoot)(scope.userId));
exports.getDriveRoot = getDriveRoot;
exports.driveRootFor = exports.getDriveRoot;
const drivePath = (value) => {
    const raw = String(value || '/').replace(/\\/g, '/').trim() || '/';
    const local = raw === constants_1.DRIVE_ROOT ? '/' : raw.startsWith(`${constants_1.DRIVE_ROOT}/`) ? raw.slice(constants_1.DRIVE_ROOT.length) : raw;
    if (raw !== '/' && local.startsWith('/') && !raw.startsWith(constants_1.DRIVE_ROOT))
        throw new Error('Drive paths must use /drive.');
    const parts = local.split('/').filter(Boolean);
    if (parts.some((part) => part === '..' || part.includes('\0')))
        throw new Error('Drive path is not allowed.');
    return `/${parts.join('/')}`;
};
exports.drivePath = drivePath;
const hostPath = (root, value) => {
    const relative = (0, exports.drivePath)(value).slice(1);
    const target = (0, node_path_1.resolve)(root, relative);
    const base = (0, node_path_1.resolve)(root);
    if (target !== base && !target.startsWith(`${base}${node_path_1.sep}`))
        throw new Error('Drive path escaped the mounted drive.');
    return target;
};
exports.hostPath = hostPath;
const blockedName = (name) => constants_1.BLOCKED_EXTENSIONS.has((0, node_path_1.extname)((0, node_path_1.basename)(name)).toLowerCase());
exports.blockedName = blockedName;
const publicPath = (root, path) => `${constants_1.DRIVE_ROOT}${path === root ? '' : `/${path.slice(root.length).split(node_path_1.sep).filter(Boolean).join('/')}`}`;
exports.publicPath = publicPath;
