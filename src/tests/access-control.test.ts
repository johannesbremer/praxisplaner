import { describe, expect, test } from "vitest";

import { hasRequiredAccess } from "../auth/access-control";

describe("access control", () => {
  test("owner role passes staff and manager access requirements without permission claims", () => {
    expect(
      hasRequiredAccess({
        permissions: [],
        requirement: {
          permissions: ["praxisplaner:read"],
          roles: ["staff", "admin", "owner"],
        },
        role: "owner",
        roles: [],
      }),
    ).toBe(true);

    expect(
      hasRequiredAccess({
        permissions: [],
        requirement: {
          permissions: ["regeln:read"],
          roles: ["admin", "owner"],
        },
        role: "owner",
        roles: [],
      }),
    ).toBe(true);
  });
});
