# Dashboard artifact organization: ordering, projects, pins, overview redesign

**Date:** 2026-09-26
**Task:** 01-dashboard-artifact-organization

## Objective
Rework the web dashboard so artifacts sort newest-first and group by Today / Yesterday / This Week / Older, artifacts can be organized into team projects (many-to-many) and pinned to the top, and the overview page becomes a two-column Vercel-style layout without the "Your role" metric. No changes to the local filesystem, the Rust agent, or CLI API contracts.

## Context
Artifacts exist only as R2 prefixes (`uploads/<teamId>/artifacts/<slug>/`); R2 lists them lexicographically, which is why oldest is on top, and prefix listing exposes no timestamps. Supporting ordering, pins, and projects therefore requires a D1 `artifacts` table synced from the upload path plus a reconciliation backfill for pre-existing artifacts. Decisions confirmed with the owner: grouping uses **last activity** (most recent file upload), boundaries use the **viewer's timezone**, **any team member** can manage projects and pins, projects live in the **sidebar nav**, overview is **two-column Vercel style**, and files inside an artifact stay **alphabetical**.

## Approach
1. New D1 migration: `artifacts` (team-scoped slug, created_at, last_activity_at, pinned_at), `projects` (team-scoped name), `artifact_projects` join table (many-to-many). R2 stays the source of truth for existence; D1 only enriches.
2. `uploadArtifact` upserts `artifacts.last_activity_at` (best-effort; upload must not fail if D1 hiccups). Dashboard listing reconciles unknown slugs in the background (`waitUntil`) by reading each legacy artifact's object timestamps.
3. Artifacts listing merges R2 prefixes with D1 metadata, sorts pinned → last activity → slug, and renders grouped sections using a `tz` cookie (set by a tiny client script; UTC fallback). Pin/unpin and project-assign are plain CSRF form POSTs like existing mutations.
4. New "Projects" nav page (create/delete, artifact counts, links to filtered artifact views) plus per-artifact project assignment (checkbox dialog on rows, panel on detail page). Filter via `?project=<id>`.
5. Overview: two-column layout — left "Usage"-style summary (artifact/device/credential counts with links + quick actions), right the grouped artifact list; role metric removed.
6. Tests updated/added in `apps/gateway/test/`; gate on `bun run test:gateway && bun run check:gateway`. Migration ships via the existing deploy workflow (`d1 migrations apply --remote`).

## Steps
- [x] Schema: add tables + Drizzle migration `0002_*` (`bun run db:generate`), verify local apply
- [x] Upload-path upsert in `content/routes.ts` (best-effort, preserves created_at)
- [x] Reconciliation backfill for legacy artifacts (bounded, via `executionCtx.waitUntil`)
- [x] Listing service: merge + sort (pinned/activity), group helper, `tz` cookie handling
- [x] Pin/unpin route + row UI (pin glyph, "Pinned" section)
- [x] Projects: CRUD routes + nav page + assignment dialog/detail panel + `?project=` filter
- [x] Artifacts page + overview render grouped sections; overview two-column redesign
- [x] Update `dashboard.test.tsx` + add service tests; run gateway tests and typecheck

## Acceptance criteria
- [ ] Artifacts page and overview list newest-activity first; pinned artifacts always precede unpinned
- [ ] Grouped headers (Pinned / Today / Yesterday / This Week / Older) reflect the viewer's timezone
- [ ] Members can create/delete projects, assign one artifact to multiple projects, filter by project
- [ ] Legacy artifacts uploaded before this change appear with correct dates after backfill
- [ ] Overview shows devices/credentials summary at top-left, no "Your role" anywhere
- [ ] `bun run test:gateway` and `bun run check:gateway` pass; upload API response unchanged

## References
- [references/schema-and-sync.md](references/schema-and-sync.md) — D1 schema, upsert semantics, backfill strategy, pagination-with-sorting approach
- [references/ui-design.md](references/ui-design.md) — grouping rules, timezone cookie, projects UX, pinning UX, overview layout mapping to the Vercel screenshot
