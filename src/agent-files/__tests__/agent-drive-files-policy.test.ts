import { describe, expect, it } from 'vitest';
import { agentDriveFolder } from '../agent-drive-files';

describe('AI Agent Drive file policy', () => {
  it('resolves organisation drive before user drive when an organisation id is present', () => {
    const folder = agentDriveFolder({ userId: 'user-1', organizationId: 'org-1' }, 'agent-1');
    expect(folder.scopeKind).toBe('organization');
    expect(folder.folderPath).toContain('/drive/ai-agents/agent-1/files');
    expect(folder.deletable).toBe(false);
  });

  it('falls back to user drive when no organisation id is present', () => {
    const folder = agentDriveFolder({ userId: 'user-1' }, 'agent-1');
    expect(folder.scopeKind).toBe('user');
    expect(folder.folderPath).toContain('/drive/ai-agents/agent-1/files');
    expect(folder.deletable).toBe(false);
  });
});
