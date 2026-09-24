import { describe, expect, it } from "bun:test";
import { renderToString } from "hono/jsx/dom/server";
import { ArtifactsPage, DashboardDocument, DeviceApprovalPage, GeneralSettingsPage, OverviewPage, TokensPage } from "../src/web/dashboard.tsx";
import type { DashboardSession } from "../src/web/dashboard-service.ts";

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
    expect(html).not.toContain('<aside class="sidebar"');
  });

  it("lists every artifact passed from the team-scoped R2 page", async () => {
    const html = await renderToString(
      <ArtifactsPage
        session={session("sidebar")}
        currentPrefix=""
        nextCursor="next-page"
        objects={[
          { path: "config/app.json", size: 1024, uploadedAt: "2026-09-24T10:00:00.000Z" },
          { path: "notes.md", size: 2048, uploadedAt: "2026-09-24T11:00:00.000Z" },
        ]}
      />,
    );

    expect(html).toContain("All published artifacts");
    expect(html).toContain("config/app.json");
    expect(html).toContain("notes.md");
    expect(html).toContain("Next page");
  });

  it("preserves nested folder prefixes in artifact pagination", async () => {
    const html = await renderToString(
      <ArtifactsPage
        session={session("sidebar")}
        currentPrefix="reports/daily/"
        nextCursor="next-page"
        objects={[{ path: "reports/daily/today.json", size: 16, uploadedAt: "2026-09-24T10:00:00.000Z" }]}
      />,
    );

    expect(html).toContain("prefix=reports%2Fdaily&amp;");
    expect(html).toContain("cursor=next-page");
  });

  it("uses a path filter instead of incomplete delimiter folder pagination", async () => {
    const html = await renderToString(
      <ArtifactsPage
        session={session("sidebar")}
        currentPrefix="reports/"
        nextCursor={null}
        objects={[]}
      />,
    );

    expect(html).toContain('name="prefix"');
    expect(html).toContain('value="reports"');
    expect(html).toContain("Clear");
    expect(html).toContain("No artifacts found");
  });

  it("derives the overview artifact URL from the current request origin", async () => {
    const html = await renderToString(
      <OverviewPage
        session={session("sidebar")}
        origin="http://127.0.0.1:8787"
        artifacts={[]}
        counts={{ tokens: 2, devices: 1 }}
      />,
    );

    expect(html).toContain("http://127.0.0.1:8787/w3dev/");
    expect(html).not.toContain("Private artifact base URL</p><code>https://artifact.w3dev.app");
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

    const approvalHtml = await renderToString(<DeviceApprovalPage session={session("sidebar")} code="ABCD2345" />);
    expect(approvalHtml).toContain("ABCD2345");
    expect(approvalHtml).toContain("W3Dev · w3dev");
    expect(approvalHtml).toContain("Approve device");
  });
});
