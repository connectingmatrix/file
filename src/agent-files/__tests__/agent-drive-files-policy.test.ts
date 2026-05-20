import { describe, expect, it } from 'vitest';
import { agentArtifactFolder, agentDriveFolder } from '../agent-drive-files';

describe('AI Agent Drive file policy', () => {
  it('keeps uploaded AI Agent files under the user agent FILES folder', () => {
    const folder = agentDriveFolder({ userId: 'user-1', organizationId: 'org-1' }, 'agent-1');
    expect(folder.scopeKind).toBe('user');
    expect(folder.folderPath).toContain('/drive/user-1/agents/agent-1/FILES');
    expect(folder.deletable).toBe(false);
  });

  it('keeps generated AI Agent artifacts under the user agent artifacts FILES folder', () => {
    const folder = agentArtifactFolder({ userId: 'user-1' }, 'agent-1');
    expect(folder.scopeKind).toBe('user');
    expect(folder.folderPath).toContain('/drive/user-1/agents/agent-1/artifacts/FILES');
    expect(folder.deletable).toBe(false);
  });
});
