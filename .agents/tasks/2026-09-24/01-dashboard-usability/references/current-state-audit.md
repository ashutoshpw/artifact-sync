# Current-state audit

## Dashboard structure
- The Worker is a manual router, not React/Next: `apps/gateway/src/index.ts:18-63`.
- Public UI consists only of login, API-token settings, and device approval: `apps/gateway/src/web/pages.ts:16-58`.
- `/` and post-login return paths target `/settings/api-tokens`, making credentials the apparent product home: `apps/gateway/src/index.ts:28-30`, `apps/gateway/src/index.ts:59`.
- There is no application shell, team switcher, account menu, artifact browser, responsive navigation, reusable state component, or designed empty/error/loading flow.
- Artifact listing is already available with team, prefix, limit, and cursor inputs: `apps/gateway/src/content/routes.ts:31-60`.

## Session persistence
### Ranked causes
1. **Cookie preservation regression, high confidence but not yet proven end-to-end.** `handleWebAuth()` reconstructs the Better Auth response and headers: `apps/gateway/src/index.ts:65-72`. OAuth commonly emits multiple `Set-Cookie` fields. The implementation and test suite do not prove they survive this path.
2. **Application-level `emailVerified` gate, medium confidence.** Every valid session is treated as anonymous unless the user is verified: `apps/gateway/src/auth/web-session.ts:10-12`. GitHub behavior must be tested and the failure surfaced as verification-required rather than a login loop.
3. **Production configuration drift, medium confidence.** Callback and origin must resolve to `https://artifact.w3dev.app`; secret or origin mismatch can invalidate OAuth/session state. Secret values must remain uninspected.
4. **No web sign-out surface, confirmed.** The UI offers no account lifecycle control.

### Required regression coverage
- Multiple `Set-Cookie` values remain distinct through the auth response wrapper.
- Email sign-in sets a cookie and a later request resolves the same session.
- GitHub-created identities have an explicit verified-email policy.
- Sign-out expires the browser session.
- Session expiry returns a safe local `returnTo` login redirect.
- Production origin/callback configuration is validated without exposing secrets.

## Teams
- `GET /__api/v1/teams` already returns only the current user's memberships with ID, name, slug, and role: `apps/gateway/src/auth/routes.ts:33-47`.
- Teams are only rendered inside token/device form selectors: `apps/gateway/src/web/pages.ts:38-58`.
- Roles are currently only `admin` and `member`: `apps/gateway/src/db/schema.ts:84-92`.
- Basic team visibility needs UI; team-wide management first needs an explicit owner role and authorization contract.

## Connected devices
- Device authorization is transient and becomes an API token named `artifact-sync device`: `apps/gateway/src/auth/routes.ts:209-257`.
- The durable link exists through `device_authorizations.api_token_id`, but device start sends no device metadata: `apps/gateway/src/auth/routes.ts:143-171`, `apps/gateway/src/auth/client.rs:94-108`.
- A device list must use the authorization/token relationship, not infer identity from a display name.
- Current `lastUsedAt` is updated during credential refresh, so the UI should call it “last refreshed” unless upload activity tracking is added.

## Team slugs
- Teams have a unique current slug, but there is no update route or ownership relation: `apps/gateway/src/db/schema.ts:77-92`.
- Existing artifact browser URLs use the team slug: `apps/gateway/src/content/routes.ts:62-85`.
- JWTs embed the current team slug until refresh: `apps/gateway/src/auth/token-service.ts:89-106`.
- A safe rename needs a canonical slug registry containing current and historical slugs, owner-only authorization, 30-day per-team cooldown, collision handling, browser redirects, and bearer-token compatibility by team ID.

## API credentials
- Existing listing and revocation are user-scoped, not team-scoped: `apps/gateway/src/auth/routes.ts:49-140`.
- Any member can create a credential for a team they belong to: `apps/gateway/src/auth/routes.ts:94-100`.
- Secrets are hashed and returned only during creation; GET responses already exclude them: `apps/gateway/src/auth/routes.ts:56-80`, `apps/gateway/src/auth/token-service.ts:56-86`.
- Team views must add owner/admin authorization without changing safe secret handling.

## Existing tooling and gaps
- Commands: `bun run test:gateway`, `bun run check:gateway`; no frontend lint, build, or component-test command: `package.json:5-8`.
- Existing tests cover JWT/content routing and basic page redirects, but not Better Auth sessions, D1-backed teams/tokens/devices, role isolation, cookie persistence, or dashboard behavior: `apps/gateway/test/auth.test.ts:67-216`.
- Plan verification uses `bunx wrangler d1 migrations apply artifact-db --local`, `bunx wrangler deploy --dry-run`, the gateway checks, `cargo fmt --all -- --check`, `cargo test --workspace`, `cargo clippy --workspace --all-targets --all-features -- -D warnings`, and `cargo build --release -p artifact-sync`.
