# Status

- **State:** in-progress
- **Updated:** 2026-09-23

## Notes
- Implementation is present across the gateway, Drizzle schema/migration, browser pages, contracts/docs, and Rust CLI. No production deployment was performed.
- Verification on 2026-09-23/24: 8 Bun gateway tests, TypeScript check, 23 Rust tests, `cargo fmt --check`, frozen Bun install, fresh isolated migration against the configured `artifact-db` binding name, Drizzle generation parity, Wrangler types check, and Worker dry-run all passed.
- Added a regression test and escaping for reflected `returnTo` data embedded in the login page's inline script.
- A local Wrangler run from the prior implementation pass exercised signup/email verification, personal-team provisioning, API-token refresh/revocation, device approval/polling, and authenticated upload/read; those D1 lifecycle checks are not yet committed as automated tests.
- User created the production D1 database as `artifact-db` and supplied its ID; the Worker binding now contains that ID. Wrangler remains unauthenticated locally, so remote migration is pending. Production readiness also requires configuring Better Auth/JWT/GitHub secrets and email sending, then validating the custom domain. No deployment or remote migration was run.
- Removed the temporary local `.dev.vars`, synthetic D1 identity records, and one test R2 object after stopping the repo's Wrangler process. This local test data is not recoverable; no production data was touched.
- Implementation started after confirming login providers, route paths, team-scoped credentials, and R2 key mapping with the user.
- Recommended refresh policy: rotating refresh credentials, 30-day inactivity expiry, 90-day absolute expiry; existing access JWTs can remain valid up to 7 days after a membership/token revocation.
