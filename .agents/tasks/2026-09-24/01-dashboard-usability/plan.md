# Stable web auth and usable dashboard

**Date:** 2026-09-24
**Task:** 01-dashboard-usability

## Objective
Make browser sessions reliable, replace the fragmented authentication/settings pages with a usable Vercel-like Worker dashboard, and expose teams, owned-team slugs, connected devices, and team API credentials without weakening tenant isolation.

## Context
- The gateway currently renders three standalone inline-HTML pages and sends `/` to API-token settings.
- GitHub OAuth succeeds but the next visit can lose the Better Auth session; response reconstruction and `emailVerified` gating are the leading audit targets.
- Teams are returned by the API but exist only inside form selectors; devices are not first-class records; slug updates and team-wide credential views do not exist.
- Artifact listing exists server-side, but there is no dashboard surface for it.
- The user chose the current Cloudflare Worker stack, explicit owner roles, own-and-team device views, permanent old-slug redirects, and one slug change per team every 30 days.
- Agent-run browser QA is excluded; the final phase includes a user-led manual QA pass and a feedback/reverification loop.

## Product decisions
- Keep Cloudflare Worker, D1, R2, Bun, TypeScript, Better Auth, and Drizzle; add Hono with JSX/SSR for routing and layouts, plus small vanilla-TypeScript progressive enhancements.
- Use a Vercel-inspired workflow and hierarchy, not a visual clone.
- Support both navigation variants from one shared application shell: sidebar and horizontal top navigation. Select the current variant with non-secret `DASHBOARD_LAYOUT=sidebar|topnav`, defaulting to `sidebar`; reserve a persisted user preference as the later override.
- Add `owner`, `admin`, and `member` roles. Owners change slugs; owners/admins manage team credentials; members manage only their own.
- Show personal and team-wide device views. Team-wide visibility is limited to owners/admins.
- Preserve every previous team slug as a redirect. A team may change its slug only once per 30 days.
- Never expose token secrets after creation.

## Approach
- Fix the session lifecycle first and lock it with cookie/session regression tests.
- Migrate ownership, slug history/cooldown, and device metadata before building the UI.
- Add Hono/JSX routing, layouts, and middleware around the existing Worker, then consume authorization-first JSON endpoints from a shared server-rendered application shell.
- Keep artifact content in existing team-prefixed private URLs; use stable team IDs for dashboard navigation.
- Ground empty/loading/error states in real data and never present nonexistent deployment activity.

## Steps
- [x] Add Hono JSX/SSR routing and shared response/security middleware without changing Worker bindings.
- [ ] Preserve Better Auth responses and cookies, add web sign-out, define GitHub email-verification behavior, and test session persistence.
- [x] Redesign login as GitHub/email choice first, with email/password revealed only after selection.
- [x] Add explicit roles, team-wide credential authorization, slug aliases, and the 30-day per-team cooldown.
- [x] Capture device name/platform/client version during CLI authorization and expose authorized device metadata.
- [x] Build shared shell, design tokens, team switcher, account menu, and reusable states.
- [x] Implement validated sidebar and horizontal top-nav variants, responsive mobile navigation, and the environment-to-user-preference precedence contract.
- [x] Add overview, flat cursor-paginated artifact browser, team settings, API-token, device, account, and focused device-approval surfaces.
- [ ] Add route, tenant-isolation, pagination, mutation, HTML, migration, Worker, and Rust regression tests.
- [ ] Update authentication and dashboard documentation after verification.
- [ ] Final phase: provide a manual QA checklist and status template for the user, incorporate reported failures, and rerun automated verification.

## Acceptance criteria
- [ ] A completed GitHub or email login leaves a valid cookie that authenticates later requests and can be signed out explicitly.
- [ ] Login initially shows only provider choices; email fields appear after `Continue with email`.
- [ ] Every authenticated view exposes the selected team, role, account, and sign-out affordance.
- [ ] Both `sidebar` and `topnav` layouts render the same complete navigation, active-route state, and mobile behavior; invalid configuration uses the documented default.
- [ ] Users can switch among all memberships and browse authorized artifacts by prefix with cursor pagination.
- [ ] Owners can change a team slug; redirects preserve old URLs; the second change within 30 days is rejected.
- [ ] Owners/admins can view and revoke team API keys and devices; members see only their own; cross-team access is denied.
- [ ] Token/device responses contain metadata only; a new token secret is returned exactly once.
- [ ] Mobile, keyboard, focus, contrast, loading, empty, error, expired-session, and mutation states are represented and covered by code tests.
- [ ] The user completes the final manual QA checklist across desktop and mobile flows, shares pass/fail status, and any reported failures are fixed and rechecked.
- [ ] `bunx wrangler d1 migrations apply artifact-db --local`, `bun run test:gateway`, `bun run check:gateway`, `bunx wrangler deploy --dry-run`, `cargo fmt --all -- --check`, `cargo test --workspace`, `cargo clippy --workspace --all-targets --all-features -- -D warnings`, and `cargo build --release -p artifact-sync` pass.

## Out of scope
- A React/Next frontend, team invitations, member administration, artifact deletion, deployment history, storage analytics, and agent-run browser QA.

## References
- [Current-state audit](references/current-state-audit.md) — evidence, root-cause ranking, and coverage gaps.
- [Dashboard UX specification](references/dashboard-ux-spec.md) — routes, permissions, data model, and page blueprint.
- [Research notes](references/research-notes.md) — validated Vercel patterns and rejected scope.
