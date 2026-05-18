import { AIAgentAttachmentEntity } from './AIAgentAttachmentEntity';
import { AttachmentEntity } from './AttachmentEntity';
import { ChunkEntity } from './ChunkEntity';
import { MessageChunkEntity } from './MessageChunkEntity';
import { SharedSpaceFileEntity } from './SharedSpaceFileEntity';
import { WorkflowAttachmentEntity } from './WorkflowAttachmentEntity';

export const fileServiceEntities = [
  AIAgentAttachmentEntity,
  AttachmentEntity,
  ChunkEntity,
  MessageChunkEntity,
  SharedSpaceFileEntity,
  WorkflowAttachmentEntity,
] as const;
