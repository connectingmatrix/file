import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { EnvLoader } from '@gigav2/lib/env';

export const SHARED_SPACE_BYTES = 5 * 1024 * 1024 * 1024;
export const DRIVE_ROOT = '/drive';
const platformRoot = () => {
  const current = platform();
  if (current === 'linux') return '/home/ubuntu/giga-shared-space';
  if (current === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Giga', 'shared-space');
  if (current === 'win32') return join(process.env.ProgramData || 'C:\\ProgramData', 'Giga', 'shared-space');
  return join(homedir(), '.giga', 'shared-space');
};

export const SHARED_SPACE_ROOT = () => EnvLoader.get('GIGA_SHARED_SPACE_ROOT') || platformRoot();
export const SHARED_SPACE_OS_QUOTA_ENFORCED = () => EnvLoader.get('GIGA_SHARED_SPACE_OS_QUOTA_ENFORCED') === 'true';
export const BLOCKED_EXTENSIONS = new Set(['.bat', '.cmd', '.com', '.csh', '.cjs', '.exe', '.js', '.mjs', '.ps1', '.sh', '.ts']);
