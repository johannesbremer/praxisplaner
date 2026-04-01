import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import {
  ensurePracticeAccessForMutation,
  ensurePracticeAccessForQuery,
} from "./practiceAccess";
import { ensureAuthenticatedIdentity } from "./userIdentity";

export const list = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    return await ctx.db
      .query("mfas")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);

    const name = args.name.trim();
    if (!name) {
      throw new Error("MFA-Name ist erforderlich.");
    }

    const existing = await ctx.db
      .query("mfas")
      .withIndex("by_practiceId_name", (q) =>
        q.eq("practiceId", args.practiceId).eq("name", name),
      )
      .first();
    if (existing) {
      throw new Error("Eine MFA mit diesem Namen existiert bereits.");
    }

    return await ctx.db.insert("mfas", {
      createdAt: BigInt(Date.now()),
      name,
      practiceId: args.practiceId,
    });
  },
  returns: v.id("mfas"),
});

export const remove = mutation({
  args: {
    mfaId: v.id("mfas"),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);

    const mfa = await ctx.db.get("mfas", args.mfaId);
    if (mfa?.practiceId !== args.practiceId) {
      throw new Error("MFA nicht gefunden.");
    }

    const vacations = await ctx.db
      .query("vacations")
      .withIndex("by_practiceId_mfaId", (q) =>
        q.eq("practiceId", args.practiceId).eq("mfaId", args.mfaId),
      )
      .collect();

    for (const vacation of vacations) {
      await ctx.db.delete("vacations", vacation._id);
    }

    await ctx.db.delete("mfas", args.mfaId);
    return null;
  },
  returns: v.null(),
});
