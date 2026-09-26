# Dashboard table actions and project layout

**Date:** 2026-09-26
**Task:** 05-artifact-row-actions

## Objective

Replace the crowded artifact-row action links with a compact, accessible menu and repair the Projects table layout while keeping all existing actions intact. Open Share in a roomy native dialog so its existing two-choice and CSRF-protected controls remain usable at narrow widths.

## Context

`ArtifactRow` currently renders four actions inline, causing the Actions column to clip on narrow dashboard layouts. Share already owns the complete owner/member UI and mutation forms; this change only relocates that UI for list rows and preserves the detail-page control.

`ProjectsPage` renders four project cells but has no project-table grid definition, so desktop headers and values collapse into one column. Its existing Delete form remains the mutation owner and must keep its confirmation and CSRF field.

## Approach

- Render one three-dot trigger per manageable artifact row with icon-plus-label menu items.
- Use a native `<dialog>` for list-row Share, preserving the existing forms, hidden CSRF/context fields, copy link, and owner permission states.
- Extend the dashboard script for exclusive row menus, outside/Escape dismissal, trigger focus restoration, and dialog trigger focus restoration.
- Add narrowly scoped row/menu/dialog styles that escape table clipping and remain usable at mobile widths.
- Add a four-column project table layout with a readable project name/date and a right-aligned Delete action; collapse to project plus action on mobile.

## Steps

- [x] Inspect current row, share control, CSS, script, and test boundaries.
- [x] Implement row menu and list-row Share dialog.
- [x] Repair project table layout and action cell.
- [x] Add focused SSR contract coverage.
- [x] Run gateway tests, typecheck, and diff checks.
- [x] Hand off for browser screenshots and independent review.

## Acceptance criteria

- [x] Each manageable row exposes one labelled actions trigger and menu items for Browse, Share, Organize, and Pin/Unpin.
- [x] Only one row menu is open at a time; Escape/outside click closes it and returns focus to its trigger.
- [x] Share opens a viewport-safe native dialog with the existing two choices, owner/member behavior, CSRF fields, copy link, and regenerate controls.
- [x] The menu and dialog are usable at desktop and 390px widths without table clipping or horizontal overflow; browser QA confirmed this along with keyboard focus restoration and exclusive menus.
- [x] Projects render as aligned Project, Artifacts, Created, and Action columns on desktop, with a readable project/action layout on mobile; Delete keeps confirmation and CSRF behavior.
- [x] `bun run test:gateway`, `bun run check:gateway`, and `git diff --check` pass.

## References

- [../04-artifact-sharing/plan.md](../04-artifact-sharing/plan.md) — existing share contract and permission boundary.
