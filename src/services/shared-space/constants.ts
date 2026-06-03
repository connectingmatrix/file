import { EnvLoader } from '@connectingmatrix/orm/env';

const DEFAULT_SHARED_SPACE_BYTES = 20 * 1024 * 1024 * 1024;
const configuredSharedSpaceBytes = () => {
  const value = Number(EnvLoader.get('GIGA_SHARED_SPACE_BYTES') || '');
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_SHARED_SPACE_BYTES;
};

export const SHARED_SPACE_BYTES = configuredSharedSpaceBytes();
export const DRIVE_ROOT = '/drive';

export const DRIVE_PATH = () => {
  const value = EnvLoader.get('DRIVE_PATH');
  if (!value) throw new Error('DRIVE_PATH is required for Drive storage.');
  return value;
};

export const SHARED_SPACE_ROOT = DRIVE_PATH;
export const SHARED_SPACE_OS_QUOTA_ENFORCED = () => EnvLoader.get('GIGA_SHARED_SPACE_OS_QUOTA_ENFORCED') === 'true';
export const BLOCKED_EXTENSIONS = new Set(['.bat', '.cmd', '.com', '.csh', '.cjs', '.exe', '.js', '.mjs', '.ps1', '.sh', '.ts']);
