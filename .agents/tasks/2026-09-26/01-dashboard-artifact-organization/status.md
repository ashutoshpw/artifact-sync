# Status

- **State:** done
- **Updated:** 2026-09-26

## Notes
- Implemented on the web dashboard only: D1 migration 0002 (artifacts, projects, artifact_projects), upload-path metadata upsert, background reconciliation for legacy artifacts, newest-first ordering with Pinned/Today/Yesterday/This Week/Older sections in the viewer timezone (tz cookie), pin/unpin, projects CRUD + multi-project assignment + project filter, and the two-column Vercel-style overview without the role metric.
- Verified: bun test 34 pass, tsc clean, cargo fmt/clippy/test clean, wrangler deploy --dry-run clean. Migration applies via the existing deploy workflow (d1 migrations apply --remote).
- Deviation from reference doc: artifact assignment lives on the artifact detail page ("Organize" row action links there) instead of a per-row modal, keeping the dashboard free of per-row dialogs.
