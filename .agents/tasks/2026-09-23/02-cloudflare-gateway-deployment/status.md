# Status

- **State:** in-progress
- **Updated:** 2026-09-23

## Notes
- After the user updated the Worker registry secret in the dashboard, `artifact-sync login --server https://artifact.w3dev.app --token-stdin` succeeded. The live identity is publisher `w3dev-workstation`, team `w3dev`, permission `artifacts:publish`, expiring `2026-12-22T17:35:21.957Z`.
- A separate `whoami` process verified the same identity against the live server and reported credential source `auth file`; the environment credential/server overrides were unset for this verification.
- The saved auth directory is mode `0700` and the regular auth file is owner-held mode `0600`. The file matches the v1 auth schema. The raw token was not printed or placed in repo files, command arguments, or output.
- No default publishing config exists, and login did not create one, change a team, start a watcher, or upload an artifact. A live R2 upload smoke test remains pending because uploads are write-only and there is no configured disposable artifact root; request approval before creating a persistent test object.
- GitHub Actions deployment run `35898619658` succeeded for `71741b55f1dcbf938631ccc3ac1c401aec4793df`; `main` matched `origin/main` during verification.
