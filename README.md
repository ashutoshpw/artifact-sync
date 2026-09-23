# artifact-sync

`artifact-sync` watches a local artifact directory and publishes changed files to a team-scoped artifact gateway. The CLI and daemon are Rust; the Cloudflare Worker and operator token utility use Bun.

Publishing settings live at `~/.agents/artifacts/config.json`:

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

The directory containing that file is watched. The local `config.json` is not uploaded and cannot select the server destination.

Build the CLI with Rust 1.85 or newer:

```sh
cargo build --release -p artifact-sync
```

Authenticate and inspect the active server-side identity:

```sh
artifact-sync login --server https://artifact.w3dev.app
artifact-sync whoami
artifact-sync daemon
```

For headless login, pass the token on standard input with `--token-stdin`; there is intentionally no `--token` argument. See [publisher authentication and operations](docs/authentication.md) for credential storage, environment overrides, logout, token provisioning, and revocation.

Use Bun 1.4.2 for the TypeScript Worker:

```sh
bun install
bun run test:gateway
bun run check:gateway
```

Artifact publishing credentials are team-scoped. Cloudflare administrative credentials and parent R2 credentials are only configured on the Worker/operator side; running the CLI requires neither.
