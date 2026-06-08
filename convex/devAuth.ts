import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";

import { mutation, type MutationCtx } from "./_generated/server";
import { createInitialRuleSet } from "./copyOnWrite";
import { isConvexAuthBypassEnabled } from "./practiceAccess";

const DEV_AUTH_USERS = [
  {
    authId: "dev-patient",
    email: "patient@preview.test",
    firstName: "Preview",
    lastName: "Patient",
  },
  {
    authId: "dev-staff",
    email: "staff@preview.test",
    firstName: "Preview",
    lastName: "Staff",
    role: "staff",
  },
  {
    authId: "dev-admin",
    email: "admin@preview.test",
    firstName: "Preview",
    lastName: "Admin",
    role: "admin",
  },
] as const;

export const ensurePreviewAuthPersonas = mutation({
  args: {},
  handler: async (ctx) => {
    if (!isConvexAuthBypassEnabled()) {
      throw new Error(
        "Preview auth personas can only be seeded with auth bypass enabled",
      );
    }

    const practice = await ensurePractice(ctx);

    const userIds: Id<"users">[] = [];
    for (const persona of DEV_AUTH_USERS) {
      const userId = await ensureUser(ctx, persona);
      userIds.push(userId);

      if ("role" in persona) {
        await ensurePracticeMember(ctx, {
          practiceId: practice._id,
          role: persona.role,
          userId,
        });
      }
    }

    return { practiceId: practice._id, users: userIds };
  },
  returns: v.object({
    practiceId: v.id("practices"),
    users: v.array(v.id("users")),
  }),
});

async function ensurePractice(ctx: MutationCtx): Promise<Doc<"practices">> {
  const existing = await ctx.db.query("practices").first();
  if (existing) {
    return existing;
  }

  const practiceId = await ctx.db.insert("practices", {
    name: "Standardpraxis",
  });
  await createInitialRuleSet(ctx.db, practiceId);

  const practice = await ctx.db.get("practices", practiceId);
  if (!practice) {
    throw new Error("Created practice was not found");
  }
  return practice;
}

async function ensurePracticeMember(
  ctx: MutationCtx,
  args: {
    practiceId: Id<"practices">;
    role: Doc<"practiceMembers">["role"];
    userId: Id<"users">;
  },
): Promise<void> {
  const existing = await ctx.db
    .query("practiceMembers")
    .withIndex("by_practiceId_userId", (q) =>
      q.eq("practiceId", args.practiceId).eq("userId", args.userId),
    )
    .first();

  if (existing) {
    if (existing.role !== args.role) {
      await ctx.db.patch("practiceMembers", existing._id, { role: args.role });
    }
    return;
  }

  await ctx.db.insert("practiceMembers", {
    createdAt: BigInt(Date.now()),
    practiceId: args.practiceId,
    role: args.role,
    userId: args.userId,
  });
}

async function ensureUser(
  ctx: MutationCtx,
  persona: (typeof DEV_AUTH_USERS)[number],
): Promise<Id<"users">> {
  const existing = await ctx.db
    .query("users")
    .withIndex("by_authId", (q) => q.eq("authId", persona.authId))
    .first();

  const userData = {
    email: persona.email,
    firstName: persona.firstName,
    lastName: persona.lastName,
  };

  if (existing) {
    await ctx.db.patch("users", existing._id, userData);
    return existing._id;
  }

  return await ctx.db.insert("users", {
    ...userData,
    authId: persona.authId,
    createdAt: BigInt(Date.now()),
  });
}
