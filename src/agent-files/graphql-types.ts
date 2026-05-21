export type AgentFileScalar = string | number | boolean | null;
export type AgentFileJsonValue = AgentFileScalar | AgentFileJsonValue[] | { [key: string]: AgentFileJsonValue };
export type AgentFileJsonObject = { [key: string]: AgentFileJsonValue };

export type AgentFileHeaderBag = { [key: string]: string | string[] | undefined };

export type AgentFileResolverContext = {
  userId?: string | null;
  organizationId?: string | null;
  organisationId?: string | null;
  request?: { headers?: AgentFileHeaderBag };
  ormRequestContext?: {
    user_id?: string | null;
    organization_id?: string | null;
    organisation_id?: string | null;
    root?: boolean | null;
  } | null;
};

export type AgentFileGraphqlUpload = {
  filename?: string | null;
  name?: string | null;
  mimetype?: string | null;
  type?: string | null;
  encoding?: string | null;
  size?: number | null;
  buffer?: Buffer | Uint8Array | null;
  createReadStream?: () => NodeJS.ReadableStream;
  stream?: () => NodeJS.ReadableStream;
  arrayBuffer?: () => Promise<ArrayBuffer>;
};

export type AgentFileGraphqlUploadSlot = AgentFileGraphqlUpload | Promise<AgentFileGraphqlUpload>;

export type AgentFileOperationArgs = {
  input?: AgentFileJsonValue | null;
  files?: AgentFileGraphqlUploadSlot[] | AgentFileGraphqlUploadSlot | null;
};

export type AgentFileOperationPayload = {
  agentId: string | null;
  status: string;
  processId: string | null;
  attachmentIds: string[];
  fileIds: string[];
  fileNames: string[];
  storagePaths: string[];
  driveLinks: string[];
  modes: string[];
  requestedModes: string[];
  fileShapeIds: string[];
  fileShapeNames: string[];
  deletedAttachmentIds: string[];
  removedFromMemory: boolean;
  driveFilesDeleted: boolean;
  folderProtected: boolean;
  message: string;
};

export type AgentFileUploadRecord = {
  attachmentId: string;
  agentId: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  hostPath: string;
  drivePath: string;
  storageBucket: string;
  modes: string[];
  requestedModes: string[];
};

export type AgentFileUploadIngestionHookInput = {
  agentId: string;
  ownerUserId: string;
  organizationId: string | null;
  temporary: boolean;
  files: AgentFileUploadRecord[];
};

export type AgentFileUploadIngestionHookResult = {
  processId: string | null;
  status: string;
  fileShapeIds: string[];
  fileShapeNames: string[];
};
