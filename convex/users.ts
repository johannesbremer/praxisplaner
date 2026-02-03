// convex/users.ts
import { v } from "convex/values";

import { query } from "./_generated/server";
import { authKit } from "./auth";
import { workOSAuthUserValidator } from "./validators";

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
 * @returns The WorkOS user object if authenticated, null otherwise.
 */
export const getAuthUser = query({
  args: {},
  handler: async (ctx) => {
    return await authKit.getAuthUser(ctx);
  },
  returns: v.union(workOSAuthUserValidator, v.null()),
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
