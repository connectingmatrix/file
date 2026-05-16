export declare const PACKAGE_STRUCTURE: {
    readonly package: "connectingmatrix-file";
    readonly structuredAt: "2026-05-15";
    readonly layout: "package-owned-ui-backend-entity";
    readonly principle: "The package owns its UI contract, backend runtime contract, entity/CRUD contract, GraphQL extension, migrations, tests, and status surface. giga-ai-backend and giga-ai-ui remain thin composition shells.";
    readonly entrypoints: {
        readonly root: "src/index.ts";
        readonly ui: "src/ui/index.ts";
        readonly backend: "src/backend/index.ts";
        readonly entity: "src/entity/index.ts";
        readonly structure: "src/package-structure.ts";
    };
    readonly folders: {
        readonly "src/ui": "browser/UI contract: dataloaders, bindWithServer clients, screens, components, socket clients, and designer entry points";
        readonly "src/backend": "server contract: package middleware, GraphQL schema/resolvers, backend services, runtime modules, webhooks/uploads/MCP APIs, and health/status";
        readonly "src/backend/modules": "domain runtime modules owned by this package, grouped by capability instead of legacy app paths";
        readonly "src/entity": "data contract: entities, repositories, access-scoped CRUD, and entity GraphQL support";
        readonly "src/entity/entities": "entity classes and persistent record definitions";
        readonly "src/entity/repositories": "CRUD repositories and persistence adapters";
        readonly "src/entity/graphql": "entity-owned GraphQL contracts/resolvers/schema helpers";
        readonly migrations: "package-owned database migrations";
        readonly tests: "unit and integration tests for the package API and compatibility behavior";
    };
    readonly movesApplied: {
        readonly backend: readonly [readonly ["general", "modules/platform"], readonly ["tree", "modules/tree"], readonly ["chat", "modules/chat"], readonly ["ai-agents", "modules/agents"]];
        readonly ui: readonly [readonly ["app/components", "components"]];
        readonly entity: readonly [readonly ["repositories/entities", "entities"]];
    };
    readonly counts: {
        readonly ui: {
            readonly files: 5;
            readonly bytes: 8117;
        };
        readonly backend: {
            readonly files: 16;
            readonly bytes: 95368;
        };
        readonly entity: {
            readonly files: 6;
            readonly bytes: 11771;
        };
        readonly migrations: {
            readonly files: 3;
            readonly bytes: 3811;
        };
        readonly tests: {
            readonly files: 0;
            readonly bytes: 0;
        };
    };
};
export default PACKAGE_STRUCTURE;
