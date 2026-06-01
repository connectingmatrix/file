"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listFolder = exports.folderBytes = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const path_1 = require("./path");
const folderBytes = (path) => {
    const stat = (0, node_fs_1.lstatSync)(path);
    if (stat.isSymbolicLink())
        return 0;
    if (!stat.isDirectory())
        return stat.size;
    return (0, node_fs_1.readdirSync)(path).reduce((total, entry) => total + (0, exports.folderBytes)(`${path}/${entry}`), 0);
};
exports.folderBytes = folderBytes;
const listFolder = (root, path) => (0, node_fs_1.readdirSync)(path, { withFileTypes: true })
    .filter((entry) => !entry.isSymbolicLink())
    .map((entry) => {
    const fullPath = `${path}/${entry.name}`;
    const stat = (0, node_fs_1.lstatSync)(fullPath);
    return {
        name: (0, node_path_1.basename)(entry.name),
        path: (0, path_1.publicPath)(root, fullPath),
        size: entry.isDirectory() ? (0, exports.folderBytes)(fullPath) : stat.size,
        kind: entry.isDirectory() ? 'folder' : 'file',
        updatedAt: stat.mtime.toISOString(),
    };
})
    .sort((left, right) => `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`));
exports.listFolder = listFolder;
