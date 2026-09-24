# Dashboard manual QA handoff

Run this checklist after the `main` deployment workflow succeeds. Automated tests, TypeScript, Clippy, Wrangler dry-run, and local D1 migration checks are completed separately; this file covers the user-led browser pass.

## Test context

- Deployment URL:
- Commit SHA:
- `DASHBOARD_LAYOUT`:
- Browser and version:
- Desktop viewport:
- Mobile viewport:
- Account email:
- Team and role:
- Disposable artifact path:
- Second team/member available: yes / no

Use a disposable team for slug mutation. Do not rename a production team merely to complete this check.

## Authentication and session

| ID | Check | Expected | Status | Notes |
|---|---|---|---|---|
| AUTH-01 | Open `/auth/login` in a signed-out private window | Only `Continue with GitHub` and `Continue with email` are initially actionable |  |  |
| AUTH-02 | Select `Continue with email` | Email/password region appears, email receives focus, and back returns to provider choices |  |  |
| AUTH-03 | Switch between sign in, create account, and forgot password | Labels, required fields, autocomplete, and pending/error states remain understandable |  |  |
| AUTH-04 | Complete GitHub login, close the tab, then reopen `/` | The authenticated dashboard opens without another login prompt |  |  |
| AUTH-05 | Complete email login, close the tab, then reopen `/dashboard` | The same browser session remains active |  |  |
| AUTH-06 | Use the account menu to sign out, then reopen a protected URL | Session is cleared and the user is redirected to login with a safe return path |  |  |

## Teams and navigation

| ID | Check | Expected | Status | Notes |
|---|---|---|---|---|
| TEAM-01 | Open the team switcher | Every membership is listed with name, slug, and role |  |  |
| TEAM-02 | Switch to another team | URL, role, overview, artifacts, tokens, and devices all change to that team |  |  |
| NAV-01 | Inspect the configured desktop layout | Complete navigation, active route, team context, account, and sign-out are visible |  |  |
| NAV-02 | Repeat with `DASHBOARD_LAYOUT=topnav` in preview/local mode | The same links and permissions render in horizontal top navigation |  |  |
| NAV-03 | Repeat primary dashboard pages at a mobile width | No page-level horizontal overflow; mobile navigation and tables remain usable |  |  |

## Artifacts

| ID | Check | Expected | Status | Notes |
|---|---|---|---|---|
| ART-01 | Open `/dashboard/<team-id>/artifacts` | Every artifact on the current R2 page is listed with full path, size, upload time, and open action |  |  |
| ART-02 | Apply a known path prefix | Only objects under that prefix are listed |  |  |
| ART-03 | If `Next page` appears, follow it | The active prefix is preserved and the next cursor page loads |  |  |
| ART-04 | Open an artifact row | The private content URL loads in a new tab and unauthorized users cannot access it |  |  |
| ART-05 | Visit another team with a browser session | Cross-team artifact access is denied |  |  |

## Team URL and redirects

| ID | Check | Expected | Status | Notes |
|---|---|---|---|---|
| SLUG-01 | As an owner, inspect Team settings | Current slug, role, history, and availability are shown |  |  |
| SLUG-02 | Change the disposable team's slug | New slug is saved; dashboard navigation remains on stable team ID |  |  |
| SLUG-03 | Open an artifact through the previous slug in a browser | Permanent redirect reaches the same artifact at the current slug |  |  |
| SLUG-04 | Attempt another slug change immediately | Change is rejected with the next eligible date |  |  |
| SLUG-05 | As an admin or member, inspect Team settings | Slug is read-only and the reason is clear |  |  |

## API tokens

| ID | Check | Expected | Status | Notes |
|---|---|---|---|---|
| TOKEN-01 | Create a disposable API token | Secret appears once with an explicit copy warning |  |  |
| TOKEN-02 | Reload the token page | Secret cannot be retrieved again; only safe metadata remains |  |  |
| TOKEN-03 | Copy the secret | Success and failure feedback are understandable |  |  |
| TOKEN-04 | Inspect token metadata | Name, owner, permissions, creation, last refresh, expiry, and status are accurate |  |  |
| TOKEN-05 | Revoke the token and confirm the dialog | Token becomes revoked and refresh is blocked |  |  |
| TOKEN-06 | As an owner/admin, inspect team tokens | Team-wide credentials are visible; as a member, only owned credentials are visible |  |  |

## Devices

| ID | Check | Expected | Status | Notes |
|---|---|---|---|---|
| DEVICE-01 | Run `artifact-sync login --server https://artifact.w3dev.app` | Browser approval page opens with a short code and selectable team |  |  |
| DEVICE-02 | Approve the code | CLI completes and the active device appears with name/platform/client metadata |  |  |
| DEVICE-03 | Switch My devices / All team devices as owner or admin | Both scopes are correct; member scope remains personal |  |  |
| DEVICE-04 | Revoke the device | It disappears from active devices and the CLI must authenticate again |  |  |

## Accessibility and resilience

| ID | Check | Expected | Status | Notes |
|---|---|---|---|---|
| A11Y-01 | Navigate every page using only Tab, Shift+Tab, Enter, Space, and Escape | Focus is visible, order is logical, and dialogs/menus can be operated |  |  |
| A11Y-02 | Inspect labels, status messages, and active navigation | Inputs have labels, errors are announced, and active route/team state is programmatically exposed |  |  |
| A11Y-03 | Repeat overview, artifacts, settings, and account menu at 200% zoom | Content remains readable without page-level horizontal scrolling |  |  |
| ERROR-01 | Submit an invalid slug and a taken slug | Distinct inline feedback is shown without losing team context |  |  |
| ERROR-02 | Try a cross-team dashboard URL and revoke ID | Access is denied without revealing another tenant's data |  |  |

## Status template

Return this section in the thread, replacing `Not run` with `Pass`, `Fail`, or `Blocked` and adding concise evidence or reproduction steps.

```text
Deployment:
Commit:
Layout:
Browser/device:

AUTH:
AUTH-01: Not run
AUTH-02: Not run
AUTH-03: Not run
AUTH-04: Not run
AUTH-05: Not run
AUTH-06: Not run

TEAM/NAV:
TEAM-01: Not run
TEAM-02: Not run
NAV-01: Not run
NAV-02: Not run
NAV-03: Not run

ARTIFACTS:
ART-01: Not run
ART-02: Not run
ART-03: Not run
ART-04: Not run
ART-05: Not run

SLUG:
SLUG-01: Not run
SLUG-02: Not run
SLUG-03: Not run
SLUG-04: Not run
SLUG-05: Not run

TOKENS:
TOKEN-01: Not run
TOKEN-02: Not run
TOKEN-03: Not run
TOKEN-04: Not run
TOKEN-05: Not run
TOKEN-06: Not run

DEVICES:
DEVICE-01: Not run
DEVICE-02: Not run
DEVICE-03: Not run
DEVICE-04: Not run

A11Y/ERROR:
A11Y-01: Not run
A11Y-02: Not run
A11Y-03: Not run
ERROR-01: Not run
ERROR-02: Not run

Failures and notes:
```

Any `Fail` or `Blocked` result returns to implementation. Fixes must be followed by the relevant automated suite and a repeat of the failed check.
