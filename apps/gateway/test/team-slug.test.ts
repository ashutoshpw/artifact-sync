import { describe, expect, it } from "bun:test";
import { isValidTeamSlug, TEAM_SLUG_CHANGE_COOLDOWN_MS } from "../src/auth/team-slug.ts";


describe("team slug validation", () => {
  it("accepts canonical lowercase slugs up to 63 characters", () => {
    expect(isValidTeamSlug("w3dev")).toBe(true);
    expect(isValidTeamSlug("a")).toBe(true);
    expect(isValidTeamSlug("team-123")).toBe(true);
    expect(isValidTeamSlug("a".repeat(63))).toBe(true);
  });

  it("rejects ambiguous or unsupported slug formats", () => {
    expect(isValidTeamSlug("")).toBe(false);
    expect(isValidTeamSlug("W3Dev")).toBe(false);
    expect(isValidTeamSlug("-team")).toBe(false);
    expect(isValidTeamSlug("team-")).toBe(false);
    expect(isValidTeamSlug("team_name")).toBe(false);
    expect(isValidTeamSlug("team/name")).toBe(false);
    expect(isValidTeamSlug("a".repeat(64))).toBe(false);
  });

  it("uses an exact 30-day team slug change cooldown", () => {
    expect(TEAM_SLUG_CHANGE_COOLDOWN_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
