import { describe, expect, test } from "vitest";

import { resolveHomePracticeRouteState } from "../routes/__root";

describe("home practice route state", () => {
  test("keeps unauthenticated practice state unknown", () => {
    expect(
      resolveHomePracticeRouteState({
        isAuthenticated: false,
        organizationSlug: undefined,
        practicesLoaded: false,
      }),
    ).toEqual({ kind: "unknown" });
  });

  test("keeps authenticated loading practice state unknown", () => {
    expect(
      resolveHomePracticeRouteState({
        isAuthenticated: true,
        organizationSlug: undefined,
        practicesLoaded: false,
      }),
    ).toEqual({ kind: "unknown" });
  });

  test("only resolves empty setup state after practices load", () => {
    expect(
      resolveHomePracticeRouteState({
        isAuthenticated: true,
        organizationSlug: undefined,
        practicesLoaded: true,
      }),
    ).toEqual({ kind: "known-empty" });
  });

  test("prefers a known organization slug", () => {
    expect(
      resolveHomePracticeRouteState({
        isAuthenticated: true,
        organizationSlug: "demo",
        practicesLoaded: true,
      }),
    ).toEqual({ kind: "known-slug", organizationSlug: "demo" });
  });
});
