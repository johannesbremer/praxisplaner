// convex/users.ts
import { v } from "convex/values";

import { query } from "./_generated/server";
import { authKit } from "./auth";

/**
 * Get the currently authenticated user.
 * Returns the user from our users table if authenticated, null otherwise.
 */
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authKit.getAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    // Find our app's user record by authId
    const user = await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", authUser.id))
      .unique();

    return user;
  },
  returns: v.union(
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
});

/**
 * Get the authenticated user from WorkOS (auth metadata).
 * This returns the WorkOS user data directly from the component.
 */
export const getAuthUser = query({
  args: {},
  handler: async (ctx) => {
    return await authKit.getAuthUser(ctx);
  },
  returns: v.any(), // WorkOS user type
});

/**
 * DEBUG: Check raw Convex auth identity.
 * This bypasses authKit to see if the JWT is reaching Convex.
 */
export const debugAuthIdentity = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    return {
      hasIdentity: identity !== null,
      issuer: identity?.issuer ?? null,
      subject: identity?.subject ?? null,
      tokenIdentifier: identity?.tokenIdentifier ?? null,
    };
  },
  returns: v.object({
    hasIdentity: v.boolean(),
    issuer: v.union(v.string(), v.null()),
    subject: v.union(v.string(), v.null()),
    tokenIdentifier: v.union(v.string(), v.null()),
  }),
});

/**
 * Get a user by their Convex ID.
 */
export const getById = query({
  args: { id: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get("users", args.id);
  },
  returns: v.union(
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
});
