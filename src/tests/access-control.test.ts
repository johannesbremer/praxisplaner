import { describe, expect, test } from "vitest";

import { hasRequiredAccess } from "../auth/access-control";

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
});
