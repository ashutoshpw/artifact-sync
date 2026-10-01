# artifact-sync

`artifact-sync` watches a local artifact directory and publishes changed files to a team-scoped artifact gateway. The CLI and daemon are Rust; the Cloudflare Worker and Drizzle migrations use Bun.

## Install

Install the published CLI globally with npm:

```sh
npm install --global artifact-sync
```

The package contains prebuilt Linux x64 (glibc) and Windows x64 binaries and does not require Rust or a compiler at install time. Node.js 18 or newer is required.

## Usage

Sign in through browser device authorization, inspect the active identity, and start the watcher:

```sh
artifact-sync login --server https://artifact.w3dev.app
artifact-sync whoami
artifact-sync daemon
```

For headless login, pass a team API token on standard input with `--token-stdin`; there is intentionally no `--token` argument.

The daemon creates and watches `~/.agents/artifacts/` as the artifact root. Every immediate child directory is one artifact, named by its exact lowercase URL-safe folder name; files and nested folders inside it stay together. Empty folders, invalid slug names, and loose files directly under the root are not uploaded. The team comes from the server-validated credential; no local file can select the server destination. The only configuration file is the authentication config at `~/.config/artifact-sync/config.json`, and the artifact root never contains daemon configuration.

## Service mode

After signing in, run the watcher as a per-user service:

```sh
artifact-sync service install
artifact-sync service status
artifact-sync service start
artifact-sync service stop
artifact-sync service uninstall
```

On Linux, service management uses `systemd --user` and does not require root access. Add `--yes` to `service install` or `service start` when existing artifacts may upload non-interactively. Uninstalling preserves credentials and sync state.

On Windows, keep `artifact-sync daemon` running in a PowerShell or Command Prompt terminal. Use a second terminal to run `artifact-sync daemon --status` or `artifact-sync daemon --stop`. Ctrl+C also stops the daemon. Restarting preserves credentials and reconciles files changed while stopped. Automatic Windows service installation is not supported.

Windows artifacts live in `%USERPROFILE%\.agents\artifacts`, credentials in `%USERPROFILE%\.config\artifact-sync\config.json`, and sync state in `%USERPROFILE%\.local\state\artifact-sync\state.sqlite3`. Credential and state storage requires a filesystem with Windows ACL support (such as NTFS); private storage grants access only to the current user and rejects reparse points in credential paths. Local daemon control uses a named pipe restricted to the current user.

## Supported platforms

The npm release supports Linux x64 with glibc and Windows x64. macOS, Linux arm64, and Windows arm64 binaries are not included. CI builds and tests the CLI on native Linux and Windows runners and installs the actual npm tarball on both platforms before publishing.
