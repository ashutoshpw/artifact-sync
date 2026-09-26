# Status

- **State:** done
- **Updated:** 2026-09-26

## Notes
- HAR shows the artifact document returns 200 while its relative `site.css` returns 401; the Google Fonts request is status 0.
- HAR predates the 14:43 and 15:00 embed deployments. Explicit embed URLs now pass their signed token to same-artifact HTML/CSS resource URLs, and the CSP permits the referenced Google Fonts hosts.
- Sign-out lost the trusted `Origin` when proxying to Better Auth, so Better Auth rejected the cookie-authenticated request while the wrapper redirected anyway. The proxy now supplies the configured app origin and reports failures.
- `bun run test:gateway`, `bun run check:gateway`, and `git diff --check` pass.
- Commit `248efa1` is on `origin/main`; GitHub Actions run `36253136216` passed verification, applied D1 migrations, and deployed the production Worker.
- The first deployment's retest path required the artifact detail page's `?token=...`; the follow-up addresses session-authenticated pages with no query token.
- Follow-up: session-authenticated documents without `?token=` now receive artifact-scoped helper tokens, so linked CSS loads when the browser withholds the partitioned cookie.
- Regression coverage exercises the reported team/artifact path, follows its tokenized stylesheet and CSS imports, and confirms the token cannot read a sibling artifact. `bun run test:gateway` (42 tests), `bun run check:gateway`, and `git diff --check` pass.
- Commit `40831a5` is on `origin/main`; GitHub Actions run `36263257848` passed gateway verification, applied D1 migrations, and deployed the production Worker.
- Ready for the user to retest the reported URL while signed in, without adding a query token.
