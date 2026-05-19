# File Service Package

Contracts owned here:

- `FileStorageProvider`: upload, download, remove, signed URL, and resumable upload session interface.
- `SupabaseStorageProvider`: Supabase Storage adapter with signed download/upload URL support and TUS session metadata.
- `putFileArtifact`: checksum-backed artifact persistence for agent attachments, project sources, builds, DB files, and node packages.
- `createZipArtifactBody`: compressed artifact body creator with a manifest embedded in the archive.

Runtime code must persist real storage objects and checksums before reporting artifact success.
