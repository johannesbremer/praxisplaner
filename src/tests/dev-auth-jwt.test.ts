import { describe, expect, test } from "vitest";

import { hasRequiredAccess } from "../auth/access-control";
import {
  getDevAuthPersonaAccess,
  getDevAuthPersonaForPath,
} from "../auth/dev-auth-jwt";

describe("dev auth persona routing", () => {
  test("maps reserved and organization-scoped routes to the expected personas", () => {
    expect(getDevAuthPersonaForPath("/")).toBe("owner");
    expect(getDevAuthPersonaForPath("/account")).toBe("owner");
    expect(getDevAuthPersonaForPath("/account?tab=team")).toBe("owner");
    expect(getDevAuthPersonaForPath("/buchung")).toBe("patient");
    expect(getDevAuthPersonaForPath("/praxisplaner")).toBe("staff");
    expect(getDevAuthPersonaForPath("/regeln")).toBe("admin");
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

  test("uses the least privileged persona that can pass each gated route", () => {
    const staffRequirement = {
      permissions: ["praxisplaner:read"],
      roles: ["staff", "admin", "owner"],
    };
    const managerRequirement = {
      permissions: ["regeln:read"],
      roles: ["admin", "owner"],
    };

    const patientAccess = getDevAuthPersonaAccess("patient");
    expect(
      hasRequiredAccess({
        ...patientAccess,
        requirement: staffRequirement,
      }),
    ).toBe(false);
    expect(
      hasRequiredAccess({
        ...patientAccess,
        requirement: managerRequirement,
      }),
    ).toBe(false);

    const staffAccess = getDevAuthPersonaAccess("staff");
    expect(
      hasRequiredAccess({
        ...staffAccess,
        requirement: staffRequirement,
      }),
    ).toBe(true);
    expect(
      hasRequiredAccess({
        ...staffAccess,
        requirement: managerRequirement,
      }),
    ).toBe(false);

    const adminAccess = getDevAuthPersonaAccess("admin");
    expect(
      hasRequiredAccess({
        ...adminAccess,
        requirement: staffRequirement,
      }),
    ).toBe(true);
    expect(
      hasRequiredAccess({
        ...adminAccess,
        requirement: managerRequirement,
      }),
    ).toBe(true);
  });
});
