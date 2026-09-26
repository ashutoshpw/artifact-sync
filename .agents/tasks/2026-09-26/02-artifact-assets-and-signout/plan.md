# Fix published artifact assets and dashboard sign-out

**Date:** 2026-09-26
**Task:** 02-artifact-assets-and-signout

## Objective
Use the supplied HAR to fix authenticated published artifact subresources and restore dashboard sign-out. Push the focused changes to `origin/main` and confirm the GitHub Actions production deployment completes.

## Context
- HAR request 0 loads `.../index.html` with HTTP 200; its relative `site.css` request gets HTTP 401 with no body.
- The same report also includes a failed external Google Fonts request; verify whether this is a separate browser/network issue.
- The dashboard's sign-out form posts to `/auth/logout`.
- Follow-up report: `/ashutosh-kumar-yaaawkla/w3dev-us-design-proposal/schemes/01-editorial/index.html` loads under a session, but linked `site.css` gets HTTP 401 without a query token.

## Approach
- Trace artifact embed-token issuance and validation across document and relative asset requests.
- Trace the dashboard logout POST through its handler, CSRF/session behavior, and current tests.
- Make the narrowest fixes, run required non-test checks, then push to `main` and follow the production workflow to completion.

## Steps
- [x] Reproduce the HAR authorization mismatch and diagnose sign-out behavior from source.
- [x] Implement the artifact asset and logout fixes with focused regression coverage where appropriate.
- [x] Review changes and run applicable checks.
- [x] Commit and push to `origin/main`.
- [x] Confirm the matching GitHub Actions deployment and report when retesting is ready.
- [x] Add an artifact-scoped resource token for session-authenticated artifact pages that do not have an explicit `?token=`.
- [x] Deploy the follow-up and report retest readiness.

## Acceptance criteria
- [x] Relative helper assets for a published artifact load under the same access conditions as its HTML document.
- [x] Dashboard sign-out invalidates the browser session and returns the user to a signed-out page.
- [x] A resource token minted without an explicit share URL authenticates same-artifact CSS and cannot access a sibling artifact.
- [x] The `origin/main` commit's production deployment succeeds, or the blocking failed workflow step is reported precisely.

## References
- User-provided `artifact-w3dev-app.har` attachment — request statuses and initiators.
