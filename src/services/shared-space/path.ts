import { mkdirSync } from 'node:fs';
import { basename, extname, resolve, sep } from 'node:path';
import { BLOCKED_EXTENSIONS, DRIVE_ROOT, SHARED_SPACE_ROOT } from './constants';

const cleanOrg = (value: string) => value.replace(/[^a-zA-Z0-9_.-]/g, '_');

export const orgRoot = (organizationId: string) => {
  const root = resolve(SHARED_SPACE_ROOT(), 'organizations', cleanOrg(organizationId));
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
};

export const drivePath = (value?: string | null) => {
  const raw =
    String(value || '/')
      .replace(/\\/g, '/')
      .trim() || '/';
  const local = raw === DRIVE_ROOT ? '/' : raw.startsWith(`${DRIVE_ROOT}/`) ? raw.slice(DRIVE_ROOT.length) : raw;
  if (raw !== '/' && local.startsWith('/') && !raw.startsWith(DRIVE_ROOT)) throw new Error('Shared space paths must use /drive.');
  const parts = local.split('/').filter(Boolean);
  if (parts.some((part) => part === '..' || part.includes('\0'))) throw new Error('Shared space path is not allowed.');
  return `/${parts.join('/')}`;
};

export const hostPath = (root: string, value?: string | null) => {
  const relative = drivePath(value).slice(1);
  const target = resolve(root, relative);
  const base = resolve(root);
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new Error('Shared space path escaped the organization drive.');
  return target;
};

export const blockedName = (name: string) => BLOCKED_EXTENSIONS.has(extname(basename(name)).toLowerCase());
export const publicPath = (root: string, path: string) =>
  `${DRIVE_ROOT}${path === root ? '' : `/${path.slice(root.length).split(sep).filter(Boolean).join('/')}`}`;
