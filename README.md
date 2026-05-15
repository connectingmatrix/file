# @connectingmatrix/file

File upload, processing, Supabase/Drive provider abstraction, project-source ZIP compression/decompression, and package-owned upload GraphQL/API layer.

This repo is intentionally split into `src/ui`, `src/backend`, and `src/entity` so it can be imported by the frontend, backend, or package-owned migration runner without making `giga-ai-backend` a monorepo again.

## Usage

```ts
import { createPackage } from '@connectingmatrix/file';

const pkg = createPackage();
await pkg.health();
```

## Server binding

Each package exports a `registerWithServer(app)` helper when server routes are needed, plus a `graphql` bundle containing `typeDefs`, `resolvers`, and `migrations`.

## Frontend binding

UI loaders expose `.bindWithServer('/graphql')` so the same package can work with the current backend or a separately deployed package host.


## Supabase upload provider

```ts
import { File, createSupabaseStorageProvider } from '@connectingmatrix/file';

File.registerProvider(createSupabaseStorageProvider({
  client: supabase,
  bucket: 'ai-agent-project-sources',
}));
```

Project source archives should use the `ai-agent-project-sources` bucket. For archives above small-file territory, switch the provider implementation to Supabase resumable/TUS upload while keeping the same package-facing provider interface.
