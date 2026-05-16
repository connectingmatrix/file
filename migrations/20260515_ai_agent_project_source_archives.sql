create extension if not exists pgcrypto;

alter table if exists ai_agent_projects add column if not exists source_archive_bucket text null;
alter table if exists ai_agent_projects add column if not exists source_archive_path text null;
alter table if exists ai_agent_projects add column if not exists source_archive_sha256 text null;
alter table if exists ai_agent_projects add column if not exists source_archive_bytes bigint null;
alter table if exists ai_agent_projects add column if not exists source_archive_encoding text null default 'zip+base64';
alter table if exists ai_agent_projects add column if not exists source_archive_base64 text null;

create index if not exists ai_agent_projects_source_archive_sha_idx on ai_agent_projects(source_archive_sha256);
create index if not exists ai_agent_projects_source_archive_path_idx on ai_agent_projects(source_archive_bucket, source_archive_path);

-- Supabase Storage bucket for private AI Agent Project source archives.
-- The backend uploads zip source archives to projects/<project-id>/source-<sha>.zip and also stores
-- source_archive_base64 in ai_agent_projects so local-to-dev deployments do not lose source data.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ai-agent-project-sources', 'ai-agent-project-sources', false, 104857600, array['application/zip', 'application/json']::text[])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'ai_agent_project_sources_service_role_all'
  ) then
    create policy "ai_agent_project_sources_service_role_all"
      on storage.objects
      for all
      to service_role
      using (bucket_id = 'ai-agent-project-sources')
      with check (bucket_id = 'ai-agent-project-sources');
  end if;
end $$;
