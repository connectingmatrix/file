import { ENTITY, FIELD, PERMISSIONS, Entity } from '@connectingmatrix/orm';

export type AIAgentAttachmentRow = {
  id: string;
  agent_id?: string | null;
  session_id?: string | null;
  chat_id?: string | null;
  shared_space_id?: string | null;
  file_id?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  filename?: string | null;
  mime_type?: string | null;
  byte_size?: number | null;
  ingestion_status?: string | null;
  ingestion_metadata?: Record<string, unknown> | null;
  created_by?: string | null;
  created_at?: string | null;
};

@ENTITY({ table: 'ai_agents_attachments', label: 'AIAgentAttachment', store: 'supabase', primaryKey: 'id' })
@PERMISSIONS({
  read: 'AI_AGENT_ATTACHMENT_READ',
  list: 'AI_AGENT_ATTACHMENT_LIST',
  create: 'AI_AGENT_ATTACHMENT_CREATE',
  update: 'AI_AGENT_ATTACHMENT_UPDATE',
  delete: 'AI_AGENT_ATTACHMENT_DELETE',
})
export class AIAgentAttachmentEntity extends Entity<AIAgentAttachmentRow> {
  @FIELD({ type: 'string', required: true, index: true }) public declare id: string | null;

  @FIELD({ type: 'string', index: true }) public declare agent_id: string | null;

  @FIELD({ type: 'string', index: true }) public declare session_id: string | null;

  @FIELD({ type: 'string', index: true }) public declare chat_id: string | null;

  @FIELD({ type: 'string', index: true }) public declare shared_space_id: string | null;

  @FIELD({ type: 'string', index: true }) public declare file_id: string | null;

  @FIELD({ type: 'string' }) public declare storage_bucket: string | null;

  @FIELD({ type: 'string' }) public declare storage_path: string | null;

  @FIELD({ type: 'string' }) public declare filename: string | null;

  @FIELD({ type: 'string' }) public declare mime_type: string | null;

  @FIELD({ type: 'number' }) public declare byte_size: number | null;

  @FIELD({ type: 'string' }) public declare ingestion_status: string | null;

  @FIELD({ type: 'object', default: {} }) public declare ingestion_metadata: Record<string, unknown> | null;

  @FIELD({ type: 'string' }) public declare created_by: string | null;

  @FIELD({ type: 'string' }) public declare created_at: string | null;

  protected async preCommit(row: Record<string, unknown>): Promise<void> {
    const now = new Date().toISOString();
    row.created_at ??= now;
    row.updated_at ??= now;
  }

  protected async preUpdate(row: Record<string, unknown>): Promise<void> {
    row.updated_at = new Date().toISOString();
  }
}
