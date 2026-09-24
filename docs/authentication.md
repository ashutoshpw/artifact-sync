# Accounts, team credentials, and artifact access

Artifact Sync uses Better Auth for web accounts and team-scoped API/device credentials for the CLI. It does not issue Cloudflare credentials to clients. The Worker uses D1 for accounts, sessions, teams, memberships, and refresh-token state, and uses its private R2 binding for all artifact operations.

## Account and team model

Users can sign up with email/password or GitHub at `https://artifact.w3dev.app/auth/login`. Email/password accounts must verify their email before publishing access is provisioned. A verified new account receives a personal team and an `admin` membership. The membership schema supports users belonging to multiple teams, but invitations and joining an additional team are not part of v1.

The API-token page is `https://artifact.w3dev.app/settings/api-tokens`. Each API token or authorized device is associated with exactly one user and one team. The server issues its team ID and permissions; the CLI's `team` setting is checked against that identity, never used as proof of access.

## API and device credential lifetime

The settings page displays a newly created `as_api_…` API token once. Store it as a secret. It is a refresh credential, not a Cloudflare key or an R2 key. `artifact-sync login --token-stdin` exchanges it for a signed access JWT and a rotating refresh credential. Interactive CLI login uses device authorization at `/auth/device`: approve the displayed short code in the browser and select the single team for that device. Device codes expire after 10 minutes and the CLI polls every 3 seconds by default.

The Worker signs access JWTs with `JWT_SECRET`; the CLI receives a seven-day access token. Protected artifact requests verify that JWT locally in the Worker and do not query D1 for each file. Refresh credentials are stored server-side only as SHA-256 hashes, rotate on refresh, expire after 30 days without refresh, and have a 90-day absolute lifetime. Refresh and revocation use D1.

Because access JWT verification is stateless, revoking an API/device token blocks future refreshes immediately but does not invalidate access JWTs already issued. Those JWTs can remain usable for up to seven days, including for upload/read requests. This is the deliberate v1 tradeoff for avoiding a database or other service lookup on every artifact operation; it is not instant revocation.

## CLI and watched directory

Optional publishing configuration lives at `~/.agents/artifacts/config.json`:

```json
{
  "team": "w3dev",
  "sync": {
    "debounceMs": 750,
    "maxConcurrentUploads": 2,
    "auditIntervalSeconds": 0
  }
}
```

The directory containing the selected publishing config is the artifact root. If the default publishing config is absent, the daemon creates and watches `~/.agents/artifacts/` with default sync settings. In that case, the team comes from the authenticated credential; a saved identity cache may select the expected team, but the gateway must validate the credential and confirm that team before uploads are enabled. If a publishing config exists, its team is checked against the server-validated identity and its sync settings are applied. The daemon recursively reconciles existing files at startup and watches the root. New and modified files are queued after the configured debounce period. A changed file is re-read before upload so a newer edit is not marked complete using stale bytes. The publishing config, auth config, symlinks, and `.artifact-sync` state are excluded. Deleting a local file does not delete an R2 object.

The Worker receives the file bytes and relative path over the authenticated gateway request, then derives the key as:

```text
uploads/<authenticated-team-id>/artifacts/<relative-path>
```

The client cannot supply a team ID or full R2 key. The Worker's R2 binding keeps the bucket private; no temporary R2 credentials, account credentials, or parent R2 credentials are sent to the client. The Workbench serves objects through `https://artifact.w3dev.app/<team-slug>/<relative-path>` only to an authenticated browser session or a valid team-scoped JWT with `artifacts:read`. The Worker resolves the slug to its team ID and reads only that team's prefix.

## CLI login and credential storage

Interactive login starts browser/device authorization and never asks the publisher to type a long-lived secret into a terminal:

```sh
artifact-sync login --server https://artifact.w3dev.app
```

For a one-time API token exchange in a headless environment, read the token from a protected secret source into standard input. Do not put it in shell arguments:

```sh
secret-manager read artifact-sync/api-token | artifact-sync login \
  --server https://artifact.w3dev.app --token-stdin
```

There is intentionally no `--token <secret>` option. Login validates the exchange with `GET /__api/v1/auth/me`, checks the configured publishing team if a publishing config exists, and only then atomically saves the new credential. A failed login leaves an existing credential unchanged. Login does not start the watcher, upload files, change the configured team, or rebind sync state.

Saved authentication is separate from publishing configuration and has this shape at `~/.config/artifact-sync/config.json` on macOS and Linux:

```json
{
  "version": 1,
  "serverUrl": "https://artifact.w3dev.app",
  "auth": {
    "type": "team_token",
    "accessToken": "<seven-day JWT; illustrative only>",
    "refreshToken": "<rotating refresh credential; illustrative only>",
    "tokenId": "api_<server-issued-id>",
    "expiresAt": "<server-issued expiry>",
    "cachedIdentity": {
      "userId": "<server-issued user ID>",
      "email": "<server-verified email>",
      "name": "<server-issued display name>",
      "teamId": "<server-issued team ID>",
      "team": "w3dev",
      "permissions": ["artifacts:publish", "artifacts:read"]
    }
  }
}
```

The identity/expiry cache is informational; the gateway is authoritative. Artifact-local configuration never chooses the destination of a saved credential. Use `--auth-config PATH` or `ARTIFACT_SYNC_AUTH_CONFIG` to select another auth file; these are distinct from publishing `--config PATH`. A credential file located inside the watched artifact root is rejected.

Credential precedence is:

1. `ARTIFACTS_PUBLISH_TOKEN`, if explicitly configured.
2. The selected auth configuration file.

An environment API token or access JWT is never written to disk implicitly. Environment credentials also require an explicit `ARTIFACT_SYNC_SERVER_URL`; there is no fallback to the auth file's server. A saved credential is bound to its normalized server origin. Changing `--server` requires a new explicit login. Production requires HTTPS and certificate verification. HTTP is accepted only for loopback development when `ARTIFACT_SYNC_ALLOW_INSECURE_HTTP=1` is set.

`artifact-sync whoami` validates the active credential against that server and displays its origin, user/publisher identity, team, permissions, expiry, and source (`auth file` or `environment`). An unreachable server is reported as unverified, not as a freshly verified cached identity. Authentication redirects are not followed; the publisher Authorization header is never sent to R2 or an artifact-content URL.

`artifact-sync logout` removes the locally stored credential while preserving unrelated settings and sync state, then notifies a running daemon to clear its in-memory tokens, cancel uploads best-effort, and leave pending work queued. Local logout is not server-side revocation. Revoke a credential from `/settings/api-tokens`; already-issued JWTs can remain valid until their seven-day expiry. If `ARTIFACTS_PUBLISH_TOKEN` is configured in the parent shell or service, logout cannot remove it and reports that it remains active.

On macOS/Linux the application auth directory is created with mode `0700`, and auth/temporary files with mode `0600` before secret bytes are written. The store validates ownership and permissions, rejects symlinked credential files/path components, locks updates, and atomically replaces the file inside the protected directory. It leaves no credential-bearing backups. V1 JSON storage is plaintext protected by filesystem access controls: it does not protect against another process running as the same user or a compromised account. The credential store is isolated from watcher/upload logic so a future OS keychain backend can replace it.

## Identity and storage implementation

Better Auth stores user, account, browser session, and email-verification records in D1 through Drizzle. Application tables store teams, memberships, hashed API refresh credentials, and hashed pending device codes. API-token management and credential refresh use the D1 binding. Access JWT verification uses only the Worker's `JWT_SECRET` and the signed claims (user, team ID/slug, permissions, token ID, issuer, audience, and expiry).

The Worker requires `artifacts:publish` for upload and `artifacts:read` for list/read. The authenticated team ID is the sole prefix source. The gateway does not grant deletion or bucket administration to clients. Authentication, refresh, token, device, and artifact responses use `Cache-Control: no-store` (artifact bytes are private/no-store). Authorization headers are not logged or forwarded to storage.

## Bun development and database migrations

Use Bun for the Worker, Drizzle Kit, and Wrangler commands:

```sh
bun install --frozen-lockfile
bun run test:gateway
bun run check:gateway
bunx wrangler types apps/gateway/worker-configuration.d.ts --config apps/gateway/wrangler.jsonc
```

The schema source is `apps/gateway/src/db/schema.ts`; review generated SQL before applying a migration. Apply locally during development with `bun run --cwd apps/gateway db:migrate:local`. Apply production migrations explicitly before deploying code that requires them with `bun run --cwd apps/gateway db:migrate:remote`. The production D1 database must exist and its ID must replace the placeholder in `apps/gateway/wrangler.jsonc` first.

## Cloudflare setup and deployment

The production Worker is `artifact-sync-gateway` on the dedicated custom domain `artifact.w3dev.app`. Its R2 binding targets the private `artifact-sync` bucket. GitHub Actions deploys on pushes to `main` and manual dispatches from `main`; pull requests verify but do not deploy.

Before the first production deployment:

1. Create the D1 database named `artifact-db`, put its ID in `apps/gateway/wrangler.jsonc`, and apply the checked-in migration with `bun run --cwd apps/gateway db:migrate:remote`.
2. Confirm the `artifact-sync` R2 bucket and active `w3dev.app` zone exist in the Cloudflare account. The worker custom domain requires `artifact.w3dev.app` to be available and routed to this Worker.
3. Configure Worker secrets using Wrangler (the prompts read values without placing them in shell history): `BETTER_AUTH_SECRET`, `JWT_SECRET` (each a unique random secret of at least 32 bytes), `GITHUB_CLIENT_ID`, and `GITHUB_CLIENT_SECRET`. Set the GitHub OAuth callback URL to `https://artifact.w3dev.app/__api/auth/callback/github`.
4. Enable Cloudflare Email sending and verify the `artifact.w3dev.app` sender domain used by `AUTH_EMAIL_FROM`, so signup verification and password-reset emails can be delivered.
5. In GitHub repository settings, set secret `CLOUDFLARE_API_TOKEN` with the narrow Worker deployment/custom-domain permissions needed, and repository variable `CLOUDFLARE_ACCOUNT_ID` for the account owning the zone, Worker, D1 database, and R2 bucket.

The GitHub deployment workflow does not upload application secrets or credentials. No publisher-token registry, R2 parent secret, or client-side Cloudflare credential is used. Running artifact-sync requires no Cloudflare administrative access.

After deployment, an unauthenticated probe should return 401 and no-store headers:

```sh
curl -sS -D - -o /dev/null https://artifact.w3dev.app/__api/v1/auth/me
```

That probe verifies the route is live, not that signup email delivery, GitHub OAuth, or authenticated artifact access works. Those require their configured provider/service and a real account. Local tests/builds are not deployment proof.
