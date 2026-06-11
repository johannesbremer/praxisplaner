import { describe, expect, test } from "vitest";

import { getDevAuthPersonaForPath } from "../auth/dev-auth-jwt";

describe("dev auth persona routing", () => {
  test("maps reserved and organization-scoped routes to the expected personas", () => {
    expect(getDevAuthPersonaForPath("/")).toBe("owner");
    expect(getDevAuthPersonaForPath("/account")).toBe("owner");
    expect(getDevAuthPersonaForPath("/account?tab=team")).toBe("owner");
    expect(getDevAuthPersonaForPath("/accounting")).toBe("patient");
    expect(getDevAuthPersonaForPath("/accounting/praxisplaner")).toBe("staff");
    expect(getDevAuthPersonaForPath("/accounting/regeln")).toBe("admin");
    expect(getDevAuthPersonaForPath("/demo")).toBe("patient");
    expect(getDevAuthPersonaForPath("/demo/praxisplaner")).toBe("staff");
    expect(getDevAuthPersonaForPath("/demo/praxisplaner/kalender")).toBe(
      "staff",
    );
    expect(getDevAuthPersonaForPath("/demo/regeln")).toBe("admin");
  });
});
