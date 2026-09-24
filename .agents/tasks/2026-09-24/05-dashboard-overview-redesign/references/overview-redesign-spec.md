# Overview redesign spec

## Target page structure

```
PageHeader (eyebrow "Team overview", h1 team.name, description)
  -> h1: 27px / 560 / letter-spacing -0.045em (desktop), 24px at <=520px
Recent artifacts                       <- primary section, first after header
  heading row: h2 "Recent artifacts" + "View all artifacts ->"
  table: path, size, uploaded timestamp, Open
  empty state (unchanged copy, links to /auth/device)
Workspace summary                      <- compact, below the fold
  Devices | API credentials | Your role
```

Removed: metric "Published artifacts" (was the `8+` hack), `.endpoint-panel` and `origin` prop.

## Typography change

In `dashboard-assets.ts`:

- `.page-header h1,.empty-dashboard h1,.approval-copy h1{ ... font-size:32px; font-weight:620 ... }` -> `font-size:27px; font-weight:560`.
  - Careful: `.empty-dashboard h1` and `.approval-copy h1` share this rule. The approval page overrides its own size later (`clamp(44px,6vw,72px)`), and `empty-dashboard` is the no-teams state. Reducing the shared rule is acceptable because both are page-level titles; confirm the empty dashboard still looks right.
- `<=520px` block: `.page-header h1{font-size:27px}` -> `24px`.

Rationale for "one step": the stylesheet ramp for page titles is 44/32/27/24/20; for weights it is 850/740/680/670/660/620. One step down from 32 is 27, one step down from 620 is 560 (60 points, consistent with the ~60-70 gaps between the lower weights).

## Recent artifacts service

New helper in `apps/gateway/src/web/dashboard-service.ts`:

```ts
export interface RecentArtifacts {
  objects: DashboardArtifact[];
  scanned: number;
  truncated: boolean;
}

export async function listRecentArtifacts(
  env: GatewayEnv,
  teamId: string,
  limit = 8,
  maxScan = 1000,
): Promise<RecentArtifacts>
```

Behavior:

- Loop `listDashboardArtifacts(env, teamId, null, cursor, 1000)` until `nextCursor === null`, `scanned >= maxScan`, or 5 pages.
- Flatten all `objects`, sort `uploadedAt` desc, tiebreak `path` asc with `localeCompare`.
- Return the first `limit` plus scan metadata.
- `truncated` is true when the cap stopped the scan before R2 was exhausted.

Cost note: default `maxScan` is 1000 and the page size is 1000, so a normal team costs one R2 list call; the loop only pages when a caller raises `maxScan`. This required raising the shared clamp in `listDashboardArtifacts` from 100 to 1000 (no caller passed more than 50 before). Artifacts page remains a single call with cursor pagination. Overview has `Cache-Control: no-store` (auth middleware), so this is per-request; revisit if teams grow past ~1000 keys.

Route change (`dashboard-routes.tsx`):

- Replace `listDashboardArtifacts(..., 8)` with `listRecentArtifacts(c.env, session.team.id)`.
- Remove `origin={...}`; the overview no longer needs it. Keep the request origin available to the settings route for the new base URL block.

## Settings base URL block

Team settings general (`dashboard.tsx` settings general section, near the `.slug-value`):

- Add a small "Artifact base URL" row with the origin-correct URL (`${new URL(c.req.url).origin}/${team.slug}/`), a copy button (`data-copy-target="artifact-base-url"`) and a hidden span, mirroring the markup removed from the overview.
- Replace the hard-coded `artifact.w3dev.app/` prefix in `.slug-value` with the same origin so preview environments are honest.
- Requires passing `origin` into the settings page component and route.

## CSS deltas (`dashboard-assets.ts`)

- `.metric-grid` becomes 3 columns (`repeat(3, minmax(0,1fr))`); `<=1100px` keeps 2; `<=520px` keeps 1fr 1fr.
- Recent artifacts table remains `.artifact-table`; add an uploaded-time column expectation only if not already rendered (check `ArtifactTable` headers; currently path/size/uploaded/action).
- `.sidebar-foot` becomes the account host:
  - `.sidebar-foot{margin-top:auto;padding:10px 8px 4px;border-top:1px solid var(--line);display:grid;gap:8px}`.
  - `.sidebar-account` (variant wrapper) full width; `.sidebar-account>summary{display:flex;width:100%;align-items:center;gap:9px;padding:8px;border:1px solid transparent;border-radius:8px}`; hover/open states reuse `.account-menu` rules.
  - `.sidebar-account .account-copy strong/small` keep ellipsis, `min-width:0`.
  - Upward popover: `.sidebar-account .account-popover{top:auto;bottom:calc(100% + 9px);left:0;right:auto;width:100%}`.
  - Desktop visibility: `@media(min-width:821px){.layout-sidebar .context-actions .account-menu{display:none}}`.
- Remove `.endpoint-panel` rules and the `<=520px` endpoint overrides once the panel is gone from the overview (keep `.slug-value code` / `.secret-row code` selectors).
- Remove the static `.sidebar-foot p/span` rules tied to the deleted text.

## dashboardScript additions (vanilla JS, `dashboard-assets.ts`)

Keep: `data-copy-target` handling, outside-click close for all `details`.

Add:

- On `toggle` for `.account-menu`/`.team-switcher`, set `summary.setAttribute("aria-expanded", String(details.open))` and initialize `aria-expanded="false"` on load.
- `keydown` Escape: if any open `details` inside the active element's tree, close it and focus its `summary`.
- No new globals, guard for missing elements (matches existing script style).

## Test updates (`apps/gateway/test/dashboard.test.tsx`)

- Overview: assert `"Private artifact base URL"` is absent (replace the old positive URL assertion at lines 101-113 with `not.toContain`).
- Overview order: `html.indexOf("Recent artifacts") < html.indexOf("Published artifacts")` style assertion; also assert `"View all artifacts"` is still present.
- Recency: extend the fake R2 bucket fixture to return two pages with mixed `uploaded` dates and assert the first rendered row is the newest path.
- Base URL on settings: assert the settings page contains the origin-based `.../w3dev/` URL and the copy button.
- Account menu: sidebar layout asserts `class="account-menu"` appears inside the `sidebar-foot` slice; topnav layout asserts it appears in the context bar; both keep `action="/auth/logout"`.
- Metrics: assert the `8+` string is gone.
