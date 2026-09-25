# Single config file: drop the publishing config

**Date:** 2026-09-25
**Task:** 02-single-config-path

## Objective
Remove every code path that reads `~/.agents/artifacts/config.json` as configuration. The only config file becomes `~/.config/artifact-sync/config.json` (the auth config), and the daemon watches the fixed artifact root `~/.agents/artifacts/`.

## Context
- A user reported the daemon still reads config from `~/.agents/artifacts/config.json`. That path is the compiled-in default publishing config (`apps/agent/src/config.rs:80`), opened on every daemon start (`apps/agent/src/daemon.rs:102`); an empty/malformed file makes the daemon fail hard.
- `ab79ac5` only made the file optional when missing; the path and its `PublishingConfig` (team + sync settings) remained.
- User direction: remove that config concept entirely; `~/.config/artifact-sync/config.json` is the only config file.
- The artifact directory `~/.agents/artifacts/` stays the default root (dashboard copy depends on it); it is a directory, not a config file.
- Sync settings previously read from the publishing config fall back to built-in defaults; the team always comes from the server-validated credential.

## Approach
- Delete `PublishingConfig`, its loaders, and `resolve_publishing_config_path` from `config.rs`; add `default_artifact_root()` (`~/.agents/artifacts`).
- Remove the global `--config` CLI flag; `daemon`/`service`/`login`/`whoami`/`logout` take the fixed root.
- Daemon: derive `expected_team` from the cached credential only; use default `SyncConfig`; stop special-casing `config.json` in the watch ignore list.
- Service: drop the publishing path from settings and unit definitions; bump saved service settings to version 2 so installed v1 services are asked to reinstall instead of starting an incompatible unit.
- Update integration tests to use the default root under a temp `HOME`, and update README/docs to describe the single config file.

## Steps
- [x] Rewrite `config.rs` without publishing-config code; add `default_artifact_root()`.
- [x] Update `main.rs`, `auth/commands.rs`, `daemon.rs`, `service.rs`, `service/systemd.rs`, `service/launchd.rs`.
- [x] Migrate saved service settings (accept v1, write v2, require reinstall for v1 starts).
- [x] Update `tests/auth_cli.rs` and unit tests; drop publishing-config fixtures.
- [x] Update `README.md`, `packages/artifact-sync/README.md`, `docs/authentication.md`.
- [x] Run `cargo test -p artifact-sync`, `cargo clippy`, `cargo fmt --check`.
- [x] Review the full diff; added a `service status` hint for legacy v1 service settings.

## Acceptance criteria
- [x] `rg 'publishing_config|load_publishing_config|resolve_publishing_config_path|~/.agents/artifacts/config.json' apps/agent` returns no runtime references.
- [x] `artifact-sync --config X daemon` fails as an unknown argument.
- [x] Daemon starts with a temp `HOME`, creates `~/.agents/artifacts`, and does not read any config there (`strace` shows only the auth config open; a malformed `~/.agents/artifacts/config.json` no longer aborts startup).
- [x] Existing credentials, whoami, logout, offline queueing, and uploads still work in integration tests (33 + 3 + 10 tests pass).
- [x] An installed v1 service reports a reinstall requirement rather than launching with the removed flag (covered by `legacy_service_settings_load_for_repair_but_require_reinstall_before_start`).

## References
- `.agents/tasks/2026-09-24/03-user-service-lifecycle/plan.md` — service definitions capture resolved config paths.
- `.agents/tasks/2026-09-23/01-publisher-auth-lifecycle/plan.md` — auth config store at `~/.config/artifact-sync/config.json`.
