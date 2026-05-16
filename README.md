# @connectingmatrix/file

All file processing, MIME detection, ZIP compression/extraction, Supabase/memory providers, attachment processing, and source archive adapter ownership.

## Ownership

This package owns its `src/client`, `src/backend`, `src/entity`, GraphQL bundle, migrations, health/status, launcher, and package contracts. It can be included in backend or UI without assuming a monorepo.

## Public contracts

- `File.detectMimeType`
- `File.registerProvider/createSupabaseStorageProvider`
- `File.registerProcessor/process/processed`
- `File.upload/download/remove/list`
- `File.zip/unzip`
- `File.createSourceArchiveAdapter(provider)`
- `GraphQL/API upload/process/delete`


## Basic usage

```ts
import { File } from '@connectingmatrix/file';
const stored = await File.upload({ fileName: 'source.zip', content, provider: 'supabase' }, ctx);
const files = await File.unzip(await File.download(stored.path, 'supabase', ctx));
```

## Server usage

```ts
import { createPackage } from '@connectingmatrix/file';
const pkg = createPackage();
await pkg.health?.();
// register pkg.routes as middleware and merge pkg.graphql into /graphql
```

## UI usage

Package UI modules expose `bindWithServer('/graphql')` where applicable. Domain packages own their dataloaders; the thin UI only renders/binds.

## Observability and process monitor

All packages expose `PackageObservability`. The server wires logger and sockets into every package. Logger registers package health probes and exposes `/logger/process-monitor` plus `/server/process-monitor`.

## Launcher

Run locally:

```bash
npm run build
node playground.mjs
```

The launcher opens in stub mode so the package can be tested independently, similar to workflow designer stub mode.

## GraphQL and routes

GraphQL namespace and routes are returned by `createPackage()`. Routes include health and launcher endpoints when needed.

## Exports

- `.`
- `./backend`
- `./ui`
- `./entity`
- `./package.json`
- `./package-structure`
- `./launcher`
- `./observability`

## Folder counts

- `src/client`: 5 files
- `src/backend`: 22 files
- `src/entity`: 6 files
- `migrations`: 3 files



## Final gap closure

See `docs/FINAL_GAP_CLOSURE_CONTRACTS.md` for the final process-monitor, project, node, workflow, and package-owned contract audit.

## Final runtime contracts

See `docs/FINAL_RUNTIME_CONTRACTS.md` for the final package-owned API, routes, launcher, observability, and wiring contracts.


## Final package contracts

- `File.upload/download/delete/list`
- `File.detectMimeType/processFile`
- `File.createSourceArchiveAdapter`
- `File.createNodePackageAdapter`
- `Supabase storage provider adapter`
- `ZIP/extract and MIME ownership`

See `docs/AUTO_GENERATED_CONTRACTS.md` and `docs/OBSERVABILITY.md` for generated operational docs.
