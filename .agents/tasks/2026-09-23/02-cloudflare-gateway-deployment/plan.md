# Cloudflare Gateway Deployment

**Date:** 2026-09-23
**Task:** 02-cloudflare-gateway-deployment

## Objective
Deploy the artifact-sync gateway Worker to `https://artifact.w3dev.app`, activate a device-scoped publisher token, and verify that this workstation can authenticate and reuse the CLI safely.

## Context
The gateway uses Bun and Wrangler; `models.dev` provides a reference workflow for serialized, repository-guarded Cloudflare deployments. Keep Worker runtime secrets in Cloudflare.

## Approach
The deployment workflow and application are implemented locally. Finish Cloudflare runtime-secret setup, deploy the current main commit, then validate the public auth path and publisher login without exposing the raw token in chat, command arguments, or logs.

## Steps
- [x] Add Bun-based workflow with verification, guarded deployment, and serialized production runs.
- [x] Configure the `artifact.w3dev.app` custom domain and account-ID injection.
- [x] Document GitHub/Cloudflare prerequisites, smoke test, and rollback.
- [x] Run gateway tests, typecheck, Wrangler dry-run, and workflow validation.
- [x] Confirm publisher-token ID/expiry choice: `w3dev-workstation`, 90 days.
- [x] Issue the publisher token and save only hash/metadata to the ignored local registry.
- [x] Configure all three runtime secrets on Worker `artifact-sync-gateway` (user-confirmed; deployment must still validate them); do not add R2 credentials to GitHub Actions.
- [ ] Push the verified main commit and confirm the GitHub deployment workflow succeeds.
- [ ] Verify `/__api/v1/auth/me` returns `401` with `Cache-Control: no-store` without credentials.
- [ ] Use the raw token over stdin for `artifact-sync login`; verify `whoami` reports the authorized identity/team and test a safe sample upload.

## Acceptance criteria
- [x] PRs and non-main dispatches cannot deploy; forks cannot access deployment credentials.
- [x] Main deploy uses locked Bun/Wrangler versions and does not pass Worker runtime secrets through GitHub.
- [x] Wrangler dry-run validates the custom-domain config; docs show the selected production origin.
- [ ] The deployed Worker is live on `artifact.w3dev.app` with required secrets and R2 bucket binding.
- [ ] The publisher token is stored in the worker registry by hash and in the current user's protected auth file after successful login; no raw token is left in repo files, chat, or logs.
- [ ] Authenticated identity and upload path are verified end-to-end; temporary R2 credentials remain team-prefix scoped and short-lived.

## References
- `models.dev/.github/workflows/deploy.yml` — deployment trigger and repository-guard reference.
- Cloudflare Workers GitHub Actions and Custom Domains documentation.
