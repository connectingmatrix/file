# Drive Storage

`@connectingmatrix/file-service` owns Drive path policy, upload tickets, quota checks, and protected module file rules.

## Host Roots

`DRIVE_PATH` is required at boot. The package does not fall back to platform-specific folders.

- User Drive host root: `$DRIVE_PATH/users/[USER-ID]/drive`
- Organization Drive host root: `$DRIVE_PATH/orgs/[ORGANIZATION-ID]/drive`
- Virtual Drive paths remain `/drive/...` in API, ORM client, workflow, MCP, and UI payloads.

Organization members mount the same organization Drive. User and organization drives use the same virtual path shapes; the mounted host root is selected by scope.

## Protected Paths

User-facing Drive create, upload, move, copy, and delete reject module-owned protected paths:

- `/drive/[USER-ID]/agents/[AGENT-ID]/FILES/...`
- `/drive/[USER-ID]/agents/[AGENT-ID]/artifacts/FILES/...`
- `/drive/[USER-ID]/agent-projects/db/...`

Chat uploads use `/drive/[USER-ID]/chats/...` and are user-deletable. Owning modules remove protected physical files only through internal file-service code paths, not through user Drive operations.

## Upload Flow

1. ORM client calls `Drive.preflight` or `AIAgentFile.preflight` with path/scope, file name, mime type, and byte size.
2. Backend resolves signed ORM request context, verifies organization membership when an organization Drive is requested, checks permissions, reads plan limits, calculates current usage, and rejects protected user paths.
3. File-service returns a short-lived signed ticket envelope.
4. ORM client uploads multipart data and ticket fields to the descriptor-backed upload operation.
5. Upload routes parse multipart data, validate the ticket fields, and verify final bytes do not exceed the approved ticket size.

## Storage Ownership

- AI Agent user uploads are stored under `/drive/[USER-ID]/agents/[AGENT-ID]/FILES/...` and create `AIAgentAttachment` rows through ORM entities.
- AI Agent artifacts are stored under `/drive/[USER-ID]/agents/[AGENT-ID]/artifacts/FILES/...`.
- Post attachments and AgentProjects source/code uploads remain Supabase Storage artifacts through ORM entity storage helpers.
- AgentProjects databases are protected under `/drive/[USER-ID]/agent-projects/db/...`.
