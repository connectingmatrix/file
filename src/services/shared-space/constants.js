"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BLOCKED_EXTENSIONS = exports.SHARED_SPACE_OS_QUOTA_ENFORCED = exports.SHARED_SPACE_ROOT = exports.DRIVE_PATH = exports.DRIVE_ROOT = exports.SHARED_SPACE_BYTES = void 0;
const env_1 = require("@connectingmatrix/orm/env");
const DEFAULT_SHARED_SPACE_BYTES = 5 * 1024 * 1024 * 1024;
const configuredSharedSpaceBytes = () => {
    const value = Number(env_1.EnvLoader.get('GIGA_SHARED_SPACE_BYTES') || '');
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_SHARED_SPACE_BYTES;
};
exports.SHARED_SPACE_BYTES = configuredSharedSpaceBytes();
exports.DRIVE_ROOT = '/drive';
const DRIVE_PATH = () => {
    const value = env_1.EnvLoader.get('DRIVE_PATH');
    if (!value)
        throw new Error('DRIVE_PATH is required for Drive storage.');
    return value;
};
exports.DRIVE_PATH = DRIVE_PATH;
exports.SHARED_SPACE_ROOT = exports.DRIVE_PATH;
const SHARED_SPACE_OS_QUOTA_ENFORCED = () => env_1.EnvLoader.get('GIGA_SHARED_SPACE_OS_QUOTA_ENFORCED') === 'true';
exports.SHARED_SPACE_OS_QUOTA_ENFORCED = SHARED_SPACE_OS_QUOTA_ENFORCED;
exports.BLOCKED_EXTENSIONS = new Set(['.bat', '.cmd', '.com', '.csh', '.cjs', '.exe', '.js', '.mjs', '.ps1', '.sh', '.ts']);
