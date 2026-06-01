"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertUserDrivePathAllowed = exports.isProtectedDrivePath = void 0;
const routing_controllers_1 = require("routing-controllers");
const path_1 = require("./path");
const protectedDrivePath = (path) => {
    const normalized = (0, path_1.drivePath)(path);
    return /^\/[^/]+\/agents\/[^/]+\/(?:FILES|artifacts\/FILES)(?:\/|$)/.test(normalized) || /^\/[^/]+\/agent-projects\/db(?:\/|$)/.test(normalized);
};
const isProtectedDrivePath = (path) => protectedDrivePath(path);
exports.isProtectedDrivePath = isProtectedDrivePath;
const assertUserDrivePathAllowed = (path) => {
    if (protectedDrivePath(path))
        throw new routing_controllers_1.BadRequestError('This Drive path is protected and can only be changed by the owning module.');
};
exports.assertUserDrivePathAllowed = assertUserDrivePathAllowed;
