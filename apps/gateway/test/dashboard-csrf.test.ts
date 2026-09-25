import { describe, expect, it } from "bun:test";
import { isDashboardMutationAllowed, issueDashboardCsrfToken, matchesDashboardCsrfToken } from "../src/auth/csrf.ts";

const CSRF_SECRET = "test-csrf-secret-that-is-at-least-32-bytes";

describe("dashboard CSRF tokens", () => {
  it("binds tokens to the authenticated session", async () => {
    const first = await issueDashboardCsrfToken(CSRF_SECRET, "session-one");
    const second = await issueDashboardCsrfToken(CSRF_SECRET, "session-two");

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(matchesDashboardCsrfToken(first, first)).toBe(true);
    expect(matchesDashboardCsrfToken(first, second)).toBe(false);
  });

  it("rejects missing and altered tokens", async () => {
    const expected = await issueDashboardCsrfToken(CSRF_SECRET, "session-one");
    const altered = `${expected.slice(0, -1)}${expected.endsWith("a") ? "b" : "a"}`;

    expect(matchesDashboardCsrfToken(null, expected)).toBe(false);
    expect(matchesDashboardCsrfToken(altered, expected)).toBe(false);
    expect(matchesDashboardCsrfToken("not-a-token", expected)).toBe(false);
  });

  it("allows opaque origins only with the current session token", async () => {
    const expected = await issueDashboardCsrfToken(CSRF_SECRET, "session-one");
    const form = new FormData();
    form.set("csrfToken", expected);
    const request = (origin?: string) => new Request("https://artifact.w3dev.app/dashboard/team-1/settings/general", {
      method: "POST",
      headers: origin ? { Origin: origin } : undefined,
    });

    expect(isDashboardMutationAllowed(request("null"), form, expected)).toBe(true);
    expect(isDashboardMutationAllowed(request("https://attacker.example"), form, expected)).toBe(false);
    expect(isDashboardMutationAllowed(request("https://artifact.w3dev.app"), form, expected)).toBe(true);
    expect(isDashboardMutationAllowed(request(), form, expected)).toBe(true);
  });
});
