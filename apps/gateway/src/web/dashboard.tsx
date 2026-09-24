import type { Child, FC } from "hono/jsx";
import {
  artifactHref,
  formatBytes,
  type DashboardArtifact,
  type DashboardDevice,
  type DashboardPage,
  type DashboardSession,
  type DashboardSettings,
  type DashboardToken,
} from "./dashboard-service.ts";

export type DashboardSection = "overview" | "artifacts" | "general" | "tokens" | "devices";

interface DashboardDocumentProps {
  session: DashboardSession;
  title: string;
  active: DashboardSection;
  children: Child;
  bodyClass?: string;
}

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  actions?: Child;
}

interface ActionFeedback {
  error?: string | null;
  notice?: string | null;
}

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : `${dateFormatter.format(date)} UTC`;
}

function initial(value: string): string {
  return value.trim().charAt(0).toUpperCase() || "A";
}

function navigation(teamId: string) {
  return [
    { id: "overview" as const, label: "Overview", short: "OV", href: `/dashboard/${teamId}` },
    { id: "artifacts" as const, label: "Artifacts", short: "AR", href: `/dashboard/${teamId}/artifacts` },
    { id: "tokens" as const, label: "API tokens", short: "KE", href: `/dashboard/${teamId}/settings/api-tokens` },
    { id: "devices" as const, label: "Devices", short: "DE", href: `/dashboard/${teamId}/settings/devices` },
    { id: "general" as const, label: "Team settings", short: "ST", href: `/dashboard/${teamId}/settings/general` },
  ];
}

export function DashboardDocument({ session, title, active, children, bodyClass = "" }: DashboardDocumentProps) {
  const team = session.team;
  const items = team ? navigation(team.id) : [];
  return (
    <html lang="en" data-layout={session.layout}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#0a0c0b" />
        <title>{title} · Artifact Sync</title>
        <link rel="stylesheet" href="/assets/dashboard.css" />
        <script src="/assets/dashboard.js" defer />
      </head>
      <body class={bodyClass}>
        <div class={`dashboard-frame layout-${session.layout}`}>
          <header class="context-bar">
            <a class="brand" href={team ? `/dashboard/${team.id}` : "/dashboard"} aria-label="Artifact Sync dashboard">
              <span class="brand-mark" aria-hidden="true">A</span>
              <span class="brand-name">Artifact Sync</span>
            </a>
            {team ? <TeamSwitcher session={session} /> : <span class="context-spacer" />}
            <div class="context-actions">
              <a class="quiet-link" href="/auth/device">Connect device</a>
              <AccountMenu session={session} />
            </div>
          </header>

          {session.layout === "topnav" && team ? <TopNavigation active={active} items={items} /> : null}
          <div class="dashboard-body">
            {session.layout === "sidebar" && team ? <Sidebar session={session} active={active} items={items} /> : null}
            <main class="dashboard-main" id="main-content">{children}</main>
          </div>

          {team ? <MobileNavigation active={active} items={items.slice(0, 4)} /> : null}
        </div>
      </body>
    </html>
  );
}

function TeamSwitcher({ session }: { session: DashboardSession }) {
  const team = session.team!;
  return (
    <details class="team-switcher">
      <summary aria-label="Switch team">
        <span class="team-monogram">{initial(team.name)}</span>
        <span class="team-current">
          <strong>{team.name}</strong>
          <small>{team.slug}</small>
        </span>
        <span class={`role-badge role-${team.role}`}>{team.role}</span>
        <span class="chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="switcher-menu">
        <p>Your teams</p>
        {session.teams.map((candidate) => (
          <a href={`/dashboard/${candidate.id}`} aria-current={candidate.id === team.id ? "page" : undefined}>
            <span class="team-monogram small">{initial(candidate.name)}</span>
            <span><strong>{candidate.name}</strong><small>{candidate.slug}</small></span>
            <span class={`role-badge role-${candidate.role}`}>{candidate.role}</span>
          </a>
        ))}
      </div>
    </details>
  );
}

function AccountMenu({ session, variant = "header" }: { session: DashboardSession; variant?: "header" | "sidebar" }) {
  return (
    <details class={`account-menu${variant === "sidebar" ? " sidebar-account" : ""}`}>
      <summary aria-label="Account menu">
        <span class="avatar">{initial(session.identity.name)}</span>
        <span class="account-copy"><strong>{session.identity.name}</strong><small>{session.identity.email}</small></span>
        <span class="chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="account-popover">
        <p>Signed in as</p>
        <strong>{session.identity.email}</strong>
        <a href="/auth/device">Connect another device</a>
        <form method="post" action="/auth/logout">
          <button type="submit">Sign out</button>
        </form>
      </div>
    </details>
  );
}

function Sidebar({ session, active, items }: { session: DashboardSession; active: DashboardSection; items: ReturnType<typeof navigation> }) {
  return (
    <aside class="sidebar" aria-label="Dashboard navigation">
      <nav>
        {items.map((item) => (
          <a href={item.href} aria-current={active === item.id ? "page" : undefined}>
            <span class="nav-glyph" aria-hidden="true">{item.short}</span>
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
      <div class="sidebar-foot">
        <AccountMenu session={session} variant="sidebar" />
      </div>
    </aside>
  );
}

function TopNavigation({ active, items }: { active: DashboardSection; items: ReturnType<typeof navigation> }) {
  return (
    <nav class="top-navigation" aria-label="Dashboard navigation">
      {items.map((item) => (
        <a href={item.href} aria-current={active === item.id ? "page" : undefined}>{item.label}</a>
      ))}
    </nav>
  );
}

function MobileNavigation({ active, items }: { active: DashboardSection; items: ReturnType<typeof navigation> }) {
  return (
    <nav class="mobile-navigation" aria-label="Mobile dashboard navigation">
      {items.map((item) => (
        <a href={item.href} aria-current={active === item.id ? "page" : undefined}>
          <span class="nav-glyph" aria-hidden="true">{item.short}</span>
          <span>{item.label}</span>
        </a>
      ))}
    </nav>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header class="page-header">
      <div>
        <p class="page-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p class="page-description">{description}</p>
      </div>
      {actions ? <div class="page-actions">{actions}</div> : null}
    </header>
  );
}

export function Feedback({ error, notice }: ActionFeedback) {
  if (!error && !notice) return null;
  return <p class={`feedback ${error ? "error" : "success"}`} role="status">{error || notice}</p>;
}

export function OverviewPage({
  session,
  artifacts,
  counts,
  storageError,
}: {
  session: DashboardSession;
  artifacts: DashboardArtifact[];
  counts: { tokens: number; devices: number };
  storageError?: string | null;
}) {
  const team = session.team!;
  return (
    <DashboardDocument session={session} title={`${team.name} overview`} active="overview">
      <PageHeader
        eyebrow="Team overview"
        title={team.name}
        description={`Private artifacts and credentials for ${team.slug}.`}
        actions={
          <>
            <a class="button secondary" href={`/dashboard/${team.id}/settings/api-tokens`}>Create token</a>
            <a class="button primary" href="/auth/device">Connect device</a>
          </>
        }
      />

      <section class="content-section">
        <div class="section-heading">
          <div><h2>Recent artifacts</h2><p>Latest files published under this team.</p></div>
          <a href={`/dashboard/${team.id}/artifacts`}>View all artifacts →</a>
        </div>
        <Feedback error={storageError} />
        {artifacts.length ? <ArtifactTable teamSlug={team.slug} objects={artifacts} /> : <EmptyState title="No artifacts published yet" body="Connect a device or run the Artifact Sync daemon to publish the first file." actionHref="/auth/device" actionLabel="Connect a device" />}
      </section>

      <section class="metric-grid" aria-label="Workspace summary">
        <Metric label="Connected devices" value={String(counts.devices)} detail={counts.devices === 1 ? "Active record" : "Active records"} />
        <Metric label="API credentials" value={String(counts.tokens)} detail="Team-scoped" />
        <Metric label="Your role" value={team.role} detail="Access level" />
      </section>
    </DashboardDocument>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article class="metric"><p>{label}</p><strong>{value}</strong><span>{detail}</span></article>;
}

export function ArtifactsPage({
  session,
  objects,
  currentPrefix,
  nextCursor,
  storageError,
}: {
  session: DashboardSession;
  objects: DashboardArtifact[];
  currentPrefix: string;
  nextCursor: string | null;
  storageError?: string | null;
}) {
  const team = session.team!;
  const requestedPrefix = currentPrefix.replace(/^\/+|\/+$/gu, "");
  return (
    <DashboardDocument session={session} title={`${team.name} artifacts`} active="artifacts">
      <PageHeader
        eyebrow="Artifacts"
        title="All published artifacts"
        description="Browse every file published under this team. Use a path prefix to narrow long artifact listings."
        actions={<button class="button secondary" type="button" data-refresh>Refresh</button>}
      />
      <form class="path-filter" method="get" action={`/dashboard/${team.id}/artifacts`}>
        <div class="field"><label for="artifact-prefix">Path prefix</label><input id="artifact-prefix" name="prefix" value={requestedPrefix} placeholder="reports/daily" /></div>
        <button class="button secondary" type="submit">Apply prefix</button>
        {requestedPrefix ? <a class="button secondary" href={`/dashboard/${team.id}/artifacts`}>Clear</a> : null}
      </form>
      <Feedback error={storageError} />
      {objects.length ? <ArtifactTable teamSlug={team.slug} objects={objects} /> : <EmptyState title="No artifacts found" body={requestedPrefix ? "No published artifact exists under this path prefix." : "No artifacts have been published under this team yet."} actionHref={requestedPrefix ? `/dashboard/${team.id}/artifacts` : "/auth/device"} actionLabel={requestedPrefix ? "Clear prefix" : "Connect a device"} />}
      {nextCursor ? <a class="button secondary pagination-next" href={`/dashboard/${team.id}/artifacts?${new URLSearchParams({
        ...(requestedPrefix ? { prefix: requestedPrefix } : {}),
        cursor: nextCursor,
      }).toString()}`}>Next page</a> : null}
    </DashboardDocument>
  );
}

function ArtifactTable({ teamSlug, objects }: { teamSlug: string; objects: DashboardArtifact[] }) {
  return (
    <div class="table-panel">
      <div class="data-table artifact-table" role="table" aria-label="Published artifacts">
        <div class="table-row table-head" role="row"><span>Name</span><span>Size</span><span>Uploaded</span><span>Action</span></div>
        {objects.map((object) => (
          <div class="table-row" role="row">
            <span class="file-cell"><span class={`file-kind ${fileKind(object.path)}`}>{fileKind(object.path)}</span><code>{object.path}</code></span>
            <span>{formatBytes(object.size)}</span>
            <span><time datetime={object.uploadedAt}>{formatDate(object.uploadedAt)}</time></span>
            <a class="row-action" href={artifactHref(teamSlug, object.path)} target="_blank" rel="noreferrer">Open ↗</a>
          </div>
        ))}
      </div>
    </div>
  );
}

function fileKind(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "file";
  return /^[a-z0-9]{1,5}$/u.test(extension) ? extension : "file";
}

export function GeneralSettingsPage({ session, settings, origin, feedback }: { session: DashboardSession; settings: DashboardSettings; origin: string; feedback?: ActionFeedback }) {
  const team = session.team!;
  const canChange = team.role === "owner" && settings.canChangeSlug;
  const baseUrl = `${origin}/${team.slug}`;
  return (
    <DashboardDocument session={session} title={`${team.name} settings`} active="general">
      <PageHeader eyebrow="Settings" title="Team settings" description="Control the public team slug used by private artifact URLs." />
      <Feedback error={feedback?.error} notice={feedback?.notice} />
      <section class="settings-grid">
        <div class="settings-main">
          <section class="settings-section">
            <div class="section-heading"><div><h2>Team URL</h2><p>Old URLs redirect permanently to the current slug.</p></div><span class={`role-badge role-${team.role}`}>{team.role}</span></div>
            <div class="slug-value"><span>{origin}/</span><code>{team.slug}</code></div>
            <div class="base-url-row">
              <span>
                <span class="section-label">Artifact base URL</span>
                <code>{baseUrl}/&lt;path&gt;</code>
              </span>
              <button class="button secondary" type="button" data-copy-target="artifact-base-url">Copy base URL</button>
              <span id="artifact-base-url" hidden>{baseUrl}/</span>
            </div>
            {team.role === "owner" ? (
              <form class="slug-form" method="post" action={`/dashboard/${team.id}/settings/general`} data-slug-form>
                <div class="field"><label for="slug">New team slug</label><input id="slug" name="slug" value={team.slug} minlength={1} maxlength={63} pattern="[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?" required disabled={!canChange} /><p>Use lowercase letters, numbers, and hyphens. A team can change its slug once every 30 days.</p></div>
                {settings.nextAvailableAt && !canChange ? <p class="cooldown">Next change available {formatDate(settings.nextAvailableAt)}.</p> : null}
                <button class="button primary" type="submit" disabled={!canChange}>Update slug</button>
              </form>
            ) : <p class="permission-note">Only an owner can change this team URL.</p>}
          </section>

          <section class="settings-section">
            <div class="section-heading"><div><h2>Slug history</h2><p>Every previous URL remains reserved as a permanent redirect.</p></div></div>
            <div class="history-list">
              {settings.slugHistory.map((entry) => (
                <div><span><code>{entry.slug}</code>{entry.isCurrent ? <span class="status current">Current</span> : <span class="status redirect">Redirect</span>}</span><span>{entry.changedAt ? `${formatDate(entry.changedAt)}${entry.changedByName ? ` · ${entry.changedByName}` : ""}` : "Original slug"}</span></div>
              ))}
            </div>
          </section>
        </div>
        <aside class="settings-aside"><p class="section-label">Access model</p><h3>{team.role === "owner" ? "Full team control" : team.role === "admin" ? "Credential administration" : "Personal credentials"}</h3><p>{team.role === "owner" ? "Owners can change the slug and manage every team credential." : team.role === "admin" ? "Admins can manage team credentials but cannot rename the team." : "Members can create and manage their own credentials and devices."}</p></aside>
      </section>
    </DashboardDocument>
  );
}

export function TokensPage({ session, page, createdToken, feedback }: { session: DashboardSession; page: DashboardPage<DashboardToken>; createdToken?: { name: string; token: string } | null; feedback?: ActionFeedback }) {
  const team = session.team!;
  return (
    <DashboardDocument session={session} title={`${team.name} API tokens`} active="tokens">
      <PageHeader
        eyebrow="Settings"
        title="API tokens"
        description={team.role === "member" ? "Create and manage credentials you own for this team." : "Create and manage every team-scoped credential."}
        actions={<button class="button primary" type="button" data-dialog-open="create-token">Create token</button>}
      />
      <Feedback error={feedback?.error} notice={feedback?.notice} />
      {createdToken ? <SecretReveal name={createdToken.name} token={createdToken.token} /> : null}
      <div class="table-panel">
        <div class="table-toolbar"><h2>Credentials</h2><span>{page.items.length} on this page</span></div>
        {page.items.length ? <div class="data-table token-table" role="table" aria-label="API tokens"><div class="table-row table-head" role="row"><span>Name</span><span>Owner</span><span>Last refreshed</span><span>Expires</span><span>Status</span><span>Action</span></div>{page.items.map((token) => <TokenRow key={token.id} team={team} token={token} />)}</div> : <EmptyState title="No API tokens" body="Create a token for CI, a server, or another trusted machine." />}
      </div>
      {page.nextCursor ? <a class="button secondary pagination-next" href={`/dashboard/${team.id}/settings/api-tokens?cursor=${encodeURIComponent(page.nextCursor)}`}>Next page</a> : null}

      <dialog id="create-token" class="modal">
        <div class="modal-head"><div><p class="section-label">New credential</p><h2>Create API token</h2></div><button class="icon-button" type="button" data-dialog-close aria-label="Close">×</button></div>
        <form method="post" action={`/dashboard/${team.id}/settings/api-tokens`} class="modal-form">
          <div class="field"><label for="token-name">Token name</label><input id="token-name" name="name" maxlength={64} placeholder="Production publisher" required /><p>Use a name that identifies where the secret is stored.</p></div>
          <div class="scope-preview"><span>Scope</span><code>{team.slug}</code><small>artifacts:publish · artifacts:read</small></div>
          <div class="modal-actions"><button class="button secondary" type="button" data-dialog-close>Cancel</button><button class="button primary" type="submit">Create token</button></div>
        </form>
      </dialog>
    </DashboardDocument>
  );
}

function TokenRow({ team, token }: { team: DashboardSession["team"]; token: DashboardToken }) {
  const status = token.revokedAt ? "Revoked" : new Date(token.expiresAt).getTime() <= Date.now() ? "Expired" : "Active";
  return (
    <div class="table-row" role="row">
      <span><strong>{token.name}</strong><small>{token.permissions.join(" · ")}</small></span>
      <span><strong>{token.owner.name}</strong><small>{token.owner.email}</small></span>
      <span>{formatDate(token.lastUsedAt)}</span>
      <span>{formatDate(token.expiresAt)}</span>
      <span><span class={`status ${status.toLowerCase()}`}>{status}</span></span>
      <span>{!token.revokedAt ? <form method="post" action={`/dashboard/${team!.id}/settings/api-tokens/revoke`} data-confirm={`Revoke ${token.name}? Future refreshes will stop immediately.`}><input type="hidden" name="tokenId" value={token.id} /><button class="danger-link" type="submit">Revoke</button></form> : <span class="muted">—</span>}</span>
    </div>
  );
}

function SecretReveal({ name, token }: { name: string; token: string }) {
  return (
    <section class="secret-reveal">
      <div><p class="section-label">Created once</p><h2>{name}</h2><p>Copy this secret now. It cannot be recovered later.</p></div>
      <div class="secret-row"><code>{token}</code><button class="button secondary" type="button" data-copy-target="created-token-secret">Copy token</button></div>
      <span id="created-token-secret" hidden>{token}</span>
    </section>
  );
}

export function DevicesPage({ session, page, scope, feedback }: { session: DashboardSession; page: DashboardPage<DashboardDevice>; scope: "mine" | "team"; feedback?: ActionFeedback }) {
  const team = session.team!;
  const canViewTeam = team.role === "owner" || team.role === "admin";
  return (
    <DashboardDocument session={session} title={`${team.name} devices`} active="devices">
      <PageHeader eyebrow="Settings" title="Connected devices" description="Machines authorized to publish and read this team's private artifacts." actions={<a class="button primary" href="/auth/device">Connect device</a>} />
      <Feedback error={feedback?.error} notice={feedback?.notice} />
      {canViewTeam ? <nav class="scope-tabs" aria-label="Device scope"><a href={`/dashboard/${team.id}/settings/devices?scope=mine`} aria-current={scope === "mine" ? "page" : undefined}>My devices</a><a href={`/dashboard/${team.id}/settings/devices?scope=team`} aria-current={scope === "team" ? "page" : undefined}>All team devices</a></nav> : null}
      <div class="table-panel">
        <div class="table-toolbar"><h2>{scope === "team" ? "Team devices" : "Your devices"}</h2><span>{page.items.length} on this page</span></div>
        {page.items.length ? <div class="data-table device-table" role="table" aria-label="Connected devices"><div class="table-row table-head" role="row"><span>Device</span><span>Connected by</span><span>Last refreshed</span><span>Expires</span><span>Status</span><span>Action</span></div>{page.items.map((device) => <DeviceRow key={device.id} team={team} device={device} />)}</div> : <EmptyState title="No connected devices" body="Run artifact-sync login and approve the code to connect the first machine." actionHref="/auth/device" actionLabel="Connect a device" />}
      </div>
      {page.nextCursor ? <a class="button secondary pagination-next" href={`/dashboard/${team.id}/settings/devices?scope=${scope}&cursor=${encodeURIComponent(page.nextCursor)}`}>Next page</a> : null}
    </DashboardDocument>
  );
}

function DeviceRow({ team, device }: { team: DashboardSession["team"]; device: DashboardDevice }) {
  const status = device.revokedAt ? "Revoked" : new Date(device.expiresAt).getTime() <= Date.now() ? "Expired" : "Connected";
  return (
    <div class="table-row" role="row">
      <span><strong>{device.name}</strong><small>{[device.platform, device.clientVersion ? `v${device.clientVersion}` : null].filter(Boolean).join(" · ") || "Artifact Sync CLI"}</small></span>
      <span><strong>{device.owner.name}</strong><small>{device.owner.email}</small></span>
      <span>{formatDate(device.lastUsedAt)}</span>
      <span>{formatDate(device.expiresAt)}</span>
      <span><span class={`status ${status.toLowerCase()}`}>{status}</span></span>
      <span>{!device.revokedAt ? <form method="post" action={`/dashboard/${team!.id}/settings/devices/revoke`} data-confirm={`Revoke ${device.name}? The device will need to sign in again.`}><input type="hidden" name="tokenId" value={device.tokenId} /><button class="danger-link" type="submit">Revoke</button></form> : <span class="muted">—</span>}</span>
    </div>
  );
}

export function NoTeamsPage({ session }: { session: DashboardSession }) {
  return (
    <DashboardDocument session={session} title="No team" active="overview" bodyClass="centered-page">
      <section class="empty-dashboard"><span class="empty-mark">A</span><p class="page-eyebrow">Workspace unavailable</p><h1>No team is attached to this account</h1><p>Personal teams are created after email or GitHub verification. Check verification, then reload this page.</p><a class="button primary" href="/dashboard">Reload dashboard</a></section>
    </DashboardDocument>
  );
}

export function DeviceApprovalPage({ session, code, success, error }: { session: DashboardSession; code: string; success?: boolean; error?: string | null }) {
  const identity = session.identity;
  return (
    <html lang="en">
      <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><meta name="color-scheme" content="dark" /><meta name="theme-color" content="#0a0c0b" /><title>Authorize device · Artifact Sync</title><link rel="stylesheet" href="/assets/dashboard.css" /><script src="/assets/dashboard.js" defer /></head>
      <body class="approval-page">
        <header class="approval-header"><a class="brand" href="/dashboard"><span class="brand-mark">A</span><span>Artifact Sync</span></a><span>{identity.email}</span></header>
        <main class="approval-main">
          <section class="approval-copy"><p class="page-eyebrow">Device authorization</p><h1>Approve a trusted machine.</h1><p>Confirm the code printed by <code>artifact-sync login</code>. The device receives access to one team only.</p><ol><li>Keep the CLI open.</li><li>Confirm the short code.</li><li>Choose the destination team.</li></ol></section>
          <section class="approval-card">
            {success ? <div class="approval-success"><span class="success-mark">✓</span><h2>Device approved</h2><p>Return to the terminal. The CLI will finish connecting automatically.</p><a class="button primary" href="/dashboard">Open dashboard</a></div> : <><div class="modal-head"><div><p class="section-label">Verification</p><h2>Authorize device</h2></div><span class="status pending">10 min expiry</span></div><Feedback error={error} /><form method="post" action="/auth/device" class="modal-form"><div class="field"><label for="user-code">Device code</label><input id="user-code" name="userCode" class="code-input" value={code} minlength={8} maxlength={8} pattern="[A-HJ-NP-Z2-9]{8}" autocomplete="one-time-code" required /></div><div class="field"><label for="teamId">Grant access to</label><select id="teamId" name="teamId" required>{session.teams.map((team) => <option value={team.id}>{team.name} · {team.slug}</option>)}</select></div><button class="button primary" type="submit">Approve device</button></form></>}
          </section>
        </main>
      </body>
    </html>
  );
}

export function EmptyState({ title, body, actionHref, actionLabel }: { title: string; body: string; actionHref?: string; actionLabel?: string }) {
  return <div class="empty-state"><span class="empty-icon">/</span><h3>{title}</h3><p>{body}</p>{actionHref && actionLabel ? <a class="button secondary" href={actionHref}>{actionLabel}</a> : null}</div>;
}
