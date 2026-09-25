# Investigate mutation Forbidden responses

**Date:** 2026-09-25
**Task:** 01-mutation-forbidden-review

## Objective
Determine why all authenticated dashboard mutations, including slug changes and device approval, return `Forbidden`, and identify a safe remediation that preserves CSRF protection.

## Context
- Dashboard mutation routes share `sameOrigin()` in `apps/gateway/src/web/dashboard-routes.tsx`.
- Slug authorization independently requires an `owner` membership, but that cannot explain device-approval failures.
- The local working tree contains unrelated user changes in `apps/agent/src/main.rs`; do not modify, stage, or discard them.

## Approach
- Trace every POST route, cookie forwarding, session lookup, and role check.
- Compare deployed responses for matching, missing, opaque, and alternate `Origin` values without using credentials.
- Use the symptom pattern and response bodies to distinguish origin rejection from authentication or authorization failures.
- Add a session-bound synchronizer token to dashboard forms and accept it only for `Origin: null`; keep all non-null foreign origins rejected.
- Preserve the existing session, ownership, and same-origin checks.

## Steps
- [x] Map all mutation routes and shared guards.
- [x] Reproduce deployed responses with controlled headers.
- [x] Check current deployment and local/recent code drift.
- [x] Document root cause and safe remediation options.
- [x] Report findings and verification evidence.
- [x] Add the session-bound token helper and dashboard session field.
- [x] Add hidden fields and guarded validation to every browser mutation form.
- [x] Add regression tests for opaque, matching, missing, and foreign origins.
- [x] Run gateway tests, typecheck, and available lint checks.
- [x] Commit only the intended changes and push `main`.

## Acceptance criteria
- [x] The source of the plain-text `Forbidden` response is identified.
- [x] The role/session hypotheses are separated from the common failure path.
- [x] No unrelated local changes are modified or staged.
- [x] `Origin: null` succeeds only with the current session's CSRF token.
- [x] Foreign non-null origins remain rejected even with a valid token.
- [x] Existing same-origin behavior and authorization checks remain intact.
- [x] Gateway tests, typecheck, and available lint checks pass.
