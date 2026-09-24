# Research notes

## Validated Vercel patterns
- Vercel's current dashboard puts team/project selection before resource navigation and uses Settings in the sidebar: https://vercel.com/docs/project-configuration/project-settings
- Its 2026 navigation redesign prioritizes common workflows, uses a hideable sidebar, and provides a mobile bottom bar: https://vercel.com/changelog/dashboard-navigation-redesign-rollout
- Vercel separates account/team/project scopes and makes the selected scope explicit: https://vercel.com/docs/accounts
- Vercel token management uses descriptive names, explicit scope and expiry, and shows the secret exactly once: https://vercel.com/docs/accounts/access-tokens

## Applied to Artifact Sync
- Team context is a first-class shell control, not a hidden form field.
- Overview and Artifacts are primary workflows; credential and device management live under Settings.
- Tables, compact metadata, stable resource identity, and restrained visual hierarchy fit a developer operations product better than the current marketing-style split pages.
- Secrets remain one-time values with safe metadata afterward.
- Both the sidebar/context-bar and horizontal top-nav patterns will be supported behind one shared navigation model; the deployment environment selects the initial variant.
- A mobile navigation treatment is planned, but implementation remains lightweight Hono JSX/SSR with server-rendered HTML/CSS and small vanilla-TypeScript enhancements.

## Rejected or deferred
- Deployment/activity UI: no deployment or audit-event data exists.
- Global search: the current R2 contract supports prefix listing, not indexed search.
- Member/invitation management: outside the reported gap and current product scope.
- React/Next or a Vite SPA: rejected by the user's decision to keep the current Worker stack.
- Pixel-level Vercel imitation: rejected in favor of Artifact Sync's existing accent and information architecture.
- Agent-run browser QA: not approved; automated verification is code-based, followed by a user-led manual QA pass in the final phase.

## GitHub reference search
Repository searches returned several small Cloudflare/Hono dashboards, but none provided a sufficiently mature, directly comparable artifact/team/device model to justify adding another product dependency or copying an architecture. The plan therefore relies on the current repository contracts and Vercel's documented UX patterns.
