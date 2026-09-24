# Dashboard UX specification

## Design read
Reading this as: a B2B developer artifact workspace for owners and machine operators, with a neutral, compact, information-dense Vercel-like language, leaning toward Hono JSX/SSR, semantic HTML, a distinctive system sans stack, restrained brand accent, tables/dividers, and low-motion feedback.

## Information architecture
Dashboard navigation uses stable team IDs so changing a slug does not break dashboard URLs.

| Route | Purpose |
|---|---|
| `/` | Redirect authenticated users to `/dashboard`; anonymous users to login |
| `/dashboard` | Resolve one membership and redirect to its team overview |
| `/dashboard/:teamId` | Team overview and onboarding |
| `/dashboard/:teamId/artifacts` | Flat file browser with path-prefix filtering and cursor pagination |
| `/dashboard/:teamId/settings/general` | Team identity and slug management |
| `/dashboard/:teamId/settings/api-tokens` | Team credential inventory and creation |
| `/dashboard/:teamId/settings/devices` | Personal/team device inventory and revocation |
| `/auth/device` | Focused device approval flow |
| `/settings/api-tokens` | Redirect to the selected team's new token page |
| `/:teamSlug/*` | Existing private artifact URL, with historical-slug redirects |

No members, invitations, activity, usage, deployment, or delete controls appear in this task.

## Application shell
- One shared shell and navigation model supports two desktop variants selected by `DASHBOARD_LAYOUT`: `sidebar` and `topnav`.
- Common top context bar: brand, team switcher, current role, account menu, and sign out.
- `sidebar` variant: persistent left navigation for Overview, Artifacts, Settings, API tokens, and Devices.
- `topnav` variant: the same navigation items render horizontally below the context bar, matching the first reference layout.
- Both variants expose identical routes, active states, permissions, and account controls; only placement changes.
- Missing or invalid `DASHBOARD_LAYOUT` defaults to `sidebar`. A later persisted user preference will override the environment value without changing page components.
- Mobile: both variants collapse to a reachable menu or bottom navigation; no fixed-width desktop grid.
- Current route, team, and loading/error context remain visible at all breakpoints.
- Hono JSX owns routing, layouts, escaping, and response composition; vanilla TypeScript is limited to progressive enhancement.
- Server-rendered initial data avoids an empty shell; mutations refresh only the affected page.

## Login experience
1. Initial page shows `Continue with GitHub` and `Continue with email` only.
2. `Continue with email` reveals an accessible email/password region and focuses the email input.
3. The email panel supports sign in, create account, forgot password, back, inline errors, and pending state.
4. GitHub uses the existing Better Auth social flow and the same safe local return path.
5. Success returns to `returnTo` when valid, otherwise to the selected team dashboard.
6. Session failures show a real signed-out state rather than silently looping to login.

## Overview
- Team name, current slug, role, private artifact base URL, and copy action.
- Recent artifacts from the real R2 list endpoint.
- Credential/device status with links to the relevant settings page.
- Empty state: install/login instructions, device approval link, and no fake usage metrics.
- No “recent deployments” until an event model exists.

## Artifacts
- Flat rows show the complete object path, size, uploaded time, and open/download action.
- An optional path-prefix filter narrows long listings without pretending delimiter folders are complete across R2 pages.
- Next page uses the R2 cursor and preserves the active prefix; no unbounded list.
- Distinct empty-prefix, storage-unavailable, unauthorized, and missing-object states.
- Global search is omitted because the current storage contract supports prefix listing, not search.

## Settings
### General
- Current name and slug.
- Slug form is owner-only; members/admins see read-only context.
- Inline validation and explicit collision/cooldown errors.
- Warning and redirect history explain that old artifact URLs continue to work.
- Next eligible change date is shown when cooldown applies.

### API tokens
- Inventory: name, owner, permissions, created, last refreshed, expiry, status, revoke.
- Create flow uses a team-scoped descriptive name and one-time secret reveal.
- Owners/admins can manage all team tokens; members see only their own.
- Secret copy has success and failure states; revoke requires confirmation.

### Devices
- Inventory: device name, authorizing user, platform/client version, team, created, last refreshed, status, revoke.
- Members see their own devices; owners/admins can switch between “My devices” and “All team devices.”
- Revocation is the same durable API-token revocation operation.

## Permission matrix

| Capability | Owner | Admin | Member |
|---|---:|---:|---:|
| View team/artifacts | Yes | Yes | Yes |
| Create own credential/device | Yes | Yes | Yes |
| View/revoke own credentials | Yes | Yes | Yes |
| View/revoke all team credentials | Yes | Yes | No |
| Change team slug | Yes | No | No |
| View historical slugs | Yes | Yes | Yes |

## Data and API changes
- Extend membership roles to `owner | admin | member`; promote one deterministic existing admin per team to owner and preserve additional admins.
- Add a canonical `team_slugs` registry with unique slug, team, current flag, changed time/by, and an atomic per-team cooldown lock.
- Add device metadata (`deviceName`, `platform`, `clientVersion`) plus recoverable single-delivery claims to authorization records; keep `apiTokenId` as the durable credential link.
- Dashboard device lists include only active, unexpired, non-revoked credentials.
- Add `PATCH /__api/v1/teams/:teamId` for owner-only slug changes.
- Add `GET /__api/v1/teams/:teamId/api-tokens` and `GET /__api/v1/teams/:teamId/devices` with role-scoped rows and pagination.
- Extend token/device revoke authorization to allow the owner or admin of that record's team, otherwise require record ownership.
- Resolve historical slugs through the registry; browser requests redirect permanently, while bearer credentials continue authorizing by immutable team ID.
- Return stable error codes for invalid slug, collision, cooldown, forbidden role, empty team, and missing records.

## UI system and states
- Neutral surfaces, thin dividers, compact tables, one existing-brand accent for primary actions, monospace for IDs/slugs/paths.
- No decorative hero, oversized marketing headings, or generic card grid in authenticated pages.
- Semantic buttons/forms/dialogs, visible focus, keyboard support, `aria-current`, `aria-expanded`, live errors, and sufficient contrast.
- Skeletons match rows/cards, inline field errors stay below inputs, destructive actions confirm, and mutations prevent duplicate submits.
- CSP remains strict; scripts and styles are served as same-origin static assets with no broad `unsafe-inline` allowance.

## Acceptance focus
- Stable shell and team context on every authenticated page.
- Honest data and no unsupported controls.
- Member/admin/owner boundaries enforced in server queries, not hidden only in HTML.
- HTML contract tests render both `sidebar` and `topnav` variants and assert equivalent navigation, active state, team context, account controls, and mobile markup.
- No agent-run browser QA. Automated verification uses HTTP/route assertions, HTML contract tests, type checks, local D1 migration checks, and Rust tests.
- The final phase provides the user a desktop/mobile manual QA checklist and status template covering authentication persistence, team switching, artifacts, slug redirects/cooldown, tokens, devices, responsive navigation, and account/sign-out; reported failures return to implementation for fixes and automated re-verification.
