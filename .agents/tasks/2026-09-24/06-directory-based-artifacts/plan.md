# Directory-based artifact sync

**Date:** 2026-09-24
**Task:** 06-directory-based-artifacts

## Objective
Treat every immediate child directory under `~/.agents/artifacts/` as one team artifact, with its basename as slug and its nested files browsable in the dashboard.

## Context
The daemon currently watches the full artifact root and uploads each file independently. R2 keys already include paths below the root; the dashboard currently renders each object as a separate artifact.

## Approach
- Discover all immediate child directories; ignore loose root files and require nonempty, URL-safe lowercase slugs matching team slug rules.
- Scope uploads to `(artifact slug, path inside artifact)`; have the Worker derive the team prefix from the authenticated identity.
- Use paginated R2 prefixes for the artifact index and file listings; do not add D1 artifact metadata or remote-delete behavior.
- Keep correctly nested existing R2 objects in place; hide but do not delete legacy root-level objects.

## Steps
- [x] Update agent discovery, watcher reconciliation, upload path contract, and local pending-state handling.
- [x] Update Worker routes and team-scoped R2 listing/upload behavior.
- [x] Replace the flat dashboard listing with artifact index and detail pages; update docs.
- [x] Add and run focused Rust/Bun tests and checks.

## Acceptance criteria
- [x] Multiple immediate child directories appear as distinct artifacts; nested files stay under their parent slug.
- [x] Root-level files and invalid artifact directories are never uploaded or listed.
- [x] Upload/list/detail/content routes enforce existing team identity and permissions.
- [x] Existing nested R2 keys remain usable; root-level legacy objects are not deleted.

## References
- User-approved directory artifact migration plan in the conversation (2026-09-24).
