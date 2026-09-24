# Human identity and team-scoped artifact access

**Date:** 2026-09-23
**Task:** 03-user-identity-and-private-artifacts

## Objective
Replace operator-issued device publisher tokens with human signup/login, team-scoped API credentials, and private Worker-mediated artifact access. Preserve the CLI watcher/scheduler while making the Worker derive each R2 key from authenticated team identity.

## Context
- Existing Worker registry authenticates device tokens; content reads are public and no listing API exists.
- Signup uses email/password and GitHub. A verified user gets a personal team and admin membership; the join schema supports multiple teams, while invitations are deferred.
- Better Auth cookies serve the web app. Each CLI/device credential is scoped to one team and uses a 7-day stateless access JWT plus a rotating, hashed refresh secret (30-day idle / 90-day absolute expiry).
- Web routes: `/auth/login`, `/settings/api-tokens`, `/auth/device`; artifact URLs: `/<team-slug>/<relative-path>`.
- Worker derives R2 keys as `uploads/<team-id>/artifacts/<relative-path>` and performs R2 operations through its binding.

## Approach
- Use Better Auth with D1 + Drizzle for user/account/session data and application-owned teams, memberships, device credentials, and refresh state.
- Sign team-scoped JWTs with a Worker secret; validate bearer access JWTs locally, and use D1 only for login/session, token management, and refresh operations.
- Keep R2 private. Worker authorizes list/read and derives upload keys; replace temporary R2 credentials with Worker-mediated upload requests.
- Implement browser device approval and CLI refresh while preserving watcher, debounce, pending-work, and retry semantics.

## Steps
- [x] Add schemas, D1 migration/configuration, Better Auth, email delivery, and account/team bootstrap.
- [x] Apply `0000_identity_and_teams.sql` to the provisioned remote D1 database `artifact-db`.
- [x] Add authenticated API-token/device flows and Worker-served login/settings/device pages.
- [x] Replace public content and temporary-credential routes with private listing/read/upload routes.
- [x] Update Rust CLI credential lifecycle and server-derived team/object-key contract.
- [x] Document configuration/deployment prerequisites and verify tests/builds.
- [x] Deploy the D1-backed gateway and verify the production login page and GitHub OAuth initiation.

## Acceptance criteria
- [x] The Worker D1 configuration targets the provisioned database and its initial identity/team migration is applied remotely.
- [x] The production Worker is deployed with the D1 binding, and its GitHub OAuth start endpoint uses the configured client ID.
- [ ] Verified email or GitHub signup creates a user, unique team slug, and admin membership atomically/idempotently.
- [ ] Each API/device credential is scoped to one team; access JWT verification is local and refresh is rotating/revocable.
- [ ] Private `/<team-slug>/<relative-path>` reads map to the team-ID R2 prefix and deny unauthorized teams.
- [ ] Upload requests cannot select another team or a full R2 key; no publisher JWT or broad R2 credentials reach R2.
- [ ] CLI watches and reconciles the configured artifact root, uploading created/modified files with the scoped credential.
- [ ] Automated integration tests cover the D1-backed signup/verification, API-token/device lifecycle, refresh, and revocation flows; current automated tests cover Worker authorization/routes and CLI lifecycle, while the D1-backed lifecycle was checked manually in local Wrangler.

## References
- [status.md](status.md) — implementation and verification progress.
