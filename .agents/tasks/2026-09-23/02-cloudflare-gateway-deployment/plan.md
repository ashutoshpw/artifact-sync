# Cloudflare Gateway Deployment

**Date:** 2026-09-23
**Task:** 02-cloudflare-gateway-deployment

## Objective
Deploy the artifact-sync gateway Worker from GitHub Actions to Cloudflare at `artifact.w3dev.app`.

## Context
The gateway uses Bun and Wrangler; `models.dev` provides a reference workflow for serialized, repository-guarded Cloudflare deployments. Keep Worker runtime secrets in Cloudflare.

## Approach
Add PR verification and main-only production deployment with Cloudflare's Wrangler Action, exact account/domain config, and deployment runbook updates.

## Steps
- [x] Add Bun-based workflow with verification, guarded deployment, and serialized production runs.
- [x] Configure the `artifact.w3dev.app` custom domain and account-ID injection.
- [x] Document GitHub/Cloudflare prerequisites, smoke test, and rollback.
- [x] Run gateway tests, typecheck, Wrangler dry-run, and workflow validation.

## Acceptance criteria
- [x] PRs and non-main dispatches cannot deploy; forks cannot access deployment credentials.
- [x] Main deploy uses locked Bun/Wrangler versions and does not pass Worker runtime secrets through GitHub.
- [x] Wrangler dry-run validates the custom-domain config; docs show the selected production origin.

## References
- `models.dev/.github/workflows/deploy.yml` — deployment trigger and repository-guard reference.
- Cloudflare Workers GitHub Actions and Custom Domains documentation.
