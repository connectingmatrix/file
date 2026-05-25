import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import { agentArtifactFolder, agentDriveFolder, writeAgentArtifactFile } from '../agent-drive-files';

beforeEach(() => {
  process.env.DRIVE_PATH = mkdtempSync(join(tmpdir(), 'giga-drive-'));
});

describe('AI Agent Drive file policy', () => {
  it('keeps uploaded organization AI Agent files under the organization agent FILES folder', () => {
    const folder = agentDriveFolder({ userId: 'user-1', organizationId: 'org-1' }, 'agent-1');
    expect(folder.scopeKind).toBe('organization');
    expect(folder.scopeId).toBe('org-1');
    expect(folder.folderPath).toContain('/drive/org-1/agents/agent-1/FILES');
    expect(folder.folderHostPath).toContain('/orgs/org-1/drive/org-1/agents/agent-1/FILES');
    expect(folder.deletable).toBe(false);
  });

  it('keeps uploaded AI Agent files under the user root when organizationId is absent', () => {
    const folder = agentDriveFolder({ userId: 'user-1' }, 'agent-1');
    expect(folder.scopeKind).toBe('user');
    expect(folder.scopeId).toBe('user-1');
    expect(folder.folderPath).toContain('/drive/user-1/agents/agent-1/FILES');
    expect(folder.folderHostPath).toContain('/users/user-1/drive/user-1/agents/agent-1/FILES');
  });

  it('keeps generated AI Agent artifacts under the user agent artifacts FILES folder', () => {
    const folder = agentArtifactFolder({ userId: 'user-1' }, 'agent-1');
    expect(folder.scopeKind).toBe('user');
    expect(folder.folderPath).toContain('/drive/user-1/agents/agent-1/artifacts/FILES');
    expect(folder.deletable).toBe(false);
  });

  it('keeps generated organization AI Agent artifacts under the organization root', async () => {
    const root = process.env.DRIVE_PATH || '';
    const file = await writeAgentArtifactFile({
      scope: { userId: 'user-1', organizationId: 'org-1' },
      agentId: 'agent-1',
      fileName: 'artifact.md',
      mimeType: 'text/markdown',
      body: Buffer.from('artifact', 'utf8'),
    });
    expect(file.scopeKind).toBe('organization');
    expect(file.scopeId).toBe('org-1');
    expect(file.drivePath).toContain('/drive/org-1/agents/agent-1/artifacts/FILES/');
    expect(file.hostPath).toContain('/orgs/org-1/drive/org-1/agents/agent-1/artifacts/FILES/');
    expect(existsSync(join(root, 'users', 'user-1', 'drive', 'org-1'))).toBe(false);
    expect(existsSync(join(root, 'org-1'))).toBe(false);
  });
});
