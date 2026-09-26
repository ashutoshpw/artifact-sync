# UI design

## Grouping rules (artifacts page + overview list)
Buckets computed from `lastActivityAt` in the viewer's zone (cookie `tz`, UTC fallback):

| Section   | Rule                                                    |
|-----------|---------------------------------------------------------|
| Pinned    | `pinnedAt != null`, sorted by `pinnedAt DESC`           |
| Today     | local calendar day == today                             |
| Yesterday | local calendar day == yesterday                         |
| This Week | rolling last 7 days, excluding today/yesterday          |
| Older     | everything else                                         |

- Empty sections are not rendered. Section headers are plain rows in the existing
  `data-table` panel (small caps, muted), matching current table styling.
- Each artifact row gains: last-activity timestamp column, project chips (≤3 + "+n"),
  pin glyph when pinned, and row actions: Browse, Organize, Pin/Unpin.
- "This Week" is a rolling 7-day window (not calendar weeks) — avoids Monday/Sunday
  ambiguity. Open for review if you prefer calendar weeks.

## Pinning UX
- Any member. `POST /dashboard/:teamId/artifacts/:slug/pin` (action=`pin`|`unpin`), CSRF
  form field like every other mutation, then re-render the page.
- Pinned rows show an accent pin icon next to the slug; the Pinned section sits above all
  groups on both the artifacts page and overview.

## Projects UX
- New sidebar/topnav item **Projects** (`/dashboard/:teamId/projects`, section id
  `projects` — update `navigation()` and `DashboardSection`).
- Projects page: table of projects (name, artifact count, created) linking to
  `/dashboard/:teamId/artifacts?project=<id>`; "New project" opens the existing modal
  pattern (`data-dialog-open`); delete is a confirm-guarded POST. Team-scoped uniqueness
  error surfaces via the standard `Feedback` component.
- Artifacts page: when projects exist, a chip/tab row (All artifacts + one chip per
  project) mirrors the device-page scope tabs; active chip = `aria-current`.
- Assignment (multi-project):
  - Artifact rows: "Organize" action links to the artifact detail page's Projects
    section (no per-row modal — keeps DOM lean and the flow fully server-rendered).
  - Artifact detail page: "Projects" section with a checkbox form (one checkbox per
    project, current membership pre-checked) → `POST /dashboard/:teamId/artifacts/:slug/projects`
    (`projectIds` array). Server replaces membership (delete-all + insert selection).
- Empty states: no projects → assignments UI hidden (or hint text); project with no
  artifacts → existing `EmptyState` component.

## Overview redesign (Vercel two-column)
Current bottom `metric-grid` is removed entirely ("Your role" is dropped, not relocated).

New layout inside `OverviewPage` (CSS grid, stacks to single column under ~900px with the
artifact list first via CSS `order`):

```
+----------------------------+------------------------------------------+
| Summary (left rail)        | Artifacts (right, main)                  |
|  - Artifacts      N  →     |  [grouped ArtifactDirectoryTable, top 8] |
|  - Devices        N  →     |  View all artifacts →                    |
|  - API credentials N  →     |                                          |
|  Quick actions:            |                                          |
|  [Connect device]          |                                          |
|  [Create token]            |                                          |
+----------------------------+------------------------------------------+
```

- Left rail: one panel, three stat rows (artifact count, connected devices, API
  credentials), each an anchor to its page (artifacts / settings/devices /
  settings/api-tokens); below it a small quick-actions panel reusing the two existing
  header buttons (Connect device, Create token) so the header can slim down to the page
  title only.
- Right: existing artifacts section but rendered with grouped sections and the new row
  layout; keeps `storageError` handling and empty state.
- Counts come from `dashboardCounts` extended with an artifact count (one extra count
  query against the `artifacts` table; R2 stays out of the count path).
- Team-switcher, role badges elsewhere (team settings page) are untouched — role only
  disappears from overview.

## CSS / JS footprint
- `dashboardStyles` (single string) gains: two-column overview grid, section header rows,
  chip/tab row, pin glyph, project chips, modal reuse (no new modal mechanics — the
  `create-token` dialog pattern already covers open/close).
- `dashboardScript` gains only the tz-cookie snippet. Everything else stays
  server-rendered forms; no framework, no client state.
