# Align account menu and settings shell with AIEO reference

**Date:** 2026-09-26
**Task:** 07-account-menu-settings

## Objective
Adapt Artifact Sync’s authenticated account dropdown and user-scoped account settings page to the source-grounded AIEO identity and navigation pattern while keeping Artifact Sync’s existing session, CSRF logout, theme, sidebar, sharing, and project behavior intact.

## Context
AIEO’s reference is implemented in `apps/next-app/src/components/dashboard/sidebar-user-menu.tsx` and `apps/next-app/src/components/account/account-sidebar.tsx`. It uses the canonical identity header with a settings gear, compact icon theme control, separated rows, and supported links for Feedback, Home Page, Changelog, Help, Docs, and Log Out. Its `/account` layout has an account-only sidebar and user-scoped General, Authentication, Tokens, Billing, and Support Cases routes.

Artifact Sync currently has native `AccountMenu` in `apps/gateway/src/web/dashboard.tsx`, with identity/email, Account settings, Connect another device, ThemePicker, and CSRF-protected Sign out. Its account route is only `/account/settings`, and the current page is a read-only Profile plus Appearance layout inside the team dashboard shell. Only routes and capabilities already present in Artifact Sync may be surfaced.

## Approach
Keep the target’s Hono SSR/native disclosure implementation. Refine the account menu structure and icon treatment to match the reference identity header and compact rows, while retaining only supported target destinations. Give `/account/settings` a distinct user-scoped shell/sidebar that does not expose team navigation, and link back to the team dashboard where a team exists. Keep the existing read-only identity and theme controls; do not add unsupported profile mutations, feedback, billing, status, authentication, token, docs, or changelog routes.

## Steps
- [x] Read governing instructions and frontend design guidance in both source contexts.
- [x] Inspect AIEO account menu, account sidebar/layout, routes, and actual supported destinations read-only.
- [x] Inspect Artifact Sync account menu, route boundaries, current settings page, tests, and prior theme/account plan.
- [x] Implement the accepted account dropdown and separate account settings shell.
- [x] Run focused gateway tests, type checks, dry-run deploy, and diff validation; complete the implementation review pass.
- [x] Push the focused change to `origin/main` after review acceptance.

## Acceptance criteria
- [x] Account dropdown has a clear identity header, settings gear/link, compact theme control, separated supported rows, and preserved CSRF sign-out/device access.
- [x] Unsupported AIEO-only destinations are not exposed by Artifact Sync.
- [x] `/account/settings` is user-scoped, visually separated from team/workspace navigation, retains Profile and Appearance content, and works for no-team sessions.
- [x] Existing artifact actions, projects, themes, sidebar, auth, and mobile/topnav flows remain intact.
- [x] Gateway tests/typecheck/diff checks pass and the final pushed SHA is verified.

## References
- AIEO source: `/home/ashutosh/PROJECTS/w3mirror/aieo/apps/next-app/src/components/dashboard/sidebar-user-menu.tsx`
- AIEO source: `/home/ashutosh/PROJECTS/w3mirror/aieo/apps/next-app/src/components/account/account-sidebar.tsx`
- Target source: `apps/gateway/src/web/dashboard.tsx`, `apps/gateway/src/web/dashboard-routes.tsx`
- Prior target plan: `.agents/tasks/2026-09-26/03-dashboard-theme-account/`
- Browser screenshot comparison: explicitly skipped because authenticated credentials were not available; source and server-rendered contract review are the accepted evidence for this task.
