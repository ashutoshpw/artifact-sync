# artifact-sync

`artifact-sync` watches a local artifact directory and publishes changed files to a team-scoped artifact gateway. The CLI and daemon are Rust; the Cloudflare Worker and Drizzle migrations use Bun.

## Install

Install the published CLI globally with npm:

```sh
npm install --global artifact-sync
```

The package contains a prebuilt Linux x64 binary and does not require Rust or a compiler at install time.

## Usage

Sign in through browser device authorization, inspect the active identity, and start the watcher:

```sh
artifact-sync login --server https://artifact.w3dev.app
artifact-sync whoami
artifact-sync daemon
```

For headless login, pass a team API token on standard input with `--token-stdin`; there is intentionally no `--token` argument.

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

## Service mode

After signing in, run the watcher as a per-user service:

```sh
artifact-sync service install
artifact-sync service status
artifact-sync service start
artifact-sync service stop
artifact-sync service uninstall
```

The npm package currently supports Linux x64 and uses `systemd --user`; it does not require root access. Add `--yes` to `service install` or `service start` when existing artifacts may upload non-interactively. Uninstalling preserves credentials and sync state.

## Supported platforms

The initial npm release supports Linux x64 with glibc. macOS, Linux arm64, and Windows support are not included in this first release. Windows support is tracked in [issue #1](https://github.com/ashutoshpw/artifact-sync/issues/1).
