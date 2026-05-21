import { DRIVE_PATH } from './services/shared-space/constants';
import { assertDriveUploadTicketConfig } from './services/shared-space/ticket';

export async function bootFileServicePackage(): Promise<void> {
  assertDriveUploadTicketConfig();
  DRIVE_PATH();
}
