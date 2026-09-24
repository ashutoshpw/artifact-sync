# Enable standalone artifact rendering

**Date:** 2026-09-24
**Task:** 04-artifact-csp

## Objective
Allow published standalone HTML artifacts to render their inline styles, scripts, and data-backed images while retaining sandbox isolation and the gateway's other content protections.

## Context
- `apps/gateway/src/content/routes.ts` currently sends `default-src 'none'; sandbox` for every artifact.
- The `sandbox` directive without `allow-scripts` blocks all scripts, while `default-src 'none'` also blocks inline styles and data images.
- Artifacts are user-controlled HTML on the gateway origin, so scripts must remain in an opaque-origin sandbox and must not receive `allow-same-origin`.

## Approach
- Replace the artifact-only CSP with an explicit allowlist for same-origin assets, inline CSS/JS, and data/blob images.
- Add `sandbox allow-scripts` while preserving `default-src 'none'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, and frame protection.
- Extend the route regression test to lock the required directives and ensure the artifact policy is distinct from the dashboard policy.

## Steps
- [x] Update the artifact response CSP.
- [x] Add assertions for allowed artifact resources and sandbox isolation.
- [x] Run gateway tests and TypeScript checks.
- [x] Review the diff for accidental policy broadening.

## Acceptance criteria
- [x] Inline styles and data/blob images are permitted by the artifact CSP.
- [x] Inline scripts are permitted only with `sandbox allow-scripts`; the policy does not grant `allow-same-origin`.
- [x] Unlisted resource types and the dashboard CSP remain restricted.
- [x] `bun run test:gateway` and `bun run check:gateway` pass.

## References
- [CSP behavior](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP) — directive semantics used for the policy decision.
