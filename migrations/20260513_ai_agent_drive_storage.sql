-- AI Agent Drive storage metadata for kube-mounted User Drive and Organization Drive files.
-- Files are stored on the backend PVC and referenced through storage_path = giga-drive://...

alter table if exists public.ai_agents_attachments
  add column if not exists owner_type text not null default 'user' check (owner_type in ('user', 'organization')),
  add column if not exists owner_id text null,
  add column if not exists drive_scope_type text null check (drive_scope_type is null or drive_scope_type in ('user', 'organization')),
  add column if not exists drive_scope_id text null,
  add column if not exists updated_at timestamptz not null default now();

update public.ai_agents_attachments
  set drive_scope_type = coalesce(drive_scope_type, owner_type),
      drive_scope_id = coalesce(drive_scope_id, owner_id)
  where drive_scope_type is null or drive_scope_id is null;

create index if not exists ai_agent_attachments_owner_idx
  on public.ai_agents_attachments(owner_type, owner_id, created_at desc);

create index if not exists ai_agent_attachments_drive_scope_idx
  on public.ai_agents_attachments(drive_scope_type, drive_scope_id, created_at desc);

create index if not exists ai_agent_attachments_ingestion_status_idx
  on public.ai_agents_attachments(agent_id, ingestion_status, created_at desc);
