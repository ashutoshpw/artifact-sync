# Artifact sharing design notes

All paths are relative to `/home/ashutosh/PROJECTS/ashutoshpw/artifact-sync`. These are implementation-planning findings from source inspection on 2026-09-26; no runtime or deployed public-share proof exists yet.

## Current data and request flow

- `apps/gateway/src/db/schema.ts:145-158` defines `artifacts` as `(id, teamId, slug, createdAt, lastActivityAt, pinnedAt)`. Migration `apps/gateway/drizzle/0002_noisy_crusher_hogan.sql` creates the same tables and the project join tables. There is no visibility, share token, or artifact owner field.
- `apps/gateway/src/content/routes.ts:15-61` writes `uploads/<authenticated team id>/artifacts/<artifact slug>/<relative path>` and best-effort upserts D1 metadata. The metadata write must never overwrite share state or turn a private artifact public.
- `apps/gateway/src/web/dashboard-service.ts:200-337` lists R2 prefixes and merges D1 metadata; `:344-414` loads one artifact and implements the existing pin/project mutations. `:491-530` backfills missing metadata by inspecting R2.
- `apps/gateway/src/web/dashboard-routes.tsx:68-132` renders the artifact list/detail and uses POST forms with foreign-origin and session-bound CSRF checks. `apps/gateway/src/web/dashboard.tsx:353-440` renders the detail header, pin action, existing embed-token panel, project controls, and file links.
- `apps/gateway/src/content/routes.ts:117-209` resolves current or historical team slugs, authorizes a browser session/JWT/embed credential, derives the team R2 key, and streams the object. `apps/gateway/src/auth/embed.ts:13-154` signs stateless 24-hour team or artifact embed JWTs and supports a partitioned `artifact_embed` cookie.
- `apps/gateway/src/index.tsx:62-67` sends `/<team>/<artifact>/<path>` requests to `serveArtifact`; `apps/gateway/src/auth/team-routes.ts:270-285` establishes the owner/admin/member role model.

## Privacy decision and data model

Use a new `artifact_shares` table with one row per artifact:

- `artifact_id` primary key and cascading FK to `artifacts.id`;
- `token` unique, high-entropy URL-safe opaque value generated with Web Crypto; it is intentionally a bearer value used in a public link and must be stored/rendered so the owner can copy the stable link after reload;
- `created_at` and nullable `revoked_at` timestamps;
- an index/unique constraint on `token` for anonymous lookup.

An active row (`revoked_at IS NULL`) means `Anyone with the link`; no row or a revoked row means `Only me`. Existing rows therefore default private without a data backfill, and a migration must not manufacture public links. If the implementation instead hashes the token, the UI must explicitly support one-time link reveal/regeneration; do not silently rotate a link on every dashboard render.

The repository has no artifact uploader/owner column, and the confirmed product decision is that `Only me` preserves the current team-private contract: authenticated members with team read access can read it, while unauthenticated requests without a valid legacy embed credential or active share credential cannot. Existing stateless `?token=` embeds remain a separately documented read capability until expiry, so `Only me` does not revoke them. The dashboard mutation is narrower: only the selected team's `owner` membership can enable, revoke, or regenerate a share. Do not introduce uploader-only authorization in this slice.

`uploadArtifact` and `backfillArtifactMetadata` must insert/update only artifact existence/activity. They must not delete, recreate, or reset `artifact_shares`; a late metadata reconciliation cannot make a previously shared artifact private or public.

## Public URL and authorization contract

The owner-facing link should be:

```text
https://artifact.w3dev.app/<current-team-slug>/<artifact-slug>/index.html?share=<opaque-token>
```

This uses the existing artifact path and the repository's observed standalone-artifact convention (`index.html`), but the same-host URL is conditional on the active-content isolation gate below; a dedicated public origin may change the final URL/config contract. The implementation should either require a root `index.html` before enabling Share and show a clear dashboard error when absent, or explicitly add a separate selected-entry-file field before shipping. It must not create a directory listing or a public team/artifact index.

Before shipping anonymous executable HTML, prove one of two isolation designs: (1) serve shared content from a dedicated public origin that does not receive dashboard session cookies, or (2) prove the existing `Content-Security-Policy` sandbox creates a compatible opaque origin for user HTML/JavaScript and cannot expose dashboard authentication. Public artifact JavaScript must never execute on the authenticated dashboard origin without that proof. Record the selected origin/CSP behavior in implementation tests and deployment checks.

In `serveArtifact`, resolve `share` only when private auth is unavailable (or treat a valid explicit share credential as the authority for the public rewrite path). Query D1 by the token, require an active row, join to the artifact/team, verify the requested team slug maps to that immutable team ID, validate the artifact slug and safe path, and derive the same R2 key as authenticated reads. Missing D1, lookup errors, malformed tokens, revoked rows, foreign teams, sibling artifacts, invalid slugs, and traversal fail closed without an R2 read; preserve the existing non-disclosing 401/404 style.

The public branch must never set `artifact_embed`, session, or another team-wide cookie. Set `Referrer-Policy: no-referrer` on bearer-query responses so the `share` value is not forwarded as a referrer. Keep `Cache-Control: private, no-store` (or an equivalent `no-store` response) for shared bytes and authorization failures so an edge/browser cache cannot serve content after revoke. Do not add Cache API/R2 public caching until revocation semantics have an explicit purge/version design.

For HTML/CSS shared responses, propagate `share=<opaque-token>` to same-origin, same-artifact URLs:

- relative resource and navigation URLs (`site.css`, `./helper.js`, `next.html`, CSS `url()` and `@import`);
- root-absolute URLs under `/<team-slug>/<artifact-slug>/`;
- preserve unrelated query parameters and fragments while replacing/adding only `share`.

Leave external absolute/protocol-relative URLs untouched and never attach the token to another artifact or team. Add anchor/navigation rewriting in addition to the current resource-tag rewriting so multi-page static artifacts stay public. With no cookie, JavaScript-created fetches must include `share` themselves; document that limitation or add a later explicit client-side token mechanism. Binary assets continue to stream directly from R2.

HTML and CSS rewriting is bounded to 4 MiB of decoded object bytes. If the declared R2 object size exceeds that limit, or the streamed body crosses it, the request fails closed with `413` and `{"error":"artifact_content_too_large"}`; smaller and empty text documents remain valid. Binary assets are not buffered by this cap.

Historical team slugs should retain the existing 308 redirect, preserving the share query. A changed current slug must not alter the immutable team ID stored by the share row.

## Dashboard behavior

Add an owner-visible Share control in every artifact row on the artifacts page and in the artifact detail header/action area. The row Share control must open the same two-choice `Only me` / `Anyone with the link` control used on the detail page, with the same state and feedback; it must not substitute a separate copy/revoke action menu. Explain in the control that `Only me` preserves access for authenticated members of this team. The detail page should also show the current state, copyable live URL, and feedback for enabled, revoked, regenerated, missing-entry-file, and service-error states. Members/admins can see the current state but cannot mutate it; do not rely on hidden controls for authorization.

Use POST `/dashboard/:teamId/artifacts/:artifactSlug/share` (or the repository's equivalent action route) with `action=enable|revoke|regenerate`. Apply `hasForeignOrigin`, opaque-origin CSRF handling, `dashboardSession`, team ID from the route/session, owner-role enforcement, artifact existence/backfill, and no-store redirects/feedback. The service must validate the slug, team ownership, active R2 artifact/index, and share row atomically enough that concurrent enable/revoke cannot leave two active tokens.

Keep the existing “Embedding” panel visibly separate. `?token=<signed embed JWT>` is currently a 24-hour team/artifact capability and existing embed cookies can continue to authorize private artifacts until expiry. Toggling `Only me` must not claim to revoke those pre-existing embed tokens. The new `?share=` capability is the explicitly revocable anonymous link; either label the distinction in the UI/docs or later migrate embed issuance to a persisted revocation-aware model as a separate task.

## Validation and limitations

Add focused route/service tests in `apps/gateway/test/auth.test.ts` and `apps/gateway/test/dashboard.test.tsx`, plus migration fixtures through `apps/gateway/test/d1.ts`:

- migration creates share state; old/new/backfilled artifacts are private and upload upserts preserve state;
- owner can enable/revoke/regenerate; admin/member, foreign origin, missing/altered CSRF, wrong team, wrong artifact, and missing index are rejected;
- anonymous `share=` serves live `index.html`, relative/root-absolute HTML/CSS/assets/navigation keep the token, external/sibling paths do not, and binary bodies remain streamed;
- revoke immediately blocks document and helper asset requests with no-store responses, malformed/revoked/foreign tokens do not trigger R2 reads, and an upload after enabling remains visible;
- private team/JWT/session reads continue to work, while existing embed-token tests remain explicit about their non-revocation window;
- dashboard list/detail render Share state and owner/member action boundaries.

Run `bun run test:gateway`, `bun run check:gateway`, local D1 migration application/fixture checks, `git diff --check`, and `bunx wrangler deploy --dry-run`. A passing suite/typecheck/dry-run proves source/config behavior only; it does not prove anonymous deployed access, CDN cache behavior, authenticated browser UX, or production D1 migration state. The implementation task should separately smoke-test a shared document, a relative CSS/image/helper request, a root-absolute same-artifact request, revoke, and a live post-share upload against the deployed Worker.
