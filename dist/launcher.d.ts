import { type PackageLauncherPanel, type RequestContext } from './contracts.js';
export declare function createConnectingmatrixFileStubLauncher(context?: RequestContext): PackageLauncherPanel;
export declare const createStubLauncher: typeof createConnectingmatrixFileStubLauncher;
export declare const Launcher: {
    open: typeof createConnectingmatrixFileStubLauncher;
    mode: "stub";
};
export declare const launcher: typeof createConnectingmatrixFileStubLauncher;
