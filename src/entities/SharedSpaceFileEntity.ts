import { ENTITY, FIELD, PERMISSIONS, Entity } from '@connectingmatrix/orm';

export type SharedSpaceFileRow = {
  id: string;
  shared_space_id?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  filename?: string | null;
  mime_type?: string | null;
  byte_size?: number | null;
  metadata?: Record<string, unknown> | null;
  created_by?: string | null;
  created_at?: string | null;
};

@ENTITY({ table: 'shared_space_files', label: 'SharedSpaceFile', store: 'supabase', primaryKey: 'id' })
@PERMISSIONS({
  read: 'SHARED_SPACE_FILE_READ',
  list: 'SHARED_SPACE_FILE_LIST',
  create: 'SHARED_SPACE_FILE_CREATE',
  update: 'SHARED_SPACE_FILE_UPDATE',
  delete: 'SHARED_SPACE_FILE_DELETE',
})
export class SharedSpaceFileEntity extends Entity<SharedSpaceFileRow> {
  @FIELD({ type: 'string', required: true, index: true }) public declare id: string | null;

  @FIELD({ type: 'string', index: true }) public declare shared_space_id: string | null;

  @FIELD({ type: 'string' }) public declare storage_bucket: string | null;

  @FIELD({ type: 'string' }) public declare storage_path: string | null;

  @FIELD({ type: 'string' }) public declare filename: string | null;

  @FIELD({ type: 'string' }) public declare mime_type: string | null;

  @FIELD({ type: 'number' }) public declare byte_size: number | null;

  @FIELD({ type: 'object', default: {} }) public declare metadata: Record<string, unknown> | null;

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
