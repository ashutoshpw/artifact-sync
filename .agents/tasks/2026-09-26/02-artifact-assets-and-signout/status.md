# Status

- **State:** in-progress
- **Updated:** 2026-09-26

## Notes
- HAR shows the artifact document returns 200 while its relative `site.css` returns 401; the Google Fonts request is status 0.
- HAR predates the 14:43 and 15:00 embed deployments. Explicit embed URLs now pass their signed token to same-artifact HTML/CSS resource URLs, and the CSP permits the referenced Google Fonts hosts.
- Sign-out lost the trusted `Origin` when proxying to Better Auth, so Better Auth rejected the cookie-authenticated request while the wrapper redirected anyway. The proxy now supplies the configured app origin and reports failures.
- `bun run test:gateway`, `bun run check:gateway`, and `git diff --check` pass.
- Next: commit, push to `origin/main`, and confirm the matching production deploy workflow succeeds.
