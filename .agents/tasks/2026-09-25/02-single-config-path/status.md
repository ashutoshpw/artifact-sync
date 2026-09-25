# Status

- **State:** done
- **Updated:** 2026-09-25

## Notes
- Implementation complete: publishing config removed from config, daemon, auth commands, service units, tests, and docs; artifact root is now the fixed `~/.agents/artifacts/`.
- Full diff reviewed; `service status` now surfaces legacy v1 service settings with a reinstall hint.
- CI-equivalent commands pass: `cargo fmt --all --check`, `cargo test --workspace --locked` (46 tests), `cargo clippy --workspace --all-targets --all-features -- -D warnings`, plus the npm launcher tests.
- `strace` confirms the daemon no longer opens `~/.agents/artifacts/config.json`; a malformed file there no longer aborts startup; `--config` is rejected by the CLI.
- Release note: removing `--config` is breaking, so installed services must rerun `service install`; publishing requires a version bump from 0.1.2.
