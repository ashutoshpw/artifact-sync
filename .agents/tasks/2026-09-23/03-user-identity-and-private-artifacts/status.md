# Status

- **State:** in-progress
- **Updated:** 2026-09-24

## Notes
- Implementation is present across the gateway, Drizzle schema/migration, browser pages, contracts/docs, and Rust CLI. The D1-backed gateway is now deployed to production.
- Verification on 2026-09-23/24: 8 Bun gateway tests, TypeScript check, 23 Rust tests, `cargo fmt --check`, frozen Bun install, fresh isolated migration against the configured `artifact-db` binding name, Drizzle generation parity, Wrangler types check, and Worker dry-run all passed.
- Added a regression test and escaping for reflected `returnTo` data embedded in the login page's inline script.
- A local Wrangler run from the prior implementation pass exercised signup/email verification, personal-team provisioning, API-token refresh/revocation, device approval/polling, and authenticated upload/read; those D1 lifecycle checks are not yet committed as automated tests.
- User created the production D1 database as `artifact-db` (`76b048e9-a3af-4bc4-8191-3c5635ad23cf`), and the Worker binding targets it. On 2026-09-24, Wrangler confirmed `0000_identity_and_teams.sql` was pending, applied it remotely (23 SQL commands), then confirmed no migrations remain and verified the expected identity/team tables with a read-only schema query.
- Root `.env` and `.env.local` are ignored by Git; `.env.local` is a regular owner-owned file restricted to mode `0600`. Wrangler loaded it via `--env-file` for the migration commands; its contents were not displayed or inspected.
- Production vars were aligned in Wrangler config, the exposed auth/JWT values were replaced without printing them, and deployment workflow `35967092453` succeeded for commit `855f2375c1fae00eda404ad46687e589f0127221`. Live smoke checks returned HTTP 200 for `/auth/login` and for GitHub OAuth initiation, which produced an authorization URL for the expected GitHub client ID. The browser authorization/callback and account signup were not completed; email/password verification is intentionally untested until a sender is configured.
- Removed the temporary local `.dev.vars`, synthetic D1 identity records, and one test R2 object after stopping the repo's Wrangler process. This local test data is not recoverable; no production data was touched.
- Implementation started after confirming login providers, route paths, team-scoped credentials, and R2 key mapping with the user.
- Recommended refresh policy: rotating refresh credentials, 30-day inactivity expiry, 90-day absolute expiry; existing access JWTs can remain valid up to 7 days after a membership/token revocation.
