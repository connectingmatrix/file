import {
    organizationSharedSpace,
    organizationSharedSpaceCreateFolder,
    organizationSharedSpaceDelete,
    organizationSharedSpaceFiles,
    organizationSharedSpaceStat,
    organizationSharedSpaceWriteFile,
    type OrganizationSharedSpaceFile,
    type OrganizationSharedSpaceSummary
} from '@giga/dataloader/client/legacy/orm/shared-space';
import type { UiDataContext } from '@giga/dataloader/client/legacy/dataloaders/context';

export type OrganizationDriveState = {
    summary: OrganizationSharedSpaceSummary;
    files: OrganizationSharedSpaceFile[];
    path: string;
};

const organizationId = (context: UiDataContext): string => {
    if (context.policy.scope.kind !== 'organization') throw new Error('Organisation Drive requires an organisation scoped session.');
    return context.policy.scope.id;
};

const childPath = (parentPath: string, name: string): string => `${parentPath}/${name}`;

export const loadOrganizationDrive = async (context: UiDataContext, path = '/drive'): Promise<OrganizationDriveState> => {
    const id = organizationId(context);
    const [summary, files] = await Promise.all([organizationSharedSpace(id), organizationSharedSpaceFiles(id, path)]);
    return { summary, files, path };
};

export const loadOrganizationDriveFile = async (context: UiDataContext, path: string): Promise<OrganizationSharedSpaceFile> => {
    return organizationSharedSpaceStat(organizationId(context), path);
};

export const createOrganizationDriveFolder = async (context: UiDataContext, parentPath: string, name: string): Promise<OrganizationSharedSpaceFile> => {
    return organizationSharedSpaceCreateFolder(organizationId(context), childPath(parentPath, name));
};

export const writeOrganizationDriveFile = async (context: UiDataContext, parentPath: string, file: File): Promise<OrganizationSharedSpaceFile> => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            resolve(result.slice(result.indexOf(',') + 1));
        };
        reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
        reader.readAsDataURL(file);
    });
    return organizationSharedSpaceWriteFile(organizationId(context), childPath(parentPath, file.name), dataUrl);
};

export const deleteOrganizationDrivePath = async (context: UiDataContext, path: string): Promise<OrganizationSharedSpaceFile> => {
    return organizationSharedSpaceDelete(organizationId(context), path);
};
