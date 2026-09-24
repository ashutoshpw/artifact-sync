# Dashboard overview redesign: recent artifacts first, calmer header, sidebar account menu

**Date:** 2026-09-24
**Task:** 05-dashboard-overview-redesign

## Objective
Make the team overview lead with recent artifacts, reduce the team-name typography one step, and move the account menu from the top-right header to the bottom of the sidebar (sidebar layout), mirroring the aieo account menu pattern.

## Context
- Overview today: PageHeader, 4-up metrics (one is a fake "8+" artifact count built from the 8-item list, `dashboard.tsx:239`), private base URL panel, then "Recent artifacts".
- "Recent artifacts" is not actually recent: R2 `list` returns keys lexicographically and the route feeds the first 8 keys unsorted (`dashboard-routes.tsx:46-48`). No recency query exists.
- The account menu is a native `<details>` in the context bar (`dashboard.tsx:129-146`); outside-click close lives in `dashboardScript`; there is no Escape handling.
- aieo pins an upward-opening account menu at the bottom of its sidebar (`references/aieo-account-menu.md`).
- Constraints to respect: both `DASHBOARD_LAYOUT` variants keep equivalent controls (placement may differ); strict CSP, static assets only; sidebar is hidden at <=820px and mobile uses a fixed bottom nav; no event/activity model; the prior dashboard-usability task marks manual QA as still open.

## Approach
1. **Typography.** `.page-header h1` 32px/620 -> 27px/560 (next values in the existing ramps 44/32/27/24/20 and 850/740/680/670/660/620; below 620 there is no existing weight, so one step is defined as 60). The `<=520px` override 27px -> 24px keeps the cascade one step wide.
2. **Overview order.** PageHeader -> Recent artifacts (primary, directly under the header) -> compact summary metrics (Devices, API credentials, Your role). Delete the `.endpoint-panel` and the unused `origin` prop, and drop the fake "Published artifacts" metric. The copyable base URL moves to Team settings (general), using the request origin instead of the hard-coded `artifact.w3dev.app/`.
3. **Honest recency.** Add `listRecentArtifacts(env, teamId, limit = 8, maxScan = 1000)` in `dashboard-service.ts`: page R2 through `listDashboardArtifacts` (200/page), sort by `uploadedAt` desc with path tiebreak, cap at 5 pages. Rows keep path, size, and uploaded time.
4. **Account menu placement.** Extract `AccountMenu` with a variant; render it in `.sidebar-foot` for sidebar layout and keep a header instance for topnav and mobile. Hide the header instance on desktop sidebar layouts only (`.layout-sidebar .context-actions .account-menu{display:none}` at `min-width:821px`). The sidebar trigger is full width (avatar, name/email, chevron) and the popover opens upward (`bottom:calc(100% + 9px)`). Replace the static sidebar footer text.
5. **Menu behavior.** Keep native `<details>` plus outside-click close; add Escape-to-close, `aria-expanded` sync, and focus return to the summary in `dashboardScript`.

## Steps
- [x] Add `listRecentArtifacts` with a unit test using a fake paged R2 bucket
- [x] Rework `OverviewPage`: remove endpoint panel and `origin`, recent artifacts first, compact metrics (no fake artifact count)
- [x] Add a copyable base URL (request origin) to the Team settings general section
- [x] Apply the h1 type steps in `dashboard-assets.ts`
- [x] Move the account menu into `.sidebar-foot` with responsive visibility and an upward popover
- [x] Extend `dashboardScript` with Escape, `aria-expanded`, and focus return
- [x] Update `dashboard.test.tsx`: overview order, base URL absent, recency sort, menu placement per layout
- [x] Run `bun run test:gateway` and `bun run check:gateway`, commit, push, deploy via GitHub Actions
- [ ] User manual QA of sidebar, topnav, and mobile

## Acceptance criteria
- [ ] Overview shows no base URL panel; the first section after the page header is Recent artifacts, newest first, with uploaded timestamps and the existing "View all artifacts" link
- [ ] Team name renders 27px/560 on desktop and 24px at `<=520px`
- [ ] Sidebar layout: account menu pinned bottom-left, opens upward; Escape and outside click close it; sign-out still posts to `/auth/logout`
- [ ] Topnav and `<=820px`: account menu stays in the header (avatar only on mobile)
- [ ] `bun run test:gateway` and `bun run check:gateway` pass, deploy workflow green, manual QA completed

## References
- [references/dashboard-current-state.md](references/dashboard-current-state.md) - as-is inventory of the overview, typography, account menu, layouts, and tests with file:line refs
- [references/overview-redesign-spec.md](references/overview-redesign-spec.md) - target overview structure, CSS deltas, service helper contract, and test assertions
- [references/aieo-account-menu.md](references/aieo-account-menu.md) - aieo sidebar account menu pattern and its no-React adaptation
