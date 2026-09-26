# Schema and sync strategy

## Why D1 at all
R2 `list({ delimiter: "/" })` returns common prefixes in lexicographic order and carries no
per-prefix metadata. Every requested feature (newest-first, date grouping, pins, project
membership) needs per-artifact mutable metadata, so artifacts get a D1 mirror. R2 remains
the source of truth for *existence* — a slug absent from R2 never renders even if a stale
D1 row exists; a slug absent from D1 renders un-enriched and gets backfilled.

## Migration `0002_artifact_organization` (Drizzle, SQLite/D1)

```sql
CREATE TABLE artifacts (
  id               TEXT PRIMARY KEY,
  team_id          TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  slug             TEXT NOT NULL,
  created_at       INTEGER NOT NULL,  -- ms epoch, first upload seen
  last_activity_at INTEGER NOT NULL,  -- ms epoch, most recent file upload
  pinned_at        INTEGER            -- NULL = unpinned
);
CREATE UNIQUE INDEX artifacts_team_slug_unique ON artifacts (team_id, slug);
CREATE INDEX artifacts_team_activity_idx ON artifacts (team_id, last_activity_at);

CREATE TABLE projects (
  id         TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX projects_team_name_unique ON projects (team_id, name);

CREATE TABLE artifact_projects (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (artifact_id, project_id)
);
```

Notes:
- `id` values are crypto `crypto.randomUUID()` (matches existing id style in the codebase).
- Project names unique per team (trimmed, 1–64 chars). Case sensitivity: exact match unique;
  UI dedupes visually — keep simple.
- No `updated_at` needed; `last_activity_at` covers it.

## Upload-path sync (`src/content/routes.ts` `uploadArtifact`)
After the R2 `put` resolves, best-effort upsert (single statement):

```ts
db.insert(artifacts)
  .values({ id, teamId, slug, createdAt: now, lastActivityAt: now })
  .onConflictDoUpdate({
    target: [artifacts.teamId, artifacts.slug],
    set: { lastActivityAt: now },
  });
```

- Wrapped in try/catch: D1 failure logs but the upload still returns 201 — R2 is truth and
  reconciliation will heal the row later. This keeps the CLI contract and reliability intact.
- On conflict `created_at` is intentionally not touched.

## Backfill / reconciliation for legacy artifacts
Where: `listDashboardArtifacts` (and overview's call of the same service).

1. Fetch R2 prefixes as today (loop cursors up to a cap, see pagination below).
2. `SELECT ... FROM artifacts WHERE team_id = ? AND slug IN (...)` — one query.
3. For slugs missing rows, spawn background work via `c.executionCtx.waitUntil(...)`:
   for each missing slug (batch cap ~20 per request to bound cost), list the artifact's
   objects (`prefix = uploads/<team>/artifacts/<slug>/`, page through, cap ~1000 objects)
   and compute `created_at = min(uploaded)`, `last_activity_at = max(uploaded)`, then insert.
   `onConflictDoNothing` to stay idempotent under concurrent requests.
4. Rendering falls back gracefully: an artifact without a D1 row sorts last (stable by slug)
   and shows no date until the next page load after backfill completes. `Hono`'s
   `app.fetch(request, env, ctx)` already receives the execution context, so
   `c.executionCtx.waitUntil` is available without changing the worker export.

Deletions: no artifact delete exists anywhere today, so stale rows are not a concern yet;
if deletion ships later it should remove the row in the same flow.

## Listing, sorting, pagination
- `listDashboardArtifacts` returns merged items:
  `{ slug, createdAt, lastActivityAt, pinnedAt, projectIds }` (projects joined per artifact
  via `artifact_projects` for the team in the same round trip).
- Sort order: `pinnedAt DESC NULLS LAST` → `lastActivityAt DESC` → `slug ASC` (in-memory,
  after merge — data size makes this trivial).
- Pagination: R2 pages are lexicographic, which fights global sorting. Take the pragmatic
  route: loop R2 cursors server-side to gather up to 1,000 prefixes (R2 max page size) per
  request. If `truncated`, keep the existing "Next page" link but switch its cursor to an
  accumulated `?after=<n>` offset: the handler re-fetches prefixes `0..after+1000`, merges,
  re-sorts, and slices. Teams at this scale are far below the cap; the mechanism exists so
  correctness does not depend on that.
- `?project=<projectId>` filters the merged list by membership (404s if the project is not
  in the current team).
- Overview uses the same service with a smaller slice (top 8).

## Timezone handling
- Client script (added to `dashboardScript`): on load, if the `tz` cookie is absent,
  set `tz = Intl.DateTimeFormat().resolvedOptions().timeZone` (validated server-side against
  `Intl.supportedValuesOf("timeZone")` / try-construct `DateTimeFormat`) and reload once
  (guarded by a sessionStorage flag to avoid loops).
- Server: read the `tz` cookie per request; compute group boundaries with
  `Intl.DateTimeFormat` in that zone; fall back to UTC when absent/invalid.
- `formatDate` switches from hardcoded UTC to the resolved zone; keeps the " UTC" suffix
  only in the fallback path.
