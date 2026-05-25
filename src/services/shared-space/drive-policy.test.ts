import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import { DRIVE_PATH } from './constants';
import { getDriveRoot, orgRoot, userRoot } from './path';
import { assertUserDrivePathAllowed } from './policy';
import { removePath } from './file-ops';

beforeEach(() => {
  delete process.env.DRIVE_PATH;
});

describe('Drive path policy', () => {
  it('requires DRIVE_PATH', () => {
    expect(() => DRIVE_PATH()).toThrow('DRIVE_PATH is required');
  });

  it('resolves user and organization roots from DRIVE_PATH', () => {
    process.env.DRIVE_PATH = mkdtempSync(join(tmpdir(), 'giga-drive-'));
    expect(userRoot('user-1')).toContain('/users/user-1/drive');
    expect(orgRoot('org-1')).toContain('/orgs/org-1/drive');
    expect(getDriveRoot({ kind: 'user', userId: 'user-1' })).toContain('/users/user-1/drive');
    expect(getDriveRoot({ kind: 'organization', organizationId: 'org-1' })).toContain('/orgs/org-1/drive');
  });

  it('protects agent and agent project db paths but allows chat paths', () => {
    expect(() => assertUserDrivePathAllowed('/drive/user-1/agents/agent-1/FILES/a.csv')).toThrow('protected');
    expect(() => assertUserDrivePathAllowed('/drive/user-1/agent-projects/db/state.duckdb')).toThrow('protected');
    expect(() => assertUserDrivePathAllowed('/drive/user-1/chats/a.csv')).not.toThrow();
  });

  it('rejects protected deletes before checking filesystem state', () => {
    process.env.DRIVE_PATH = mkdtempSync(join(tmpdir(), 'giga-drive-'));
    expect(() => removePath(userRoot('user-1'), '/drive/user-1/agents/agent-1/FILES/missing.txt')).toThrow('protected');
  });

  it('allows chat folder deletes through user Drive operations', () => {
    process.env.DRIVE_PATH = mkdtempSync(join(tmpdir(), 'giga-drive-'));
    const root = userRoot('user-1');
    mkdirSync(join(root, 'user-1', 'chats'), { recursive: true });
    writeFileSync(join(root, 'user-1', 'chats', 'note.txt'), 'hello');
    expect(removePath(root, '/drive/user-1/chats').deleted).toBe(true);
  });
});
