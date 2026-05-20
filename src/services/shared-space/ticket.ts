import { createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestError } from 'routing-controllers';
import { EnvLoader } from '@gigav2/lib/env';

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

const secret = () => EnvLoader.get('SERVER_SECRET') || EnvLoader.get('ORM_CLIENT_SECRET') || EnvLoader.get('JWT_SECRET') || '';
const sign = (body: string) => createHmac('sha256', secret()).update(body).digest('base64url');
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
const bodyFrom = (payload: DriveUploadTicket) => Buffer.from(fields(payload).map(encodeURIComponent).join('\n'), 'utf8').toString('base64url');
const fieldAt = (items: string[], index: number): string => decodeURIComponent(items[index] || '');
const ticketFrom = (body: string): DriveUploadTicket => {
  const items = Buffer.from(body, 'base64url').toString('utf8').split('\n');
  return {
    purpose: fieldAt(items, 0) === 'ai-agent' ? 'ai-agent' : 'drive',
    scopeKind: fieldAt(items, 1) === 'organization' ? 'organization' : 'user',
    scopeId: fieldAt(items, 2),
    userId: fieldAt(items, 3),
    organizationId: fieldAt(items, 4) || null,
    path: fieldAt(items, 5),
    fileName: fieldAt(items, 6),
    mimeType: fieldAt(items, 7),
    maxBytes: Number(fieldAt(items, 8)),
    expiresAt: Number(fieldAt(items, 9)),
  };
};

export const createDriveUploadTicket = (payload: DriveUploadTicket): string => {
  if (!secret()) throw new Error('SERVER_SECRET is required for Drive upload tickets.');
  const body = bodyFrom(payload);
  return `${body}.${sign(body)}`;
};

export const verifyDriveUploadTicket = (ticket: string): DriveUploadTicket => {
  const [body, signature] = ticket.split('.');
  if (!body || !signature || !secret()) throw new BadRequestError('Drive upload ticket is required.');
  const expected = sign(body);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new BadRequestError('Drive upload ticket is invalid.');
  const payload = ticketFrom(body);
  if (payload.expiresAt < Date.now()) throw new BadRequestError('Drive upload ticket expired.');
  return payload;
};

export type DriveUploadPreflightResult = { uploadUrl: string; ticket: string; path: string; expiresAt: number; maxBytes: number };
