import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import {
  ensurePracticeAccessForMutation,
  ensurePracticeAccessForQuery,
} from "./practiceAccess";
import { ensureAuthenticatedIdentity } from "./userIdentity";

const vacationPortionValidator = v.union(
  v.literal("full"),
  v.literal("morning"),
  v.literal("afternoon"),
);

const staffTypeValidator = v.union(v.literal("mfa"), v.literal("practitioner"));

export const getVacationsInRange = query({
  args: {
    endDateExclusive: v.string(),
    practiceId: v.id("practices"),
    startDate: v.string(),
  },
  handler: async (ctx, args) => {
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    return await ctx.db
      .query("vacations")
      .withIndex("by_practiceId_date", (q) =>
        q.eq("practiceId", args.practiceId).gte("date", args.startDate),
      )
      .filter((q) => q.lt(q.field("date"), args.endDateExclusive))
      .collect();
  },
});

export const createVacation = mutation({
  args: {
    date: v.string(),
    mfaId: v.optional(v.id("mfas")),
    portion: vacationPortionValidator,
    practiceId: v.id("practices"),
    practitionerId: v.optional(v.id("practitioners")),
    staffType: staffTypeValidator,
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);

    if (args.staffType === "practitioner") {
      if (!args.practitionerId || args.mfaId) {
        throw new Error("Ungültige Urlaubszuordnung für Arzt.");
      }
      const practitioner = await ctx.db.get(
        "practitioners",
        args.practitionerId,
      );
      if (practitioner?.practiceId !== args.practiceId) {
        throw new Error("Arzt nicht gefunden.");
      }
    } else {
      if (!args.mfaId || args.practitionerId) {
        throw new Error("Ungültige Urlaubszuordnung für MFA.");
      }
      const mfa = await ctx.db.get("mfas", args.mfaId);
      if (mfa?.practiceId !== args.practiceId) {
        throw new Error("MFA nicht gefunden.");
      }
    }

    const existing = await ctx.db
      .query("vacations")
      .withIndex("by_practiceId_date", (q) =>
        q.eq("practiceId", args.practiceId).eq("date", args.date),
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("staffType"), args.staffType),
          q.eq(q.field("portion"), args.portion),
          args.staffType === "practitioner"
            ? q.eq(q.field("practitionerId"), args.practitionerId)
            : q.eq(q.field("mfaId"), args.mfaId),
        ),
      )
      .first();

    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("vacations", {
      createdAt: BigInt(Date.now()),
      date: args.date,
      ...(args.mfaId && { mfaId: args.mfaId }),
      portion: args.portion,
      practiceId: args.practiceId,
      ...(args.practitionerId && { practitionerId: args.practitionerId }),
      staffType: args.staffType,
    });
  },
  returns: v.id("vacations"),
});

export const deleteVacation = mutation({
  args: {
    date: v.string(),
    mfaId: v.optional(v.id("mfas")),
    portion: vacationPortionValidator,
    practiceId: v.id("practices"),
    practitionerId: v.optional(v.id("practitioners")),
    staffType: staffTypeValidator,
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);

    const existing = await ctx.db
      .query("vacations")
      .withIndex("by_practiceId_date", (q) =>
        q.eq("practiceId", args.practiceId).eq("date", args.date),
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("staffType"), args.staffType),
          q.eq(q.field("portion"), args.portion),
          args.staffType === "practitioner"
            ? q.eq(q.field("practitionerId"), args.practitionerId)
            : q.eq(q.field("mfaId"), args.mfaId),
        ),
      )
      .first();

    if (existing) {
      await ctx.db.delete("vacations", existing._id);
    }

    return null;
  },
  returns: v.null(),
});
