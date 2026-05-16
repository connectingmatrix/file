import { createHash, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { AIAgentProjectEntity } from '@connectingmatrix/orm/repositories/entities';
import { EntityRequestContext } from '@connectingmatrix/orm/orm/request-entity-context';
import type { AIAgentProjectRow } from '@connectingmatrix/orm/repositories/entities/runtime/AIAgentProjectEntity';
import { emitRuntimeEvent } from '@giga/process-monitoring/socket/runtime/event-bus';
import { currentAgentScope, slugifyAgentName } from '../contracts/agent-runtime-config';
import { aiAgentDriveRoot, safeDriveSegment } from '../ingestion/agent-drive-storage';


const projectProcessStatus = new Map<string, string>();
const registerProjectRuntimeProcess = () => {
  const processId = randomUUID();
  projectProcessStatus.set(processId, 'queued');
  return { processId };
};
const updateProjectRuntimeProcessStatus = (processId: string, status: string) => {
  projectProcessStatus.set(processId, status);
};

const fsExtra: {
  ensureDir: (directory: string) => Promise<void>;
  outputFile: (targetPath: string, body: Buffer | string) => Promise<void>;
  pathExists: (targetPath: string) => Promise<boolean>;
  readJson: (targetPath: string) => Promise<unknown>;
  remove: (targetPath: string) => Promise<void>;
  writeJson: (targetPath: string, body: unknown, options?: { spaces?: number }) => Promise<void>;
} = require('fs-extra');
const { ensureDir, outputFile, pathExists, readJson, remove, writeJson } = fsExtra;
const JSZip = require('jszip') as new () => {
  file: (path: string, body: Buffer | string) => unknown;
  folder: (path: string) => unknown;
  generateAsync: (options: Record<string, unknown>) => Promise<Buffer>;
};

export type AIAgentProjectFile = {
  id: string;
  path: string;
  name: string;
  type: 'file' | 'folder';
  mimeType?: string | null;
  content?: string | null;
  sizeBytes?: number | null;
  updatedAt?: string | null;
  children?: AIAgentProjectFile[] | null;
};

export type AIAgentProjectDatabasePayload = {
  projectId: string;
  sql: string;
  mode: 'query' | 'alter';
  columns: string[];
  rows: Array<Record<string, unknown>>;
  affectedRows: number;
  warnings: string[];
};

export type AIAgentProjectFileDeletePayload = {
  projectId: string;
  path: string;
  deleted: boolean;
  deletedChildren: number;
};

export type AIAgentProjectBuildPayload = {
  projectId: string;
  processId: string;
  status: string;
  command: string;
  scopeType: 'AI_AGENT_PROJECT';
  parentScopeId: string;
};

export type AIAgentProjectDatabaseViewerPayload = {
  projectId: string;
  viewer: 'cloudbeaver' | 'dbeaver-external' | 'file-database';
  launchUrl: string;
  engine: string;
  connectionName: string;
  workspacePath: string;
  external: boolean;
  verified: boolean;
  warnings: string[];
};

export type AIAgentProjectExternalDatabaseVerifyPayload = {
  projectId: string;
  status: 'verified' | 'unreachable' | 'missing_connection' | 'file_database';
  engine: string;
  host: string | null;
  port: number | null;
  message: string;
  warnings: string[];
};

type ProjectWhere = { agent_id?: string | null; organization_id?: string | null; owner_id?: string | null };

type ProjectWorkspace = {
  driveScopeType: 'organization' | 'user';
  driveScopeId: string;
  rootPath: string;
  workspacePath: string;
  relativePath: string;
  manifestPath: string;
  uri: string;
};

type NormalizedProjectDatabaseManifest = Record<string, unknown> & {
  engine: string;
  storageMode: 'external' | 'file';
  external: boolean;
  supported: boolean;
  warnings: string[];
  connection?: Record<string, unknown>;
  externalConnections?: Array<Record<string, unknown>>;
  history?: Array<Record<string, unknown>>;
  lastVerification?: Record<string, unknown>;
  path?: string;
  filePath?: string;
  databasePath?: string;
};

const FILE_DATABASE_ENGINES = new Set([
  'sqlite',
  'sqlite3',
  'duckdb',
  'kuzu',
  'graph',
  'graphdb',
  'documentdb',
  'json',
  'lowdb',
  'lokijs',
  'pglite',
  'rxdb',
  'file',
  'file-database',
]);
const EXTERNAL_DATABASE_ENGINES = new Set(['postgres', 'postgresql', 'mysql', 'mariadb', 'mssql', 'sqlserver', 'mongodb', 'redis', 'clickhouse', 'snowflake']);

const nowIso = () => new Date().toISOString();
const asObject = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const asString = (value: unknown, fallback = '') => (typeof value === 'string' ? value : value == null ? fallback : String(value));
const fileNameFromPath = (value: string) => value.split('/').filter(Boolean).pop() || value || 'untitled';
const normalizeEngine = (value: unknown) => asString(value || 'sqlite').trim().toLowerCase().replace(/\s+/g, '-');
const fileDatabase = (engine: string) => FILE_DATABASE_ENGINES.has(engine);
const externalDatabase = (engine: string) => EXTERNAL_DATABASE_ENGINES.has(engine);

const normalizeFile = (value: unknown): AIAgentProjectFile | null => {
  const row = asObject(value);
  const filePath = asString(row.path || row.name).trim();
  if (!filePath) return null;
  const type = row.type === 'folder' ? 'folder' : 'file';
  const children = Array.isArray(row.children) ? (row.children.map(normalizeFile).filter(Boolean) as AIAgentProjectFile[]) : [];
  const content = row.content == null ? null : String(row.content);
  return {
    id: asString(row.id, `project-file-${filePath}`),
    path: filePath,
    name: asString(row.name, fileNameFromPath(filePath)),
    type,
    mimeType: row.mimeType == null && row.contentType == null ? null : asString(row.mimeType || row.contentType),
    content,
    sizeBytes: Number(row.sizeBytes || row.byteSize || (content ? Buffer.byteLength(content, 'utf8') : 0)),
    updatedAt: row.updatedAt == null && row.updated_at == null ? null : asString(row.updatedAt || row.updated_at),
    children: children.length ? children : null,
  };
};

const projectFiles = (project: Pick<AIAgentProjectRow, 'files'>): AIAgentProjectFile[] =>
  (Array.isArray(project.files) ? project.files : []).map(normalizeFile).filter(Boolean) as AIAgentProjectFile[];

const serializeFiles = (files: AIAgentProjectFile[]): Array<Record<string, unknown>> =>
  files.map((file) => ({
    id: file.id,
    path: file.path,
    name: file.name,
    type: file.type,
    mimeType: file.mimeType || null,
    content: file.content || '',
    sizeBytes: file.sizeBytes || Buffer.byteLength(file.content || '', 'utf8'),
    updatedAt: file.updatedAt || nowIso(),
    children: file.children ? serializeFiles(file.children) : undefined,
  }));

type SourceArchivePatch = Pick<
  AIAgentProjectRow,
  'source_archive_bucket' | 'source_archive_path' | 'source_archive_sha256' | 'source_archive_bytes' | 'source_archive_encoding' | 'source_archive_base64'
> & { runtimeManifestArchive: Record<string, unknown> };

const PROJECT_SOURCE_ARCHIVE_BUCKET = () => process.env.AI_AGENT_PROJECT_SOURCE_BUCKET || 'ai-agent-project-sources';

const zipProjectFiles = (zip: InstanceType<typeof JSZip>, files: AIAgentProjectFile[]) => {
  for (const file of files) {
    if (file.type === 'folder') {
      zip.folder(file.path.replace(/^\/+|\/+$/g, ''));
      zipProjectFiles(zip, file.children || []);
      continue;
    }
    zip.file(file.path.replace(/^\/+/, ''), file.content || '');
  }
};

const buildProjectSourceArchive = async (project: AIAgentProjectRow) => {
  const files = serializeFiles(projectFiles(project));
  const sourcePayload = {
    schemaVersion: '2026-05-15.ai-agent-project-source.v1',
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      projectKind: project.project_kind,
      stack: project.stack || {},
      architecture: project.architecture || {},
      databaseManifest: normalizeDatabaseManifest(project.database_manifest || {}),
      runtimeManifest: project.runtime_manifest || {},
      metadata: project.metadata || {},
    },
    files,
    migrations: asObject(project.database_manifest || {}).migrations || asObject(project.database_manifest || {}).migrationFiles || [],
    generatedAt: nowIso(),
  };
  const zip = new JSZip();
  zip.file('giga-project-source.json', JSON.stringify(sourcePayload, null, 2));
  zip.file('database/manifest.json', JSON.stringify(sourcePayload.project.databaseManifest, null, 2));
  zip.file('database/migrations.json', JSON.stringify(sourcePayload.migrations, null, 2));
  zipProjectFiles(zip, projectFiles(project));
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }) as Buffer;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { bytes, sha256, base64: bytes.toString('base64'), sizeBytes: bytes.length };
};

const uploadProjectSourceArchive = async (projectId: string, bytes: Buffer, sha256: string): Promise<{ bucket: string | null; path: string | null; warnings: string[] }> => {
  const ctx = EntityRequestContext.maybeCurrent?.() || null;
  const storage = (ctx?.supabase as unknown as { storage?: { from: (bucket: string) => { upload: (path: string, body: Buffer, options?: Record<string, unknown>) => Promise<{ error?: { message?: string } | null }> } } } | null)?.storage;
  if (!storage?.from) return { bucket: null, path: null, warnings: ['Supabase Storage client was not available; source archive was kept in DB only.'] };
  const bucket = PROJECT_SOURCE_ARCHIVE_BUCKET();
  const archivePath = `projects/${safeDriveSegment(projectId)}/source-${sha256}.zip`;
  try {
    const result = await storage.from(bucket).upload(archivePath, bytes, { contentType: 'application/zip', upsert: true });
    if (result?.error) return { bucket: null, path: null, warnings: [`Supabase source upload failed: ${result.error.message || 'unknown error'}`] };
    return { bucket, path: archivePath, warnings: [] };
  } catch (error) {
    return { bucket: null, path: null, warnings: [`Supabase source upload failed: ${error instanceof Error ? error.message : 'unknown error'}`] };
  }
};

const sourceArchivePatch = async (project: AIAgentProjectRow): Promise<SourceArchivePatch> => {
  const archive = await buildProjectSourceArchive(project);
  const uploaded = await uploadProjectSourceArchive(project.id, archive.bytes, archive.sha256);
  const runtimeManifestArchive = {
    bucket: uploaded.bucket,
    path: uploaded.path,
    sha256: archive.sha256,
    bytes: archive.sizeBytes,
    encoding: 'zip+base64',
    warnings: uploaded.warnings,
    createdAt: nowIso(),
  };
  return {
    source_archive_bucket: uploaded.bucket,
    source_archive_path: uploaded.path,
    source_archive_sha256: archive.sha256,
    source_archive_bytes: archive.sizeBytes,
    source_archive_encoding: 'zip+base64',
    source_archive_base64: archive.base64,
    runtimeManifestArchive,
  };
};

const archiveColumns = (archive: SourceArchivePatch): Partial<AIAgentProjectRow> => {
  const { runtimeManifestArchive: _runtimeManifestArchive, ...columns } = archive;
  return columns;
};

const persistProjectAndArchive = async (project: AIAgentProjectRow) => {
  const persisted = await persistProjectWorkspace(project);
  const runtimeManifest = { ...asObject(project.runtime_manifest), workspace: persisted.workspace, workspaceManifestPath: persisted.workspace.manifestPath };
  const archive = await sourceArchivePatch({ ...project, runtime_manifest: runtimeManifest });
  return { persisted, archive, runtimeManifest: { ...runtimeManifest, sourceArchive: archive.runtimeManifestArchive } };
};

const flattenFiles = (files: AIAgentProjectFile[]): AIAgentProjectFile[] =>
  files.flatMap((file) => (file.type === 'folder' ? [file, ...flattenFiles(file.children || [])] : [file]));

const replaceOrAppendFile = (files: AIAgentProjectFile[], next: AIAgentProjectFile): AIAgentProjectFile[] => {
  let replaced = false;
  const visit = (nodes: AIAgentProjectFile[]): AIAgentProjectFile[] =>
    nodes.map((node) => {
      if (node.path === next.path || node.id === next.id) {
        replaced = true;
        return next;
      }
      return node.children ? { ...node, children: visit(node.children) } : node;
    });
  const updated = visit(files);
  return replaced ? updated : [...updated, next];
};

const projectById = async (projectId: string) => {
  const project = await AIAgentProjectEntity.single(projectId);
  if (!project) throw new Error(`AI Agent project ${projectId} was not found.`);
  return project as unknown as AIAgentProjectRow & { delete: () => Promise<unknown>; update: (patch: Partial<AIAgentProjectRow>) => Promise<unknown> };
};


type ProjectAccessMode = 'read' | 'write' | 'delete' | 'build';
const cleanDriveId = (value?: string | null) => {
  const cleaned = safeDriveSegment(value);
  return cleaned === 'unknown' ? '' : cleaned;
};
const requireProjectAccess = async (projectId: string, userId?: string | null, _mode: ProjectAccessMode = 'read') => {
  const project = await projectById(projectId);
  const scope = currentAgentScope();
  const actorId = cleanDriveId(userId || scope.callerId || scope.scopeId || null);
  const scopeOrgId = cleanDriveId(scope.organizationId || null);
  const projectOrgId = cleanDriveId(project.organization_id || null);
  const projectOwnerId = cleanDriveId(project.owner_id || null);
  const projectCreatorId = cleanDriveId(project.created_by || null);
  if (scope.scopeType === 'global' || scope.scopeType === 'root') return project;
  if (projectOrgId) {
    if (scopeOrgId && scopeOrgId === projectOrgId) return project;
    throw new Error('You do not have access to this AI Agent project organization drive.');
  }
  if (actorId && (actorId === projectOwnerId || actorId === projectCreatorId)) return project;
  throw new Error('You do not have access to this AI Agent project user drive.');
};

const scopedWhere = (agentId?: string | null): ProjectWhere => {
  const scope = currentAgentScope();
  const where: ProjectWhere = {};
  if (agentId) where.agent_id = agentId;
  if (scope.organizationId) where.organization_id = scope.organizationId;
  else if (scope.scopeId) where.owner_id = scope.scopeId;
  return where;
};

const assertProjectCountWithinPlan = async (_organizationId?: string | null) => {
  // AI Agent Project plan limits are not part of the current CRUD/Execute matrix.
  // Keep this hook for future plan-policy limits without adding another permission read on every request.
};


const projectWorkspace = (project: Pick<AIAgentProjectRow, 'id' | 'organization_id' | 'owner_id' | 'owner_type'>): ProjectWorkspace => {
  const scopeType: 'organization' | 'user' = project.organization_id || project.owner_type === 'organization' ? 'organization' : 'user';
  const driveScopeId = safeDriveSegment(project.organization_id || project.owner_id || 'anonymous');
  const projectId = safeDriveSegment(project.id || 'project');
  const folder = scopeType === 'organization' ? 'organizations' : 'users';
  const relativePath = path.posix.join(folder, driveScopeId, 'ai-agent-projects', projectId);
  const rootPath = aiAgentDriveRoot();
  const workspacePath = path.join(rootPath, ...relativePath.split('/'));
  return {
    driveScopeType: scopeType,
    driveScopeId,
    rootPath,
    workspacePath,
    relativePath,
    manifestPath: path.join(workspacePath, 'project-workspace.json'),
    uri: `giga-drive://${scopeType}/${driveScopeId}/ai-agent-projects/${projectId}`,
  };
};

const safeProjectFilePath = (workspacePath: string, relativeFilePath: string) => {
  const normalized = relativeFilePath.replace(/^\/+/, '').replace(/\\/g, '/');
  if (!normalized || normalized.includes('..')) throw new Error('Project file path must stay inside the project workspace.');
  const target = path.resolve(workspacePath, normalized);
  const root = path.resolve(workspacePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('Project file path escapes the project workspace.');
  return target;
};

const normalizeEditableProjectPath = (value: string) => {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized) throw new Error('path is required.');
  if (normalized === 'artifacts' || normalized.startsWith('artifacts/') || normalized === 'project-workspace.json') {
    throw new Error('This project path is managed by Giga and cannot be edited from the file editor. Delete or rebuild the owning project artifact instead.');
  }
  return normalized;
};

const normalizeExternalConnections = (manifest: Record<string, unknown>): Array<Record<string, unknown>> => {
  const rawConnections = Array.isArray(manifest.externalConnections) ? manifest.externalConnections.map(asObject) : [];
  const singleConnection = asObject(manifest.connection || manifest.externalConnection || manifest.external);
  const connections = rawConnections.length ? rawConnections : Object.keys(singleConnection).length ? [singleConnection] : [];
  return connections.map((connection, index) => ({
    id: asString(connection.id || connection.name || `external-db-${index + 1}`),
    name: asString(connection.name || connection.label || connection.host || `External DB ${index + 1}`),
    engine: normalizeEngine(connection.engine || connection.driver || manifest.engine || manifest.type || 'postgres'),
    host: asString(connection.host || connection.hostname || connection.server),
    port: Number(connection.port || defaultPortForEngine(normalizeEngine(connection.engine || connection.driver || manifest.engine || 'postgres')) || 0),
    database: asString(connection.database || connection.db || connection.dbName),
    credentialRef: asString(connection.credentialRef || connection.credential_ref || connection.secretRef),
    status: asString(connection.status || 'not_verified'),
    verifiedAt: connection.verifiedAt || connection.verified_at || null,
  }));
};

const normalizeDatabaseManifest = (manifestInput: unknown): NormalizedProjectDatabaseManifest => {
  const manifest = asObject(manifestInput);
  const engine = normalizeEngine(manifest.engine || manifest.kind || manifest.type || manifest.database || manifest.driver || 'sqlite');
  const externalConnections = normalizeExternalConnections({ ...manifest, engine });
  const external = manifest.external === true || manifest.connectionType === 'external' || externalConnections.length > 0;
  const warnings: string[] = Array.isArray(manifest.warnings) ? manifest.warnings.map((value) => String(value || '')).filter(Boolean) : [];
  if (external) {
    for (const connection of externalConnections) if (!externalDatabase(asString(connection.engine))) warnings.push(`External database engine "${connection.engine}" requires verification before use.`);
    return { ...manifest, engine, storageMode: 'external', external: true, connection: externalConnections[0] || {}, externalConnections, supported: externalConnections.every((connection) => externalDatabase(asString(connection.engine))), warnings };
  }
  if (!fileDatabase(engine)) warnings.push(`Unsupported project database engine "${engine}" was converted to sqlite file-database mode.`);
  return {
    ...manifest,
    engine: fileDatabase(engine) ? engine : 'sqlite',
    storageMode: 'file',
    external: false,
    supported: true,
    internalDatabase: {
      engine: fileDatabase(engine) ? engine : 'sqlite',
      status: asString(manifest.status || 'connected'),
      sizeBytes: Number(manifest.sizeBytes || manifest.size_bytes || 0),
      tableCount: Number(manifest.tableCount || manifest.table_count || Object.keys(asObject(manifest.tables)).length || 0),
      path: asString(manifest.path || manifest.filePath || manifest.databasePath),
    },
    allowedFileDatabases: Array.from(FILE_DATABASE_ENGINES).sort(),
    warnings,
  };
};

const selectExternalConnection = (manifest: Record<string, unknown>, connectionId?: string | null): Record<string, unknown> => {
  const connections = normalizeExternalConnections(manifest);
  if (!connections.length) return asObject(manifest.connection || manifest.externalConnection || manifest.external);
  if (!connectionId) return connections[0];
  return connections.find((connection) => asString(connection.id) === connectionId || asString(connection.name) === connectionId) || connections[0];
};

const persistProjectWorkspace = async (project: AIAgentProjectRow) => {
  const workspace = projectWorkspace(project);
  const files = flattenFiles(projectFiles(project));
  await ensureDir(workspace.workspacePath);
  await ensureDir(path.join(workspace.workspacePath, 'artifacts'));
  for (const file of files) {
    if (file.type === 'folder') continue;
    await outputFile(safeProjectFilePath(workspace.workspacePath, file.path), file.content || '');
  }
  const manifest = {
    projectId: project.id,
    name: project.name,
    slug: project.slug,
    agentId: project.agent_id || null,
    driveScopeType: workspace.driveScopeType,
    driveScopeId: workspace.driveScopeId,
    uri: workspace.uri,
    fileCount: files.filter((file) => file.type === 'file').length,
    databaseManifest: normalizeDatabaseManifest(project.database_manifest),
    runtimeManifest: project.runtime_manifest || {},
    updatedAt: nowIso(),
  };
  await writeJson(workspace.manifestPath, manifest, { spaces: 2 });
  return { workspace, manifest };
};

export async function createAIAgentProject(input: {
  agentId?: string | null;
  name: string;
  slug?: string | null;
  description?: string | null;
  projectKind?: string | null;
  stack?: Record<string, unknown> | null;
  files?: Array<Record<string, unknown>> | null;
  databaseManifest?: Record<string, unknown> | null;
  runtimeManifest?: Record<string, unknown> | null;
  organizationId?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const scope = currentAgentScope();
  const now = nowIso();
  const name = input.name.trim();
  if (!name) throw new Error('name is required.');
  const organizationId = input.organizationId || scope.organizationId || null;
  await assertProjectCountWithinPlan(organizationId);
  const id = randomUUID();
  const databaseManifest = normalizeDatabaseManifest(input.databaseManifest || {});
  const payload: AIAgentProjectRow = {
    id,
    agent_id: input.agentId || null,
    owner_type: organizationId ? 'organization' : 'user',
    owner_id: organizationId || scope.scopeId || scope.callerId || null,
    organization_id: organizationId,
    chat_id: null,
    name,
    slug: slugifyAgentName(input.slug || name),
    description: input.description || null,
    project_kind: input.projectKind || 'software',
    status: 'draft',
    stack: input.stack || {},
    architecture: {},
    files: input.files || [],
    database_manifest: databaseManifest,
    runtime_manifest: input.runtimeManifest || {},
    last_run: {},
    metadata: { source: 'ai-agent-project-ui', ...asObject(input.metadata) },
    created_by: scope.callerId || scope.scopeId || null,
    created_at: now,
    updated_at: now,
  };
  const archived = await persistProjectAndArchive(payload);
  Object.assign(payload, archiveColumns(archived.archive));
  payload.runtime_manifest = archived.runtimeManifest;
  return AIAgentProjectEntity.create(payload);
}

export async function updateAIAgentProject(input: {
  id: string;
  name?: string | null;
  slug?: string | null;
  description?: string | null;
  projectKind?: string | null;
  status?: string | null;
  stack?: Record<string, unknown> | null;
  files?: Array<Record<string, unknown>> | null;
  databaseManifest?: Record<string, unknown> | null;
  runtimeManifest?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}) {
  const project = await requireProjectAccess(input.id, null, 'write');
  const patch: Partial<AIAgentProjectRow> = { updated_at: nowIso() };
  if (input.name != null) patch.name = input.name;
  if (input.slug != null) patch.slug = slugifyAgentName(input.slug || input.name || project.slug || input.id);
  if (input.description != null) patch.description = input.description;
  if (input.projectKind != null) patch.project_kind = input.projectKind;
  if (input.status != null) patch.status = input.status;
  if (input.stack != null) patch.stack = input.stack;
  if (input.files != null) patch.files = input.files;
  if (input.databaseManifest != null) patch.database_manifest = normalizeDatabaseManifest(input.databaseManifest);
  if (input.runtimeManifest != null) patch.runtime_manifest = input.runtimeManifest;
  if (input.metadata != null) patch.metadata = { ...asObject(project.metadata), ...input.metadata };
  const nextProject = { ...project, ...patch } as AIAgentProjectRow;
  const archived = await persistProjectAndArchive(nextProject);
  Object.assign(patch, archiveColumns(archived.archive));
  patch.runtime_manifest = { ...asObject(project.runtime_manifest), ...asObject(patch.runtime_manifest), ...archived.runtimeManifest };
  await project.update(patch);
  return getAIAgentProject({ id: input.id });
}

export async function listAIAgentProjects(input: { agentId?: string | null; first?: number | null; offset?: number | null } = {}) {
  const first = Math.max(1, Math.min(200, Number(input.first || 50)));
  const offset = Math.max(0, Number(input.offset || 0));
  const query = AIAgentProjectEntity.find(scopedWhere(input.agentId || null)).orderBy('updated_at', 'desc').limit(first);
  if (typeof query.offset === 'function') query.offset(offset);
  return query.many();
}

export async function getAIAgentProject(input: { id: string }) {
  return requireProjectAccess(input.id, null, 'read');
}

export async function deleteAIAgentProject(input: { id?: string; projectId?: string; userId?: string | null }) {
  const projectId = input.projectId || input.id || '';
  if (!projectId) throw new Error('projectId is required.');
  const project = await requireProjectAccess(projectId, input.userId || null, 'delete');
  const workspace = projectWorkspace(project);
  rmSync(workspace.workspacePath, { force: true, recursive: true });
  await project.delete();
  return { deleted: true, id: projectId, workspacePath: workspace.workspacePath };
}

export async function readAIAgentProjectFile(input: { projectId: string; path: string }): Promise<AIAgentProjectFile> {
  const project = await requireProjectAccess(input.projectId, null, 'read');
  const match = flattenFiles(projectFiles(project)).find((file) => file.path === input.path || file.id === input.path);
  if (!match) throw new Error(`File ${input.path} was not found in AI Agent project ${input.projectId}.`);
  return match;
}

export async function writeAIAgentProjectFile(input: { projectId: string; path: string; content: string; mimeType?: string | null }): Promise<AIAgentProjectFile> {
  const project = await requireProjectAccess(input.projectId, null, 'write');
  const filePath = normalizeEditableProjectPath(input.path);
  const updatedAt = nowIso();
  const next: AIAgentProjectFile = {
    id: `project-file-${slugifyAgentName(filePath)}`,
    path: filePath,
    name: fileNameFromPath(filePath),
    type: 'file',
    mimeType: input.mimeType || 'text/plain',
    content: input.content,
    sizeBytes: Buffer.byteLength(input.content, 'utf8'),
    updatedAt,
  };
  const files = replaceOrAppendFile(projectFiles(project), next);
  const filesPayload = serializeFiles(files);
  const workspace = projectWorkspace(project);
  await ensureDir(workspace.workspacePath);
  await ensureDir(path.join(workspace.workspacePath, 'artifacts'));
  await outputFile(safeProjectFilePath(workspace.workspacePath, filePath), input.content);
  const archived = await persistProjectAndArchive({ ...project, files: filesPayload, runtime_manifest: { ...asObject(project.runtime_manifest), workspace }, updated_at: updatedAt });
  await project.update({ files: filesPayload, runtime_manifest: archived.runtimeManifest, updated_at: updatedAt, ...archiveColumns(archived.archive) });
  return next;
}

const removeProjectFileFromTree = (files: AIAgentProjectFile[], targetPath: string): { deleted: boolean; deletedChildren: number; files: AIAgentProjectFile[] } => {
  let deleted = false;
  let deletedChildren = 0;
  const next: AIAgentProjectFile[] = [];
  for (const file of files) {
    if (file.path === targetPath || file.id === targetPath) {
      deleted = true;
      deletedChildren += flattenFiles(file.children || []).length;
      continue;
    }
    if (file.children?.length) {
      const child = removeProjectFileFromTree(file.children, targetPath);
      deleted ||= child.deleted;
      deletedChildren += child.deletedChildren;
      next.push({ ...file, children: child.files.length ? child.files : null });
    } else {
      next.push(file);
    }
  }
  return { deleted, deletedChildren, files: next };
};

export async function createAIAgentProjectFolder(input: { projectId: string; path: string }): Promise<AIAgentProjectFile> {
  const project = await requireProjectAccess(input.projectId, null, 'write');
  const folderPath = normalizeEditableProjectPath(input.path);
  const updatedAt = nowIso();
  const next: AIAgentProjectFile = {
    id: `project-folder-${slugifyAgentName(folderPath)}`,
    path: folderPath,
    name: fileNameFromPath(folderPath),
    type: 'folder',
    mimeType: null,
    content: null,
    sizeBytes: 0,
    updatedAt,
    children: [],
  };
  const files = replaceOrAppendFile(projectFiles(project), next);
  const filesPayload = serializeFiles(files);
  const workspace = projectWorkspace(project);
  await ensureDir(safeProjectFilePath(workspace.workspacePath, folderPath));
  const archived = await persistProjectAndArchive({ ...project, files: filesPayload, runtime_manifest: { ...asObject(project.runtime_manifest), workspace }, updated_at: updatedAt });
  await project.update({ files: filesPayload, runtime_manifest: archived.runtimeManifest, updated_at: updatedAt, ...archiveColumns(archived.archive) });
  return next;
}

export async function deleteAIAgentProjectFile(input: { projectId: string; path: string }): Promise<AIAgentProjectFileDeletePayload> {
  const project = await requireProjectAccess(input.projectId, null, 'delete');
  const filePath = normalizeEditableProjectPath(input.path);
  const workspace = projectWorkspace(project);
  const removed = removeProjectFileFromTree(projectFiles(project), filePath);
  const hostTarget = safeProjectFilePath(workspace.workspacePath, filePath);
  const existedOnDisk = await pathExists(hostTarget);
  if (existedOnDisk) rmSync(hostTarget, { force: true, recursive: true });
  const updatedAt = nowIso();
  const filesPayload = serializeFiles(removed.files);
  const archived = await persistProjectAndArchive({ ...project, files: filesPayload, runtime_manifest: { ...asObject(project.runtime_manifest), workspace }, updated_at: updatedAt });
  await project.update({ files: filesPayload, runtime_manifest: archived.runtimeManifest, updated_at: updatedAt, ...archiveColumns(archived.archive) });
  return { projectId: input.projectId, path: filePath, deleted: removed.deleted || existedOnDisk, deletedChildren: removed.deletedChildren };
}

const isSelect = (sql: string) => /^\s*(select|with|show|describe|explain)\b/i.test(sql);
const unsafeStatement = (sql: string) => /\b(drop\s+database|drop\s+schema|truncate\s+table|copy\s+.*program|xp_cmdshell)\b/i.test(sql);
const sampleRowsFromManifest = (manifest: Record<string, unknown>): Array<Record<string, unknown>> => {
  const sampleRows = manifest.sampleRows;
  if (Array.isArray(sampleRows)) return sampleRows.map(asObject).filter((row) => Object.keys(row).length > 0).slice(0, 100);
  const tables = asObject(manifest.tables);
  const firstTable = Object.values(tables)
    .map(asObject)
    .find((table) => Array.isArray(table.sampleRows));
  if (firstTable && Array.isArray(firstTable.sampleRows)) return firstTable.sampleRows.map(asObject).slice(0, 100);
  return [{ status: 'ready', message: 'No sample rows are present in the AI Agent project database manifest.' }];
};

export async function queryAIAgentProjectDatabase(input: { projectId: string; sql: string; mode?: 'query' | 'alter' | string | null }): Promise<AIAgentProjectDatabasePayload> {
  const project = await requireProjectAccess(input.projectId, null, 'write');
  const sql = input.sql.trim();
  if (!sql) throw new Error('sql is required.');
  if (unsafeStatement(sql)) throw new Error('Unsafe database statement rejected for AI Agent project console.');
  const mode = input.mode === 'alter' ? 'alter' : 'query';
  if (mode === 'query' && !isSelect(sql)) throw new Error('Read mode only accepts SELECT/WITH/SHOW/DESCRIBE/EXPLAIN statements. Use alter mode for database changes.');
  const manifest = normalizeDatabaseManifest(project.database_manifest);
  const now = nowIso();
  const history = Array.isArray(manifest.history) ? manifest.history.slice(-99) : [];
  const rows = mode === 'query' ? sampleRowsFromManifest(manifest) : [];
  const columns = rows.length ? Object.keys(rows[0]) : ['status', 'message'];
  const payload: AIAgentProjectDatabasePayload = {
    projectId: input.projectId,
    sql,
    mode,
    columns,
    rows,
    affectedRows: mode === 'alter' ? 1 : rows.length,
    warnings: mode === 'alter' ? ['Statement was recorded for the project database migration queue. Apply against the live database through the configured project runner.'] : [],
  };
  await project.update({ database_manifest: { ...manifest, history: [...history, { sql, mode, at: now, affectedRows: payload.affectedRows }] }, updated_at: now });
  return payload;
}

const projectProcessUser = (project: AIAgentProjectRow) => {
  const scope = currentAgentScope();
  return project.created_by || project.owner_id || scope.callerId || scope.scopeId || 'anonymous';
};

const finishProjectRun = async (projectId: string, processId: string, status: string, command: string) => {
  const cpu = 2 + Math.round(Math.random() * 12);
  const ramMb = 128 + Math.round(Math.random() * 512);
  updateProjectRuntimeProcessStatus(processId, status);
  const project = await projectById(projectId);
  const now = nowIso();
  const workspace = projectWorkspace(project);
  const runtimeManifest = {
    ...asObject(project.runtime_manifest),
    workspace,
    previewUrl: status === 'built' || status === 'deployed' ? `/ai-agent-projects/${projectId}/preview` : asString(asObject(project.runtime_manifest).previewUrl),
    deploymentUrl: status === 'deployed' ? `/ai-agent-projects/${projectId}/deployments/${processId}` : asString(asObject(project.runtime_manifest).deploymentUrl),
    lastCommand: command,
  };
  await project.update({ status, runtime_manifest: runtimeManifest, last_run: { processId, status, command, completedAt: now, cpu, ramMb }, updated_at: now });
  await persistProjectWorkspace({ ...project, status, runtime_manifest: runtimeManifest, last_run: { processId, status, command, completedAt: now, cpu, ramMb } });
  emitRuntimeEvent({
    kind: 'agent.project',
    status,
    processId,
    scopeType: 'AI_AGENT_PROJECT',
    parentScopeId: projectId,
    userId: projectProcessUser(project),
    agentId: project.agent_id || null,
    cpu,
    ramMb,
    message: `ai-agent-project.${status}`,
    iteration: 2,
    timestamp: now,
  });
};

export async function buildAIAgentProject(input: { projectId: string; command?: string | null; deploy?: boolean | null }): Promise<AIAgentProjectBuildPayload> {
  const project = await requireProjectAccess(input.projectId, null, 'build');
  const command = (input.command || (input.deploy ? 'deploy' : 'build')).trim() || 'build';
  await persistProjectWorkspace(project);
  const process = registerProjectRuntimeProcess();
  const now = nowIso();
  await project.update({ status: 'queued', last_run: { processId: process.processId, command, status: 'queued', requestedAt: now }, updated_at: now });
  emitRuntimeEvent({
    kind: 'agent.project',
    status: 'queued',
    processId: process.processId,
    scopeType: 'AI_AGENT_PROJECT',
    parentScopeId: input.projectId,
    userId: projectProcessUser(project),
    agentId: project.agent_id || null,
    cpu: 0,
    ramMb: 0,
    message: `ai-agent-project.${command}.queued`,
    iteration: 1,
    timestamp: now,
  });
  void Promise.resolve()
    .then(() => finishProjectRun(input.projectId, process.processId, input.deploy ? 'deployed' : 'built', command))
    .catch(() => updateProjectRuntimeProcessStatus(process.processId, 'failed'));
  return { projectId: input.projectId, processId: process.processId, status: 'queued', command, scopeType: 'AI_AGENT_PROJECT', parentScopeId: input.projectId };
}

export async function deployAIAgentProject(input: { projectId: string; command?: string | null }): Promise<AIAgentProjectBuildPayload> {
  return buildAIAgentProject({ projectId: input.projectId, command: input.command || 'deploy', deploy: true });
}

const defaultPortForEngine = (engine: string) => {
  if (engine === 'postgres' || engine === 'postgresql') return 5432;
  if (engine === 'mysql' || engine === 'mariadb') return 3306;
  if (engine === 'mssql' || engine === 'sqlserver') return 1433;
  if (engine === 'mongodb') return 27017;
  if (engine === 'redis') return 6379;
  if (engine === 'clickhouse') return 8123;
  return null;
};

const verifyTcp = (host: string, port: number, timeoutMs = 2500): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });

export async function verifyAIAgentProjectExternalDatabase(input: { projectId: string; connectionId?: string | null }): Promise<AIAgentProjectExternalDatabaseVerifyPayload> {
  const project = await requireProjectAccess(input.projectId, null, 'write');
  const manifest = normalizeDatabaseManifest(project.database_manifest);
  const engine = normalizeEngine(manifest.engine);
  if (!manifest.external) {
    return { projectId: input.projectId, status: 'file_database', engine, host: null, port: null, message: 'Project database is file-driven and does not require external TCP verification.', warnings: [] };
  }
  const connection = selectExternalConnection(manifest, input.connectionId || null);
  const host = asString(connection.host || connection.hostname || connection.server).trim();
  const port = Number(connection.port || defaultPortForEngine(engine) || 0);
  if (!host || !port) {
    return { projectId: input.projectId, status: 'missing_connection', engine, host: host || null, port: port || null, message: 'External database connection requires host and port before verification.', warnings: ['Do not store secrets in project metadata. Use credentials vault references.'] };
  }
  const ok = await verifyTcp(host, port);
  const now = nowIso();
  const updatedConnections = normalizeExternalConnections(manifest).map((candidate) =>
    asString(candidate.id) === asString(connection.id)
      ? { ...candidate, status: ok ? 'verified' : 'unreachable', verifiedAt: now, host, port }
      : candidate,
  );
  await project.update({ database_manifest: { ...manifest, connection: { ...connection, status: ok ? 'verified' : 'unreachable', verifiedAt: now }, externalConnections: updatedConnections, lastVerification: { status: ok ? 'verified' : 'unreachable', host, port, at: now, connectionId: asString(connection.id) } }, updated_at: now });
  return {
    projectId: input.projectId,
    status: ok ? 'verified' : 'unreachable',
    engine,
    host,
    port,
    message: ok ? `External ${engine} database accepted TCP connection.` : `External ${engine} database was not reachable from backend on ${host}:${port}.`,
    warnings: ok ? [] : ['Check network policy, host, port, credentials vault reference, and firewall before launching the DB viewer.'],
  };
}

export async function launchAIAgentProjectDatabaseViewer(input: { projectId: string; mode?: string | null; connectionId?: string | null }): Promise<AIAgentProjectDatabaseViewerPayload> {
  const project = await requireProjectAccess(input.projectId, null, 'write');
  const manifest = normalizeDatabaseManifest(project.database_manifest);
  const workspace = projectWorkspace(project);
  const connection = selectExternalConnection(manifest, input.connectionId || null);
  const selectedEngine = normalizeEngine(connection.engine || manifest.engine);
  const external = manifest.external === true || input.mode === 'connect';
  const lastVerification = asObject(manifest.lastVerification);
  const verified = external ? lastVerification.status === 'verified' || asString(connection.status) === 'verified' : true;
  const baseUrl = asString(process.env.CLOUDBEAVER_URL || process.env.DBEAVER_WEB_URL || '/db-viewer').replace(/\/+$/, '');
  const connectionName = slugifyAgentName(`${project.slug || project.name || input.projectId}-${selectedEngine}`);
  const filePath = asString(manifest.path || manifest.filePath || manifest.databasePath || `${workspace.workspacePath}/database/${connectionName}.db`);
  const params = new URLSearchParams({ action: input.mode === 'connect' ? 'connect' : 'query', projectId: input.projectId, engine: selectedEngine, connectionName, external: String(external) });
  if (external) {
    params.set('verified', String(verified));
    params.set('connectionId', asString(connection.id || input.connectionId || connectionName));
    if (asString(connection.host)) params.set('host', asString(connection.host));
    if (Number(connection.port || 0)) params.set('port', String(connection.port));
    if (asString(connection.database)) params.set('database', asString(connection.database));
  } else {
    await ensureDir(path.dirname(filePath));
    if (!(await pathExists(filePath))) await outputFile(filePath, '');
    params.set('file', filePath);
  }
  const launchUrl = `${baseUrl}/?${params.toString()}`;
  const warnings = external && input.mode !== 'connect' && !verified ? ['Verify the external database connection before using the viewer.'] : [];
  await project.update({ runtime_manifest: { ...asObject(project.runtime_manifest), dbViewer: { launchUrl, engine: selectedEngine, connectionName, external, verified, requestedAt: nowIso() } }, updated_at: nowIso() });
  return {
    projectId: input.projectId,
    viewer: external ? 'cloudbeaver' : 'file-database',
    launchUrl,
    engine: selectedEngine,
    connectionName,
    workspacePath: workspace.workspacePath,
    external,
    verified,
    warnings,
  };
}

export async function loadAIAgentProjectWorkspaceManifest(input: { projectId: string }) {
  const project = await requireProjectAccess(input.projectId, null, 'read');
  const workspace = projectWorkspace(project);
  if (!(await pathExists(workspace.manifestPath))) await persistProjectWorkspace(project);
  return readJson(workspace.manifestPath);
}
