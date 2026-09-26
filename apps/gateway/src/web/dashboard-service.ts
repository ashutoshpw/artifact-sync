import { and, count, desc, eq, gt, inArray, isNotNull, isNull, lt, or, type SQL } from "drizzle-orm";
import { createDatabase } from "../db/client.ts";
import { apiTokens, artifactProjects, artifactShares, artifacts, deviceAuthorizations, projects, teamMemberships, teamSlugChangeLocks, teamSlugs, teams, user } from "../db/schema.ts";
import { authError } from "../auth/middleware.ts";
import { safePermissions } from "../auth/permissions.ts";
import { isValidTeamSlug, TEAM_SLUG_CHANGE_COOLDOWN_MS } from "../auth/team-slug.ts";
import type { GatewayEnv } from "../auth/types.ts";
import { getWebSession, type WebIdentity } from "../auth/web-session.ts";
import { createArtifactShareToken } from "../content/share.ts";
import { readDashboardPreferences, type SidebarPreference, type ThemePreference } from "./dashboard-preferences.ts";

export type TeamRole = "owner" | "admin" | "member";
export type DashboardLayout = "sidebar" | "topnav";

const R2_PAGE_LIMIT = 1000;
const ARTIFACT_FETCH_CAP = 2000;
const RECONCILIATION_BATCH = 20;
const BACKFILL_PAGE_CAP = 10;

export interface DashboardTeam {
  id: string;
  name: string;
  slug: string;
  role: TeamRole;
}

export interface DashboardSession {
  identity: WebIdentity;
  csrfToken: string;
  teams: DashboardTeam[];
  team?: DashboardTeam;
  layout: DashboardLayout;
  timeZone: string;
  theme: ThemePreference;
  sidebar: SidebarPreference;
}

export interface DashboardArtifact {
  slug: string;
  createdAt: string | null;
  lastActivityAt: string | null;
  pinnedAt: string | null;
  projects: Array<{ id: string; name: string }>;
  share: DashboardArtifactShare;
}

export interface DashboardArtifactShare {
  active: boolean;
  token: string | null;
  createdAt: string | null;
  revokedAt: string | null;
}

export interface DashboardProject {
  id: string;
  name: string;
  artifactCount: number;
  createdAt: string;
}

export interface ArtifactList {
  items: DashboardArtifact[];
  total: number;
  nextCursor: string | null;
  missingSlugs: string[];
  projects: Array<{ id: string; name: string }>;
}

export interface DashboardArtifactFile {
  path: string;
  size: number;
  uploadedAt: string;
  etag?: string;
}

export interface DashboardToken {
  id: string;
  name: string;
  owner: { id: string; name: string; email: string };
  permissions: string[];
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface DashboardDevice {
  id: string;
  tokenId: string;
  name: string;
  platform: string | null;
  clientVersion: string | null;
  owner: { id: string; name: string; email: string };
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface DashboardSettings {
  slugHistory: Array<{
    slug: string;
    isCurrent: boolean;
    changedAt: string | null;
    changedByName: string | null;
  }>;
  canChangeSlug: boolean;
  nextAvailableAt: string | null;
}

export interface DashboardPage<T> {
  items: T[];
  nextCursor: string | null;
}

export async function requireDashboardSession(
  request: Request,
  env: GatewayEnv,
  teamId?: string,
): Promise<DashboardSession | Response> {
  const webSession = await getWebSession(request, env).catch(() => null);
  if (!webSession) return authError(401, "web_session_required");
  const teams = await listUserTeams(webSession.identity.id, env);
  const team = teamId ? teams.find((candidate) => candidate.id === teamId) : teams[0];
  if (teamId && !team) return authError(404, "team_not_found");
  return {
    identity: webSession.identity,
    csrfToken: webSession.csrfToken,
    teams,
    team,
    layout: dashboardLayout(env),
    timeZone: viewerTimeZone(request),
    ...readDashboardPreferences(request),
  };
}

export type ArtifactGroupId = "pinned" | "today" | "yesterday" | "week" | "older";

export interface ArtifactSection {
  id: ArtifactGroupId;
  label: string;
  artifacts: DashboardArtifact[];
}

const GROUP_LABELS: Record<ArtifactGroupId, string> = {
  pinned: "Pinned",
  today: "Today",
  yesterday: "Yesterday",
  week: "This week",
  older: "Older",
};

const DAY = 24 * 60 * 60 * 1000;

export function groupArtifacts(items: DashboardArtifact[], timeZone: string, now = new Date()): ArtifactSection[] {
  const dayKey = zoneDayKey(timeZone);
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - DAY));
  const weekStart = now.getTime() - 7 * DAY;
  const buckets: Record<ArtifactGroupId, DashboardArtifact[]> = {
    pinned: [], today: [], yesterday: [], week: [], older: [],
  };
  for (const artifact of items) {
    if (artifact.pinnedAt) {
      buckets.pinned.push(artifact);
      continue;
    }
    const activity = artifact.lastActivityAt ? Date.parse(artifact.lastActivityAt) : NaN;
    if (Number.isNaN(activity)) {
      buckets.older.push(artifact);
      continue;
    }
    const key = dayKey(new Date(activity));
    if (key === today) buckets.today.push(artifact);
    else if (key === yesterday) buckets.yesterday.push(artifact);
    else if (activity >= weekStart) buckets.week.push(artifact);
    else buckets.older.push(artifact);
  }
  return (Object.keys(buckets) as ArtifactGroupId[])
    .filter((id) => buckets[id].length > 0)
    .map((id) => ({ id, label: GROUP_LABELS[id], artifacts: buckets[id] }));
}

function zoneDayKey(timeZone: string): (date: Date) => string {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
  }
  return (date: Date) => formatter.format(date);
}

export function dashboardLayout(env: GatewayEnv): DashboardLayout {
  return env.DASHBOARD_LAYOUT === "topnav" ? "topnav" : "sidebar";
}

export async function listUserTeams(userId: string, env: GatewayEnv): Promise<DashboardTeam[]> {
  const db = createDatabase(env.DB);
  const rows = await db.select({
    id: teams.id,
    name: teams.name,
    slug: teams.slug,
    role: teamMemberships.role,
  })
    .from(teamMemberships)
    .innerJoin(teams, eq(teamMemberships.teamId, teams.id))
    .where(eq(teamMemberships.userId, userId))
    .orderBy(teams.name);
  return rows;
}

export async function listDashboardArtifacts(
  env: GatewayEnv,
  teamId: string,
  cursor: string | null,
  options: { limit?: number; projectId?: string | null } = {},
): Promise<ArtifactList | Response> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const offset = decodeOffset(cursor);
  if (offset === null) return authError(400, "invalid_cursor");
  const slugs = await listArtifactSlugs(env, teamId);
  if (slugs instanceof Response) return slugs;
  const metadata = await loadArtifactMetadata(env, teamId);
  const merged = mergeArtifacts(slugs, metadata.artifactRows, metadata.memberships, metadata.projects);
  const missingSlugs = merged.filter((artifact) => artifact.lastActivityAt === null).map((artifact) => artifact.slug);
  let visible = merged;
  if (options.projectId) {
    if (!metadata.projects.some((project) => project.id === options.projectId)) return authError(404, "project_not_found");
    visible = merged.filter((artifact) => artifact.projects.some((project) => project.id === options.projectId));
  }
  const page = visible.slice(offset, offset + limit);
  return {
    items: page,
    total: visible.length,
    nextCursor: offset + limit < visible.length ? String(offset + limit) : null,
    missingSlugs,
    projects: metadata.projects.map(({ id, name }) => ({ id, name })),
  };
}

async function listArtifactSlugs(env: GatewayEnv, teamId: string): Promise<string[] | Response> {
  const artifactRoot = `uploads/${teamId}/artifacts/`;
  const slugs: string[] = [];
  let cursor: string | undefined;
  try {
    do {
      const result = await env.ARTIFACTS_BUCKET.list({
        prefix: artifactRoot,
        delimiter: "/",
        cursor,
        limit: R2_PAGE_LIMIT,
      });
      for (const delimitedPrefix of result.delimitedPrefixes) {
        if (!delimitedPrefix.startsWith(artifactRoot)) continue;
        const slug = delimitedPrefix.slice(artifactRoot.length).replace(/\/$/u, "");
        if (isValidTeamSlug(slug) && !slugs.includes(slug)) slugs.push(slug);
      }
      cursor = result.truncated ? result.cursor ?? undefined : undefined;
    } while (cursor && slugs.length < ARTIFACT_FETCH_CAP);
  } catch {
    return authError(503, "artifact_storage_unavailable");
  }
  return slugs;
}

interface ArtifactMetaRow {
  slug: string;
  createdAt: Date;
  lastActivityAt: Date;
  pinnedAt: Date | null;
  shareToken?: string | null;
  shareCreatedAt?: Date | null;
  shareRevokedAt?: Date | null;
}

async function loadArtifactMetadata(
  env: GatewayEnv,
  teamId: string,
): Promise<{
  artifactRows: ArtifactMetaRow[];
  memberships: Array<{ slug: string; projectId: string }>;
  projects: Array<{ id: string; name: string }>;
}> {
  if (!env.DB) return { artifactRows: [], memberships: [], projects: [] };
  try {
    const db = createDatabase(env.DB);
    const [rows, projectRows, shareRows] = await Promise.all([
      db.select({
        slug: artifacts.slug,
        createdAt: artifacts.createdAt,
        lastActivityAt: artifacts.lastActivityAt,
        pinnedAt: artifacts.pinnedAt,
      }).from(artifacts).where(eq(artifacts.teamId, teamId)),
      db.select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(eq(projects.teamId, teamId))
        .orderBy(projects.name),
      db.select({
        slug: artifacts.slug,
        token: artifactShares.token,
        createdAt: artifactShares.createdAt,
        revokedAt: artifactShares.revokedAt,
      })
        .from(artifactShares)
        .innerJoin(artifacts, eq(artifactShares.artifactId, artifacts.id))
        .where(eq(artifacts.teamId, teamId)),
    ]);
    const memberships = await db.select({
      slug: artifacts.slug,
      projectId: artifactProjects.projectId,
    })
      .from(artifactProjects)
      .innerJoin(artifacts, eq(artifactProjects.artifactId, artifacts.id))
      .innerJoin(projects, eq(artifactProjects.projectId, projects.id))
      .where(eq(artifacts.teamId, teamId))
      .orderBy(projects.name);
    const sharesBySlug = new Map(shareRows.map((row) => [row.slug, row]));
    return {
      artifactRows: rows.map((row) => {
        const share = sharesBySlug.get(row.slug);
        return {
          ...row,
          shareToken: share?.token ?? null,
          shareCreatedAt: share?.createdAt ?? null,
          shareRevokedAt: share?.revokedAt ?? null,
        };
      }),
      memberships,
      projects: projectRows,
    };
  } catch (error) {
    console.error("artifact metadata load failed", error);
    return { artifactRows: [], memberships: [], projects: [] };
  }
}

export function mergeArtifacts(
  slugs: string[],
  rows: ArtifactMetaRow[],
  memberships: Array<{ slug: string; projectId: string }>,
  teamProjects: Array<{ id: string; name: string }>,
): DashboardArtifact[] {
  const rowsBySlug = new Map(rows.map((row) => [row.slug, row]));
  const namesById = new Map(teamProjects.map((project) => [project.id, project.name]));
  const projectsBySlug = new Map<string, Array<{ id: string; name: string }>>();
  for (const membership of memberships) {
    const name = namesById.get(membership.projectId);
    if (!name) continue;
    const list = projectsBySlug.get(membership.slug) ?? [];
    list.push({ id: membership.projectId, name });
    projectsBySlug.set(membership.slug, list);
  }
  return slugs.map((slug) => {
    const row = rowsBySlug.get(slug);
    return {
      slug,
      createdAt: toIsoDate(row?.createdAt),
      lastActivityAt: toIsoDate(row?.lastActivityAt),
      pinnedAt: toIsoDate(row?.pinnedAt),
      projects: projectsBySlug.get(slug) ?? [],
      share: row ? artifactShareView(row.shareToken, row.shareCreatedAt, row.shareRevokedAt) : privateArtifactShare(),
    };
  }).sort(compareArtifacts);
}

function toIsoDate(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

export function compareArtifacts(a: DashboardArtifact, b: DashboardArtifact): number {
  if (Boolean(a.pinnedAt) !== Boolean(b.pinnedAt)) return a.pinnedAt ? -1 : 1;
  if (a.pinnedAt && b.pinnedAt) {
    const pinnedDelta = Date.parse(b.pinnedAt) - Date.parse(a.pinnedAt);
    if (pinnedDelta) return pinnedDelta;
  }
  const activityDelta = timestampValue(b.lastActivityAt) - timestampValue(a.lastActivityAt);
  if (activityDelta) return activityDelta;
  return a.slug.localeCompare(b.slug);
}

function timestampValue(value: string | null): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

export async function getDashboardArtifact(env: GatewayEnv, teamId: string, slug: string): Promise<DashboardArtifact | null> {
  if (!isValidTeamSlug(slug) || !env.DB) return null;
  try {
    const db = createDatabase(env.DB);
    const [row] = await db.select({
      id: artifacts.id,
      createdAt: artifacts.createdAt,
      lastActivityAt: artifacts.lastActivityAt,
      pinnedAt: artifacts.pinnedAt,
    })
      .from(artifacts)
      .where(and(eq(artifacts.teamId, teamId), eq(artifacts.slug, slug)))
      .limit(1);
    if (!row) return null;
    const memberships = await db.select({ id: projects.id, name: projects.name })
      .from(artifactProjects)
      .innerJoin(projects, eq(artifactProjects.projectId, projects.id))
      .where(eq(artifactProjects.artifactId, row.id))
      .orderBy(projects.name);
    const [share] = await db.select({ token: artifactShares.token, createdAt: artifactShares.createdAt, revokedAt: artifactShares.revokedAt })
      .from(artifactShares)
      .where(eq(artifactShares.artifactId, row.id))
      .limit(1);
    return {
      slug,
      createdAt: toIsoDate(row.createdAt),
      lastActivityAt: toIsoDate(row.lastActivityAt),
      pinnedAt: toIsoDate(row.pinnedAt),
      projects: memberships.map((membership) => ({ id: membership.id, name: membership.name })),
      share: artifactShareView(share?.token, share?.createdAt, share?.revokedAt),
    };
  } catch (error) {
    console.error("artifact metadata load failed", error);
    return null;
  }
}

function privateArtifactShare(): DashboardArtifactShare {
  return { active: false, token: null, createdAt: null, revokedAt: null };
}

function artifactShareView(
  token: string | null | undefined,
  createdAt: Date | null | undefined,
  revokedAt: Date | null | undefined,
): DashboardArtifactShare {
  const active = Boolean(token && !revokedAt);
  return {
    active,
    token: active ? token! : null,
    createdAt: createdAt?.toISOString() ?? null,
    revokedAt: revokedAt?.toISOString() ?? null,
  };
}

export type ArtifactShareAction = "enable" | "revoke" | "regenerate";
export type ArtifactShareError =
  | "artifact_not_found"
  | "entry_file_required"
  | "share_service_unavailable"
  | "team_owner_required";

export async function updateArtifactShare(
  env: GatewayEnv,
  teamId: string,
  slug: string,
  action: ArtifactShareAction,
  role: TeamRole,
): Promise<{ ok: true; action: ArtifactShareAction } | { ok: false; error: ArtifactShareError }> {
  if (role !== "owner") return { ok: false, error: "team_owner_required" };
  if (!isValidTeamSlug(slug) || !env.DB) return { ok: false, error: "artifact_not_found" };

  try {
    const db = createDatabase(env.DB);
    const artifactId = await ensureArtifactId(env, teamId, slug);
    if (!artifactId) return { ok: false, error: "artifact_not_found" };

    if (action === "revoke") {
      await db.update(artifactShares)
        .set({ revokedAt: new Date() })
        .where(eq(artifactShares.artifactId, artifactId));
      return { ok: true, action };
    }

    if (!await artifactHasEntryFile(env, teamId, slug)) {
      return { ok: false, error: "entry_file_required" };
    }

    const [existing] = await db.select({ token: artifactShares.token, revokedAt: artifactShares.revokedAt })
      .from(artifactShares)
      .where(eq(artifactShares.artifactId, artifactId))
      .limit(1);
    if (action === "enable" && existing && !existing.revokedAt) return { ok: true, action };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = createArtifactShareToken();
      try {
        await db.insert(artifactShares)
          .values({ artifactId, token, createdAt: new Date(), revokedAt: null })
          .onConflictDoUpdate({
            target: artifactShares.artifactId,
            set: { token, createdAt: new Date(), revokedAt: null },
          });
        return { ok: true, action };
      } catch (error) {
        if (!isUniqueConstraintError(error) || attempt === 2) throw error;
      }
    }
  } catch (error) {
    console.error("artifact share update failed", error);
    return { ok: false, error: "share_service_unavailable" };
  }
  return { ok: false, error: "share_service_unavailable" };
}

async function artifactHasEntryFile(env: GatewayEnv, teamId: string, slug: string): Promise<boolean> {
  try {
    if (typeof (env.ARTIFACTS_BUCKET as { head?: unknown }).head !== "function") return false;
    return Boolean(await env.ARTIFACTS_BUCKET.head(`uploads/${teamId}/artifacts/${slug}/index.html`));
  } catch (error) {
    console.error("artifact entry file check failed", error);
    return false;
  }
}

export async function toggleArtifactPin(env: GatewayEnv, teamId: string, slug: string, pinned: boolean): Promise<boolean> {
  if (!isValidTeamSlug(slug) || !env.DB) return false;
  try {
    if (!await ensureArtifactRow(env, teamId, slug)) return false;
    await createDatabase(env.DB).update(artifacts)
      .set({ pinnedAt: pinned ? new Date() : null })
      .where(and(eq(artifacts.teamId, teamId), eq(artifacts.slug, slug)));
    return true;
  } catch (error) {
    console.error("artifact pin failed", error);
    return false;
  }
}

export async function setArtifactProjects(env: GatewayEnv, teamId: string, slug: string, projectIds: string[]): Promise<boolean> {
  if (!isValidTeamSlug(slug) || !env.DB) return false;
  const selected = [...new Set(projectIds)];
  try {
    const db = createDatabase(env.DB);
    const artifactId = await ensureArtifactId(env, teamId, slug);
    if (!artifactId) return false;
    const valid = selected.length
      ? await db.select({ id: projects.id }).from(projects).where(and(eq(projects.teamId, teamId), inArray(projects.id, selected)))
      : [];
    if (valid.length !== selected.length) return false;
    await db.delete(artifactProjects).where(eq(artifactProjects.artifactId, artifactId));
    if (selected.length) {
      await db.insert(artifactProjects).values(selected.map((projectId) => ({
        artifactId,
        projectId,
        createdAt: new Date(),
      })));
    }
    return true;
  } catch (error) {
    console.error("artifact project update failed", error);
    return false;
  }
}

export async function listDashboardProjects(env: GatewayEnv, teamId: string): Promise<DashboardProject[]> {
  if (!env.DB) return [];
  try {
    const db = createDatabase(env.DB);
    const rows = await db.select({
      id: projects.id,
      name: projects.name,
      createdAt: projects.createdAt,
      artifactCount: count(artifactProjects.artifactId),
    })
      .from(projects)
      .leftJoin(artifactProjects, eq(artifactProjects.projectId, projects.id))
      .where(eq(projects.teamId, teamId))
      .groupBy(projects.id)
      .orderBy(projects.name);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      artifactCount: row.artifactCount,
      createdAt: row.createdAt.toISOString(),
    }));
  } catch (error) {
    console.error("project list failed", error);
    return [];
  }
}

export type CreateProjectError = "invalid_project_name" | "project_name_taken" | "project_service_unavailable";

export async function createDashboardProject(env: GatewayEnv, teamId: string, name: string): Promise<{ ok: true; project: { id: string; name: string } } | { ok: false; error: CreateProjectError }> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 64) return { ok: false, error: "invalid_project_name" };
  try {
    const project = { id: crypto.randomUUID(), name: trimmed };
    await createDatabase(env.DB).insert(projects).values({ ...project, teamId, createdAt: new Date() });
    return { ok: true, project };
  } catch (error) {
    if (isUniqueConstraintError(error)) return { ok: false, error: "project_name_taken" };
    console.error("project create failed", error);
    return { ok: false, error: "project_service_unavailable" };
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof Error) {
      if ((current as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") return true;
      if (current.message.includes("UNIQUE constraint failed")) return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export async function deleteDashboardProject(env: GatewayEnv, teamId: string, projectId: string): Promise<boolean> {
  if (!projectId) return false;
  try {
    const deleted = await createDatabase(env.DB).delete(projects)
      .where(and(eq(projects.id, projectId), eq(projects.teamId, teamId)))
      .returning({ id: projects.id });
    return deleted.length > 0;
  } catch (error) {
    console.error("project delete failed", error);
    return false;
  }
}

export async function reconcileArtifacts(env: GatewayEnv, teamId: string, slugs: string[]): Promise<void> {
  if (!env.DB) return;
  for (const slug of slugs.slice(0, RECONCILIATION_BATCH)) {
    await backfillArtifactMetadata(env, teamId, slug);
  }
}

export async function backfillArtifactMetadata(env: GatewayEnv, teamId: string, slug: string): Promise<boolean> {
  if (!env.DB || !isValidTeamSlug(slug)) return false;
  let created: Date | null = null;
  let last: Date | null = null;
  let cursor: string | undefined;
  let pages = 0;
  try {
    const prefix = `uploads/${teamId}/artifacts/${slug}/`;
    do {
      const result = await env.ARTIFACTS_BUCKET.list({ prefix, cursor, limit: R2_PAGE_LIMIT });
      for (const object of result.objects) {
        if (!created || object.uploaded < created) created = object.uploaded;
        if (!last || object.uploaded > last) last = object.uploaded;
      }
      cursor = result.truncated ? result.cursor ?? undefined : undefined;
      pages += 1;
    } while (cursor && pages < BACKFILL_PAGE_CAP);
    if (!created || !last) return false;
    await createDatabase(env.DB).insert(artifacts)
      .values({ id: crypto.randomUUID(), teamId, slug, createdAt: created, lastActivityAt: last })
      .onConflictDoNothing();
    return true;
  } catch (error) {
    console.error("artifact reconciliation failed", error);
    return false;
  }
}

async function ensureArtifactRow(env: GatewayEnv, teamId: string, slug: string): Promise<boolean> {
  return Boolean(await ensureArtifactId(env, teamId, slug));
}

async function ensureArtifactId(env: GatewayEnv, teamId: string, slug: string): Promise<string | null> {
  const db = createDatabase(env.DB);
  const existing = await artifactIdFor(db, teamId, slug);
  if (existing) return existing;
  const backfilled = await backfillArtifactMetadata(env, teamId, slug);
  if (!backfilled) return null;
  return artifactIdFor(db, teamId, slug);
}

async function artifactIdFor(db: ReturnType<typeof createDatabase>, teamId: string, slug: string): Promise<string | null> {
  const [row] = await db.select({ id: artifacts.id })
    .from(artifacts)
    .where(and(eq(artifacts.teamId, teamId), eq(artifacts.slug, slug)))
    .limit(1);
  return row?.id ?? null;
}

const TIMEZONE_COOKIE = /(?:^|;\s*)tz=([^;]*)/u;

export function viewerTimeZone(request: Request): string {
  const match = TIMEZONE_COOKIE.exec(request.headers.get("Cookie") ?? "");
  if (!match) return "UTC";
  const candidate = decodeURIComponent(match[1]).trim();
  if (!candidate || candidate.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate });
    return candidate;
  } catch {
    return "UTC";
  }
}

export async function listDashboardArtifactFiles(
  env: GatewayEnv,
  teamId: string,
  artifactSlug: string,
  cursor: string | null,
  limit = 50,
): Promise<DashboardPage<DashboardArtifactFile> | Response> {
  if (!isValidTeamSlug(artifactSlug)) return authError(404, "artifact_not_found");
  if (!safeCursor(cursor)) return authError(400, "invalid_cursor");
  const prefix = `uploads/${teamId}/artifacts/${artifactSlug}/`;
  try {
    const result = await env.ARTIFACTS_BUCKET.list({
      prefix,
      cursor: cursor ?? undefined,
      limit: Math.min(Math.max(limit, 1), 1000),
    });
    return {
      items: result.objects.map((object) => ({
        path: object.key.slice(prefix.length),
        size: object.size,
        uploadedAt: object.uploaded.toISOString(),
        etag: object.httpEtag,
      })),
      nextCursor: result.truncated ? result.cursor ?? null : null,
    };
  } catch {
    return authError(503, "artifact_storage_unavailable");
  }
}

export async function listDashboardTokens(
  env: GatewayEnv,
  identity: WebIdentity,
  team: DashboardTeam,
  cursor: string | null,
  limit = 50,
): Promise<DashboardPage<DashboardToken> | Response> {
  if (!safeCursor(cursor)) return authError(400, "invalid_cursor");
  const db = createDatabase(env.DB);
  const conditions = [eq(apiTokens.teamId, team.id)];
  if (team.role === "member") conditions.push(eq(apiTokens.userId, identity.id));
  const decoded = decodeCursor(cursor);
  if (cursor && !decoded) return authError(400, "invalid_cursor");
  if (decoded) conditions.push(cursorCondition(decoded, apiTokens.createdAt, apiTokens.id));
  const rows = await db.select({
    id: apiTokens.id,
    name: apiTokens.name,
    ownerId: user.id,
    ownerName: user.name,
    ownerEmail: user.email,
    permissions: apiTokens.permissions,
    createdAt: apiTokens.createdAt,
    lastUsedAt: apiTokens.lastUsedAt,
    expiresAt: apiTokens.expiresAt,
    revokedAt: apiTokens.revokedAt,
  })
    .from(apiTokens)
    .innerJoin(user, eq(apiTokens.userId, user.id))
    .where(and(...conditions))
    .orderBy(desc(apiTokens.createdAt), desc(apiTokens.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    items: page.map((row) => ({
      id: row.id,
      name: row.name,
      owner: { id: row.ownerId, name: row.ownerName, email: row.ownerEmail },
      permissions: safePermissions(row.permissions),
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
    })),
    nextCursor: rows.length > limit ? encodeCursor(page.at(-1)!.createdAt, page.at(-1)!.id) : null,
  };
}

export async function listDashboardDevices(
  env: GatewayEnv,
  identity: WebIdentity,
  team: DashboardTeam,
  scope: "mine" | "team",
  cursor: string | null,
  limit = 50,
): Promise<DashboardPage<DashboardDevice> | Response> {
  if (scope === "team" && team.role === "member") return authError(403, "team_access_required");
  if (!safeCursor(cursor)) return authError(400, "invalid_cursor");
  const db = createDatabase(env.DB);
  const now = new Date();
  const conditions = [
    eq(deviceAuthorizations.teamId, team.id),
    eq(deviceAuthorizations.status, "completed"),
    isNotNull(deviceAuthorizations.apiTokenId),
    isNull(apiTokens.revokedAt),
    gt(apiTokens.expiresAt, now),
    gt(apiTokens.idleExpiresAt, now),
  ];
  if (scope === "mine" || team.role === "member") conditions.push(eq(apiTokens.userId, identity.id));
  const decoded = decodeCursor(cursor);
  if (cursor && !decoded) return authError(400, "invalid_cursor");
  if (decoded) conditions.push(cursorCondition(decoded, apiTokens.createdAt, apiTokens.id));
  const rows = await db.select({
    id: deviceAuthorizations.id,
    tokenId: apiTokens.id,
    name: deviceAuthorizations.deviceName,
    platform: deviceAuthorizations.platform,
    clientVersion: deviceAuthorizations.clientVersion,
    ownerId: user.id,
    ownerName: user.name,
    ownerEmail: user.email,
    createdAt: apiTokens.createdAt,
    lastUsedAt: apiTokens.lastUsedAt,
    expiresAt: apiTokens.expiresAt,
    revokedAt: apiTokens.revokedAt,
  })
    .from(deviceAuthorizations)
    .innerJoin(apiTokens, eq(deviceAuthorizations.apiTokenId, apiTokens.id))
    .innerJoin(user, eq(apiTokens.userId, user.id))
    .where(and(...conditions))
    .orderBy(desc(apiTokens.createdAt), desc(apiTokens.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    items: page.map((row) => ({
      id: row.id,
      tokenId: row.tokenId,
      name: row.name || "Artifact Sync device",
      platform: row.platform,
      clientVersion: row.clientVersion,
      owner: { id: row.ownerId, name: row.ownerName, email: row.ownerEmail },
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
    })),
    nextCursor: rows.length > limit ? encodeCursor(page.at(-1)!.createdAt, page.at(-1)!.id) : null,
  };
}

export async function dashboardCounts(
  env: GatewayEnv,
  identity: WebIdentity,
  team: DashboardTeam,
): Promise<{ tokens: number; devices: number }> {
  const db = createDatabase(env.DB);
  const tokenConditions = [eq(apiTokens.teamId, team.id)];
  const now = new Date();
  const deviceConditions = [
    eq(deviceAuthorizations.teamId, team.id),
    eq(deviceAuthorizations.status, "completed"),
    isNotNull(deviceAuthorizations.apiTokenId),
    isNull(apiTokens.revokedAt),
    gt(apiTokens.expiresAt, now),
    gt(apiTokens.idleExpiresAt, now),
  ];
  if (team.role === "member") {
    tokenConditions.push(eq(apiTokens.userId, identity.id));
    deviceConditions.push(eq(apiTokens.userId, identity.id));
  }
  const [[tokenCount], [deviceCount]] = await Promise.all([
    db.select({ value: count() }).from(apiTokens).where(and(...tokenConditions)),
    db.select({ value: count() })
      .from(deviceAuthorizations)
      .innerJoin(apiTokens, eq(deviceAuthorizations.apiTokenId, apiTokens.id))
      .where(and(...deviceConditions)),
  ]);
  return { tokens: tokenCount.value, devices: deviceCount.value };
}

export async function dashboardSettings(
  env: GatewayEnv,
  team: DashboardTeam,
): Promise<DashboardSettings> {
  const db = createDatabase(env.DB);
  const [history, lock] = await Promise.all([
    db.select({
      slug: teamSlugs.slug,
      isCurrent: teamSlugs.isCurrent,
      changedAt: teamSlugs.changedAt,
      changedByName: user.name,
    })
      .from(teamSlugs)
      .leftJoin(user, eq(teamSlugs.changedByUserId, user.id))
      .where(eq(teamSlugs.teamId, team.id))
      .orderBy(desc(teamSlugs.changedAt), desc(teamSlugs.slug)),
    db.select({ lastChangedAt: teamSlugChangeLocks.lastChangedAt })
      .from(teamSlugChangeLocks)
      .where(eq(teamSlugChangeLocks.teamId, team.id))
      .limit(1),
  ]);
  const nextAvailableAt = lock[0]
    ? new Date(lock[0].lastChangedAt.getTime() + TEAM_SLUG_CHANGE_COOLDOWN_MS)
    : null;
  return {
    slugHistory: history.map((entry) => ({
      slug: entry.slug,
      isCurrent: entry.isCurrent,
      changedAt: entry.changedAt?.toISOString() ?? null,
      changedByName: entry.changedByName,
    })),
    canChangeSlug: team.role === "owner" && (!nextAvailableAt || nextAvailableAt.getTime() <= Date.now()),
    nextAvailableAt: nextAvailableAt?.toISOString() ?? null,
  };
}

export function artifactHref(teamSlug: string, path: string): string {
  return `/${encodeURIComponent(teamSlug)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function artifactShareHref(origin: string, teamSlug: string, artifactSlug: string, token: string): string {
  const url = new URL(artifactHref(teamSlug, `${artifactSlug}/index.html`), origin);
  url.searchParams.set("share", token);
  return url.toString();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function safeCursor(value: string | null): boolean {
  return !value || value.length <= 1024;
}

function decodeOffset(value: string | null): number | null {
  if (!value) return 0;
  if (!/^\d{1,9}$/u.test(value)) return null;
  return Number(value);
}

type Cursor = { createdAt: Date; id: string };

function decodeCursor(value: string | null): Cursor | null {
  if (!value) return null;
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const decoded = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))) as unknown;
    if (!isObject(decoded) || typeof decoded.createdAt !== "string" || typeof decoded.id !== "string") return null;
    const createdAt = new Date(decoded.createdAt);
    if (Number.isNaN(createdAt.getTime()) || !decoded.id) return null;
    return { createdAt, id: decoded.id };
  } catch {
    return null;
  }
}

function encodeCursor(createdAt: Date, id: string): string {
  return btoa(JSON.stringify({ createdAt: createdAt.toISOString(), id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function cursorCondition(cursor: Cursor, createdAt: typeof apiTokens.createdAt, id: typeof apiTokens.id): SQL {
  const condition = or(
    lt(createdAt, cursor.createdAt),
    and(eq(createdAt, cursor.createdAt), lt(id, cursor.id)),
  );
  if (!condition) throw new Error("cursor condition could not be created");
  return condition;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
