import { BadRequestError } from 'routing-controllers';
import { drivePath } from './path';

const protectedDrivePath = (path: string) => {
  const normalized = drivePath(path);
  return /^\/[^/]+\/agents\/[^/]+\/(?:FILES|artifacts\/FILES)(?:\/|$)/.test(normalized) || /^\/[^/]+\/agent-projects\/db(?:\/|$)/.test(normalized);
};

export const isProtectedDrivePath = (path: string): boolean => protectedDrivePath(path);

export const assertUserDrivePathAllowed = (path: string): void => {
  if (protectedDrivePath(path)) throw new BadRequestError('This Drive path is protected and can only be changed by the owning module.');
};
