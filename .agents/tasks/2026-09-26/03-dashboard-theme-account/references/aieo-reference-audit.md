# AIEO reference audit

Source inspected read-only at `/home/ashutosh/PROJECTS/w3mirror/aieo` on 2026-09-26. These findings describe implementation patterns in source; they are not runtime or deployed proof for either repository.

## Transferable patterns

- `apps/next-app/src/components/dashboard/sidebar-user-menu.tsx:40-78` combines session/profile display, a settings link at `/account/settings`, and theme state in one account menu. It fetches the canonical profile (`/api/account`) rather than relying only on a potentially stale auth session (`:47-61`), then falls back to session name/email/image (`:73-76`).
- The trigger is a full-width, keyboard-accessible button with avatar fallback, truncated identity, and an affordance (`sidebar-user-menu.tsx:93-110`). The menu opens upward from a sidebar and keeps settings beside the identity (`:110-134`).
- The Theme row offers explicit `system`, `light`, and `dark` choices and prevents the containing menu item from closing while the nested control is used (`sidebar-user-menu.tsx:146-178`). This is the useful interaction model for artifact-sync, adapted to native HTML rather than Radix/React.
- Account routes are user-scoped: `apps/next-app/src/app/account/layout.tsx:6-18` calls `requireSession("/account")` before rendering an account shell, and `apps/next-app/src/lib/account-navigation.ts:31-79` keeps account links under `/account`. The target can use a smaller profile/appearance page and its existing SSR session boundary.

## Risks and exclusions

- AIEO’s custom `ThemeProvider` stores the choice under `aieo-theme` and reads it in an effect (`apps/next-app/src/components/theme-provider.tsx:5-22,64-89`). It registers a system media-query listener whose callback closes over `initialTheme` (`:91-107`); source review identifies a stale-selection risk after an explicit theme change. Do not copy this provider behavior blindly.
- AIEO has no equivalent target for the artifact-sync collapsed mobile shell in this audit; the target must preserve its own header account trigger and fixed four-item mobile navigation at `max-width:820px`.
- AIEO includes feedback, billing/upgrade, platform status, authentication/security, and token surfaces. The target audit found no corresponding artifact-sync product contracts for those account sections. Exclude them unless a later source audit proves existing target capability.
- The target is Hono JSX/SSR with a strict same-origin CSP and no React theme provider. Implement the three-state appearance choice through the target’s existing static dashboard asset and SSR metadata/data attributes. Define persistence and first-paint behavior together; avoid a client-only choice that flashes dark before hydration.

## Target decisions

1. Reuse the account menu’s existing native disclosure and identity/sign-out behavior. Add a link to one user-scoped account page and a compact System/Light/Dark control, with the same controls reachable from the mobile header.
2. Keep the account page limited to current identity/profile fields and appearance. The current target session exposes `id`, `name`, and `email`; the user table also stores verification/image fields, but profile mutations and provider/security settings are not currently exposed by target code. Do not invent those APIs in this plan.
3. Preserve target auth boundaries: account access requires the verified Better Auth browser session, sign-out remains `POST /auth/logout`, and any future profile mutation must be CSRF/origin checked and scoped by the session user ID.
4. Treat AIEO as interaction and information-architecture input only. Validate the target’s SSR output, keyboard/mobile behavior, preference persistence, system changes, and deployed authenticated pages separately.
