# Browser QA evidence

Local browser QA completed on 2026-09-26 against disposable artifact fixtures and the local Worker.

- Anonymous shared HTML loaded without session or share cookies; relative and root-absolute CSS, module scripts, images, `fetch`, and navigation worked with the propagated `share=` credential.
- The sandboxed document could not read `document.cookie` and received a `SecurityError`, confirming the opaque-origin boundary. Public responses retained `sandbox allow-scripts` without `allow-same-origin`.
- Revoke returned 404 for the previous document and CSS URLs. Uploading after enabling a share was visible through the same link.
- Regeneration isolated the new token from the old token. Owner mutations succeeded; member and invalid-CSRF attempts were rejected.
- The checks used loopback substitutions for the configured local domain. No positive production smoke test or production migration was performed.
