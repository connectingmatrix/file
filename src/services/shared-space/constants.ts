import { EnvLoader } from '@gigav2/lib/env';

export const SHARED_SPACE_BYTES = 5 * 1024 * 1024 * 1024;
export const DRIVE_ROOT = '/drive';

export const DRIVE_PATH = () => {
  const value = EnvLoader.get('DRIVE_PATH');
  if (!value) throw new Error('DRIVE_PATH is required for Drive storage.');
  return value;
};

export const SHARED_SPACE_ROOT = DRIVE_PATH;
export const SHARED_SPACE_OS_QUOTA_ENFORCED = () => EnvLoader.get('GIGA_SHARED_SPACE_OS_QUOTA_ENFORCED') === 'true';
export const BLOCKED_EXTENSIONS = new Set(['.bat', '.cmd', '.com', '.csh', '.cjs', '.exe', '.js', '.mjs', '.ps1', '.sh', '.ts']);
