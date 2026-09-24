# Publish the artifact-sync CLI to npm

**Date:** 2026-09-24
**Task:** 02-publish-npm-cli

## Objective
Publish the Rust CLI as the public unscoped npm package `artifact-sync`, so users can install and run `artifact-sync` without installing Rust or a separate system binary.

## Context
- The monorepo root `package.json` is private and contains the Bun gateway workspace; it must not be published as the CLI package.
- The executable is the Rust package `artifact-sync` in `apps/agent/Cargo.toml`, currently version `0.1.1`.
- The existing `deploy.yml` workflow deploys the gateway and does not build or publish the Rust CLI.
- The current agent uses Unix-only filesystem, locking, socket, and signal APIs. The first release will support Linux x64 with glibc; macOS and Windows support are deferred, with Windows tracked separately in [#1](https://github.com/ashutoshpw/artifact-sync/issues/1).
- The working tree contains unrelated gateway changes; implementation must stage only the packaging, documentation, and release-workflow files.

## Decisions
- Use the unscoped npm package name `artifact-sync`; verify that the name is available and that the publishing account owns it before releasing. Do not introduce an npm scope.
- Keep the root package private and create a separate `packages/artifact-sync` package rather than adding a duplicate package name to the Bun workspace.
- Ship a single npm package containing a prebuilt Linux x64 binary for the first release. This keeps installation and release automation simple; additional platform packages can be introduced when their build toolchains are available.
- Support Linux x64 with glibc only. Reject macOS, Linux arm64, and Windows at the npm package boundary until tested binaries are added.
- Keep the npm version aligned with the Rust package version and gate `main` publishing on a new, unpublished version.
- Use npm Trusted Publishing with provenance where available; do not add an install-time download or compilation script.

## Approach
1. Add a dependency-free Node.js launcher that maps the host platform and architecture to a bundled Rust executable, forwards stdin/stdout/stderr, arguments, signals, and exit status, and emits a clear unsupported-platform error.
2. Build release binaries in a GitHub Actions matrix, stage them outside the source tree with executable permissions, and create a package tarball containing the launcher, binaries, README, and license.
3. Add a separate publishing workflow triggered by pushes to `main` and manual runs. A single publish job will wait for every matrix build, run package and smoke tests, and publish only if the package version is not already present on npm.
4. Verify the packed tarball from a clean temporary install before publication and publish with `--provenance --access public`.

## Planned files
- `packages/artifact-sync/package.json` — public package metadata, `bin`, `files`, `repository`, `license`, `engines`, and `publishConfig`.
- `packages/artifact-sync/bin/artifact-sync.js` — platform-selecting Node.js launcher.
- `packages/artifact-sync/README.md` — npm installation and CLI usage documentation.
- `packages/artifact-sync/test/launcher.test.mjs` — launcher argument, stdio, platform, and exit-status coverage.
- `scripts/prepare-npm-package.mjs` — build-artifact staging, permission handling, version checks, and package validation.
- `.github/workflows/publish-npm.yml` — Rust build matrix, package smoke tests, version gate, and npm publication.
- `LICENSE` — MIT license text matching the Rust package metadata.
- `.gitignore` — ignore generated package staging and release artifacts.

## Steps
- [ ] Confirm the publishing account can reserve the unscoped name `artifact-sync` on npm.
- [x] Add the package manifest, launcher, README, license, and launcher tests.
- [x] Add the staging script and verify it rejects missing, mismatched, or unverified release binaries.
- [x] Add the Linux x64 target matrix using the Rust 1.88 toolchain and locked Cargo dependencies.
- [x] Add the main-branch workflow with least-privilege permissions, npm authentication, provenance, and a duplicate-version no-op.
- [x] Run `npm pack --dry-run` and inspect the tarball contents for the wrapper, all supported binaries, README, and license only.
- [x] Install the packed tarball in a clean temporary directory and verify `artifact-sync --version` plus argument and stdin forwarding.
- [ ] Push a versioned release to `main`, confirm publication, then push again without a version change and confirm the workflow safely skips publication.
- [x] Update the plan status with implementation and verification results; publication remains pending.

## Acceptance criteria
- [x] A clean npm install from the packed tarball exposes the `artifact-sync` command on the supported Linux x64 target.
- [x] Installation does not require Rust, a compiler, network access, or a `postinstall` script.
- [x] The launcher forwards CLI arguments, stdin, output, errors, signals, and exit status correctly.
- [x] Unsupported platforms fail with an actionable message and no unusable binary is advertised.
- [x] The package version matches the Rust release version and the workflow never overwrites an existing npm version.
- [ ] The workflow runs only for the intended repository/main ref, uses npm trusted publishing or a protected secret, and publishes provenance.
- [x] The packed tarball contains no source secrets, build intermediates, or unrelated gateway files.

## Status
- Package sources, launcher tests, staging validation, Rust tests, gateway tests, typecheck, and local tarball installation are complete.
- The initial `0.1.0` package is published and contains the service command; the npm README now documents service mode for the `0.1.1` release.
- The first release remains intentionally limited to Linux x64; the `0.1.1` package is staged and locally verified at `dist/npm/artifact-sync`.
- Trusted Publishing configuration, commit, push, and `0.1.1` publication remain pending.

## Out of scope
- macOS and Linux arm64 npm binaries for the first release.
- Windows compilation or Windows npm binaries; see [#1](https://github.com/ashutoshpw/artifact-sync/issues/1).
- Publishing the Bun gateway package or changing its deployment workflow.
- Splitting the first release into platform-specific optional npm packages.

## References
- [Windows support issue #1](https://github.com/ashutoshpw/artifact-sync/issues/1) — deferred Windows compatibility work.
- `package.json:2-5` — private monorepo root and Bun workspace.
- `apps/agent/Cargo.toml:1-10` — Rust package and executable definition.
- `apps/agent/src/daemon.rs:15`, `apps/agent/src/state.rs:4`, and `apps/agent/src/auth/store.rs:6-8` — current Unix-only implementation boundaries.
