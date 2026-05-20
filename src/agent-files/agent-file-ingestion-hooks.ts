import type { AgentFileUploadIngestionHookInput, AgentFileUploadIngestionHookResult } from './graphql-types';

export type AgentFileUploadIngestionHook = (input: AgentFileUploadIngestionHookInput) => Promise<AgentFileUploadIngestionHookResult>;

let uploadIngestionHook: AgentFileUploadIngestionHook | null = null;

export function registerAgentFileUploadIngestionHook(hook: AgentFileUploadIngestionHook): void {
  uploadIngestionHook = hook;
}

export async function runAgentFileUploadIngestionHook(input: AgentFileUploadIngestionHookInput): Promise<AgentFileUploadIngestionHookResult> {
  if (!uploadIngestionHook) return { processId: null, status: 'uploaded', fileShapeIds: [], fileShapeNames: [] };
  return uploadIngestionHook(input);
}
