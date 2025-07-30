import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { getNextLocationColor } from "./validators";

/**
 * Get all locations for a practice.
 */
export const getLocations = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("locations")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();
  },
});

/**
 * Create a new location for a practice.
 */
export const createLocation = mutation({
  args: {
    name: v.string(),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    // Check if a location with this name already exists for this practice
    const existingLocation = await ctx.db
      .query("locations")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .filter((q) => q.eq(q.field("name"), args.name))
      .first();

    if (existingLocation) {
      throw new Error(
        `Location "${args.name}" already exists for this practice`,
      );
    }

    // Get existing locations to determine next color
    const existingLocations = await ctx.db
      .query("locations")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    // Assign color based on the number of existing locations
    const assignedColor = getNextLocationColor(existingLocations.length);

    const locationId = await ctx.db.insert("locations", {
      color: assignedColor,
      name: args.name,
      practiceId: args.practiceId,
    });

    return locationId;
  },
  returns: v.id("locations"),
});

/**
 * Update an existing location.
 */
export const updateLocation = mutation({
  args: {
    locationId: v.id("locations"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const location = await ctx.db.get(args.locationId);
    if (!location) {
      throw new Error("Location not found");
    }

    // Check if another location with this name already exists for this practice
    const existingLocation = await ctx.db
      .query("locations")
      .withIndex("by_practiceId", (q) =>
        q.eq("practiceId", location.practiceId),
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("name"), args.name),
          q.neq(q.field("_id"), args.locationId),
        ),
      )
      .first();

    if (existingLocation) {
      throw new Error(
        `Location "${args.name}" already exists for this practice`,
      );
    }

    await ctx.db.patch(args.locationId, {
      name: args.name,
    });
  },
});

/**
 * Delete a location.
 */
export const deleteLocation = mutation({
  args: {
    locationId: v.id("locations"),
  },
  handler: async (ctx, args) => {
    const location = await ctx.db.get(args.locationId);
    if (!location) {
      throw new Error("Location not found");
    }

    // Check if any appointments are using this location
    const appointmentsUsingLocation = await ctx.db
      .query("appointments")
      .filter((q) => q.eq(q.field("locationId"), args.locationId))
      .first();

    if (appointmentsUsingLocation) {
      throw new Error("Cannot delete location that is used by appointments");
    }

    // Check if any rules are using this location
    const rulesUsingLocation = await ctx.db
      .query("rules")
      .filter((q) => q.eq(q.field("limit_atLocation"), args.locationId))
      .first();

    if (rulesUsingLocation) {
      throw new Error("Cannot delete location that is used by rules");
    }

    await ctx.db.delete(args.locationId);
  },
});

/**
 * Get a specific location by ID.
 */
export const getLocation = query({
  args: {
    locationId: v.id("locations"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.locationId);
  },
});
