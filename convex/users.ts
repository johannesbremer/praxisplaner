// convex/users.ts
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";

import { query } from "./_generated/server";
import { authKit } from "./auth";
import { workOSAuthUserValidator } from "./validators";

interface BookingConfirmationStepSnapshot {
  lastModified: bigint;
  personalData: BookingPersonalData;
}

interface BookingPersonalData {
  city?: string;
  dateOfBirth?: string;
  firstName?: string;
  lastName?: string;
  street?: string;
}

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
    const [existingConfirmationStepRaw, newConfirmationStepRaw, user] =
      await Promise.all([
        ctx.db
          .query("bookingExistingConfirmationSteps")
          .withIndex("by_userId", (q) => q.eq("userId", args.id))
          .order("desc")
          .first(),
        ctx.db
          .query("bookingNewConfirmationSteps")
          .withIndex("by_userId", (q) => q.eq("userId", args.id))
          .order("desc")
          .first(),
        ctx.db.get("users", args.id),
      ]);

    const existingConfirmationStep =
      existingConfirmationStepRaw as BookingConfirmationStepSnapshot | null;
    const newConfirmationStep =
      newConfirmationStepRaw as BookingConfirmationStepSnapshot | null;

    if (!user) {
      return null;
    }

    let latestPersonalData: BookingPersonalData | undefined;

    if (existingConfirmationStep && newConfirmationStep) {
      latestPersonalData =
        existingConfirmationStep.lastModified >= newConfirmationStep.lastModified
          ? existingConfirmationStep.personalData
          : newConfirmationStep.personalData;
    } else if (existingConfirmationStep) {
      latestPersonalData = existingConfirmationStep.personalData;
    } else if (newConfirmationStep) {
      latestPersonalData = newConfirmationStep.personalData;
    }

    const firstName = user.firstName ?? latestPersonalData?.firstName;
    const lastName = user.lastName ?? latestPersonalData?.lastName;

    const result: {
      _creationTime: number;
      _id: Id<"users">;
      authId: string;
      city?: string;
      createdAt: bigint;
      dateOfBirth?: string;
      email: string;
      firstName?: string;
      lastName?: string;
      street?: string;
    } = {
      ...user,
    };

    const assignIfDefined = <
      K extends "city" | "dateOfBirth" | "firstName" | "lastName" | "street",
    >(
      key: K,
      value: (typeof result)[K] | undefined,
    ) => {
      if (value === undefined) {
        return;
      }
      result[key] = value;
    };

    assignIfDefined("city", latestPersonalData?.city);
    assignIfDefined("dateOfBirth", latestPersonalData?.dateOfBirth);
    assignIfDefined("firstName", firstName);
    assignIfDefined("lastName", lastName);
    assignIfDefined("street", latestPersonalData?.street);

    return result;
  },
  returns: v.union(
    v.object({
      _creationTime: v.number(),
      _id: v.id("users"),
      authId: v.string(),
      city: v.optional(v.string()),
      createdAt: v.int64(),
      dateOfBirth: v.optional(v.string()),
      email: v.string(),
      firstName: v.optional(v.string()),
      lastName: v.optional(v.string()),
      street: v.optional(v.string()),
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
