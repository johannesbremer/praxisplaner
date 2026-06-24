import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "../_generated/api";
import { DEV_AUTH_USERS } from "../devAuthData";
import schema from "../schema";
import {
  canManageWorkOSOrganizationUsers,
  getWorkOSOrganizationMembershipRoleSlugs,
  mapWorkOSRoleSlugsToOrganizationRole,
} from "../workosOrganizations";
import { modules } from "./test.setup";

function createTestContext() {
  return convexTest(schema, modules);
}

async function getUsersByAuthId(
  t: ReturnType<typeof createTestContext>,
  authId: string,
) {
  return await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", authId))
      .collect();
  });
}

async function runUserEvent(
  t: ReturnType<typeof createTestContext>,
  event: "user.created" | "user.deleted" | "user.updated",
  data: {
    email: string;
    firstName?: string;
    id: string;
    lastName?: string;
  },
) {
  await t.mutation(internal.auth.authKitEvent, {
    data,
    event,
  });
}

describe("WorkOS AuthKit user sync", () => {
  test("seeds the owner dev persona used by account auth bypass", () => {
    expect(DEV_AUTH_USERS).toContainEqual({
      authId: "dev-owner",
      email: "owner@preview.test",
      firstName: "Preview",
      lastName: "Owner",
      role: "owner",
    });
  });

  test("reads membership role objects from WorkOS payloads", () => {
    expect(
      getWorkOSOrganizationMembershipRoleSlugs({
        role: { slug: "admin" },
        roles: [{ slug: "owner" }, { slug: "staff" }, { slug: 123 }],
      }),
    ).toEqual(["admin", "owner", "staff"]);
    expect(mapWorkOSRoleSlugsToOrganizationRole(["org:owner"])).toBe("owner");
    expect(mapWorkOSRoleSlugsToOrganizationRole(["org:admin"])).toBe("admin");
    expect(mapWorkOSRoleSlugsToOrganizationRole(["org:staff"])).toBe("staff");
    expect(mapWorkOSRoleSlugsToOrganizationRole(["org:patient"])).toBe(
      "patient",
    );
    expect(mapWorkOSRoleSlugsToOrganizationRole([])).toBe("patient");
  });

  test("limits user-management widget tokens to active WorkOS owners", () => {
    expect(
      canManageWorkOSOrganizationUsers({
        roleSlugs: ["staff"],
        status: "active",
      }),
    ).toBe(false);
    expect(
      canManageWorkOSOrganizationUsers({
        roleSlugs: ["admin"],
        status: "active",
      }),
    ).toBe(false);
    expect(
      canManageWorkOSOrganizationUsers({
        roleSlugs: ["org:owner"],
        status: "active",
      }),
    ).toBe(true);
    expect(
      canManageWorkOSOrganizationUsers({
        roleSlugs: ["owner"],
        status: "inactive",
      }),
    ).toBe(false);
  });

  test("user.created inserts an app user", async () => {
    const t = createTestContext();

    await runUserEvent(t, "user.created", {
      email: "created@example.com",
      firstName: "Ada",
      id: "user_created",
      lastName: "Lovelace",
    });

    const users = await getUsersByAuthId(t, "user_created");
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      authId: "user_created",
      email: "created@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
    });
  });

  test("user.created is idempotent for duplicate WorkOS deliveries", async () => {
    const t = createTestContext();
    const initialEvent = {
      email: "duplicate@example.com",
      firstName: "Initial",
      id: "user_duplicate",
      lastName: "Name",
    };

    await runUserEvent(t, "user.created", initialEvent);
    await runUserEvent(t, "user.created", {
      ...initialEvent,
      email: "updated-duplicate@example.com",
      firstName: "Updated",
    });

    const users = await getUsersByAuthId(t, "user_duplicate");
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      email: "updated-duplicate@example.com",
      firstName: "Updated",
      lastName: "Name",
    });
  });

  test("user.updated patches an existing app user", async () => {
    const t = createTestContext();

    await runUserEvent(t, "user.created", {
      email: "before@example.com",
      firstName: "Before",
      id: "user_updated",
      lastName: "User",
    });
    await runUserEvent(t, "user.updated", {
      email: "after@example.com",
      firstName: "After",
      id: "user_updated",
      lastName: "User",
    });

    const users = await getUsersByAuthId(t, "user_updated");
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      email: "after@example.com",
      firstName: "After",
      lastName: "User",
    });
  });

  test("user.deleted removes matching app users", async () => {
    const t = createTestContext();

    await runUserEvent(t, "user.created", {
      email: "deleted@example.com",
      id: "user_deleted",
    });
    await runUserEvent(t, "user.deleted", {
      email: "deleted@example.com",
      id: "user_deleted",
    });

    await expect(getUsersByAuthId(t, "user_deleted")).resolves.toEqual([]);
  });

  test("organization membership events sync practice member roles", async () => {
    const t = createTestContext();
    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        authId: "user_org_member",
        createdAt: BigInt(Date.now()),
        email: "org-member@example.com",
      });
    });
    const practiceId = await t.run(async (ctx) => {
      return await ctx.db.insert("practices", {
        name: "WorkOS Practice",
        workOSOrganizationId: "org_member_sync",
      });
    });

    await t.mutation(internal.auth.authKitEvent, {
      data: {
        id: "om_member_sync",
        object: "organization_membership",
        organization_id: "org_member_sync",
        role: { slug: "admin" },
        status: "active",
        user_id: "user_org_member",
      },
      event: "organization_membership.created",
    });

    await expect(
      t.run(async (ctx) => {
        return await ctx.db
          .query("organizationMembers")
          .withIndex("by_practiceId_userId", (q) =>
            q.eq("practiceId", practiceId).eq("userId", userId),
          )
          .first();
      }),
    ).resolves.toMatchObject({ role: "admin" });

    await t.mutation(internal.auth.authKitEvent, {
      data: {
        id: "om_member_sync",
        object: "organization_membership",
        organization_id: "org_member_sync",
        roles: [{ slug: "staff" }],
        status: "active",
        user_id: "user_org_member",
      },
      event: "organization_membership.updated",
    });

    await expect(
      t.run(async (ctx) => {
        return await ctx.db
          .query("organizationMembers")
          .withIndex("by_practiceId_userId", (q) =>
            q.eq("practiceId", practiceId).eq("userId", userId),
          )
          .first();
      }),
    ).resolves.toMatchObject({ role: "staff" });

    await t.mutation(internal.auth.authKitEvent, {
      data: {
        id: "om_member_sync",
        object: "organization_membership",
        organization_id: "org_member_sync",
        role: { slug: "staff" },
        status: "inactive",
        user_id: "user_org_member",
      },
      event: "organization_membership.updated",
    });

    await expect(
      t.run(async (ctx) => {
        return await ctx.db
          .query("organizationMembers")
          .withIndex("by_practiceId_userId", (q) =>
            q.eq("practiceId", practiceId).eq("userId", userId),
          )
          .first();
      }),
    ).resolves.toBeNull();
  });
});
