# Artifact sharing: owner-controlled anonymous links

**Date:** 2026-09-26
**Task:** 04-artifact-sharing

## Objective

Add a dashboard Share action with `Only me` and `Anyone with the link`. Existing and newly created artifacts remain private by default; a team owner can enable a revocable anonymous link for one artifact.

## Context

Artifacts are team-scoped R2 prefixes with D1 metadata. The confirmed meaning of `Only me` is the existing authenticated team-private scope; it does not mean uploader-only privacy. Existing worktree changes are preserved.

## Approach

Use one persisted opaque share record per artifact and the existing Worker/R2 path. Keep the link live against the artifact prefix, authorize every request through D1, and propagate a distinct `share=` query credential through same-artifact HTML/CSS/resource URLs without setting a public cookie. Preserve the existing `?token=` embed contract and document its separate revocation window.

## Steps

- [x] Inventory schema, migrations, artifact CRUD, dashboard controls, content serving, auth, embeds, and validation conventions.
- [x] Report source-backed findings and proposed scope to the coordinating agent; discovery accepted with the team-private assumption recorded.
- [x] Add the share schema/migration and service helpers; default missing rows to private and never reset sharing during upload/reconciliation.
- [x] Add owner-only CSRF/origin-checked dashboard mutations and Share controls on artifact rows and detail pages.
- [x] Add anonymous `share=` authorization for the live `/<team>/<artifact>/index.html` URL and all same-artifact resource/navigation requests.
- [x] Preserve private/team/JWT access and existing embed behavior; validate revocation and cross-team/artifact isolation.
- [x] Bound shared HTML/CSS URL rewriting to 4 MiB; oversized or over-limit streamed objects return `413 artifact_content_too_large`, while empty text documents remain valid.

## Acceptance criteria

- [x] Existing/new artifacts render `Only me` until an owner enables a share record; missing D1 metadata fails closed for public reads.
- [x] Only the selected team role `owner` can enable/revoke/regenerate a link; foreign origins, missing/invalid CSRF, other roles, teams, and artifacts are rejected.
- [x] Anonymous access requires the active artifact share token, serves the live R2 prefix, and returns no public/session/team-wide cookie; responses remain `no-store` so revocation is immediate.
- [x] Relative and same-origin root-absolute resource/navigation URLs keep `share=`; external URLs and sibling artifacts never receive it. Existing `?token=` embeds remain a separately documented 24-hour capability and are not claimed to be revoked by `Only me`.
- [x] Public executable HTML passes an isolation gate before implementation: serve it from a dedicated public origin without dashboard session cookies, or prove the existing CSP sandbox provides a compatible opaque origin; never ship public artifact JavaScript on the authenticated dashboard origin. Browser QA confirmed the opaque-origin sandbox and zero-cookie behavior; see [references/browser-qa.md](references/browser-qa.md).
- [x] Tests cover migration/defaults, owner authorization, dashboard rendering/actions, shared HTML/CSS/assets, live uploads, revoke, traversal, token isolation, private reads, and the existing embed boundary; `bun run test:gateway`, `bun run check:gateway`, migration checks, and Wrangler dry-run pass. Production smoke and remote migration remain outside this local validation.

## References

- [references/share-design.md](references/share-design.md) — source evidence, schema/route contract, privacy decision, UX, isolation, and validation details.
- [references/browser-qa.md](references/browser-qa.md) — local browser evidence for shared execution, opaque-origin isolation, revocation, upload visibility, and role/CSRF behavior.
