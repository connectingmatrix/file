import { Request, Response } from 'express';
import multer from 'multer';
import { Readable } from 'node:stream';
import { BadRequestError, JsonController, Post, Req, Res, UnauthorizedError } from 'routing-controllers';
import { Service } from 'typedi';
import { OrganisationEntity, SharedSpaceEntity } from '@connectingmatrix/orm/repositories/entities';
import type { UploadScalarFile } from '@connectingmatrix/orm/repositories/entities/runtime/SharedSpaceEntity';
import { getCurrentUserIdOrThrow, isCurrentUserRootUser } from '@giga/shared/lib/helper';
import type { GraphqlResolverContext } from '@giga/shared/types';
import { SupabaseClient } from '@giga/general/decorators/integration/supabase-client';

const DEFAULT_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;
const MAX_UPLOAD_BYTES = Math.max(
  1,
  Number(process.env.AI_AGENT_UPLOAD_MAX_BYTES || process.env.GRAPHQL_UPLOAD_MAX_BYTES || DEFAULT_UPLOAD_LIMIT_BYTES),
);
const uploadParser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, fieldSize: MAX_UPLOAD_BYTES, fields: 20, files: 1 },
}).single('file');

type UploadRequest = Request & { file?: Express.Multer.File; userId?: string | null; effectiveRoot?: boolean };

const parseUpload = async (request: UploadRequest, response: Response) =>
  new Promise<void>((resolve, reject) => uploadParser(request, response, (error) => (error ? reject(error) : resolve())));

const uploadValue = (file: Express.Multer.File): UploadScalarFile => ({
  filename: file.originalname,
  mimetype: file.mimetype,
  encoding: '7bit',
  createReadStream: () => Readable.from([file.buffer]),
});

@JsonController('/shared-space')
@Service()
export class SharedSpaceUploadController {
  @Post('/upload')
  async upload(@Req() request: UploadRequest, @Res() response: Response) {
    await parseUpload(request, response);
    const file = request.file;
    const path = String(request.body?.path || '').trim();
    const organizationId = String(request.body?.organizationId || '').trim();
    if (!file) throw new BadRequestError('Upload file is required.');
    if (!path) throw new BadRequestError('Upload path is required.');

    const supabase = await SupabaseClient(request);
    const userId = await getCurrentUserIdOrThrow(supabase);
    if (!userId) throw new UnauthorizedError('Authorization token is invalid.');
    const effectiveRoot = await isCurrentUserRootUser(supabase);
    const context = {
      request,
      supabase,
      body: {},
      graphqlContext: null,
      userId,
      effectiveRoot,
    } as GraphqlResolverContext;

    const saved = organizationId
      ? await (OrganisationEntity.load(organizationId) as OrganisationEntity).sharedSpace.uploadFile(context, {
          file: uploadValue(file),
          maxBytes: MAX_UPLOAD_BYTES,
          path,
        })
      : await SharedSpaceEntity.forUser(userId).uploadFile(context, { file: uploadValue(file), maxBytes: MAX_UPLOAD_BYTES, path });
    return response.status(200).json(saved);
  }
}
