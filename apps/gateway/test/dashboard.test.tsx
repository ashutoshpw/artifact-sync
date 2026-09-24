import { describe, expect, it } from "bun:test";
import { renderToString } from "hono/jsx/dom/server";
import { ArtifactDetailPage, ArtifactsPage, DashboardDocument, DeviceApprovalPage, GeneralSettingsPage, OverviewPage, TokensPage } from "../src/web/dashboard.tsx";
import { listDashboardArtifactFiles, listDashboardArtifacts, type DashboardSession } from "../src/web/dashboard-service.ts";

const team = {
  id: "team-1",
  name: "W3Dev",
  slug: "w3dev",
  role: "owner" as const,
};

function session(layout: "sidebar" | "topnav"): DashboardSession {
  return {
    identity: { id: "user-1", name: "Ashutosh Kumar", email: "ashutosh@w3.dev" },
    teams: [team],
    team,
    layout,
  };
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
    expect(html).toContain('href="/dashboard/team-1/artifacts"');
    expect(html).toContain("Workspace content");
    const footer = html.slice(html.indexOf('class="sidebar-foot"'), html.indexOf("</aside>"));
    expect(footer).toContain('class="account-menu sidebar-account"');
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

  it("lists each artifact directory as one entry", async () => {
    const html = await renderToString(
      <ArtifactsPage
        session={session("sidebar")}
        nextCursor="next-page"
        artifacts={[{ slug: "reports" }, { slug: "notes" }]}
      />,
    );

    expect(html).toContain("Published artifacts");
    expect(html).toContain("Each immediate folder under the publishing root is one artifact");
    expect(html).toContain("reports");
    expect(html).toContain("notes");
    expect(html).toContain("/dashboard/team-1/artifacts/reports");
    expect(html).toContain("Next page");
  });

  it("browses nested files within a single artifact", async () => {
    const html = await renderToString(
      <ArtifactDetailPage
        session={session("sidebar")}
        artifact="reports"
        nextCursor="next-page"
        files={[{ path: "daily/today.json", size: 16, uploadedAt: "2026-09-24T10:00:00.000Z" }]}
      />,
    );

    expect(html).toContain("daily/today.json");
    expect(html).toContain('href="/w3dev/reports/daily/today.json"');
    expect(html).toContain("cursor=next-page");
  });

  it("shows an explicit empty state when the team has no artifact directories", async () => {
    const html = await renderToString(
      <ArtifactsPage
        session={session("sidebar")}
        nextCursor={null}
        artifacts={[]}
      />,
    );

    expect(html).toContain("No artifacts found");
    expect(html).toContain("Create a non-empty folder under ~/.agents/artifacts");
  });

  it("shows artifact directories on the overview and drops the base URL panel", async () => {
    const html = await renderToString(
      <OverviewPage
        session={session("sidebar")}
        artifacts={[{ slug: "reports" }, { slug: "notes" }]}
        counts={{ tokens: 2, devices: 1 }}
      />,
    );

    expect(html).not.toContain("Private artifact base URL");
    expect(html).not.toContain("8+");
    expect(html).toContain("View all artifacts");
    expect(html).toContain("Each directory is one artifact with its own files");
    expect(html.indexOf('aria-label="Workspace summary"')).toBeGreaterThan(html.indexOf("Each directory is one artifact"));
  });

  it("paginates R2 artifact prefixes and excludes invalid and root-level entries", async () => {
    const calls: R2ListOptions[] = [];
    const env = {
      ARTIFACTS_BUCKET: {
        async list(options: R2ListOptions) {
          calls.push(options);
          return {
            objects: [{ key: `${options.prefix}loose.txt`, size: 1, uploaded: new Date(), httpEtag: '"loose"' }],
            delimitedPrefixes: [
              `${options.prefix}alpha/`,
              `${options.prefix}beta/`,
              `${options.prefix}bad_name/`,
              "uploads/another-team/artifacts/foreign/",
            ],
            truncated: true,
            cursor: "page-2",
          };
        },
      },
    };

    const result = await listDashboardArtifacts(env as never, "team-1", null, 10);
    if (result instanceof Response) throw new Error("expected artifact page");
    expect(result.items).toEqual([{ slug: "alpha" }, { slug: "beta" }]);
    expect(result.nextCursor).toBe("page-2");
    expect(calls[0]).toMatchObject({ prefix: "uploads/team-1/artifacts/", delimiter: "/", limit: 10 });
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

    const approvalHtml = await renderToString(<DeviceApprovalPage session={session("sidebar")} code="ABCD2345" />);
    expect(approvalHtml).toContain("ABCD2345");
    expect(approvalHtml).toContain("W3Dev · w3dev");
    expect(approvalHtml).toContain("Approve device");
  });
});
