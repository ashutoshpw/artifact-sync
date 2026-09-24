# aieo sidebar account menu (reference pattern)

Source repo (read-only): `/home/ashutosh/PROJECTS/w3mirror/aieo`.

## Where it lives

- Component: `apps/next-app/src/components/dashboard/sidebar-user-menu.tsx` (`SidebarUserMenu`, lines 40-236).
- Mounted at the bottom of every sidebar in a `shrink-0 border-t p-2` block:
  - `apps/next-app/src/app/dashboard/(components)/DashboardSideBar.tsx:315-317`
  - `apps/next-app/src/app/dashboard/(components)/DashboardMobileSidebar.tsx:267-269` (`mt-auto`)
  - `apps/next-app/src/components/account/account-sidebar.tsx:182-184`
  - `apps/next-app/src/app/adminx/(components)/AdminSidebar.tsx:187-189`
- Sidebar shell pattern: `flex h-full max-h-screen flex-col`, nav at top, account block pinned with `mt-auto`/`shrink-0`.

## Trigger and surface

- Trigger: full-width button, `flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent`; avatar `h-7 w-7` with initials fallback (`(name?.[0] || email?.[0] || "U").toUpperCase()`), truncated name (`flex-1 truncate text-sm font-medium`), `ChevronsUpDown` icon at the right.
- Menu opens upward: `<DropdownMenuContent side="top" align="start" className="w-72 p-0">`, sideOffset 4, portaled.
- Surface: `z-50 rounded-md border bg-popover shadow-md`, enter/exit fade + zoom + slide-from-bottom transitions.
- Sections: header with email and a settings icon link, separator, menu items, sign-out, optional upgrade CTA, platform status footer.

## Behavior (supplied by Radix DropdownMenu)

- Open/close state is internal to Radix; no manual state.
- Click-outside and Escape dismissal, focus move into the menu and restore to trigger, roving arrow-key navigation, `role="menu"`/`role="menuitem"`, and `aria-expanded` on the trigger.
- Theme row calls `onSelect(e => e.preventDefault())` so nested buttons do not close the menu.
- Sign out is an async action then router redirect.

## Adaptation for artifact-sync (no React)

- Keep the native `<details>` disclosure already used by `AccountMenu`; it gives Enter/Space toggling and works without JS.
- Keep/reuse the existing outside-click close in `dashboardScript`; add Escape-to-close + focus return + `aria-expanded` sync (Radix parity concerns only those behaviors in our scope).
- Reuse the existing popover styling (`.account-popover`) but flip it upward inside the sidebar: `top:auto; bottom:calc(100% + 9px); left:0; right:auto; width:100%`.
- Trigger becomes full width in the sidebar, with the same avatar + name/email + chevron composition; truncation via existing ellipsis rules.
- Do not port aieo's React-only pieces: SWR profile fetch, theme selector, upgrade CTA, status footer, portal, Radix focus trap, `next/link`.
- Keep our existing menu contents: "Signed in as" + email, "Connect another device", sign-out form (`POST /auth/logout`).
- Responsive plan:
  - sidebar layout desktop (`min-width:821px`): menu in `.sidebar-foot`, header instance hidden.
  - topnav layout (all widths) and any layout `<=820px`: menu in the context bar, avatar-only trigger on mobile.
