# Restore compact sidebar navigation

**Date:** 2026-09-26
**Task:** 06-sidebar-density

## Objective
Restore compact, evenly spaced desktop sidebar navigation rows after the theme/account dashboard commit, while keeping the account footer anchored and preserving collapsed, mobile, theme, and artifact/project behavior.

## Context
The current desktop screenshot shows the six sidebar links stretched through the available sidebar height, with Artifacts and Projects appearing as large selected/hovered blocks. The theme/account commit changed `.sidebar nav` from a compact grid to a flexing grid without constraining grid track alignment.

## Approach
Keep the sidebar nav as a flexing scroll region so the account footer remains at the bottom, but align its auto-sized grid tracks at the start. Preserve existing row padding, gap, active-route selector, collapsed overrides, and mobile media rules.

## Steps
- [x] Inspect current CSS cascade and compare the theme/account commit.
- [x] Add the minimal grid alignment fix in `dashboard-assets.ts`.
- [x] Run gateway tests, type checks, and diff validation.
- [x] Verify desktop and narrow/mobile sidebar behavior in browser screenshots.
- [x] Update status after review acceptance.

## Acceptance criteria
- [x] Expanded desktop sidebar links render as compact rows of about 38px with 3px gaps.
- [x] Only the current route uses active styling; hover remains restrained.
- [x] Account footer remains at the bottom; collapsed and mobile navigation still work.
- [x] Existing gateway checks pass and browser review finds no regression.

## References
- Browser QA screenshots: `/tmp/artifact-sync-qa-sidebar-fixed-*.png`.
- Deployment verification remains pending until this change is pushed.
