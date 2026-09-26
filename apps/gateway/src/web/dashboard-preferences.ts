export type ThemePreference = "system" | "light" | "dark";

export interface SidebarPreference {
  collapsed: boolean;
  width: number;
  lastExpanded: number;
}

export interface DashboardPreferences {
  theme: ThemePreference;
  sidebar: SidebarPreference;
}

export const THEME_COOKIE = "theme";
export const SIDEBAR_COOKIE = "artifact_sync_dashboard_sidebar";
export const SIDEBAR_RAIL_WIDTH = 64;
export const SIDEBAR_MIN_WIDTH = 140;
export const SIDEBAR_MAX_WIDTH = 320;
export const SIDEBAR_DEFAULT_WIDTH = 236;
export const PREFERENCE_MAX_AGE = 31_536_000;

const THEME_VALUES = new Set<ThemePreference>(["system", "light", "dark"]);
const SIDEBAR_COOKIE_PATTERN = /^v1\.c([01])\.w(\d+)\.e(\d+)$/u;

export function isThemePreference(value: string | null | undefined): value is ThemePreference {
  return value !== null && value !== undefined && THEME_VALUES.has(value as ThemePreference);
}

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));
}

export function defaultSidebarPreference(): SidebarPreference {
  return { collapsed: false, width: SIDEBAR_DEFAULT_WIDTH, lastExpanded: SIDEBAR_DEFAULT_WIDTH };
}

export function parseThemeCookieValue(value: string | null | undefined): ThemePreference {
  return isThemePreference(value) ? value : "system";
}

export function parseSidebarCookieValue(value: string | null | undefined): SidebarPreference {
  if (!value) return defaultSidebarPreference();
  const match = SIDEBAR_COOKIE_PATTERN.exec(value);
  if (!match) return defaultSidebarPreference();
  const lastExpanded = clampSidebarWidth(Number(match[3]));
  const expandedWidth = clampSidebarWidth(Number(match[2]));
  const collapsed = match[1] === "1";
  return {
    collapsed,
    width: collapsed ? SIDEBAR_RAIL_WIDTH : expandedWidth,
    lastExpanded,
  };
}

export function serializeThemeCookie(theme: ThemePreference): string {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${PREFERENCE_MAX_AGE}; SameSite=Lax`;
}

export function serializeSidebarCookie(preference: SidebarPreference): string {
  const lastExpanded = clampSidebarWidth(preference.lastExpanded);
  const width = preference.collapsed ? SIDEBAR_RAIL_WIDTH : clampSidebarWidth(preference.width);
  return `${SIDEBAR_COOKIE}=v1.c${preference.collapsed ? "1" : "0"}.w${width}.e${lastExpanded}; Path=/; Max-Age=${PREFERENCE_MAX_AGE}; SameSite=Lax`;
}

function readCookieHeader(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

export function readDashboardPreferences(request: Request): DashboardPreferences {
  const cookieHeader = request.headers.get("Cookie");
  return {
    theme: parseThemeCookieValue(readCookieHeader(cookieHeader, THEME_COOKIE)),
    sidebar: parseSidebarCookieValue(readCookieHeader(cookieHeader, SIDEBAR_COOKIE)),
  };
}

export function themeColor(theme: ThemePreference): string {
  return theme === "light" ? "#f5f8f3" : "#090b0a";
}

export function resolvedTheme(theme: ThemePreference): ThemePreference {
  return theme;
}
