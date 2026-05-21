import { deleteAiAgentFileOperation } from './agent-file-graphql-operations';
import type { AgentFileJsonObject, AgentFileJsonValue, AgentFileOperationArgs, AgentFileOperationPayload, AgentFileResolverContext } from './graphql-types';

type GraphqlField = 'String' | 'ID' | 'Boolean' | { of: 'String' | 'ID'; list: true };
type GraphqlOutput = { [key: string]: GraphqlField };

type FileServiceRootResolverRegistration = {
  name: string;
  operationType: 'mutation';
  args?: string;
  input?: string;
  output: GraphqlOutput;
  resolverHandler: (
    root: AgentFileJsonValue | null,
    args: AgentFileOperationArgs,
    context: AgentFileResolverContext,
    info: AgentFileJsonValue | null,
  ) => Promise<AgentFileOperationPayload>;
};

type FileServiceRootRegistrar = {
  registerRootResolvers(registrations: readonly FileServiceRootResolverRegistration[]): void;
};

const objectValue = (value: AgentFileJsonValue | null | undefined): AgentFileJsonObject =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as AgentFileJsonObject) : {};

const agentFilePayloadOutput: GraphqlOutput = {
  agentId: 'ID',
  status: 'String',
  processId: 'String',
  attachmentIds: { of: 'ID', list: true },
  fileIds: { of: 'ID', list: true },
  fileNames: { of: 'String', list: true },
  storagePaths: { of: 'String', list: true },
  driveLinks: { of: 'String', list: true },
  modes: { of: 'String', list: true },
  requestedModes: { of: 'String', list: true },
  fileShapeIds: { of: 'ID', list: true },
  fileShapeNames: { of: 'String', list: true },
  deletedAttachmentIds: { of: 'ID', list: true },
  removedFromMemory: 'Boolean',
  driveFilesDeleted: 'Boolean',
  folderProtected: 'Boolean',
  message: 'String',
};

let registered = false;

export function registerFileServiceGraphqlOperations(orm: FileServiceRootRegistrar): void {
  if (registered) return;
  registered = true;
  orm.registerRootResolvers([
    {
      name: 'deleteAiAgentFile',
      operationType: 'mutation',
      input: 'Opaque',
      output: agentFilePayloadOutput,
      resolverHandler: (_root, args) => deleteAiAgentFileOperation(objectValue(args.input)),
    },
  ]);
}
