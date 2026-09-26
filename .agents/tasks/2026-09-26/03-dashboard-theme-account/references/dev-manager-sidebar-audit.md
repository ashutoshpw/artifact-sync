# dev-manager sidebar reference audit

Source inspected read-only at `/home/ashutosh/PROJECTS/w3mirror/dev-manager` on 2026-09-26. These findings are source evidence for interaction design; they are not runtime or deployed proof for artifact-sync.

## Sidebar state and resizing

- `apps/next-app/src/components/dashboard/sidebar-context.tsx:13-20` defines a persisted width (`sidebar-width`), a 224px default, a 64px icon rail, and 140–320px expanded bounds. `:37-77` hydrates/persists width, remembers the last expanded width, and toggles between the rail and that width.
- The provider renders the main shell as a grid whose first column is the current width and animates `grid-template-columns` over 300ms when not actively resizing (`sidebar-context.tsx:159-172`).
- The source uses a mouse resize handler (`handleMouseDown`, document `mousemove`, and document `mouseup`): it clamps width, collapses to the icon rail below a 100px threshold, and clears document cursor/text-selection state on mouse-up (`sidebar-context.tsx:79-112`). The focusable vertical separator exposes `role="separator"`, orientation, min/max/current values, and Arrow/Home/End keyboard resizing (`:114-195`); the target should use Pointer Events with capture and explicit pointer-up/cancel/lost-capture cleanup instead of assuming this mouse-only lifecycle.
- `DashboardTopNav` exposes a desktop `Toggle sidebar` button (`apps/next-app/src/app/dashboard/(components)/DashboardTopNav.tsx:78-90`), while `DashboardSideBar` exposes `Expand sidebar` in icon-only mode and otherwise keeps the workspace switcher in the header (`DashboardSideBar.tsx:152-173`). Navigation labels become screen-reader-only/title-backed icon links in the collapsed rail through `SidebarNavLink` (`apps/next-app/src/components/ui/sidebar-nav.tsx:8-35`).

## Navigation and account behavior

- The sidebar transitions root and drill-down panes with 200ms transforms, and ensures a drill-down cannot remain stranded in the collapsed rail (`DashboardSideBar.tsx:177-226`). The account menu stays in a shrink-0 bordered footer and receives the collapsed state (`:269-271`).
- The mobile experience is a separate dock and full-height dialog. The dock exposes `aria-expanded`, `aria-controls`, and explicit open/close labels (`apps/next-app/src/components/dashboard/mobile-nav-dock.tsx:27-64`). The dialog moves focus to the first link on open and restores it to the dock trigger after Escape/outside close/navigation (`apps/next-app/src/components/dashboard/mobile-nav-menu.tsx:126-151`), with account actions included in the scrollable menu (`:166-184`).
- The mobile account surface keeps profile, settings, and the same System/Light/Dark controls reachable as desktop (`apps/next-app/src/components/dashboard/mobile-account-actions.tsx:55-129`). This supports preserving a dedicated target account/appearance entry point when the target mobile bottom bar replaces the sidebar.

## AdminX comparison and limits

- AdminX’s sidebar provides the rail affordances directly: `AdminSidebar.tsx:125-164` renders an icon-only `Expand sidebar` control with a title, an expanded `Collapse sidebar` control, and the header boundary. `:166-207` animates the root and drill-down panes with 200ms transforms, while `:209-234` omits the drill-down pane when the rail is collapsed; `:240-242` keeps the account menu in a shrink-0 bordered footer. These are useful interaction references, but the target has a flat dashboard route set and should not inherit AdminX’s drill-down state or the possibility of a stranded active pane.
- AdminX’s mobile top navigation uses a Radix `Sheet` (`apps/next-app/src/app/adminx/(components)/AdminTopNav.tsx:59-118`) and defines its mobile `navItems` and `stripeItems` separately from the sidebar navigation (`:38-55`). The desktop sidebar toggle is at `:120-129`. The target should derive mobile and desktop links from one route list so no destination is omitted, then add account and appearance actions to that same accessible surface rather than porting the AdminX route arrays or dependency choices.

## Target adaptation

1. Keep artifact-sync’s existing `sidebar`/`topnav` environment variants and native SSR HTML. Add a desktop sidebar toggle and an icon-only rail only to the sidebar variant; retain topnav and the existing mobile breakpoint behavior.
2. Use a concrete namespaced SSR-readable preference cookie such as `artifact_sync_dashboard_sidebar=v1.c<0|1>.w<width>.e<last-expanded>`: validate `c`, force 64px when collapsed, clamp expanded `w` and `e` to 140–320px, and fall back to 236px. Emit the normalized width through `data-sidebar-width` and external static selectors that set one CSS variable, keeping dynamic sizing out of inline styles under the target CSP. Add a keyboard-operable `role="separator"` resize handle with 16px Arrow steps plus Home/End, Pointer Events capture cleanup, `aria-label`, `aria-expanded`/`aria-controls`, title text for icon-only links, 220–250ms eased cubic-bezier transitions, no transition while dragging, and `prefers-reduced-motion` overrides.
3. Keep account/theme controls reachable in the collapsed footer and mobile header/bottom navigation. Do not port manager-specific workspace/project drill-downs, command finder, invitation/billing/status surfaces, or React/Radix dependencies.
