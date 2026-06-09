import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "../_generated/api";
import schema from "../schema";
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
});
