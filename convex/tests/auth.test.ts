import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "../_generated/api";
import { DEV_AUTH_USERS } from "../devAuthData";
import schema from "../schema";
import {
  canManageWorkOSOrganizationUsers,
  getWorkOSOrganizationMembershipRoleSlugs,
  mapWorkOSRoleSlugsToOrganizationRole,
} from "../workosOrganizations";
import { modules } from "./test.setup";

function createJsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function createTestContext() {
  return convexTest(schema, modules);
}

function getFetchUrl(input: Parameters<typeof fetch>[0]): URL {
  if (typeof input === "string" || input instanceof URL) {
    return new URL(input.toString());
  }
  return new URL(input.url);
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("seeds dev personas used by account auth bypass", () => {
    expect(DEV_AUTH_USERS).toContainEqual({
      authId: "dev-patient",
      email: "patient@preview.test",
      firstName: "Preview",
      lastName: "Patient",
      role: "patient",
    });
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
    expect(() => mapWorkOSRoleSlugsToOrganizationRole([])).toThrow(
      "WorkOS organization membership has no supported role slug",
    );
    expect(() => mapWorkOSRoleSlugsToOrganizationRole(["member"])).toThrow(
      "WorkOS organization membership has no supported role slug",
    );
    expect(() => mapWorkOSRoleSlugsToOrganizationRole(["billing"])).toThrow(
      "WorkOS organization membership has no supported role slug",
    );
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

  test("joinBookingPracticeBySlug creates a patient membership for an unaffiliated user", async () => {
    const t = createTestContext();
    await t.run(async (ctx) => {
      await ctx.db.insert("practices", {
        name: "Demo Practice",
        slug: "demo-practice",
        workOSOrganizationId: "org_demo_practice",
      });
    });
    const createdMemberships: unknown[] = [];
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const url = getFetchUrl(input);
      if (url.pathname === "/user_management/users/user_join_patient") {
        return Promise.resolve(
          createJsonResponse({
            email: "join-patient@example.com",
            id: "user_join_patient",
          }),
        );
      }
      if (
        url.pathname === "/user_management/organization_memberships" &&
        init?.method === "GET"
      ) {
        return Promise.resolve(createJsonResponse({ data: [] }));
      }
      if (
        url.pathname === "/user_management/organization_memberships" &&
        init?.method === "POST"
      ) {
        const payload: unknown =
          typeof init.body === "string" ? JSON.parse(init.body) : null;
        createdMemberships.push(payload);
        return Promise.resolve(
          createJsonResponse({
            id: "om_join_patient",
            object: "organization_membership",
            organization_id: "org_demo_practice",
            role: { slug: "patient" },
            status: "active",
            user_id: "user_join_patient",
          }),
        );
      }
      throw new Error(`Unexpected WorkOS request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const authed = t.withIdentity({ subject: "user_join_patient" });
    const membershipId = await authed.action(
      api.workosOrganizations.joinBookingPracticeBySlug,
      {
        practiceSlug: "demo-practice",
      },
    );
    const membership = await t.run(
      async (ctx) => await ctx.db.get("organizationMembers", membershipId),
    );

    expect(createdMemberships).toEqual([
      {
        organization_id: "org_demo_practice",
        role_slug: "patient",
        user_id: "user_join_patient",
      },
    ]);
    expect(membership).toMatchObject({ role: "patient" });
  });

  test("joinBookingPracticeBySlug syncs an existing target organization membership", async () => {
    const t = createTestContext();
    const userId = await t.mutation(
      internal.users.insertProvisionedUserFromTrustedProfile,
      {
        email: "existing-target@example.com",
        workOSUserId: "user_existing_target",
      },
    );
    const practiceId = await t.run(async (ctx) => {
      return await ctx.db.insert("practices", {
        name: "Existing Target Practice",
        slug: "existing-target",
        workOSOrganizationId: "org_existing_target",
      });
    });
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const url = getFetchUrl(input);
      if (
        url.pathname === "/user_management/organization_memberships" &&
        init?.method === "GET"
      ) {
        return Promise.resolve(
          createJsonResponse({
            data: [
              {
                id: "om_existing_target",
                object: "organization_membership",
                organization_id: "org_existing_target",
                role: { slug: "staff" },
                status: "active",
                user_id: "user_existing_target",
              },
            ],
          }),
        );
      }
      throw new Error(`Unexpected WorkOS request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const authed = t.withIdentity({ subject: "user_existing_target" });
    const membershipId = await authed.action(
      api.workosOrganizations.joinBookingPracticeBySlug,
      {
        practiceSlug: "existing-target",
      },
    );
    const membership = await t.run(
      async (ctx) => await ctx.db.get("organizationMembers", membershipId),
    );

    expect(membership).toMatchObject({ practiceId, role: "staff", userId });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("joinBookingPracticeBySlug rejects users with another active WorkOS organization", async () => {
    const t = createTestContext();
    await t.run(async (ctx) => {
      await ctx.db.insert("practices", {
        name: "Blocked Practice",
        slug: "blocked-practice",
        workOSOrganizationId: "org_blocked_practice",
      });
    });
    const createdMemberships: unknown[] = [];
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const url = getFetchUrl(input);
      if (url.pathname === "/user_management/users/user_blocked") {
        return Promise.resolve(
          createJsonResponse({
            email: "blocked@example.com",
            id: "user_blocked",
          }),
        );
      }
      if (
        url.pathname === "/user_management/organization_memberships" &&
        init?.method === "GET"
      ) {
        return Promise.resolve(
          createJsonResponse({
            data: [
              {
                id: "om_other",
                object: "organization_membership",
                organization_id: "org_other",
                role: { slug: "patient" },
                status: "active",
                user_id: "user_blocked",
              },
            ],
          }),
        );
      }
      if (
        url.pathname === "/user_management/organization_memberships" &&
        init?.method === "POST"
      ) {
        const payload: unknown =
          typeof init.body === "string" ? JSON.parse(init.body) : null;
        createdMemberships.push(payload);
        return Promise.resolve(createJsonResponse({}));
      }
      throw new Error(`Unexpected WorkOS request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const authed = t.withIdentity({ subject: "user_blocked" });

    await expect(
      authed.action(api.workosOrganizations.joinBookingPracticeBySlug, {
        practiceSlug: "blocked-practice",
      }),
    ).rejects.toThrow("User already belongs to another WorkOS organization");
    expect(createdMemberships).toEqual([]);
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

  test("unsupported active WorkOS roles remove stale local memberships", async () => {
    const t = createTestContext();
    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        authId: "user_org_unsupported_role",
        createdAt: BigInt(Date.now()),
        email: "unsupported-role@example.com",
      });
    });
    const practiceId = await t.run(async (ctx) => {
      const insertedPracticeId = await ctx.db.insert("practices", {
        name: "Unsupported Role Practice",
        workOSOrganizationId: "org_unsupported_role_sync",
      });
      await ctx.db.insert("organizationMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: insertedPracticeId,
        role: "admin",
        userId,
      });
      return insertedPracticeId;
    });

    await t.mutation(internal.auth.authKitEvent, {
      data: {
        id: "om_unsupported_role_sync",
        object: "organization_membership",
        organization_id: "org_unsupported_role_sync",
        roles: [{ slug: "member" }],
        status: "active",
        user_id: "user_org_unsupported_role",
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
