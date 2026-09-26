import { Fragment, type Child } from "hono/jsx";
import {
  artifactHref,
  artifactShareHref,
  formatBytes,
  groupArtifacts,
  type DashboardArtifact,
  type DashboardArtifactFile,
  type DashboardDevice,
  type DashboardPage,
  type DashboardProject,
  type DashboardSession,
  type DashboardSettings,
  type DashboardToken,
} from "./dashboard-service.ts";
import { resolvedTheme, themeColor, type ThemePreference } from "./dashboard-preferences.ts";

export type DashboardSection = "overview" | "artifacts" | "projects" | "general" | "tokens" | "devices" | "account";

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

const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

function dateFormatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = dateFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    });
    dateFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function formatDate(value: string | null, timeZone = "UTC"): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const text = dateFormatterFor(timeZone).format(date);
  return timeZone === "UTC" ? `${text} UTC` : text;
}

function initial(value: string): string {
  return value.trim().charAt(0).toUpperCase() || "A";
}

function CsrfField({ token }: { token: string }) {
  return <input type="hidden" name="csrfToken" value={token} />;
}

function navigation(teamId: string) {
  return [
    { id: "overview" as const, label: "Overview", short: "OV", href: `/dashboard/${teamId}` },
    { id: "artifacts" as const, label: "Artifacts", short: "AR", href: `/dashboard/${teamId}/artifacts` },
    { id: "projects" as const, label: "Projects", short: "PR", href: `/dashboard/${teamId}/projects` },
    { id: "tokens" as const, label: "API tokens", short: "KE", href: `/dashboard/${teamId}/settings/api-tokens` },
    { id: "devices" as const, label: "Devices", short: "DE", href: `/dashboard/${teamId}/settings/devices` },
    { id: "general" as const, label: "Team settings", short: "ST", href: `/dashboard/${teamId}/settings/general` },
  ];
}

export function DashboardDocument({ session, title, active, children, bodyClass = "" }: DashboardDocumentProps) {
  const team = session.team;
  const items = team ? navigation(team.id) : [];
  return (
    <html
      lang="en"
      data-layout={session.layout}
      data-theme={session.theme}
      data-theme-state={resolvedTheme(session.theme)}
      data-sidebar-width={session.layout === "sidebar" ? String(session.sidebar.width) : undefined}
      data-sidebar-last-expanded={session.layout === "sidebar" ? String(session.sidebar.lastExpanded) : undefined}
      data-sidebar-collapsed={session.layout === "sidebar" && session.sidebar.collapsed ? "true" : "false"}
    >
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <ThemeMetadata theme={session.theme} />
        <title>{title} · Artifact Sync</title>
        <link rel="stylesheet" href="/assets/dashboard.css" />
        <link rel="stylesheet" href="/assets/dashboard-share.css" />
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

          {team ? <MobileNavigation session={session} active={active} items={items} /> : null}
        </div>
      </body>
    </html>
  );
}

function ThemeMetadata({ theme }: { theme: ThemePreference }) {
  return (
    <>
      <meta name="color-scheme" content={theme === "system" ? "light dark" : theme} />
      <meta name="theme-color" data-theme-color="active" media={theme === "system" ? "not all" : undefined} content={themeColor(theme)} />
      <meta name="theme-color" data-theme-color="system-light" media={theme === "system" ? "(prefers-color-scheme: light)" : "not all"} content="#f5f8f3" />
      <meta name="theme-color" data-theme-color="system-dark" media={theme === "system" ? "(prefers-color-scheme: dark)" : "not all"} content="#090b0a" />
    </>
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
        <a href="/account/settings">Account settings</a>
        <a href="/auth/device">Connect another device</a>
        <ThemePicker theme={session.theme} compact />
        <form method="post" action="/auth/logout">
          <CsrfField token={session.csrfToken} />
          <button type="submit">Sign out</button>
        </form>
      </div>
    </details>
  );
}

function Sidebar({ session, active, items }: { session: DashboardSession; active: DashboardSection; items: ReturnType<typeof navigation> }) {
  return (
    <aside
      class={`sidebar${session.sidebar.collapsed ? " is-collapsed" : ""}`}
      id="dashboard-sidebar"
      aria-label="Dashboard navigation"
      data-sidebar-collapsed={session.sidebar.collapsed ? "true" : "false"}
    >
      <div class="sidebar-head">
        <span class="sidebar-title">Navigation</span>
        <button
          class="sidebar-toggle icon-button"
          type="button"
          data-sidebar-toggle
          aria-controls="sidebar-nav"
          aria-expanded={session.sidebar.collapsed ? "false" : "true"}
          aria-label={session.sidebar.collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={session.sidebar.collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >{session.sidebar.collapsed ? "→" : "←"}</button>
      </div>
      <nav id="sidebar-nav">
        {items.map((item) => (
          <a href={item.href} aria-current={active === item.id ? "page" : undefined} title={item.label}>
            <span class="nav-glyph" aria-hidden="true">{item.short}</span>
            <span class="nav-label">{item.label}</span>
          </a>
        ))}
      </nav>
      <div class="sidebar-foot">
        <AccountMenu session={session} variant="sidebar" />
      </div>
      <div
        class="sidebar-resize"
        data-sidebar-resize
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-controls="dashboard-sidebar"
        aria-label="Resize sidebar"
        aria-expanded={session.sidebar.collapsed ? "false" : "true"}
        aria-valuemin="140"
        aria-valuemax="320"
        aria-valuenow={String(session.sidebar.collapsed ? session.sidebar.lastExpanded : session.sidebar.width)}
        aria-valuetext={session.sidebar.collapsed ? "Collapsed" : `${session.sidebar.width} pixels`}
        title="Resize sidebar"
      />
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

function MobileNavigation({ session, active, items }: { session: DashboardSession; active: DashboardSection; items: ReturnType<typeof navigation> }) {
  return (
    <>
      <nav class="mobile-navigation" aria-label="Mobile dashboard navigation">
        {items.slice(0, 4).map((item) => (
          <a href={item.href} aria-current={active === item.id ? "page" : undefined} title={item.label}>
            <span class="nav-glyph" aria-hidden="true">{item.short}</span>
            <span>{item.label}</span>
          </a>
        ))}
        <button
          class="mobile-navigation-more"
          type="button"
          data-mobile-nav-open
          aria-expanded="false"
          aria-controls="mobile-dashboard-navigation"
          aria-haspopup="dialog"
        >
          <span class="nav-glyph" aria-hidden="true">••</span>
          <span>More</span>
        </button>
      </nav>
      <dialog class="mobile-nav-dialog" id="mobile-dashboard-navigation" data-mobile-nav-dialog aria-labelledby="mobile-dashboard-navigation-title">
        <div class="mobile-nav-dialog-panel">
          <div class="mobile-nav-dialog-head">
            <h2 id="mobile-dashboard-navigation-title">Dashboard menu</h2>
            <button class="icon-button" type="button" data-mobile-nav-close aria-label="Close dashboard menu">×</button>
          </div>
          <nav class="mobile-nav-dialog-links" aria-label="All dashboard destinations">
            {items.map((item) => (
              <a href={item.href} aria-current={active === item.id ? "page" : undefined}>
                <span class="nav-glyph" aria-hidden="true">{item.short}</span>
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
          <section class="mobile-account-actions" aria-labelledby="mobile-account-actions-title">
            <h3 id="mobile-account-actions-title">Account</h3>
            <a href="/account/settings">Account settings</a>
            <a href="/auth/device">Connect another device</a>
            <ThemePicker theme={session.theme} />
            <form method="post" action="/auth/logout">
              <CsrfField token={session.csrfToken} />
              <button type="submit">Sign out</button>
            </form>
          </section>
        </div>
      </dialog>
    </>
  );
}

function ThemePicker({ theme, compact = false }: { theme: ThemePreference; compact?: boolean }) {
  return (
    <div class={`theme-picker${compact ? " theme-picker-compact" : ""}`} data-theme-picker role="group" aria-label="Appearance">
      {!compact ? <p class="theme-picker-label">Appearance</p> : null}
      <div class="theme-picker-options">
        {(["system", "light", "dark"] as const).map((choice) => (
          <button type="button" data-theme-choice={choice} aria-pressed={theme === choice ? "true" : "false"}>
            {choice[0].toUpperCase() + choice.slice(1)}
          </button>
        ))}
      </div>
    </div>
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
  artifactsTotal,
  counts,
  origin,
  storageError,
}: {
  session: DashboardSession;
  artifacts: DashboardArtifact[];
  artifactsTotal: number;
  counts: { tokens: number; devices: number };
  origin?: string;
  storageError?: string | null;
}) {
  const team = session.team!;
  const sections = groupArtifacts(artifacts, session.timeZone);
  return (
    <DashboardDocument session={session} title={`${team.name} overview`} active="overview">
      <PageHeader
        eyebrow="Team overview"
        title={team.name}
        description={`Private artifacts and credentials for ${team.slug}.`}
      />
      <div class="overview-grid">
        <aside class="overview-side" aria-label="Workspace summary">
          <section class="side-panel">
            <h2>Summary</h2>
            <div class="summary-rows">
              <a class="summary-row" href={`/dashboard/${team.id}/artifacts`}>
                <span>Artifacts</span>
                <strong>{artifactsTotal}</strong>
              </a>
              <a class="summary-row" href={`/dashboard/${team.id}/settings/devices`}>
                <span>Connected devices</span>
                <strong>{counts.devices}</strong>
              </a>
              <a class="summary-row" href={`/dashboard/${team.id}/settings/api-tokens`}>
                <span>API credentials</span>
                <strong>{counts.tokens}</strong>
              </a>
            </div>
          </section>
          <section class="side-panel">
            <h2>Quick actions</h2>
            <div class="quick-actions">
              <a class="button secondary" href="/auth/device">Connect device</a>
              <a class="button secondary" href={`/dashboard/${team.id}/settings/api-tokens`}>Create token</a>
            </div>
          </section>
        </aside>
        <section class="overview-main">
          <div class="section-heading">
            <div><h2>Artifacts</h2><p>Newest activity first. Pin and organize from the artifacts page.</p></div>
            <a href={`/dashboard/${team.id}/artifacts`}>View all artifacts →</a>
          </div>
          <Feedback error={storageError} />
          {artifacts.length ? (
            <ArtifactDirectoryTable team={team} origin={origin} sections={sections} timeZone={session.timeZone} manageable={false} csrfToken={session.csrfToken} />
          ) : (
            <EmptyState title="No artifacts published yet" body="Create a folder under ~/.agents/artifacts and run the Artifact Sync daemon to publish it." actionHref="/auth/device" actionLabel="Connect a device" />
          )}
        </section>
      </div>
    </DashboardDocument>
  );
}

export function ArtifactsPage({
  session,
  list,
  activeProjectId,
  origin,
  storageError,
  feedback,
}: {
  session: DashboardSession;
  list: { items: DashboardArtifact[]; total: number; nextCursor: string | null; projects: Array<{ id: string; name: string }> };
  activeProjectId: string | null;
  origin?: string;
  storageError?: string | null;
  feedback?: ActionFeedback;
}) {
  const team = session.team!;
  const sections = groupArtifacts(list.items, session.timeZone);
  const activeProject = list.projects.find((project) => project.id === activeProjectId);
  const pageHref = (query: string) => {
    const params = new URLSearchParams(query);
    if (activeProjectId) params.set("project", activeProjectId);
    const search = params.toString();
    return `/dashboard/${team.id}/artifacts${search ? `?${search}` : ""}`;
  };
  return (
    <DashboardDocument session={session} title={`${team.name} artifacts`} active="artifacts">
      <PageHeader
        eyebrow={activeProject ? "Project" : "Artifacts"}
        title={activeProject ? activeProject.name : "Published artifacts"}
        description={activeProject ? "Artifacts grouped into this project. Newest activity first." : "Each immediate folder under the publishing root is one artifact. Open one to browse its files."}
        actions={<button class="button secondary" type="button" data-refresh>Refresh</button>}
      />
      {list.projects.length ? (
        <nav class="scope-tabs" aria-label="Filter by project">
          <a href={`/dashboard/${team.id}/artifacts`} aria-current={activeProjectId ? undefined : "page"}>All artifacts</a>
          {list.projects.map((project) => (
            <a
              href={`/dashboard/${team.id}/artifacts?project=${encodeURIComponent(project.id)}`}
              aria-current={project.id === activeProjectId ? "page" : undefined}
            >
              {project.name}
            </a>
          ))}
        </nav>
      ) : null}
      <Feedback error={storageError} notice={feedback?.notice} />
      {list.items.length ? (
        <ArtifactDirectoryTable team={team} origin={origin} sections={sections} timeZone={session.timeZone} manageable csrfToken={session.csrfToken} activeProjectId={activeProjectId} />
      ) : (
        <EmptyState
          title={activeProject ? "No artifacts in this project" : "No artifacts found"}
          body={activeProject ? "Use Organize on an artifact to add it to this project." : "Create a non-empty folder under ~/.agents/artifacts and run the Artifact Sync daemon."}
          actionHref={activeProject ? `/dashboard/${team.id}/artifacts` : "/auth/device"}
          actionLabel={activeProject ? "All artifacts" : "Connect a device"}
        />
      )}
      {list.nextCursor ? <a class="button secondary pagination-next" href={pageHref(`after=${encodeURIComponent(list.nextCursor)}`)}>Next page</a> : null}
    </DashboardDocument>
  );
}

export function ArtifactDetailPage({
  session,
  artifact,
  artifactMeta,
  projects,
  embedToken,
  origin,
  files,
  nextCursor,
  storageError,
  feedback,
}: {
  session: DashboardSession;
  artifact: string;
  artifactMeta: DashboardArtifact | null;
  projects: Array<{ id: string; name: string }>;
  embedToken: string | null;
  origin?: string;
  files: DashboardArtifactFile[];
  nextCursor: string | null;
  storageError?: string | null;
  feedback?: ActionFeedback;
}) {
  const team = session.team!;
  const pinned = Boolean(artifactMeta?.pinnedAt);
  const detailPath = `/dashboard/${team.id}/artifacts/${encodeURIComponent(artifact)}`;
  return (
    <DashboardDocument session={session} title={`${artifact} · ${team.name}`} active="artifacts">
      <PageHeader
        eyebrow="Artifact"
        title={artifact}
        description={artifactMeta?.lastActivityAt ? `Last upload ${formatDate(artifactMeta.lastActivityAt, session.timeZone)}. Files and nested folders publish as one artifact.` : "Files and nested folders published as one artifact."}
        actions={
          <>
            <form method="post" action={`${detailPath}/pin`}>
              <CsrfField token={session.csrfToken} />
              <input type="hidden" name="action" value={pinned ? "unpin" : "pin"} />
              <input type="hidden" name="context" value="detail" />
              <button class="button secondary" type="submit">{pinned ? "Unpin" : "Pin"}</button>
            </form>
            <a class="button secondary" href={`/dashboard/${team.id}/artifacts`}>All artifacts</a>
          </>
        }
      />
      <Feedback error={storageError ?? feedback?.error} notice={feedback?.notice} />
      <section class="content-section">
        <div class="section-heading">
          <div><h2>Share</h2><p>Choose whether this artifact stays with the team or anyone with the link can open it.</p></div>
        </div>
        <div class="table-panel share-panel">
          <ArtifactShareControl team={team} artifact={artifactMeta ?? artifactWithPrivateShare(artifact)} origin={origin} csrfToken={session.csrfToken} context="detail" />
        </div>
      </section>
      <section class="content-section">
        <div class="section-heading">
          <div><h2>Embedding</h2><p>Browsers block session cookies for artifact assets loaded from other sites. Append this token to artifact URLs used outside the dashboard; it grants read access to this team's artifacts for 24 hours. This is separate from Share, so Only me does not revoke existing embed tokens before they expire.</p></div>
        </div>
        <div class="table-panel">
          {embedToken ? (
            <div class="secret-row">
              <code id="embed-token">?token={embedToken}</code>
              <button class="button secondary" type="button" data-copy-target="embed-token">Copy token</button>
            </div>
          ) : (
            <p class="permission-note">The embed token could not be created right now. Reload to try again.</p>
          )}
        </div>
      </section>
      <section class="content-section" id="projects">
        <div class="section-heading">
          <div><h2>Projects</h2><p>Group this artifact into one or more team projects.</p></div>
        </div>
        <div class="table-panel project-panel">
          {projects.length ? (
            <form method="post" action={`${detailPath}/projects`} class="project-checks">
              <CsrfField token={session.csrfToken} />
              {projects.map((project) => (
                <label>
                  <input type="checkbox" name="projectIds" value={project.id} checked={artifactMeta?.projects.some((member) => member.id === project.id) ?? false} />
                  <span>{project.name}</span>
                </label>
              ))}
              <div class="project-form-actions"><button class="button primary" type="submit">Save projects</button></div>
            </form>
          ) : (
            <p class="permission-note">No projects yet. Create one from the <a href={`/dashboard/${team.id}/projects`}>Projects</a> page.</p>
          )}
        </div>
      </section>
      <section class="content-section">
        <div class="section-heading">
          <div><h2>Files</h2><p>Browse everything published under this artifact.</p></div>
        </div>
        {files.length ? <ArtifactFileTable teamSlug={team.slug} artifactSlug={artifact} files={files} timeZone={session.timeZone} /> : <EmptyState title="No files in this artifact" body="The artifact may have been removed or has not finished uploading." actionHref={`/dashboard/${team.id}/artifacts`} actionLabel="Back to artifacts" />}
        {nextCursor ? <a class="button secondary pagination-next" href={`${detailPath}?cursor=${encodeURIComponent(nextCursor)}`}>Next page</a> : null}
      </section>
    </DashboardDocument>
  );
}

function ArtifactDirectoryTable({
  team,
  origin,
  sections,
  timeZone,
  manageable,
  csrfToken,
  activeProjectId,
}: {
  team: NonNullable<DashboardSession["team"]>;
  origin?: string;
  sections: ReturnType<typeof groupArtifacts>;
  timeZone: string;
  manageable: boolean;
  csrfToken: string;
  activeProjectId?: string | null;
}) {
  return (
    <div class="table-panel">
      <div class="data-table artifact-table" role="table" aria-label="Published artifacts">
        <div class="table-row table-head" role="row"><span>Artifact</span><span>Last upload</span><span>Projects</span><span>Actions</span></div>
        {sections.map((section) => (
          <Fragment key={section.id}>
            <div class="table-row table-section" role="row"><span>{section.label}</span></div>
            {section.artifacts.map((artifact) => (
              <ArtifactRow
                key={artifact.slug}
                team={team}
                artifact={artifact}
                origin={origin}
                timeZone={timeZone}
                manageable={manageable}
                csrfToken={csrfToken}
                activeProjectId={activeProjectId}
              />
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function ArtifactRow({
  team,
  artifact,
  origin,
  timeZone,
  manageable,
  csrfToken,
  activeProjectId,
}: {
  team: NonNullable<DashboardSession["team"]>;
  artifact: DashboardArtifact;
  origin?: string;
  timeZone: string;
  manageable: boolean;
  csrfToken: string;
  activeProjectId?: string | null;
}) {
  const teamId = team!.id;
  const detailHref = `/dashboard/${teamId}/artifacts/${encodeURIComponent(artifact.slug)}`;
  return (
    <div class="table-row" role="row">
      <span class="file-cell">
        <span class="file-kind directory">DIR</span>
        <code>{artifact.slug}</code>
        {artifact.pinnedAt ? <span class="pin-mark" role="img" aria-label="Pinned">◆</span> : null}
      </span>
      <span>
        {artifact.lastActivityAt
          ? <time datetime={artifact.lastActivityAt}>{formatDate(artifact.lastActivityAt, timeZone)}</time>
          : <span class="muted">—</span>}
      </span>
      <span>
        {artifact.projects.length
          ? <span class="chip-row">{artifact.projects.map((project) => <span class="chip" key={project.id}>{project.name}</span>)}</span>
          : <span class="muted">—</span>}
      </span>
      <span class="row-actions">
        <a class="row-action" href={detailHref}>Browse →</a>
        <ArtifactShareControl team={team} artifact={artifact} origin={origin} csrfToken={csrfToken} context="list" activeProjectId={activeProjectId} />
        {manageable ? (
          <>
            <a class="row-action" href={`${detailHref}#projects`}>Organize</a>
            <form method="post" action={`${detailHref}/pin`}>
              <CsrfField token={csrfToken} />
              <input type="hidden" name="action" value={artifact.pinnedAt ? "unpin" : "pin"} />
              {activeProjectId ? <input type="hidden" name="project" value={activeProjectId} /> : null}
              <button class="row-action" type="submit">{artifact.pinnedAt ? "Unpin" : "Pin"}</button>
            </form>
          </>
        ) : null}
      </span>
    </div>
  );
}

function artifactWithPrivateShare(slug: string): DashboardArtifact {
  return {
    slug,
    createdAt: null,
    lastActivityAt: null,
    pinnedAt: null,
    projects: [],
    share: { active: false, token: null, createdAt: null, revokedAt: null },
  };
}

function ArtifactShareControl({
  team,
  artifact,
  origin,
  csrfToken,
  context,
  activeProjectId,
}: {
  team: NonNullable<DashboardSession["team"]>;
  artifact: DashboardArtifact;
  origin?: string;
  csrfToken: string;
  context: "list" | "detail";
  activeProjectId?: string | null;
}) {
  const canManage = team.role === "owner";
  const shareUrl = origin && artifact.share.active && artifact.share.token
    ? artifactShareHref(origin, team.slug, artifact.slug, artifact.share.token)
    : null;
  const shareId = `share-url-${team.id}-${artifact.slug}`;
  const actionPath = `/dashboard/${team.id}/artifacts/${encodeURIComponent(artifact.slug)}/share`;
  const stateLabel = artifact.share.active ? "Anyone with the link" : "Only me";
  return (
    <details class={`share-control${context === "list" ? " share-control-compact" : ""}`}>
      <summary><span>Share</span><span class={`status ${artifact.share.active ? "active" : "private"}`}>{stateLabel}</span></summary>
      <div class="share-popover">
        <p class="share-explanation">Only me keeps access with authenticated members of this team. Anyone with the link can open the shared artifact without a dashboard session. Existing embedding tokens are a separate 24-hour capability and remain valid until expiry; Only me does not revoke them.</p>
        <form method="post" action={actionPath}>
          <CsrfField token={csrfToken} />
          <input type="hidden" name="context" value={context} />
          {activeProjectId ? <input type="hidden" name="project" value={activeProjectId} /> : null}
          <div class="share-choices" role="group" aria-label="Artifact sharing">
            <button class={`share-choice${!artifact.share.active ? " selected" : ""}`} type="submit" name="action" value="revoke" disabled={!canManage} aria-pressed={!artifact.share.active ? "true" : "false"}>
              <strong>Only me</strong><small>Authenticated team members keep their existing access.</small>
            </button>
            <button class={`share-choice${artifact.share.active ? " selected" : ""}`} type="submit" name="action" value="enable" disabled={!canManage} aria-pressed={artifact.share.active ? "true" : "false"}>
              <strong>Anyone with the link</strong><small>Share the artifact URL with people outside the team.</small>
            </button>
          </div>
        </form>
        {shareUrl ? (
          <div class="share-link">
            <code id={shareId}>{shareUrl}</code>
            <button class="button secondary" type="button" data-copy-target={shareId}>Copy link</button>
          </div>
        ) : null}
        {canManage && artifact.share.active ? (
          <form method="post" action={actionPath} data-confirm="Regenerate this link? The current link will stop working immediately.">
            <CsrfField token={csrfToken} />
            <input type="hidden" name="context" value={context} />
            {activeProjectId ? <input type="hidden" name="project" value={activeProjectId} /> : null}
            <button class="danger-link" type="submit" name="action" value="regenerate">Regenerate link</button>
          </form>
        ) : null}
        {!canManage ? <p class="permission-note">Only a team owner can change this sharing setting.</p> : null}
      </div>
    </details>
  );
}

function ArtifactFileTable({ teamSlug, artifactSlug, files, timeZone }: { teamSlug: string; artifactSlug: string; files: DashboardArtifactFile[]; timeZone: string }) {
  return (
    <div class="table-panel">
      <div class="data-table artifact-table" role="table" aria-label={`Files in ${artifactSlug}`}>
        <div class="table-row table-head" role="row"><span>File</span><span>Size</span><span>Uploaded</span><span>Action</span></div>
        {files.map((file) => (
          <div class="table-row" role="row">
            <span class="file-cell"><span class={`file-kind ${fileKind(file.path)}`}>{fileKind(file.path)}</span><code>{file.path}</code></span>
            <span>{formatBytes(file.size)}</span>
            <span><time datetime={file.uploadedAt}>{formatDate(file.uploadedAt, timeZone)}</time></span>
            <a class="row-action" href={artifactHref(teamSlug, `${artifactSlug}/${file.path}`)} target="_blank" rel="noreferrer">Open ↗</a>
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
                <CsrfField token={session.csrfToken} />
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
        {page.items.length ? <div class="data-table token-table" role="table" aria-label="API tokens"><div class="table-row table-head" role="row"><span>Name</span><span>Owner</span><span>Last refreshed</span><span>Expires</span><span>Status</span><span>Action</span></div>{page.items.map((token) => <TokenRow key={token.id} team={team} token={token} csrfToken={session.csrfToken} />)}</div> : <EmptyState title="No API tokens" body="Create a token for CI, a server, or another trusted machine." />}
      </div>
      {page.nextCursor ? <a class="button secondary pagination-next" href={`/dashboard/${team.id}/settings/api-tokens?cursor=${encodeURIComponent(page.nextCursor)}`}>Next page</a> : null}

      <dialog id="create-token" class="modal">
        <div class="modal-head"><div><p class="section-label">New credential</p><h2>Create API token</h2></div><button class="icon-button" type="button" data-dialog-close aria-label="Close">×</button></div>
        <form method="post" action={`/dashboard/${team.id}/settings/api-tokens`} class="modal-form">
          <CsrfField token={session.csrfToken} />
          <div class="field"><label for="token-name">Token name</label><input id="token-name" name="name" maxlength={64} placeholder="Production publisher" required /><p>Use a name that identifies where the secret is stored.</p></div>
          <div class="scope-preview"><span>Scope</span><code>{team.slug}</code><small>artifacts:publish · artifacts:read</small></div>
          <div class="modal-actions"><button class="button secondary" type="button" data-dialog-close>Cancel</button><button class="button primary" type="submit">Create token</button></div>
        </form>
      </dialog>
    </DashboardDocument>
  );
}

export function ProjectsPage({ session, projects, feedback }: { session: DashboardSession; projects: DashboardProject[]; feedback?: ActionFeedback }) {
  const team = session.team!;
  return (
    <DashboardDocument session={session} title={`${team.name} projects`} active="projects">
      <PageHeader
        eyebrow="Projects"
        title="Team projects"
        description="Organize artifacts into named groups. An artifact can belong to several projects."
        actions={<button class="button primary" type="button" data-dialog-open="create-project">New project</button>}
      />
      <Feedback error={feedback?.error} notice={feedback?.notice} />
      <div class="table-panel">
        <div class="table-toolbar"><h2>Projects</h2><span>{projects.length} total</span></div>
        {projects.length ? (
          <div class="data-table project-table" role="table" aria-label="Team projects">
            <div class="table-row table-head" role="row"><span>Project</span><span>Artifacts</span><span>Created</span><span>Action</span></div>
            {projects.map((project) => (
              <div class="table-row" role="row" key={project.id}>
                <span><strong>{project.name}</strong></span>
                <span><a class="row-action" href={`/dashboard/${team.id}/artifacts?project=${encodeURIComponent(project.id)}`}>{project.artifactCount} {project.artifactCount === 1 ? "artifact" : "artifacts"}</a></span>
                <span>{formatDate(project.createdAt, session.timeZone)}</span>
                <span>
                  <form method="post" action={`/dashboard/${team.id}/projects/${encodeURIComponent(project.id)}/delete`} data-confirm={`Delete ${project.name}? Artifacts remain, but leave this project.`}>
                    <CsrfField token={session.csrfToken} />
                    <button class="danger-link" type="submit">Delete</button>
                  </form>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No projects yet" body="Create a project to group related artifacts, then use Organize on any artifact to add it." />
        )}
      </div>

      <dialog id="create-project" class="modal">
        <div class="modal-head"><div><p class="section-label">New project</p><h2>Create project</h2></div><button class="icon-button" type="button" data-dialog-close aria-label="Close">×</button></div>
        <form method="post" action={`/dashboard/${team.id}/projects`} class="modal-form">
          <CsrfField token={session.csrfToken} />
          <div class="field"><label for="project-name">Project name</label><input id="project-name" name="name" maxlength={64} placeholder="Release bundles" required /><p>Use a short name your team recognizes.</p></div>
          <div class="modal-actions"><button class="button secondary" type="button" data-dialog-close>Cancel</button><button class="button primary" type="submit">Create project</button></div>
        </form>
      </dialog>
    </DashboardDocument>
  );
}

function TokenRow({ team, token, csrfToken }: { team: DashboardSession["team"]; token: DashboardToken; csrfToken: string }) {
  const status = token.revokedAt ? "Revoked" : new Date(token.expiresAt).getTime() <= Date.now() ? "Expired" : "Active";
  return (
    <div class="table-row" role="row">
      <span><strong>{token.name}</strong><small>{token.permissions.join(" · ")}</small></span>
      <span><strong>{token.owner.name}</strong><small>{token.owner.email}</small></span>
      <span>{formatDate(token.lastUsedAt)}</span>
      <span>{formatDate(token.expiresAt)}</span>
      <span><span class={`status ${status.toLowerCase()}`}>{status}</span></span>
      <span>{!token.revokedAt ? <form method="post" action={`/dashboard/${team!.id}/settings/api-tokens/revoke`} data-confirm={`Revoke ${token.name}? Future refreshes will stop immediately.`}><CsrfField token={csrfToken} /><input type="hidden" name="tokenId" value={token.id} /><button class="danger-link" type="submit">Revoke</button></form> : <span class="muted">—</span>}</span>
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
        {page.items.length ? <div class="data-table device-table" role="table" aria-label="Connected devices"><div class="table-row table-head" role="row"><span>Device</span><span>Connected by</span><span>Last refreshed</span><span>Expires</span><span>Status</span><span>Action</span></div>{page.items.map((device) => <DeviceRow key={device.id} team={team} device={device} csrfToken={session.csrfToken} />)}</div> : <EmptyState title="No connected devices" body="Run artifact-sync login and approve the code to connect the first machine." actionHref="/auth/device" actionLabel="Connect a device" />}
      </div>
      {page.nextCursor ? <a class="button secondary pagination-next" href={`/dashboard/${team.id}/settings/devices?scope=${scope}&cursor=${encodeURIComponent(page.nextCursor)}`}>Next page</a> : null}
    </DashboardDocument>
  );
}

function DeviceRow({ team, device, csrfToken }: { team: DashboardSession["team"]; device: DashboardDevice; csrfToken: string }) {
  const status = device.revokedAt ? "Revoked" : new Date(device.expiresAt).getTime() <= Date.now() ? "Expired" : "Connected";
  return (
    <div class="table-row" role="row">
      <span><strong>{device.name}</strong><small>{[device.platform, device.clientVersion ? `v${device.clientVersion}` : null].filter(Boolean).join(" · ") || "Artifact Sync CLI"}</small></span>
      <span><strong>{device.owner.name}</strong><small>{device.owner.email}</small></span>
      <span>{formatDate(device.lastUsedAt)}</span>
      <span>{formatDate(device.expiresAt)}</span>
      <span><span class={`status ${status.toLowerCase()}`}>{status}</span></span>
      <span>{!device.revokedAt ? <form method="post" action={`/dashboard/${team!.id}/settings/devices/revoke`} data-confirm={`Revoke ${device.name}? The device will need to sign in again.`}><CsrfField token={csrfToken} /><input type="hidden" name="tokenId" value={device.tokenId} /><button class="danger-link" type="submit">Revoke</button></form> : <span class="muted">—</span>}</span>
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

export function AccountSettingsPage({ session }: { session: DashboardSession }) {
  return (
    <DashboardDocument session={session} title="Account settings" active="account" bodyClass="account-page">
      <PageHeader
        eyebrow="Account"
        title="Account settings"
        description="Review your identity and choose how the dashboard should look."
      />
      <div class="account-settings-grid">
        <section class="settings-section" aria-labelledby="profile-heading">
          <div class="section-heading"><div><h2 id="profile-heading">Profile</h2><p>These fields come from your verified sign-in.</p></div></div>
          <dl class="profile-details">
            <div><dt>Name</dt><dd>{session.identity.name}</dd></div>
            <div><dt>Email</dt><dd>{session.identity.email}</dd></div>
          </dl>
          <p class="permission-note">Your verified sign-in supplies these details.</p>
        </section>
        <section class="settings-section" aria-labelledby="appearance-heading">
          <div class="section-heading"><div><h2 id="appearance-heading">Appearance</h2><p>Choose a theme for this browser.</p></div></div>
          <ThemePicker theme={session.theme} />
          <p class="permission-note">System follows your operating system preference. The choice applies to the dashboard and device approval page.</p>
        </section>
      </div>
    </DashboardDocument>
  );
}

export function DeviceApprovalPage({ session, code, success, error }: { session: DashboardSession; code: string; success?: boolean; error?: string | null }) {
  const identity = session.identity;
  return (
    <html lang="en" data-theme={session.theme} data-theme-state={resolvedTheme(session.theme)}>
      <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><ThemeMetadata theme={session.theme} /><title>Authorize device · Artifact Sync</title><link rel="stylesheet" href="/assets/dashboard.css" /><script src="/assets/dashboard.js" defer /></head>
      <body class="approval-page">
        <header class="approval-header"><a class="brand" href="/dashboard"><span class="brand-mark">A</span><span>Artifact Sync</span></a><span>{identity.email}</span></header>
        <main class="approval-main">
          <section class="approval-copy"><p class="page-eyebrow">Device authorization</p><h1>Approve a trusted machine.</h1><p>Confirm the code printed by <code>artifact-sync login</code>. The device receives access to one team only.</p><ol><li>Keep the CLI open.</li><li>Confirm the short code.</li><li>Choose the destination team.</li></ol></section>
          <section class="approval-card">
            {success ? <div class="approval-success"><span class="success-mark">✓</span><h2>Device approved</h2><p>Return to the terminal. The CLI will finish connecting automatically.</p><a class="button primary" href="/dashboard">Open dashboard</a></div> : <><div class="modal-head"><div><p class="section-label">Verification</p><h2>Authorize device</h2></div><span class="status pending">10 min expiry</span></div><Feedback error={error} /><form method="post" action="/auth/device" class="modal-form"><CsrfField token={session.csrfToken} /><div class="field"><label for="user-code">Device code</label><input id="user-code" name="userCode" class="code-input" value={code} minlength={8} maxlength={8} pattern="[A-HJ-NP-Z2-9]{8}" autocomplete="one-time-code" required /></div><div class="field"><label for="teamId">Grant access to</label><select id="teamId" name="teamId" required>{session.teams.map((team) => <option value={team.id}>{team.name} · {team.slug}</option>)}</select></div><button class="button primary" type="submit">Approve device</button></form></>}
          </section>
        </main>
      </body>
    </html>
  );
}

export function EmptyState({ title, body, actionHref, actionLabel }: { title: string; body: string; actionHref?: string; actionLabel?: string }) {
  return <div class="empty-state"><span class="empty-icon">/</span><h3>{title}</h3><p>{body}</p>{actionHref && actionLabel ? <a class="button secondary" href={actionHref}>{actionLabel}</a> : null}</div>;
}
