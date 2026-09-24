# Dashboard current state (as-is inventory)

References are to `/home/ashutosh/PROJECTS/ashutoshpw/artifact-sync`.

## Route and rendering

- `GET /dashboard` redirects to the first team: `apps/gateway/src/web/dashboard-routes.tsx:36-41`.
- `GET /dashboard/:teamId` loads data and renders `OverviewPage`: `dashboard-routes.tsx:43-54`.
  - `listDashboardArtifacts(c.env, session.team.id, null, null, 8)` (line 46-48)
  - `dashboardCounts(c.env, session.identity, session.team)` (line 49)
  - `origin={new URL(c.req.url).origin}` (line 50)

## Overview page (`OverviewPage`, `apps/gateway/src/web/dashboard.tsx:209-264`)

Order top to bottom:

1. `PageHeader` with eyebrow "Team overview", title `team.name`, description `Private artifacts and credentials for {team.slug}.` (lines 226-236).
2. Metric grid (lines 238-243): Published artifacts, Connected devices, API credentials, Your role.
   - The artifact metric is approximate: `value={artifacts.length === 8 ? "8+" : String(artifacts.length)}` (line 239).
3. Private artifact base URL panel (lines 245-252): `.endpoint-panel`, `baseUrl = ${origin}/${team.slug}` (line 223), copy button `data-copy-target="artifact-base-url"`.
4. Recent artifacts (lines 254-261): heading + `View all artifacts` link, `ArtifactTable` or `EmptyState`.
   - `artifacts` here is just the first 8 R2 keys, not sorted by upload date.

## Typography

- `.page-header h1` (shared with `.empty-dashboard h1`, `.approval-copy h1`): `font-size:32px; font-weight:620; letter-spacing:-.045em; line-height:1.1` (`dashboard-assets.ts` line 2, single-line stylesheet).
- Mobile `<=520px` override: `.page-header h1{font-size:27px}`.
- Other sizes in the stylesheet: 44, 32, 27, 24, 20, 19, 18, 15, 14, 13, 12, 11, 10, 9, 8.
- Other weights: 850 (brand-mark), 740 (brand), 680 (button), 670 (section h2), 660 (field labels), 620 (h1, metric strong).

## Account menu

- Markup: `AccountMenu` at `dashboard.tsx:129-146`, native `<details class="account-menu">`.
- Placement: `.context-actions` in the top bar, after a `Connect device` quiet link (`dashboard.tsx:83-86`).
- Content: "Signed in as", email, "Connect another device" link, sign-out form posting to `/auth/logout`.
- CSS: `.account-menu>summary` (padding 5px 7px, radius 8px, transparent border); `.account-popover` absolute, `top:calc(100% + 9px)`, `right:0`, width 250px, z-index 50 (`dashboard-assets.ts` line 2).
- Behavior: `<details>` toggle; outside-click close only (`dashboardScript`, `all("details")` listener); no Escape handler; no explicit `aria-expanded`.
- Mobile `<=820px`: `.account-copy` is hidden, so the header trigger collapses to the avatar; `.account-popover{top:54px}`.

## Layouts and sidebar

- `DASHBOARD_LAYOUT=topnav|sidebar`, default sidebar (`dashboard-service.ts:92-94`); `data-layout` on `<html>` and `layout-{layout}` on the frame (`dashboard.tsx:65-76`).
- Sidebar renders only for sidebar layout (`dashboard.tsx:91`), `TopNavigation` only for topnav (line 89); `MobileNavigation` always when a team exists (line 95).
- Sidebar structure (`dashboard.tsx:149-166`): `<aside class="sidebar">` with `<nav>` and a static `.sidebar-foot` ("Team-scoped publishing" / "Private R2 storage").
- Sidebar is a sticky full-height flex column; `.sidebar-foot{margin-top:auto; padding:12px 9px; border-top:1px solid var(--line)}` (`dashboard-assets.ts`).
- `<=820px`: `.sidebar{display:none}`, `.mobile-navigation` becomes a fixed bottom bar with 4 links (`items.slice(0, 4)`), `.brand-name`/`.account-copy`/`.quiet-link` hidden.

## Artifact data

- `listDashboardArtifacts(env, teamId, requestedPrefix, cursor, limit = 50)` (`dashboard-service.ts:111-145`):
  - Root prefix `uploads/${teamId}/artifacts/`; R2 `list({ prefix, cursor, limit: clamp(1..100) })`.
  - Returns `{ prefix, objects: [{ path, size, uploadedAt, etag }], nextCursor }`.
- R2 list order is lexicographic by key; there is no `uploadedAt` sort anywhere and no artifact table in D1.
- Full artifacts page uses the same helper with default limit 50 (`dashboard-routes.tsx:56-63`).
- `dashboardCounts` returns only `{ tokens, devices }` from D1 (`dashboard-service.ts:256-...`); it does not count artifacts.
- Artifact rows render path, size, uploadedAt, and an `Open` action (`dashboard.tsx:311-318`).

## Settings base URL today

- Team settings general shows slug as `artifact.w3dev.app/` + `team.slug` in `.slug-value` with a hard-coded hostname (`dashboard.tsx:342`).
- The overview's copy affordance (`data-copy-target="artifact-base-url"`) is the only place a full, origin-correct URL is exposed; the token secret copy button uses the same `data-copy-target` mechanism (`dashboard.tsx:415`), so the copy script must stay.

## Tests (`apps/gateway/test/dashboard.test.tsx`)

- Sidebar layout: asserts `layout-sidebar`, `class="sidebar"`, `"W3Dev"`, `action="/auth/logout"`, artifacts link, `"Workspace content"` (lines 23-36).
- Topnav layout: asserts `layout-topnav`, `class="top-navigation"`, devices link, `aria-current`, no `<aside class="sidebar"` (lines 38-50).
- Artifact page: `"All published artifacts"`, fixture paths, `"Next page"` (lines 52-69).
- Overview URL: asserts `http://127.0.0.1:8787/w3dev/` is present and that the hard-coded `https://artifact.w3dev.app` variant is absent (lines 101-113).
- No test asserts `"Recent artifacts"`, row order, metric values, or account-menu placement.
