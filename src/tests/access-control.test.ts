import { describe, expect, test } from "vitest";

import {
  hasRequiredAccess,
  isUnaffiliatedAccountAccess,
} from "../auth/access-control";

describe("access control", () => {
  test("WorkOS permission claims pass staff and manager access requirements without Convex roles", () => {
    expect(
      hasRequiredAccess({
        permissions: ["praxisplaner:read"],
        requirement: {
          permissions: ["praxisplaner:read"],
          roles: ["staff", "admin", "owner"],
        },
        role: null,
        roles: [],
      }),
    ).toBe(true);

    expect(
      hasRequiredAccess({
        permissions: ["regeln:read"],
        requirement: {
          permissions: ["regeln:read"],
          roles: ["admin", "owner"],
        },
        role: null,
        roles: [],
      }),
    ).toBe(true);
  });

  test("account access treats users without organization role claims as unaffiliated", () => {
    expect(
      isUnaffiliatedAccountAccess({
        permissions: [],
        role: null,
        roles: [],
      }),
    ).toBe(true);

    expect(
      isUnaffiliatedAccountAccess({
        permissions: [],
        role: "staff",
        roles: ["staff"],
      }),
    ).toBe(false);

    expect(
      isUnaffiliatedAccountAccess({
        permissions: ["praxisplaner:read"],
        role: null,
        roles: [],
      }),
    ).toBe(false);
  });

  test("account access allows owners but not admins", () => {
    const accountRequirement = {
      permissions: [],
      roles: ["owner"],
    };

    expect(
      hasRequiredAccess({
        permissions: [],
        requirement: accountRequirement,
        role: "owner",
        roles: ["owner"],
      }),
    ).toBe(true);

    expect(
      hasRequiredAccess({
        permissions: [],
        requirement: accountRequirement,
        role: "admin",
        roles: ["admin"],
      }),
    ).toBe(false);
  });
});
