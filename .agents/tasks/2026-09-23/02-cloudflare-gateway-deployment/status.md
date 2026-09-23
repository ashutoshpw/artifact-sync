# Status

- **State:** in-progress
- **Updated:** 2026-09-23

## Notes
- Deployment code and workflow are implemented locally; `main` has two pending commits before this status update (`989c7b5` gateway deploy and `fdabf0f` task tracker).
- User reports the R2 bucket and bucket-scoped R2 token are ready and GitHub deploy settings are configured.
- Worker runtime secrets are user-confirmed; deployment and live publisher authentication remain to be completed.
- Publisher token selection is `w3dev-workstation` with a 90-day expiry; keep the raw token out of chat, command arguments, and logs, and pass it directly to the CLI through stdin after deployment.
- Issued token ID `pub_CnK06R-sUTH2Te_s` for team `w3dev`, permission `artifacts:publish`, expiring `2026-12-22T17:35:21Z`; ignored registry file is mode `0600` and contains only the cryptographic hash and metadata. Raw token is held only in the active session for later stdin login.
- GitHub Actions settings were verified read-only: `CLOUDFLARE_API_TOKEN` secret and `CLOUDFLARE_ACCOUNT_ID` variable are present. Local Wrangler is unauthenticated, so Worker secret presence is user-reported; a successful first deploy will validate the required bindings.
- `artifact.w3dev.app` did not resolve before deployment; the configured Worker custom domain is expected to provision during deploy.
- User confirmed v1 access semantics: any authorized team member can use the gateway after receiving a team-scoped publisher token; self-registration is not required.
- User confirms Worker `artifact-sync-gateway` exists and all three required runtime secrets are set. Deployment has not yet validated them; GitHub Actions will do so on the first real deploy.
