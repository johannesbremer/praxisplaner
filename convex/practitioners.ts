import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { practitionerUpdateValidator } from "./validators";

export const createPractitioner = mutation({
  args: {
    name: v.string(),
    practiceId: v.id("practices"),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Verify the practice exists
    const practice = await ctx.db.get(args.practiceId);
    if (!practice) {
      throw new Error("Practice not found");
    }

    const practitionerData = {
      name: args.name,
      practiceId: args.practiceId,
      ...(args.tags && { tags: args.tags }),
    };

    const practitionerId = await ctx.db.insert(
      "practitioners",
      practitionerData,
    );

    return practitionerId;
  },
  returns: v.id("practitioners"),
});

export const updatePractitioner = mutation({
  args: {
    practitionerId: v.id("practitioners"),
    updates: practitionerUpdateValidator,
  },
  handler: async (ctx, args) => {
    const practitioner = await ctx.db.get(args.practitionerId);
    if (!practitioner) {
      throw new Error("Practitioner not found");
    }

    // Filter out undefined values to avoid patch issues
    const filteredUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args.updates)) {
      if (value !== undefined) {
        filteredUpdates[key] = value;
      }
    }

    await ctx.db.patch(args.practitionerId, filteredUpdates);
    return null;
  },
  returns: v.null(),
});

export const deletePractitioner = mutation({
  args: {
    practitionerId: v.id("practitioners"),
  },
  handler: async (ctx, args) => {
    const practitioner = await ctx.db.get(args.practitionerId);
    if (!practitioner) {
      throw new Error("Practitioner not found");
    }

    // Check if practitioner has any base schedules
    const schedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_practitionerId", (q) =>
        q.eq("practitionerId", args.practitionerId),
      )
      .collect();

    if (schedules.length > 0) {
      throw new Error(
        "Cannot delete practitioner with existing schedules. Please delete schedules first.",
      );
    }

    await ctx.db.delete(args.practitionerId);
    return null;
  },
  returns: v.null(),
});

export const getPractitioners = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    const practitioners = await ctx.db
      .query("practitioners")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    return practitioners.sort((a, b) => a.name.localeCompare(b.name));
  },
});
