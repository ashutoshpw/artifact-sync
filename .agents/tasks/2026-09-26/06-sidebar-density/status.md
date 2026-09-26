# Status

- **State:** ready-to-deploy
- **Updated:** 2026-09-26

## Notes
- Root cause confirmed: theme/account commit changed `.sidebar nav` to `flex:1 1 auto` while leaving grid auto tracks at the default stretch alignment, distributing spare sidebar height across links.
- Proposed minimal fix: add `align-content:start` to `.sidebar nav`, preserving the flexing nav region and bottom account footer.
- Accepted and applied the one-property fix.
- Browser QA passed in both themes at 1280x900 and 390x844: expanded rows are about 38px with 3px gaps, the footer remains at the bottom, the collapsed 64px rail works, Artifacts is the only active route, hover does not persist, and there is no visible overflow or browser error.
- Evidence: `/tmp/artifact-sync-qa-sidebar-fixed-dark-1280x900.png`, `/tmp/artifact-sync-qa-sidebar-fixed-dark-1280x900-hover-projects.png`, `/tmp/artifact-sync-qa-sidebar-fixed-dark-collapsed-1280x900.png`, `/tmp/artifact-sync-qa-sidebar-fixed-dark-mobile-390x844.png`, `/tmp/artifact-sync-qa-sidebar-fixed-light-1280x900.png`, `/tmp/artifact-sync-qa-sidebar-fixed-light-mobile-390x844.png`.
- Local validation passed: 62 tests, 425 assertions, typecheck, and diff validation.
- Deployment verification is pending push and the resulting deploy run.
