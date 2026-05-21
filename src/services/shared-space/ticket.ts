import { createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestError } from 'routing-controllers';
import { EnvLoader } from '@connectingmatrix/orm/env';

export type DriveUploadPurpose = 'drive' | 'ai-agent';
export type DriveUploadTicket = {
  purpose: DriveUploadPurpose;
  scopeKind: 'user' | 'organization';
  scopeId: string;
  userId: string;
  organizationId: string | null;
  path: string;
  fileName: string;
  mimeType: string;
  maxBytes: number;
  expiresAt: number;
};
export type DriveUploadTicketEnvelope = { payload: DriveUploadTicket; signature: string };
export type DriveUploadTicketForm = {
  driveTicketExpiresAt?: string;
  driveTicketFileName?: string;
  driveTicketMaxBytes?: string;
  driveTicketMimeType?: string;
  driveTicketOrganizationId?: string;
  driveTicketPath?: string;
  driveTicketPurpose?: string;
  driveTicketScopeId?: string;
  driveTicketScopeKind?: string;
  driveTicketSignature?: string;
  driveTicketUserId?: string;
};

const secret = () => EnvLoader.getOrThrow('SERVER_SECRET');
export const assertDriveUploadTicketConfig = (): void => {
  EnvLoader.getOrThrow('SERVER_SECRET');
};
const sign = (body: string) => createHmac('sha256', secret()).update(body).digest('hex');
const fields = (payload: DriveUploadTicket): string[] => [
  payload.purpose,
  payload.scopeKind,
  payload.scopeId,
  payload.userId,
  payload.organizationId || '',
  payload.path,
  payload.fileName,
  payload.mimeType,
  `${payload.maxBytes}`,
  `${payload.expiresAt}`,
];
const bodyFrom = (payload: DriveUploadTicket) => fields(payload).map(encodeURIComponent).join('\n');
const requiredField = (value: string | undefined, name: string): string => {
  if (!value) throw new BadRequestError(`${name} is required.`);
  return value;
};
const numberField = (value: string | undefined, name: string): number => {
  const numberValue = Number(requiredField(value, name));
  if (!Number.isFinite(numberValue)) throw new BadRequestError(`${name} is invalid.`);
  return numberValue;
};
const purposeField = (value: string | undefined): DriveUploadPurpose => {
  if (value === 'drive' || value === 'ai-agent') return value;
  throw new BadRequestError('Drive upload ticket purpose is invalid.');
};
const scopeKindField = (value: string | undefined): DriveUploadTicket['scopeKind'] => {
  if (value === 'user' || value === 'organization') return value;
  throw new BadRequestError('Drive upload ticket scope is invalid.');
};
const ticketFrom = (form: DriveUploadTicketForm): DriveUploadTicket => {
  return {
    purpose: purposeField(form.driveTicketPurpose),
    scopeKind: scopeKindField(form.driveTicketScopeKind),
    scopeId: requiredField(form.driveTicketScopeId, 'driveTicketScopeId'),
    userId: requiredField(form.driveTicketUserId, 'driveTicketUserId'),
    organizationId: form.driveTicketOrganizationId || null,
    path: requiredField(form.driveTicketPath, 'driveTicketPath'),
    fileName: requiredField(form.driveTicketFileName, 'driveTicketFileName'),
    mimeType: requiredField(form.driveTicketMimeType, 'driveTicketMimeType'),
    maxBytes: numberField(form.driveTicketMaxBytes, 'driveTicketMaxBytes'),
    expiresAt: numberField(form.driveTicketExpiresAt, 'driveTicketExpiresAt'),
  };
};

export const createDriveUploadTicket = (payload: DriveUploadTicket): DriveUploadTicketEnvelope => {
  const body = bodyFrom(payload);
  return { payload, signature: sign(body) };
};

export const verifyDriveUploadTicket = (form: DriveUploadTicketForm): DriveUploadTicket => {
  const payload = ticketFrom(form);
  const signature = requiredField(form.driveTicketSignature, 'driveTicketSignature');
  const body = bodyFrom(payload);
  const expected = sign(body);
  const left = Buffer.from(signature, 'hex');
  const right = Buffer.from(expected, 'hex');
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new BadRequestError('Drive upload ticket is invalid.');
  if (payload.expiresAt < Date.now()) throw new BadRequestError('Drive upload ticket expired.');
  return payload;
};

export type DriveUploadPreflightResult = { uploadUrl: string; ticket: DriveUploadTicketEnvelope; path: string; expiresAt: number; maxBytes: number };
