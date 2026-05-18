import { ENTITY, FIELD, PERMISSIONS, Entity } from '@connectingmatrix/orm';

export type WorkflowAttachmentRow = {
  id: string;
  workflow_id: string;
  attachment_id: string;
  scope_type: string;
  scope_id: string;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

@ENTITY({ table: 'ai_workflow_scope_attachments', label: 'WorkflowAttachment', store: 'supabase', primaryKey: 'id', scoped: true })
@PERMISSIONS({ read: 'WORKFLOW_ATTACHMENT_READ', create: 'WORKFLOW_ATTACHMENT_CREATE', delete: 'WORKFLOW_ATTACHMENT_DELETE' })
export class WorkflowAttachmentEntity extends Entity<WorkflowAttachmentRow> {
  @FIELD({ type: 'string', required: true, index: true }) public declare id: string | null;

  @FIELD({ type: 'string', required: true, index: true }) public declare workflow_id: string | null;

  @FIELD({ type: 'string', required: true, index: true }) public declare attachment_id: string | null;

  @FIELD({ type: 'string', required: true }) public declare scope_type: string | null;

  @FIELD({ type: 'string', required: true }) public declare scope_id: string | null;

  @FIELD({ type: 'string' }) public declare created_by: string | null;

  @FIELD({ type: 'string' }) public declare created_at: string | null;

  @FIELD({ type: 'string' }) public declare updated_at: string | null;
}
