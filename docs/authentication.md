# Publisher authentication and operations

V1 uses team-scoped publisher tokens. It does not add usernames, passwords, OAuth, or a public token-creation API.

## Client configuration

Publishing configuration remains separate from authentication at `~/.agents/artifacts/config.json`:

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

The directory containing this file is the watched artifact root. Keep `team` here; do not add `serverUrl` or a token to this file.

Saved authentication is stored at `~/.config/artifact-sync/config.json` on macOS and Linux. Its shape is:

```json
{
  "version": 1,
  "serverUrl": "https://artifacts.example.com",
  "auth": {
    "type": "publisher_token",
    "token": "<publisher token, shown only as a schema example>",
    "tokenId": "pub_<operator-issued-id>",
    "expiresAt": "<server-issued expiry>"
  }
}
```

The token and expiry above are placeholders, not usable credentials or defaults. The server origin is normalized and saved with the credential. Artifact-local settings never choose the destination for a saved token.

Use `--auth-config PATH` or `ARTIFACT_SYNC_AUTH_CONFIG` to select a different auth file. This is distinct from publishing `--config PATH`. An auth file inside the watched artifact root is rejected.
When running a daemon with a custom auth path, pass the same `--auth-config PATH` to the daemon and the CLI commands that manage that credential.

### Login, identity, and logout

Interactive login resolves and displays the destination, then prompts with terminal echo disabled:

```sh
artifact-sync login --server https://artifacts.example.com
```

For non-interactive login, provide the token on standard input from an approved secret manager or another protected source:

```sh
secret-manager read artifact-sync/publisher-token | artifact-sync login \
  --server https://artifacts.example.com --token-stdin
```

There is intentionally no `--token` option. Login validates `GET /__api/v1/auth/me`, checks the configured publishing team when that file exists, and only then atomically saves the credential. It does not start the daemon, upload artifacts, change the team, or modify sync state. The token is never printed.

`whoami` verifies the active token with the configured server each time; cached identity data is informational only:

```sh
artifact-sync whoami
```

It reports the normalized server origin, publisher ID, authorized team, permissions, expiry, and whether the credential came from the auth file or environment. A network outage is reported as unverified; a cached identity is not presented as freshly authenticated.

Local logout removes the auth-file credential, preserves unrelated settings and sync state, and signals a running daemon to clear its publisher and temporary R2 credentials, cancel uploads best-effort, and retain pending work:

```sh
artifact-sync logout
```

Logout is not server-side revocation. If `ARTIFACTS_PUBLISH_TOKEN` remains set in the parent shell or service configuration, logout reports that it cannot remove that environment value; it takes precedence over the auth file.

### Environment credentials and destinations

Credential precedence is:

1. `ARTIFACTS_PUBLISH_TOKEN`, if set.
2. The selected authentication configuration file.

Environment credentials are never persisted implicitly. They require an explicit destination in `ARTIFACT_SYNC_SERVER_URL`; if it is missing, empty, or invalid, the CLI fails instead of falling back. If `ARTIFACT_SYNC_SERVER_URL` selects an origin different from a saved credential's origin, the saved credential is not reused. Run an explicit `login --server ...` to change destinations.

Production servers must use HTTPS with normal certificate verification. HTTP is accepted only for loopback development when `ARTIFACT_SYNC_ALLOW_INSECURE_HTTP=1` is explicitly set.

### Local credential-file protection

The application auth directory is created with mode `0700` and the auth file and atomic temporary files with mode `0600`. The client checks file ownership and permissions, rejects symlinked credential files and symlinked path components, and serializes updates with a lock. Credential replacement is an atomic rename in the protected directory; no credential-bearing backup is kept.

V1 stores JSON plaintext protected by filesystem access controls. This does not protect credentials from another process running as the same user or from a compromised user account. No Cloudflare administrative or parent R2 credentials are stored on the client. Temporary R2 session credentials are memory-only and are never written to the auth file or sync state. The store boundary is separate from watcher/upload logic so an OS keychain backend can be added later.

## Operator token provisioning

Run the operator-only utility with Bun. Give every device a distinct publisher ID and issue one token per device. The utility uses 32 cryptographically random bytes, associates the token with one team, `artifacts:publish`, and a required expiration, and writes only the SHA-256 token hash and authorization metadata to the local registry. The raw token is printed once for delivery; transfer it to the publisher through an approved secret channel and do not put it in tickets, source control, shell arguments, or logs.

Issue:

```sh
bun run apps/gateway/tools/publisher-tokens.ts issue \
  --registry operator/publisher-token-registry.json \
  --team w3dev \
  --publisher-id laptop-alex-01 \
  --permission artifacts:publish \
  --expires-at 2027-01-31T23:59:59Z
```

The expiry is an operator choice, not a default. The tool refuses to issue a second active token for the same publisher ID; use a distinct ID per device or rotate the existing device token.

Rotate an existing token (the replacement inherits its team and permission):

```sh
bun run apps/gateway/tools/publisher-tokens.ts rotate \
  --registry operator/publisher-token-registry.json \
  --token-id pub_<existing-id> \
  --expires-at 2027-01-31T23:59:59Z
```

Revoke by token ID:

```sh
bun run apps/gateway/tools/publisher-tokens.ts revoke \
  --registry operator/publisher-token-registry.json \
  --token-id pub_<existing-id>
```

The utility updates a local registry only. To activate issue, rotation, or revocation, upload the complete updated registry as the Worker secret from the repository root:

```sh
bunx wrangler secret put ARTIFACT_SYNC_PUBLISHER_TOKEN_REGISTRY \
  --config apps/gateway/wrangler.jsonc \
  < operator/publisher-token-registry.json

bunx wrangler deployments list \
  --name artifact-sync-gateway \
  --config apps/gateway/wrangler.jsonc
```

`wrangler secret put` creates and deploys a Worker version immediately. Confirm the updated deployment is active before telling a publisher that rotation or revocation is effective. A local registry edit, successful command invocation, or queued deployment alone is not proof that the server is enforcing it.

The daemon has no registry-management capability. Only an operator with Cloudflare administrative access can update the Worker secret. Someone merely running `artifact-sync` needs no Cloudflare account credentials.

## Gateway authorization and temporary R2 sessions

The Worker validates each token against the active registry on both `GET /__api/v1/auth/me` and `POST /__api/v1/uploads/credentials`. It enforces expiration, revocation, and `artifacts:publish`; the authorized team is read from registry metadata. A requested upload team must exactly match that team. The client-supplied team is never proof of authorization.

Authentication and temporary-credential responses use `Cache-Control: no-store`. Missing, invalid, expired, or revoked credentials return 401; an authenticated publisher without the required permission or team returns 403. Registry/configuration failure returns a no-store service error, not a misleading invalid-token response. Authentication headers are not logged or forwarded to R2 or artifact-content URLs.

Only the trusted Worker exchanges a validated publisher identity for temporary R2 credentials. Each session lasts 900 seconds (15 minutes), is restricted to `teams/<authorized-team>/artifacts/`, and permits `PutObject` only. No deletion, cross-team access, or bucket administration is delegated. The client caches these credentials in memory and refreshes them when they are within two minutes of expiry. A temporary R2 expiry is treated as a session-refresh condition, not proof that the publisher token is invalid.

Revoking a publisher token prevents new gateway exchanges once the updated registry is active. It does not instantly revoke a previously issued R2 session: that scoped session can remain usable until its 15-minute expiry. A local logout cancels local in-flight work best-effort, but cannot revoke a session already issued to that client.

## Bun Worker development

Use Bun for the TypeScript app and operator utility:

```sh
bun install
bun run test:gateway
bun run check:gateway
bunx wrangler types
```

Configure `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, and an artifact-serving route/domain in `apps/gateway/wrangler.jsonc`. Set `ARTIFACT_SYNC_PUBLISHER_TOKEN_REGISTRY`, `R2_PARENT_ACCESS_KEY_ID`, and `R2_PARENT_SECRET_ACCESS_KEY` as Worker secrets; never add parent R2 credentials to client configuration.
