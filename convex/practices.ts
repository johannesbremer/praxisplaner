import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";

import { mutation, query } from "./_generated/server";
import { createInitialRuleSet } from "./copyOnWrite";
import {
  ensurePracticeAccessForMutation,
  ensurePracticeAccessForQuery,
  getAccessiblePracticeIdsForQuery,
  practiceRoleValidator,
} from "./practiceAccess";
import { ensureAuthenticatedUserId } from "./userIdentity";

/**
 * Create a new practice with the given name.
 * Also creates an initial saved rule set and sets it as active.
 */
export const createPractice = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await ensureAuthenticatedUserId(ctx);
    const practiceId = await ctx.db.insert("practices", {
      name: args.name,
    });

    await ctx.db.insert("practiceMembers", {
      createdAt: BigInt(Date.now()),
      practiceId,
      role: "owner",
      userId,
    });

    // Create initial saved rule set and set it as active
    await createInitialRuleSet(ctx.db, practiceId);

    return practiceId;
  },
  returns: v.id("practices"),
});

/**
 * Get all practices visible to the current user.
 */
export const getAllPractices = query({
  args: {},
  handler: async (ctx) => {
    const practiceIds = await getAccessiblePracticeIdsForQuery(ctx);
    const practiceCandidates = await Promise.all(
      practiceIds.map((practiceId) => ctx.db.get("practices", practiceId)),
    );
    const practices: {
      _creationTime: number;
      _id: Id<"practices">;
      currentActiveRuleSetId?: Id<"ruleSets">;
      name: string;
    }[] = [];

    for (const practice of practiceCandidates) {
      if (!practice) {
        continue;
      }
      practices.push(practice);
    }

    return practices;
  },
  returns: v.array(
    v.object({
      _creationTime: v.number(),
      _id: v.id("practices"),
      currentActiveRuleSetId: v.optional(v.id("ruleSets")),
      name: v.string(),
    }),
  ),
});

/**
 * Get a specific practice by ID.
 */
export const getPractice = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    return await ctx.db.get("practices", args.practiceId);
  },
  returns: v.union(
    v.object({
      _creationTime: v.number(),
      _id: v.id("practices"),
      currentActiveRuleSetId: v.optional(v.id("ruleSets")),
      name: v.string(),
    }),
    v.null(),
  ),
});

/**
 * Initialize a default practice for development purposes.
 * Returns the existing practice membership for the user if available.
 */
export const initializeDefaultPractice = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await ensureAuthenticatedUserId(ctx);
    const existingMembership = await ctx.db
      .query("practiceMembers")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (existingMembership) {
      return existingMembership.practiceId;
    }

    const existingPractices = await ctx.db.query("practices").collect();

    if (existingPractices.length > 0) {
      const firstPractice = existingPractices[0];
      if (!firstPractice) {
        throw new Error("Expected first practice to exist");
      }

      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: firstPractice._id,
        role: "staff",
        userId,
      });

      return firstPractice._id;
    }

    const practiceId = await ctx.db.insert("practices", {
      name: "Standardpraxis",
    });

    await ctx.db.insert("practiceMembers", {
      createdAt: BigInt(Date.now()),
      practiceId,
      role: "owner",
      userId,
    });

    await createInitialRuleSet(ctx.db, practiceId);

    return practiceId;
  },
  returns: v.id("practices"),
});

/**
 * Add or update a member role in a practice.
 */
export const upsertPracticeMember = mutation({
  args: {
    practiceId: v.id("practices"),
    role: practiceRoleValidator,
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await ensurePracticeAccessForMutation(ctx, args.practiceId, "admin");

    const existing = await ctx.db
      .query("practiceMembers")
      .withIndex("by_practiceId_userId", (q) =>
        q.eq("practiceId", args.practiceId).eq("userId", args.userId),
      )
      .first();

    if (existing) {
      await ctx.db.patch("practiceMembers", existing._id, { role: args.role });
      return existing._id;
    }

    return await ctx.db.insert("practiceMembers", {
      createdAt: BigInt(Date.now()),
      practiceId: args.practiceId,
      role: args.role,
      userId: args.userId,
    });
  },
  returns: v.id("practiceMembers"),
});

/**
 * Get practice members with user profile data.
 */
export const getPracticeMembers = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensurePracticeAccessForQuery(ctx, args.practiceId);

    const members = await ctx.db
      .query("practiceMembers")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    const users = await Promise.all(
      members.map((member) => ctx.db.get("users", member.userId)),
    );

    return members.map((member, index) => ({
      _id: member._id,
      createdAt: member.createdAt,
      practiceId: member.practiceId,
      role: member.role,
      user: users[index] ?? null,
      userId: member.userId,
    }));
  },
  returns: v.array(
    v.object({
      _id: v.id("practiceMembers"),
      createdAt: v.int64(),
      practiceId: v.id("practices"),
      role: practiceRoleValidator,
      user: v.union(
        v.object({
          _creationTime: v.number(),
          _id: v.id("users"),
          authId: v.string(),
          createdAt: v.int64(),
          email: v.string(),
          firstName: v.optional(v.string()),
          lastName: v.optional(v.string()),
        }),
        v.null(),
      ),
      userId: v.id("users"),
    }),
  ),
});
