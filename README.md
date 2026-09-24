# artifact-sync

`artifact-sync` watches a local artifact directory and publishes changed files to a team-scoped artifact gateway. The CLI and daemon are Rust; the Cloudflare Worker and Drizzle migrations use Bun.

Optional publishing settings live at `~/.agents/artifacts/config.json`:

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

The directory containing that file is watched. If the file is absent, the daemon creates and watches `~/.agents/artifacts/`, uses default sync settings, and takes the team from the server-validated credential. When present, the file's team must match the credential. The local `config.json` is not uploaded and cannot select the server destination.

Build the CLI with Rust 1.85 or newer:

```sh
cargo build --release -p artifact-sync
```

Sign in through browser device authorization, inspect the active identity, and start the watcher:

```sh
artifact-sync login --server https://artifact.w3dev.app
artifact-sync whoami
artifact-sync daemon
```

For headless login, pass a team API token on standard input with `--token-stdin`; there is intentionally no `--token` argument. See [accounts and artifact access](docs/authentication.md) for account setup, team-scoped credentials, credential storage, environment overrides, logout, and revocation.

## Dashboard

Open `https://artifact.w3dev.app` after signing in to:

- switch between every team membership and inspect the current role;
- browse every artifact published under the selected team with cursor pagination and path-prefix filtering;
- connect CLI devices and view active personal or team-wide devices;
- create one-time team-scoped API tokens and revoke credentials;
- change an owned team slug while preserving permanent redirects from previous artifact URLs.

The non-secret `DASHBOARD_LAYOUT` Worker variable selects `sidebar` or `topnav`; invalid or missing values default to `sidebar`. Both variants use the same routes, permissions, and responsive navigation.

Use Bun 1.4.2 for the TypeScript Worker:

```sh
bun install
bun run test:gateway
bun run check:gateway
```

The daemon recursively reconciles the configured artifact directory at startup and uploads new or modified files after the configured debounce. It preserves queued work across connectivity failures. The Worker derives each R2 object key from the authenticated team identity; API/device credentials are limited to one team. Cloudflare administrative and R2 credentials remain server-side; running the CLI requires neither.
