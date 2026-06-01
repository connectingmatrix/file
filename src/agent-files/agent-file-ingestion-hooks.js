"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAgentFileUploadIngestionHook = registerAgentFileUploadIngestionHook;
exports.runAgentFileUploadIngestionHook = runAgentFileUploadIngestionHook;
let uploadIngestionHook = null;
function registerAgentFileUploadIngestionHook(hook) {
    uploadIngestionHook = hook;
}
async function runAgentFileUploadIngestionHook(input) {
    if (!uploadIngestionHook)
        return { processId: null, status: 'uploaded', fileShapeIds: [], fileShapeNames: [] };
    return uploadIngestionHook(input);
}
