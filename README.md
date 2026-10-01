# artifact-sync

`artifact-sync` watches a local artifact directory and publishes changed files to a team-scoped artifact gateway. The CLI and daemon are Rust; the Cloudflare Worker and Drizzle migrations use Bun.

The daemon creates and watches `~/.agents/artifacts/` as the artifact root. Every immediate child directory is one artifact, named by its exact lowercase URL-safe folder name; files and nested folders inside it stay together. Empty folders, invalid slug names, and loose files directly under the root are not uploaded. The team comes from the server-validated credential; no local file can select the server destination. The only configuration file is the authentication config at `~/.config/artifact-sync/config.json`, and the artifact root never contains daemon configuration.

Install the prebuilt CLI on Linux x64 (glibc) or Windows x64 with Node.js 18 or newer:

```sh
npm install --global artifact-sync
```

Or build the CLI with Rust 1.88 or newer (Windows builds also require the Visual Studio C++ build tools and Windows SDK):

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

## Service mode

To run the watcher under the current user's service manager instead of keeping a terminal open:

```sh
artifact-sync service install
artifact-sync service status
artifact-sync service stop
artifact-sync service start
artifact-sync service uninstall
```

Service management uses macOS `launchd` or Linux `systemd --user`, requires no root access, and never captures environment tokens. Install after logging in; it may reconcile and upload existing artifacts, so interactive installs ask first and headless installs with existing files require `--yes`. See the authentication guide for lifecycle, status, and Linux session behavior.

## Windows

On Windows x64, run `artifact-sync daemon` in a PowerShell or Command Prompt terminal after logging in. In another terminal, inspect it or stop it gracefully:

```powershell
artifact-sync daemon --status
artifact-sync daemon --stop
```

Ctrl+C also stops the foreground daemon. Restart it with `artifact-sync daemon`; credentials and pending uploads survive shutdown. Automatic Windows service installation is not supported. Windows arm64 and macOS npm binaries are not included.

Windows paths are `%USERPROFILE%\.agents\artifacts` for artifacts, `%USERPROFILE%\.config\artifact-sync\config.json` for credentials, and `%USERPROFILE%\.local\state\artifact-sync\state.sqlite3` for pending sync state. Use a local filesystem that supports Windows ACLs (such as NTFS). Private storage is owned by the current user and grants access only to that user; credential paths containing reparse points (including junctions) are rejected. Daemon control uses a local named pipe restricted to the current user. See [authentication](docs/authentication.md) for storage and credential details.

## Dashboard

Open `https://artifact.w3dev.app` after signing in to:

- switch between every team membership and inspect the current role;
- browse artifacts under the selected team, then open an artifact to browse its files;
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

The daemon reconciles every artifact directory at startup, watches the root recursively, and uploads new or modified files after the configured debounce. It preserves queued work across connectivity failures. R2 objects use `uploads/<authenticated-team-id>/artifacts/<artifact-slug>/<path-inside-artifact>`; the Worker derives the team prefix from the authenticated identity. API/device credentials are limited to one team. Cloudflare administrative and R2 credentials remain server-side; running the CLI requires neither.
