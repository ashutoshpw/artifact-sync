# Publisher Authentication and Artifact Sync v1

**Date:** 2026-09-23
**Task:** 01-publisher-auth-lifecycle

## Objective
Build a greenfield Rust agent/daemon and TypeScript Cloudflare Worker with team-scoped publisher-token login, secure credential storage, operator provisioning, and a minimal local-to-R2 artifact sync lifecycle.

## Context
The checkout is empty and has no prior sync source/specification. Per user direction, this implementation reconstructs a minimal baseline: recursive watch under `~/.agents/artifacts`, durable upload queue, team-prefixed object writes, and public read-only artifact serving.

## Approach
- Keep publishing config and auth config separate; use a POSIX file-store behind an interface.
- Validate publisher tokens at the Worker on identity and temporary-credential exchanges.
- Mint 15-minute, team-prefix, `PutObject`-only R2 credentials in the trusted Worker.
- Preserve queued work during offline/auth changes; do not propagate remote deletes in v1.

## Steps
- [x] Scaffold Rust workspace, Bun TypeScript Worker, shared schemas, and task docs.
- [x] Implement secure auth config store, CLI login/whoami/logout, and gateway auth contracts.
- [x] Add operator token registry tooling, Worker routes, content serving, and deployment docs.
- [x] Add daemon watch/state/upload loop with credential refresh and auth-change notification.
- [x] Finish acceptance-test expansion, final checks, and local commit.

## Acceptance criteria
- [x] CLI auth lifecycle, env precedence, destination binding, file safety, redaction, and daemon logout behavior are covered.
- [x] Gateway enforces registry expiry/revocation/team/permission rules and returns team-scoped, short-lived upload credentials.
- [x] Daemon preserves pending work offline, does not poll auth while idle, and never sends publisher credentials to R2.
- [x] Operator docs show issue/rotate/revoke and require active Worker deployment before confirming revocation.

## References
- User authentication and sync requirements in the conversation.
- Cloudflare R2 temporary credentials and Worker secret documentation retrieved during planning.
