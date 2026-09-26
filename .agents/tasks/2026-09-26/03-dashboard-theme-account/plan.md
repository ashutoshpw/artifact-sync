# Dashboard theme, account, and adaptable sidebar

**Date:** 2026-09-26
**Task:** 03-dashboard-theme-account

## Objective
Improve the gateway dashboard shell with a reliable System/Light/Dark appearance control, a dedicated user-scoped `/account/settings` page, and an accessible desktop sidebar that can collapse and resize. Preserve Hono SSR, Better Auth session boundaries, CSRF sign-out, the existing `sidebar`/`topnav` variants, and the current product scope.

## Context
The shell is rendered by `apps/gateway/src/web/dashboard.tsx:80-118` and served with same-origin deferred assets from `dashboard-routes.tsx:37-39` under a strict CSP in `web/http.ts:1-7`. Theme is currently dark-only (`dashboard.tsx:84-90`, `dashboard-assets.ts:1-3`); the account popover has identity, device-link, and logout only (`dashboard.tsx:148-167`); the sidebar is a fixed 236px column and mobile renders only four links (`dashboard-assets.ts:1-3`, `dashboard.tsx:197-207`).

The account route is user-scoped and must work without an active team, including a verified user with no memberships. Initial profile scope is read-only name and email from `WebIdentity` (`auth/web-session.ts:5-25`); the D1 `user`/`account` tables contain more fields, but target code has no profile mutation contract (`db/schema.ts:13-75`). Do not add passkeys, security integrations, billing, feedback, status, or other unsupported account surfaces.

## Approach
1. Add a validated `system | light | dark` theme contract read from a non-sensitive `theme` cookie. SSR emits the explicit theme on `<html>` and matching color metadata; CSS resolves `system` through `prefers-color-scheme`, while the same-origin dashboard script updates the attribute and cookie without a localStorage second source or inline script.
2. Add `/account/settings` behind the verified browser session without requiring a team. Render read-only name/email and appearance settings, link it from both account-menu placements, and retain the existing CSRF-protected `POST /auth/logout` and device link.
3. Adapt the accepted manager-sidebar pattern to the target’s vanilla SSR shell: persist `artifact_sync_dashboard_sidebar=v1.c<0|1>.w<width>.e<last-expanded>` as a non-sensitive, SameSite=Lax preference cookie so SSR can emit the initial grid/rail width without layout shift. Parse and validate the fields on SSR, falling back to expanded 236px; `c=1` renders a 64px rail, while expanded `w` and `e` clamp to 140–320px. Emit the normalized integer width as `data-sidebar-width` rather than an inline style; generated static external CSS selectors for 64 and 140–320 set one CSS variable, and the same attribute updates during drag. Expose a desktop toggle and icon labels, and use Pointer Events with capture plus a keyboard separator: Arrow keys move in 16px steps, Home selects the rail, and End selects 320px; clean up on pointer-up, cancel, or lost capture. Animate the shell toggle over 220–250ms with an eased cubic-bezier curve when motion is allowed, and disable the transition while dragging. Keep the topnav variant unchanged.
4. Replace the mobile four-link ceiling with an accessible modal navigation surface that keeps primary links compact but exposes all routes, account, and appearance controls. Trap focus while open, focus the first useful control, return focus to the trigger after Escape/outside dismissal or navigation, and apply reduced-motion rules and safe empty/session states.

## Steps
- [x] Add theme/account/sidebar state contracts and route helpers; preserve no-team and anonymous redirect behavior.
- [x] Implement semantic light/dark/system tokens, SSR cookie selection, system-media fallback, color metadata, and account-menu/account-page controls under strict CSP.
- [x] Implement desktop collapse/rail/resize behavior and the mobile navigation surface; keep account/theme reachable in sidebar, topnav, collapsed, and mobile states, with the SSR cookie contract, keyboard steps, modal focus handling, drag cleanup, and bounded short-height sidebar navigation.
- [x] Add focused SSR/service/auth regression coverage and update authentication/dashboard documentation with source-versus-runtime verification boundaries.
- [x] Run package checks and local authenticated desktop/mobile/manual system-theme checks separately from source/build proof; production deployment verification remains explicitly out of scope for this task.

Current validation: `bun run test:gateway` (61 passing), `bun run check:gateway`, `(cd apps/gateway && bunx wrangler deploy --dry-run)`, emitted dashboard JavaScript parsing, and `git diff --check` pass. Local authenticated browser/motion checks cover account/no-team/anonymous access, theme persistence and OS changes, desktop pointer/keyboard/collapse/short-height behavior, 240ms transitions, drag/reduced-motion behavior, topnav, mobile navigation and focus handling, no horizontal overflow, device approval metadata, and the integrated artifact-sharing empty state. These checks do not establish deployed behavior.

## Acceptance criteria
- [x] Authenticated `/account/settings` renders for users with or without a team; unauthenticated requests redirect to login with a safe return path; the page exposes only supported read-only name/email data plus appearance controls.
- [x] Account menu links to the page from header/sidebar placements, retains device access and CSRF logout, and remains keyboard reachable when the sidebar is collapsed or the mobile navigation is open.
- [x] System/Light/Dark selection persists through the validated theme cookie, SSRs the selected attribute before deferred JavaScript, follows OS changes in System mode, and avoids a visible theme flash. All dashboard, sharing, and device-approval surfaces use semantic light/dark tokens, native control contrast, and reduced-motion behavior.
- [x] Desktop sidebar toggles between expanded and 64px icon rail, restores `e` from the namespaced `artifact_sync_dashboard_sidebar` cookie, and SSRs a validated 64px or 140–320px `data-sidebar-width` value that external static selectors map to one CSS variable, avoiding inline styles and layout shift. Pointer/keyboard resizing clamps to those bounds, updates the attribute, exposes separator values/labels, moves by 16px with Arrow keys and supports Home/End, releases capture and clears drag state on every termination path, and animates the toggle over 220–250ms eased cubic-bezier only when motion is allowed and never while dragging. Topnav behavior remains equivalent.
- [x] Mobile exposes every dashboard destination and account/appearance actions with `aria-expanded`/`aria-controls`, a modal focus trap and initial focus, focus return, Escape/outside dismissal, and no horizontal overflow.
- [x] `bun run test:gateway`, `bun run check:gateway`, and `(cd apps/gateway && bunx wrangler deploy --dry-run)` pass; the full deploy workflow remains the source of production verification. Authenticated browser, OS preference, sharing empty-state, and motion checks are reported separately; deployed proof was not performed.

## References
- [references/current-state-audit.md](references/current-state-audit.md) — target shell, theme, account/auth boundaries, tests, and validation evidence.
- [references/aieo-reference-audit.md](references/aieo-reference-audit.md) — AIEO account/profile/theme patterns and excluded unsupported surfaces.
- [references/dev-manager-sidebar-audit.md](references/dev-manager-sidebar-audit.md) — bounded sidebar collapse, resize, animation, and mobile focus patterns.
