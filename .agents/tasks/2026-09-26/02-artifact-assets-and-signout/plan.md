# Fix published artifact assets and dashboard sign-out

**Date:** 2026-09-26
**Task:** 02-artifact-assets-and-signout

## Objective
Use the supplied HAR to fix authenticated published artifact subresources and restore dashboard sign-out. Push the focused changes to `origin/main` and confirm the GitHub Actions production deployment completes.

## Context
- HAR request 0 loads `.../index.html` with HTTP 200; its relative `site.css` request gets HTTP 401 with no body.
- The same report also includes a failed external Google Fonts request; verify whether this is a separate browser/network issue.
- The dashboard's sign-out form posts to `/auth/logout`.

## Approach
- Trace artifact embed-token issuance and validation across document and relative asset requests.
- Trace the dashboard logout POST through its handler, CSRF/session behavior, and current tests.
- Make the narrowest fixes, run required non-test checks, then push to `main` and follow the production workflow to completion.

## Steps
- [x] Reproduce the HAR authorization mismatch and diagnose sign-out behavior from source.
- [x] Implement the artifact asset and logout fixes with focused regression coverage where appropriate.
- [x] Review changes and run applicable checks.
- [ ] Commit and push to `origin/main`.
- [ ] Confirm the matching GitHub Actions deployment and report when retesting is ready.

## Acceptance criteria
- Relative helper assets for a published artifact load under the same access conditions as its HTML document.
- Dashboard sign-out invalidates the browser session and returns the user to a signed-out page.
- The `origin/main` commit's production deployment succeeds, or the blocking failed workflow step is reported precisely.

## References
- User-provided `artifact-w3dev-app.har` attachment — request statuses and initiators.
