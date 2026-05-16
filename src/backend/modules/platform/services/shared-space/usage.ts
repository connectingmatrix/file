import { lstatSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';
import { publicPath } from './path';

export const folderBytes = (path: string): number => {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return 0;
  if (!stat.isDirectory()) return stat.size;
  return readdirSync(path).reduce((total, entry) => total + folderBytes(`${path}/${entry}`), 0);
};

export const listFolder = (root: string, path: string) =>
  readdirSync(path, { withFileTypes: true })
    .filter((entry) => !entry.isSymbolicLink())
    .map((entry) => {
      const fullPath = `${path}/${entry.name}`;
      const stat = lstatSync(fullPath);
      return {
        name: basename(entry.name),
        path: publicPath(root, fullPath),
        size: entry.isDirectory() ? folderBytes(fullPath) : stat.size,
        kind: entry.isDirectory() ? 'folder' : 'file',
        updatedAt: stat.mtime.toISOString(),
      };
    })
    .sort((left, right) => `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`));
