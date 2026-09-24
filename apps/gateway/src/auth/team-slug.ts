export const TEAM_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const TEAM_SLUG_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export function isValidTeamSlug(value: string): boolean {
  return TEAM_SLUG_PATTERN.test(value);
}
