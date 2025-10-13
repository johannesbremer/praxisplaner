import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { createInitialRuleSet } from "./copyOnWrite";

/**
 * Create a new practice with the given name.
 * Also creates an initial saved rule set and sets it as active.
 */
export const createPractice = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const practiceId = await ctx.db.insert("practices", {
      name: args.name,
    });

    // Create initial saved rule set and set it as active
    await createInitialRuleSet(ctx.db, practiceId);

    return practiceId;
  },
  returns: v.id("practices"),
});

/**
 * Get all practices in the system.
 */
export const getAllPractices = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("practices").collect();
  },
});

/**
 * Get a specific practice by ID.
 */
export const getPractice = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.practiceId);
  },
});

/**
 * Initialize a default practice for development purposes.
 * Returns the existing practice if one already exists, otherwise creates a new one.
 */
export const initializeDefaultPractice = mutation({
  args: {},
  handler: async (ctx) => {
    // Check if any practice already exists
    const existingPractices = await ctx.db.query("practices").collect();

    if (existingPractices.length > 0) {
      const firstPractice = existingPractices[0];
      if (firstPractice) {
        return firstPractice._id;
      }
    }

    // Create a default practice
    const practiceId = await ctx.db.insert("practices", {
      name: "Standardpraxis",
    });

    // Create initial saved rule set and set it as active
    await createInitialRuleSet(ctx.db, practiceId);

    return practiceId;
  },
  returns: v.id("practices"),
});
