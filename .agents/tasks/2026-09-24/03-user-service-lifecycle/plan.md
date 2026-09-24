# User-level artifact-sync service lifecycle

**Date:** 2026-09-24
**Task:** 03-user-service-lifecycle

## Objective
Add `artifact-sync service install|status|start|stop|uninstall` for macOS launchd and Linux systemd user services, while preserving the foreground `daemon` command.

## Context
The watcher currently runs only as a foreground process. Its private Unix socket supports auth-change notification but has no status response. The selected saved auth file defaults to `~/.config/artifact-sync/config.json`; installed services must use that file, not capture environment secrets.

## Approach
Use native per-user managers, with no root privileges and no automatic systemd linger. Generate service definitions using the absolute current executable and resolved config paths. The service runner uses saved-file credentials only. Status combines native manager state with local daemon health over the private socket; it never performs auth network requests or reveals secrets.

## Steps
- [x] Add service CLI commands, platform adapters, safe/idempotent definition management, and documented unsupported-manager errors.
- [x] Add file-only daemon credential mode, local status protocol, and pending-work status.
- [x] Preflight auth/service-manager state, refuse to adopt or kill an unmanaged running daemon, and warn/confirm before starting when existing artifacts may upload (`--yes` for noninteractive use).
- [x] Document install, login-start behavior, status, stop, uninstall, executable-path updates, and Linux linger remaining opt-in.

## Acceptance criteria
- [x] Tests cover launchd/systemd definition rendering, path escaping, secret exclusion, atomic/idempotent replacement, unmanaged collisions, PID ownership checks, and non-interactive confirmation errors. The generated systemd unit passes `systemd-analyze verify` when available.
- [x] Status distinguishes manager/process state from publishing ready/offline/paused state, reports pending count while running or stopped, and does not present an offline cached identity as verified.
- [x] `cargo test -p artifact-sync` passes.
- [x] Uninstall only removes managed service definitions/settings; authentication, artifact files, and sync state are left in place.
- [ ] Native install/start/status/stop/uninstall smoke tests on live macOS launchd and Linux systemd user sessions. Not run during implementation to avoid changing the current host's service state; Linux definition syntax was validated with `systemd-analyze`.

## References
- Existing daemon control socket and auth file are implemented under `apps/agent/src/daemon.rs` and `apps/agent/src/auth/`.
