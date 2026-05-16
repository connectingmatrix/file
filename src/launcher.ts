import { nowIso, type PackageLauncherPanel, type RequestContext } from './contracts.js';

export function createConnectingmatrixFileStubLauncher(context: RequestContext = {}): PackageLauncherPanel {
  return {
    packageName: '@connectingmatrix/file',
    title: 'File Processing Launcher',
    mode: 'stub',
    status: 'ready',
    checkedAt: nowIso(),
    summary: 'Launches file upload providers, MIME detection, processors, ZIP/extract and source archive adapter.',
    healthPath: '/file/health',
    graphqlNamespace: 'file',
    routes: [
      { method: 'GET', path: '/file/health', description: 'Health/status endpoint' },
      { method: 'GET', path: '/file/launcher', description: 'Stub launcher panel' }
    ],
    owns: {
      ui: ['dataloaders', 'bindWithServer', 'status/launcher UI'],
      backend: ["storage providers", "mime detector", "zip extractor", "format processors"],
      entity: ["StoredFile", "ProcessedFile"],
      migrations: ['migrations/*.sql']
    },
    actions: [
      { name: 'detectMime', label: 'detectMime', method: 'LOCAL' as const, description: 'Run detectMime demo action' },
      { name: 'process', label: 'process', method: 'LOCAL' as const, description: 'Run process demo action' },
      { name: 'zipExtract', label: 'zipExtract', method: 'LOCAL' as const, description: 'Run zipExtract demo action' }
    ],
    sampleData: { context: 'stub-playground', userId: context.userId ?? 'stub-user' },
    context: { userId: context.userId, organizationId: context.organizationId, root: Boolean(context.root), traceId: context.traceId },
    notes: [
      'This launcher is intentionally stub-mode playable so the package can be tested outside giga-ai-backend.',
      'The launcher exposes this package boundary only; cross-package behavior is injected through adapters.'
    ]
  };
}

export const createStubLauncher = createConnectingmatrixFileStubLauncher;
export const Launcher = { open: createConnectingmatrixFileStubLauncher, mode: 'stub' as const };
export const launcher = createConnectingmatrixFileStubLauncher;
