import { describe, expect, it } from "bun:test";
import { renderToString } from "hono/jsx/dom/server";
import { createMigratedDb } from "./d1.ts";
import { AccountSettingsPage, ArtifactDetailPage, ArtifactsPage, DashboardDocument, DeviceApprovalPage, DevicesPage, GeneralSettingsPage, OverviewPage, ProjectsPage, TokensPage } from "../src/web/dashboard.tsx";
import {
  createDashboardProject,
  backfillArtifactMetadata,
  groupArtifacts,
  listDashboardArtifactFiles,
  listDashboardArtifacts,
  listDashboardProjects,
  mergeArtifacts,
  reconcileArtifacts,
  setArtifactProjects,
  toggleArtifactPin,
  updateArtifactShare,
  getDashboardArtifact,
  type DashboardArtifact,
  type DashboardSession,
} from "../src/web/dashboard-service.ts";
import { defaultSidebarPreference, parseSidebarCookieValue, parseThemeCookieValue, readDashboardPreferences, serializeSidebarCookie, serializeThemeCookie } from "../src/web/dashboard-preferences.ts";
import { artifactShareStyles, dashboardScript, dashboardStyles } from "../src/web/dashboard-assets.ts";

const team = {
  id: "team-1",
  name: "W3Dev",
  slug: "w3dev",
  role: "owner" as const,
};
const shareToken = "s".repeat(43);

function session(layout: "sidebar" | "topnav"): DashboardSession {
  return {
    identity: { id: "user-1", name: "Ashutosh Kumar", email: "ashutosh@w3.dev" },
    csrfToken: "csrf-token",
    teams: [team],
    team,
    layout,
    timeZone: "UTC",
    theme: "system",
    sidebar: defaultSidebarPreference(),
  };
}

function artifact(slug: string, overrides: Partial<DashboardArtifact> = {}) {
  return {
    slug,
    createdAt: null,
    lastActivityAt: null,
    pinnedAt: null,
    projects: [],
    share: { active: false, token: null, createdAt: null, revokedAt: null },
    ...overrides,
  };
}

function createTestEnv(files: Record<string, Array<{ key: string; uploaded: Date }>> = {}) {
  const { sqlite, db } = createMigratedDb();
  sqlite.exec(`INSERT INTO teams (id, name, slug, created_at) VALUES ('team-1', 'W3Dev', 'w3dev', 0)`);
  const bucket = {
    async list(options: R2ListOptions) {
      const prefix = options.prefix ?? "";
      if (options.delimiter === "/") {
        return {
          objects: [],
          delimitedPrefixes: Object.keys(files).filter((key) => key.startsWith(prefix)),
          truncated: false,
        };
      }
      const entries = files[prefix] ?? [];
      return {
        objects: entries.map((entry) => ({
          key: `${prefix}${entry.key}`,
          size: 1,
          uploaded: entry.uploaded,
          httpEtag: '"etag"',
        })),
        delimitedPrefixes: [],
        truncated: false,
      };
    },
    async head(key: string) {
      const match = /^(uploads\/[^/]+\/artifacts\/[^/]+\/)(.+)$/u.exec(key);
      if (!match || !(files[match[1]] ?? []).some((entry) => entry.key === match[2])) return null;
      return {
        size: 1,
        uploaded: new Date("2026-09-24T10:00:00.000Z"),
        httpEtag: '"index"',
        writeHttpMetadata(headers: Headers) { headers.set("Content-Type", "text/html; charset=utf-8"); },
      };
    },
  };
  return { env: { DB: db, ARTIFACTS_BUCKET: bucket }, sqlite };
}

describe("dashboard server rendering", () => {
  it("renders the sidebar layout with full team and account context", async () => {
    const html = await renderToString(
      <DashboardDocument session={session("sidebar")} title="Overview" active="overview">
        <p>Workspace content</p>
      </DashboardDocument>,
    );

    expect(html).toContain('class="dashboard-frame layout-sidebar"');
    expect(html).toContain('class="sidebar"');
    expect(html).toContain("W3Dev");
    expect(html).toContain('action="/auth/logout"');
    expect(html).toContain('name="csrfToken" value="csrf-token"');
    expect(html).toContain('href="/dashboard/team-1/artifacts"');
    expect(html).toContain('href="/dashboard/team-1/projects"');
    expect(html).toContain("Workspace content");
    const footer = html.slice(html.indexOf('class="sidebar-foot"'), html.indexOf("</aside>"));
    expect(footer).toContain('class="account-menu sidebar-account"');
  });

  it("renders theme metadata, the full mobile destination surface, and sidebar controls", async () => {
    const html = await renderToString(
      <DashboardDocument session={session("sidebar")} title="Overview" active="overview">
        <p>Workspace content</p>
      </DashboardDocument>,
    );

    expect(html).toContain('data-theme="system"');
    expect(html).toContain('data-theme-state="system"');
    expect(html).toContain('data-sidebar-width="236"');
    expect(html).toContain('data-sidebar-last-expanded="236"');
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-valuemin="140"');
    expect(html).toContain('aria-valuemax="320"');
    expect(html).toContain('data-mobile-nav-open');
    expect(html).toContain('id="mobile-dashboard-navigation"');
    expect(html).toContain('href="/dashboard/team-1/settings/general"');
    expect(html).toContain('href="/account/settings"');
    expect(html).toContain('data-theme-choice="light"');
    expect(html).toContain('data-theme-choice="dark"');
    expect(html).not.toContain(" style=");
  });

  it("renders a no-team account page with read-only identity and appearance controls", async () => {
    const noTeamSession: DashboardSession = {
      ...session("sidebar"),
      teams: [],
      team: undefined,
      theme: "light",
    };
    const html = await renderToString(<AccountSettingsPage session={noTeamSession} />);

    expect(html).toContain("Account settings");
    expect(html).toContain("Ashutosh Kumar");
    expect(html).toContain("ashutosh@w3.dev");
    expect(html).toContain('data-theme="light"');
    expect(html).toContain('data-theme-choice="light" aria-pressed="true"');
    expect(html).toContain("Your verified sign-in supplies these details.");
    expect(html).not.toContain("Team settings");
  });

  it("renders the top navigation variant with equivalent resource links", async () => {
    const html = await renderToString(
      <DashboardDocument session={session("topnav")} title="Overview" active="artifacts">
        <p>Workspace content</p>
      </DashboardDocument>,
    );

    expect(html).toContain('class="dashboard-frame layout-topnav"');
    expect(html).toContain('class="top-navigation"');
    expect(html).toContain('href="/dashboard/team-1/settings/devices"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('class="account-menu"');
    expect(html).not.toContain("sidebar-account");
    expect(html).not.toContain('<aside class="sidebar"');
  });

  it("groups artifacts into sections with pinned first and mutation forms", async () => {
    const html = await renderToString(
      <ArtifactsPage
        session={session("sidebar")}
        activeProjectId={null}
        list={{
          items: [
            artifact("reports", {
              pinnedAt: "2026-01-02T10:00:00.000Z",
              lastActivityAt: "2026-01-05T10:00:00.000Z",
              share: { active: true, token: shareToken, createdAt: "2026-01-05T10:00:00.000Z", revokedAt: null },
            }),
            artifact("notes", { lastActivityAt: "2026-01-04T10:00:00.000Z" }),
          ],
          total: 2,
          nextCursor: "2",
          projects: [{ id: "p1", name: "Relay" }],
        }}
        origin="https://artifact.w3dev.app"
      />,
    );

    expect(html).toContain("Published artifacts");
    expect(html).toContain("reports");
    expect(html).toContain("notes");
    expect(html).toContain("/dashboard/team-1/artifacts/reports");
    expect(html).toContain(">Pinned<");
    expect(html).toContain(">Older<");
    expect(html).toContain(">Pin<");
    expect(html).toContain(">Unpin<");
    expect(html).toContain('value="csrf-token"');
    expect(html).toContain('action="/dashboard/team-1/artifacts/notes/pin"');
    expect(html).toContain('aria-label="Filter by project"');
    expect(html).toContain('aria-label="Actions for reports"');
    expect(html).toContain('data-dialog-open="share-dialog-team-1-reports"');
    expect(html).toContain(">Shared<");
    expect(html).toContain('<dialog id="share-dialog-team-1-reports"');
    expect(html).toContain('aria-labelledby="share-dialog-team-1-reports-heading"');
    expect(html).toContain('name="context" value="list"');
    expect(html).toContain('aria-label="Close share dialog"');
    expect(html).toContain("Relay");
    expect(html).toContain("Next page");
    expect(html).toContain("after=2");
  });

  it("keeps list share mutations scoped to the project and disables them for members", async () => {
    const memberSession: DashboardSession = {
      ...session("sidebar"),
      team: { ...team, role: "member" },
      teams: [{ ...team, role: "member" }],
    };
    const html = await renderToString(
      <ArtifactsPage
        session={memberSession}
        activeProjectId="p1"
        list={{
          items: [artifact("reports", { share: { active: true, token: shareToken, createdAt: "2026-01-05T10:00:00.000Z", revokedAt: null } })],
          total: 1,
          nextCursor: null,
          projects: [{ id: "p1", name: "Relay" }],
        }}
        origin="https://artifact.w3dev.app"
      />,
    );

    expect(html).toContain('data-dialog-open="share-dialog-team-1-reports"');
    expect(html).toContain('name="context" value="list"');
    expect(html).toContain('name="project" value="p1"');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('name="action" value="regenerate"');
  });

  it("browses nested files within a single artifact and offers project assignment", async () => {
    const html = await renderToString(
      <ArtifactDetailPage
        session={session("sidebar")}
        artifact="reports"
        artifactMeta={artifact("reports", {
          pinnedAt: "2026-01-02T10:00:00.000Z",
          projects: [{ id: "p1", name: "Relay" }],
          share: { active: true, token: shareToken, createdAt: "2026-01-05T10:00:00.000Z", revokedAt: null },
        })}
        projects={[{ id: "p1", name: "Relay" }, { id: "p2", name: "Scratch" }]}
        embedToken="embed-token-value"
        origin="https://artifact.w3dev.app"
        nextCursor="next-page"
        files={[{ path: "daily/today.json", size: 16, uploadedAt: "2026-09-24T10:00:00.000Z" }]}
      />,
    );

    expect(html).toContain("daily/today.json");
    expect(html).toContain('href="/w3dev/reports/daily/today.json"');
    expect(html).toContain("cursor=next-page");
    expect(html).toContain('id="projects"');
    expect(html).toContain('name="projectIds"');
    expect(html).toContain("Unpin");
    expect(html).toContain('id="embed-token"');
    expect(html).toContain("?token=embed-token-value");
    expect(html).toContain("Copy token");
    expect(html).toContain('class="share-control" open=""');
    expect(html).toContain("Anyone with the link");
    expect(html).toContain(`https://artifact.w3dev.app/w3dev/reports/index.html?share=${shareToken}`);
    expect(html).toContain("Regenerate link");
    expect(html).toContain('value="csrf-token"');
  });

  it("renders the same share choices for members while disabling mutations", async () => {
    const memberSession: DashboardSession = {
      ...session("sidebar"),
      team: { ...team, role: "member" },
      teams: [{ ...team, role: "member" }],
    };
    const html = await renderToString(
      <ArtifactDetailPage
        session={memberSession}
        artifact="reports"
        artifactMeta={artifact("reports", { share: { active: false, token: null, createdAt: null, revokedAt: "2026-01-05T10:00:00.000Z" } })}
        projects={[]}
        embedToken={null}
        origin="https://artifact.w3dev.app"
        files={[]}
        nextCursor={null}
      />,
    );

    expect(html).toContain("Only me");
    expect(html).toContain("Anyone with the link");
    expect(html).toContain("Only a team owner can change this sharing setting.");
    expect(html).toContain('disabled=""');
    expect(html).not.toContain("Regenerate link");
  });

  it("shows an explicit empty state when the team has no artifact directories", async () => {
    const html = await renderToString(
      <ArtifactsPage
        session={session("sidebar")}
        activeProjectId={null}
        list={{ items: [], total: 0, nextCursor: null, projects: [] }}
      />,
    );

    expect(html).toContain("No artifacts found");
    expect(html).toContain("Create a non-empty folder under ~/.agents/artifacts");
  });

  it("renders the overview as a two-column summary without the role metric", async () => {
    const html = await renderToString(
      <OverviewPage
        session={session("sidebar")}
        artifacts={[artifact("reports"), artifact("notes")]}
        artifactsTotal={2}
        counts={{ tokens: 2, devices: 1 }}
      />,
    );

    expect(html).toContain('aria-label="Workspace summary"');
    expect(html).not.toContain("Your role");
    expect(html).toContain("Connected devices");
    expect(html).toContain("API credentials");
    expect(html).toContain("Quick actions");
    expect(html).toContain("View all artifacts");
    expect(html).toContain('href="/dashboard/team-1/settings/devices"');
    expect(html).toContain('href="/dashboard/team-1/settings/api-tokens"');
    expect(html).toContain("reports");
  });

  it("paginates R2 artifact prefixes, excludes invalid entries, and follows R2 cursors", async () => {
    const calls: R2ListOptions[] = [];
    const env = {
      ARTIFACTS_BUCKET: {
        async list(options: R2ListOptions) {
          calls.push(options);
          if (!options.cursor) {
            return {
              objects: [],
              delimitedPrefixes: [
                `${options.prefix}alpha/`,
                `${options.prefix}beta/`,
                `${options.prefix}bad_name/`,
                "uploads/another-team/artifacts/foreign/",
              ],
              truncated: true,
              cursor: "page-2",
            };
          }
          return {
            objects: [],
            delimitedPrefixes: [`${options.prefix}gamma/`],
            truncated: false,
          };
        },
      },
    };

    const result = await listDashboardArtifacts(env as never, "team-1", null, { limit: 2 });
    if (result instanceof Response) throw new Error("expected artifact page");
    expect(result.items.map((item) => item.slug)).toEqual(["alpha", "beta"]);
    expect(result.total).toBe(3);
    expect(result.nextCursor).toBe("2");
    expect(result.missingSlugs).toEqual(["alpha", "beta", "gamma"]);
    expect(calls[0]).toMatchObject({ prefix: "uploads/team-1/artifacts/", delimiter: "/", limit: 1000 });
    expect(calls[1]).toMatchObject({ cursor: "page-2" });

    const secondPage = await listDashboardArtifacts(env as never, "team-1", "2", { limit: 2 });
    if (secondPage instanceof Response) throw new Error("expected second artifact page");
    expect(secondPage.items.map((item) => item.slug)).toEqual(["gamma"]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it("lists nested files relative to one artifact prefix", async () => {
    const env = {
      ARTIFACTS_BUCKET: {
        async list(options: R2ListOptions) {
          return {
            objects: [{
              key: `${options.prefix}nested/output.json`,
              size: 16,
              uploaded: new Date("2026-09-24T10:00:00.000Z"),
              httpEtag: '"file"',
            }],
            delimitedPrefixes: [],
            truncated: false,
          };
        },
      },
    };
    const result = await listDashboardArtifactFiles(env as never, "team-1", "reports", null);
    if (result instanceof Response) throw new Error("expected artifact files");
    expect(result.items).toEqual([{
      path: "nested/output.json",
      size: 16,
      uploadedAt: "2026-09-24T10:00:00.000Z",
      etag: '"file"',
    }]);
  });

  it("orders merged artifacts pinned first, then by last activity", () => {
    const at = (hours: number) => new Date(Date.UTC(2026, 8, 20, hours)).toISOString();
    const merged = mergeArtifacts(
      ["a", "b", "c", "d"],
      [
        { slug: "a", createdAt: new Date(0), lastActivityAt: new Date(at(5)), pinnedAt: null },
        { slug: "b", createdAt: new Date(0), lastActivityAt: new Date(at(9)), pinnedAt: null },
        { slug: "c", createdAt: new Date(0), lastActivityAt: new Date(at(2)), pinnedAt: new Date(at(12)) },
        { slug: "d", createdAt: new Date(0), lastActivityAt: new Date(at(7)), pinnedAt: null },
      ],
      [{ slug: "b", projectId: "p1" }],
      [{ id: "p1", name: "Relay" }],
    );

    expect(merged.map((item) => item.slug)).toEqual(["c", "b", "d", "a"]);
    expect(merged[1].projects).toEqual([{ id: "p1", name: "Relay" }]);
  });

  it("buckets artifacts by viewer timezone boundaries", () => {
    const now = new Date("2026-09-26T12:00:00.000Z");
    const sections = groupArtifacts(
      [
        artifact("pinned-old", { pinnedAt: "2026-01-01T00:00:00.000Z", lastActivityAt: "2026-01-01T00:00:00.000Z" }),
        artifact("today-utc", { lastActivityAt: "2026-09-26T08:00:00.000Z" }),
        artifact("yesterday-utc", { lastActivityAt: "2026-09-25T20:00:00.000Z" }),
        artifact("this-week", { lastActivityAt: "2026-09-22T00:00:00.000Z" }),
        artifact("older", { lastActivityAt: "2026-08-01T00:00:00.000Z" }),
        artifact("unknown"),
      ],
      "UTC",
      now,
    );

    const byId = new Map(sections.map((section) => [section.id, section]));
    expect(sections.map((section) => section.label)).toEqual(["Pinned", "Today", "Yesterday", "This week", "Older"]);
    expect(byId.get("today")!.artifacts.map((item) => item.slug)).toEqual(["today-utc"]);
    expect(byId.get("yesterday")!.artifacts.map((item) => item.slug)).toEqual(["yesterday-utc"]);
    expect(byId.get("week")!.artifacts.map((item) => item.slug)).toEqual(["this-week"]);
    expect(byId.get("older")!.artifacts.map((item) => item.slug)).toEqual(["older", "unknown"]);

    // 2026-09-26T01:00Z is "today" in UTC, but still "yesterday" in UTC+14.
    const utc = groupArtifacts([artifact("edge", { lastActivityAt: "2026-09-26T01:00:00.000Z" })], "UTC", now);
    expect(utc.map((section) => section.id)).toEqual(["today"]);
    const ahead = groupArtifacts([artifact("edge", { lastActivityAt: "2026-09-26T01:00:00.000Z" })], "Pacific/Kiritimati", now);
    expect(ahead.map((section) => section.id)).toEqual(["yesterday"]);
  });

  it("shows one-time token material and team-wide credential scope", async () => {
    const html = await renderToString(
      <TokensPage
        session={session("sidebar")}
        page={{
          items: [{
            id: "api-1",
            name: "Production publisher",
            owner: { id: "user-1", name: "Ashutosh Kumar", email: "ashutosh@w3.dev" },
            permissions: ["artifacts:publish", "artifacts:read"],
            createdAt: "2026-09-24T10:00:00.000Z",
            lastUsedAt: "2026-09-24T11:00:00.000Z",
            expiresAt: "2026-12-23T10:00:00.000Z",
            revokedAt: null,
          }],
          nextCursor: null,
        }}
        createdToken={{ name: "Production publisher", token: "as_api_example_secret" }}
      />,
    );

    expect(html).toContain("as_api_example_secret");
    expect(html).toContain("Created once");
    expect(html).toContain("w3dev");
    expect(html).toContain("Revoke");
    expect(html).toContain('name="csrfToken" value="csrf-token"');
  });

  it("adds the session CSRF field to device revocation forms", async () => {
    const html = await renderToString(
      <DevicesPage
        session={session("sidebar")}
        scope="mine"
        page={{
          items: [{
            id: "device-1",
            tokenId: "api-1",
            name: "Laptop",
            platform: "linux",
            clientVersion: "0.1.2",
            owner: { id: "user-1", name: "Ashutosh Kumar", email: "ashutosh@w3.dev" },
            createdAt: "2026-09-24T10:00:00.000Z",
            lastUsedAt: "2026-09-24T11:00:00.000Z",
            expiresAt: "2026-12-23T10:00:00.000Z",
            revokedAt: null,
          }],
          nextCursor: null,
        }}
      />,
    );

    expect(html).toContain("Laptop");
    expect(html).toContain('name="csrfToken" value="csrf-token"');
  });

  it("renders projects with create and delete affordances", async () => {
    const html = await renderToString(
      <ProjectsPage
        session={session("sidebar")}
        projects={[{ id: "p1", name: "Relay", artifactCount: 3, createdAt: "2026-09-24T10:00:00.000Z" }]}
      />,
    );

    expect(html).toContain("Relay");
    expect(html).toContain('href="/dashboard/team-1/artifacts?project=p1"');
    expect(html).toContain("3 artifacts");
    expect(html).toContain('action="/dashboard/team-1/projects/p1/delete"');
    expect(html).toContain('action="/dashboard/team-1/projects"');
    expect(html).toContain('class="data-table project-table"');
    expect(html).toContain('class="project-action-cell"');
    expect(html).toContain('class="danger-link project-delete"');
    expect(html).toContain('class="project-cell-label">Artifacts</span>');
    expect(html).toContain('class="project-cell-label">Created</span>');
    expect(html).toContain('data-dialog-open="create-project"');
    expect(html).toContain('name="csrfToken" value="csrf-token"');
  });

  it("renders slug history, cooldown state, and device approval", async () => {
    const settingsHtml = await renderToString(
      <GeneralSettingsPage
        session={session("sidebar")}
        origin="http://127.0.0.1:8787"
        settings={{
          canChangeSlug: false,
          nextAvailableAt: "2026-10-24T10:00:00.000Z",
          slugHistory: [
            { slug: "w3dev", isCurrent: true, changedAt: null, changedByName: null },
            { slug: "old-w3dev", isCurrent: false, changedAt: "2026-09-24T10:00:00.000Z", changedByName: "Ashutosh Kumar" },
          ],
        }}
      />,
    );
    expect(settingsHtml).toContain("old-w3dev");
    expect(settingsHtml).toContain("Next change available");
    expect(settingsHtml).toContain("http://127.0.0.1:8787/w3dev/");
    expect(settingsHtml).toContain('data-copy-target="artifact-base-url"');
    expect(settingsHtml).toContain('name="csrfToken" value="csrf-token"');

    const approvalHtml = await renderToString(<DeviceApprovalPage session={session("sidebar")} code="ABCD2345" />);
    expect(approvalHtml).toContain("ABCD2345");
    expect(approvalHtml).toContain("W3Dev · w3dev");
    expect(approvalHtml).toContain("Approve device");
    expect(approvalHtml).toContain('name="csrfToken" value="csrf-token"');
    expect(approvalHtml).toContain('data-theme="system"');
    expect(approvalHtml).toContain('name="color-scheme" content="light dark"');
  });
});

describe("dashboard preference contracts", () => {
  it("emits a parseable external dashboard script", () => {
    expect(() => new Function(dashboardScript)).not.toThrow();
  });

  it("emits bounded external selectors for the sidebar rail and widths", () => {
    expect(dashboardStyles).toContain('html[data-layout="sidebar"][data-sidebar-width="64"]{--sidebar:64px}');
    expect(dashboardStyles).toContain('html[data-layout="sidebar"][data-sidebar-width="140"]{--sidebar:140px}');
    expect(dashboardStyles).toContain('html[data-layout="sidebar"][data-sidebar-width="320"]{--sidebar:320px}');
  });

  it("keeps artifact sharing surfaces on theme tokens", () => {
    expect(artifactShareStyles).toContain("background:var(--panel)");
    expect(artifactShareStyles).toContain("border-color:var(--accent);background:var(--panel-hover)");
    expect(artifactShareStyles).not.toContain("background:#121613");
    expect(artifactShareStyles).not.toContain("background:#182111");
  });

  it("validates theme and sidebar cookies at the SSR boundary", () => {
    expect(parseThemeCookieValue("dark")).toBe("dark");
    expect(parseThemeCookieValue("invalid")).toBe("system");
    expect(parseSidebarCookieValue("v1.c0.w280.e240")).toEqual({ collapsed: false, width: 280, lastExpanded: 240 });
    expect(parseSidebarCookieValue("v1.c1.w999.e130")).toEqual({ collapsed: true, width: 64, lastExpanded: 140 });
    expect(parseSidebarCookieValue("v1.c0.wnot-a-width.e236")).toEqual(defaultSidebarPreference());
    expect(serializeThemeCookie("light")).toContain("theme=light; Path=/; Max-Age=31536000; SameSite=Lax");
    expect(serializeSidebarCookie({ collapsed: true, width: 64, lastExpanded: 280 })).toContain("artifact_sync_dashboard_sidebar=v1.c1.w64.e280");
  });

  it("reads only the namespaced preference cookies from a request", () => {
    const request = new Request("https://artifact.w3dev.app/account/settings", {
      headers: { Cookie: "theme=light; artifact_sync_dashboard_sidebar=v1.c0.w310.e270; theme=dark" },
    });
    expect(readDashboardPreferences(request)).toEqual({
      theme: "light",
      sidebar: { collapsed: false, width: 310, lastExpanded: 270 },
    });
  });
});

describe("artifact organization services", () => {
  it("pins artifacts to the top and reconciles legacy metadata from R2", async () => {
    const { env } = createTestEnv({
      "uploads/team-1/artifacts/reports/": [{ key: "a.txt", uploaded: new Date("2026-09-20T10:00:00.000Z") }],
      "uploads/team-1/artifacts/notes/": [
        { key: "old.txt", uploaded: new Date("2026-09-21T09:00:00.000Z") },
        { key: "new.txt", uploaded: new Date("2026-09-24T10:00:00.000Z") },
      ],
    });

    expect(await toggleArtifactPin(env as never, "team-1", "reports", true)).toBe(true);

    const first = await listDashboardArtifacts(env as never, "team-1", null, { limit: 10 });
    if (first instanceof Response) throw new Error("expected artifact list");
    expect(first.items.map((item) => item.slug)).toEqual(["reports", "notes"]);
    expect(first.items[0].pinnedAt).not.toBeNull();
    expect(first.missingSlugs).toEqual(["notes"]);

    await reconcileArtifacts(env as never, "team-1", first.missingSlugs);
    const second = await listDashboardArtifacts(env as never, "team-1", null, { limit: 10 });
    if (second instanceof Response) throw new Error("expected artifact list");
    expect(second.missingSlugs).toEqual([]);
    expect(second.items.map((item) => item.slug)).toEqual(["reports", "notes"]);
    expect(second.items[1].lastActivityAt).toBe("2026-09-24T10:00:00.000Z");
    expect(second.items[1].createdAt).toBe("2026-09-21T09:00:00.000Z");
    expect(second.items.every((item) => item.share.active === false && item.share.token === null)).toBe(true);

    expect(await toggleArtifactPin(env as never, "team-1", "reports", false)).toBe(true);
    const third = await listDashboardArtifacts(env as never, "team-1", null, { limit: 10 });
    if (third instanceof Response) throw new Error("expected artifact list");
    expect(third.items.map((item) => item.slug)).toEqual(["notes", "reports"]);
    expect(third.items[1].pinnedAt).toBeNull();
  });

  it("creates projects, assigns artifacts to several, and filters by project", async () => {
    const { env } = createTestEnv({
      "uploads/team-1/artifacts/reports/": [{ key: "a.txt", uploaded: new Date("2026-09-20T10:00:00.000Z") }],
      "uploads/team-1/artifacts/notes/": [{ key: "b.txt", uploaded: new Date("2026-09-24T10:00:00.000Z") }],
    });

    const relay = await createDashboardProject(env as never, "team-1", "Relay");
    const scratch = await createDashboardProject(env as never, "team-1", "Scratch");
    if (!relay.ok || !scratch.ok) throw new Error("expected project creation to succeed");
    const duplicate = await createDashboardProject(env as never, "team-1", "Relay");
    const invalid = await createDashboardProject(env as never, "team-1", "");
    expect(!duplicate.ok && duplicate.error).toBe("project_name_taken");
    expect(!invalid.ok && invalid.error).toBe("invalid_project_name");

    expect(await setArtifactProjects(env as never, "team-1", "reports", [relay.project.id, scratch.project.id])).toBe(true);
    expect(await setArtifactProjects(env as never, "team-1", "notes", [scratch.project.id])).toBe(true);

    const all = await listDashboardArtifacts(env as never, "team-1", null, { limit: 10 });
    if (all instanceof Response) throw new Error("expected artifact list");
    expect(all.items.find((item) => item.slug === "reports")!.projects.map((project) => project.name)).toEqual(["Relay", "Scratch"]);

    const filtered = await listDashboardArtifacts(env as never, "team-1", null, { limit: 10, projectId: relay.project.id });
    if (filtered instanceof Response) throw new Error("expected filtered list");
    expect(filtered.items.map((item) => item.slug)).toEqual(["reports"]);
    expect(filtered.total).toBe(1);

    expect(await listDashboardArtifacts(env as never, "team-1", null, { projectId: "missing" }) instanceof Response).toBe(true);

    const projects = await listDashboardProjects(env as never, "team-1");
    expect(projects.map((project) => [project.name, project.artifactCount])).toEqual([["Relay", 1], ["Scratch", 2]]);
    expect(projects[0].createdAt).toBeTypeOf("string");
  });

  it("keeps one owner-controlled share row across enable, regenerate, revoke, and backfill", async () => {
    const { env, sqlite } = createTestEnv({
      "uploads/team-1/artifacts/reports/": [
        { key: "index.html", uploaded: new Date("2026-09-24T10:00:00.000Z") },
        { key: "app.js", uploaded: new Date("2026-09-24T10:01:00.000Z") },
      ],
    });

    expect(await updateArtifactShare(env as never, "team-1", "reports", "enable", "admin")).toEqual({ ok: false, error: "team_owner_required" });
    expect(await updateArtifactShare(env as never, "team-1", "reports", "enable", "member")).toEqual({ ok: false, error: "team_owner_required" });

    const enabled = await updateArtifactShare(env as never, "team-1", "reports", "enable", "owner");
    expect(enabled).toEqual({ ok: true, action: "enable" });
    const firstRow = sqlite.prepare("SELECT token, created_at, revoked_at FROM artifact_shares WHERE artifact_id = (SELECT id FROM artifacts WHERE team_id = 'team-1' AND slug = 'reports')").get() as { token: string; created_at: number; revoked_at: number | null };
    expect(firstRow.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(firstRow.revoked_at).toBeNull();

    const idempotent = await updateArtifactShare(env as never, "team-1", "reports", "enable", "owner");
    expect(idempotent).toEqual({ ok: true, action: "enable" });
    const unchangedRow = sqlite.prepare("SELECT token, created_at FROM artifact_shares WHERE artifact_id = (SELECT id FROM artifacts WHERE team_id = 'team-1' AND slug = 'reports')").get();
    expect(unchangedRow).toEqual({ token: firstRow.token, created_at: firstRow.created_at });

    const beforeBackfill = await getDashboardArtifact(env as never, "team-1", "reports");
    expect(beforeBackfill?.share).toMatchObject({ active: true, token: firstRow.token });
    const list = await listDashboardArtifacts(env as never, "team-1", null, { limit: 10 });
    if (list instanceof Response) throw new Error("expected artifact list");
    expect(list.items.find((item) => item.slug === "reports")?.share).toMatchObject({ active: true, token: firstRow.token });
    expect(await backfillArtifactMetadata(env as never, "team-1", "reports")).toBe(true);
    const afterBackfill = await getDashboardArtifact(env as never, "team-1", "reports");
    expect(afterBackfill?.share).toMatchObject({ active: true, token: firstRow.token });

    const regenerated = await updateArtifactShare(env as never, "team-1", "reports", "regenerate", "owner");
    expect(regenerated).toEqual({ ok: true, action: "regenerate" });
    const regeneratedRow = sqlite.prepare("SELECT token, revoked_at FROM artifact_shares WHERE artifact_id = (SELECT id FROM artifacts WHERE team_id = 'team-1' AND slug = 'reports')").get() as { token: string; revoked_at: number | null };
    expect(regeneratedRow.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(regeneratedRow.token).not.toBe(firstRow.token);
    expect(regeneratedRow.revoked_at).toBeNull();

    const revoked = await updateArtifactShare(env as never, "team-1", "reports", "revoke", "owner");
    expect(revoked).toEqual({ ok: true, action: "revoke" });
    const afterRevoke = await getDashboardArtifact(env as never, "team-1", "reports");
    expect(afterRevoke?.share.active).toBe(false);
    expect(afterRevoke?.share.token).toBeNull();
    expect(afterRevoke?.share.revokedAt).toBeTypeOf("string");
  });

  it("requires a live index entry and rejects foreign or missing artifacts", async () => {
    const missingIndex = createTestEnv({
      "uploads/team-1/artifacts/readme/": [{ key: "README.md", uploaded: new Date("2026-09-24T10:00:00.000Z") }],
    });
    expect(await updateArtifactShare(missingIndex.env as never, "team-1", "readme", "enable", "owner"))
      .toEqual({ ok: false, error: "entry_file_required" });

    expect(await updateArtifactShare(missingIndex.env as never, "other-team", "readme", "enable", "owner"))
      .toEqual({ ok: false, error: "artifact_not_found" });
    expect(await updateArtifactShare(missingIndex.env as never, "team-1", "missing", "enable", "owner"))
      .toEqual({ ok: false, error: "artifact_not_found" });
  });
});
