"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerFileServiceGraphqlOperations = registerFileServiceGraphqlOperations;
const agent_file_graphql_operations_1 = require("./agent-file-graphql-operations");
const objectValue = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const agentFilePayloadOutput = {
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
function registerFileServiceGraphqlOperations(orm) {
    if (registered)
        return;
    registered = true;
    orm.registerRootResolvers([
        {
            name: 'deleteAiAgentFile',
            operationType: 'mutation',
            input: 'Opaque',
            output: agentFilePayloadOutput,
            resolverHandler: (_root, args) => (0, agent_file_graphql_operations_1.deleteAiAgentFileOperation)(objectValue(args.input)),
        },
    ]);
}
