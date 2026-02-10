// convex/auth.ts
import { type AuthFunctions, AuthKit } from "@convex-dev/workos-authkit";

import type { DataModel } from "./_generated/dataModel";

import { components, internal } from "./_generated/api";

// Get a typed object of internal Convex functions exported by this file
const authFunctions: AuthFunctions = internal.auth;

export const authKit = new AuthKit<DataModel>(components.workOSAuthKit, {
  authFunctions,
});

/**
 * User sync events from WorkOS.
 *
 * When users are created, updated, or deleted in WorkOS, these events
 * sync that data to our users table. This gives us a local users table
 * that we can query directly and extend with app-specific data.
 */
export const { authKitEvent } = authKit.events({
  "user.created": async (ctx, event) => {
    // Check if user already exists to handle webhook retries idempotently
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", event.data.id))
      .unique();

    if (existingUser) {
      // User already exists, update their data instead
      const updateData: {
        email: string;
        firstName?: string;
        lastName?: string;
      } = {
        email: event.data.email,
      };
      if (event.data.firstName) {
        updateData.firstName = event.data.firstName;
      }
      if (event.data.lastName) {
        updateData.lastName = event.data.lastName;
      }
      await ctx.db.patch("users", existingUser._id, updateData);
      return;
    }

    // Insert new user
    const userData: {
      authId: string;
      createdAt: bigint;
      email: string;
      firstName?: string;
      lastName?: string;
    } = {
      authId: event.data.id,
      createdAt: BigInt(Date.now()),
      email: event.data.email,
    };
    if (event.data.firstName) {
      userData.firstName = event.data.firstName;
    }
    if (event.data.lastName) {
      userData.lastName = event.data.lastName;
    }
    await ctx.db.insert("users", userData);
  },
  "user.deleted": async (ctx, event) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", event.data.id))
      .unique();
    if (!user) {
      console.warn(`User not found for delete: ${event.data.id}`);
      return;
    }
    await ctx.db.delete("users", user._id);
  },
  "user.updated": async (ctx, event) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", event.data.id))
      .unique();
    if (!user) {
      console.warn(`User not found for update: ${event.data.id}`);
      return;
    }
    const updateData: {
      email: string;
      firstName?: string;
      lastName?: string;
    } = {
      email: event.data.email,
    };
    if (event.data.firstName) {
      updateData.firstName = event.data.firstName;
    }
    if (event.data.lastName) {
      updateData.lastName = event.data.lastName;
    }
    await ctx.db.patch("users", user._id, updateData);
  },
});
