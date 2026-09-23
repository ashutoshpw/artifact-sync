# Status

- **State:** in-progress
- **Updated:** 2026-09-23

## Notes
- Deployment code and workflow are implemented locally; `main` is one commit ahead of `origin/main` (`989c7b5`).
- User reports the R2 bucket and bucket-scoped R2 token are ready and GitHub deploy settings are configured.
- Worker runtime secrets, deployment, and live publisher authentication remain to be completed.
- Publisher token selection is `w3dev-workstation` with a 90-day expiry; keep the raw token out of chat, command arguments, and logs, and pass it directly to the CLI through stdin after deployment.
- Issued token ID `pub_CnK06R-sUTH2Te_s` for team `w3dev`, permission `artifacts:publish`, expiring `2026-12-22T17:35:21Z`; ignored registry file is mode `0600` and contains only the cryptographic hash and metadata. Raw token is held only in the active session for later stdin login.
- GitHub Actions settings were verified read-only: `CLOUDFLARE_API_TOKEN` secret and `CLOUDFLARE_ACCOUNT_ID` variable are present. This local Wrangler environment is not authenticated, so Worker runtime secrets must be entered in the dashboard or after the user authenticates Wrangler.
- `artifact.w3dev.app` currently does not resolve; the deployment workflow is not yet on GitHub's default branch because local `main` is one commit ahead. This is expected before the Worker custom domain is provisioned.
