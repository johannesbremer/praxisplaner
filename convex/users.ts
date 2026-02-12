// convex/users.ts
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";

import { query } from "./_generated/server";
import { authKit } from "./auth";
import { findUserByAuthId } from "./userIdentity";
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
    const user = await findUserByAuthId(ctx.db, authUser.id);

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

/**
 * Fetch a lightweight map of users by their Convex IDs for UI display.
 * Returns only the fields we need for names and email fallbacks.
 */
export const getUsersByIds = query({
  args: { userIds: v.array(v.id("users")) },
  handler: async (ctx, args) => {
    const users = await Promise.all(
      args.userIds.map((id) => ctx.db.get("users", id)),
    );

    const userMap: Record<
      Id<"users">,
      {
        email: string;
        firstName?: string;
        lastName?: string;
      }
    > = {};

    for (const user of users) {
      if (!user) {
        continue;
      }

      userMap[user._id] = {
        email: user.email,
        ...(user.firstName ? { firstName: user.firstName } : {}),
        ...(user.lastName ? { lastName: user.lastName } : {}),
      };
    }

    return userMap;
  },
  returns: v.record(
    v.id("users"),
    v.object({
      email: v.string(),
      firstName: v.optional(v.string()),
      lastName: v.optional(v.string()),
    }),
  ),
});
