import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import {
  canModifyDirectly,
  validateEntityBelongsToRuleSet,
  validateRuleSetBelongsToPractice,
} from "./ruleSetValidation";

/**
 * Get all locations for a specific rule set.
 * ruleSetId is required to prevent querying across all rule sets.
 */
export const getLocations = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("locations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
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
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Verify the rule set exists and belongs to this practice
    await validateRuleSetBelongsToPractice(
      ctx,
      args.ruleSetId,
      args.practiceId,
    );

    // Check if a location with this name already exists in this rule set
    const existingLocation = await ctx.db
      .query("locations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .filter((q) => q.eq(q.field("name"), args.name))
      .first();

    if (existingLocation) {
      throw new Error(
        `Location "${args.name}" already exists in this rule set`,
      );
    }

    const locationId = await ctx.db.insert("locations", {
      name: args.name,
      practiceId: args.practiceId,
      ruleSetId: args.ruleSetId,
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
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    const fetchedLocation = await ctx.db.get(args.locationId);

    // Validate the entity and rule set
    const location = await validateEntityBelongsToRuleSet(
      ctx,
      fetchedLocation,
      "Location",
      args.ruleSetId,
    );

    // Check if another location with this name already exists in this rule set
    const existingLocation = await ctx.db
      .query("locations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .filter((q) =>
        q.and(
          q.eq(q.field("name"), args.name),
          q.neq(q.field("_id"), args.locationId),
        ),
      )
      .first();

    if (existingLocation) {
      throw new Error(
        `Location "${args.name}" already exists in this rule set`,
      );
    }

    // Check if the location already belongs to the target rule set
    if (canModifyDirectly(location.ruleSetId, args.ruleSetId)) {
      // Same rule set - we can patch directly (for ungespeichert)
      await ctx.db.patch(args.locationId, {
        name: args.name,
      });
      return args.locationId;
    } else {
      // Different rule set - create a new location (copy-on-write)
      const newLocationId = await ctx.db.insert("locations", {
        name: args.name,
        practiceId: location.practiceId,
        ruleSetId: args.ruleSetId,
      });
      return newLocationId;
    }
  },
  returns: v.id("locations"),
});

/**
 * Delete a location.
 */
export const deleteLocation = mutation({
  args: {
    locationId: v.id("locations"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    const fetchedLocation = await ctx.db.get(args.locationId);

    // Validate the entity and rule set
    const location = await validateEntityBelongsToRuleSet(
      ctx,
      fetchedLocation,
      "Location",
      args.ruleSetId,
    );

    // Check if the location belongs to the target rule set
    if (canModifyDirectly(location.ruleSetId, args.ruleSetId)) {
      // Same rule set - we can delete directly (for ungespeichert)
      // Check if any appointments are using this location
      const appointmentsUsingLocation = await ctx.db
        .query("appointments")
        .filter((q) => q.eq(q.field("locationId"), args.locationId))
        .first();

      if (appointmentsUsingLocation) {
        throw new Error("Cannot delete location that is used by appointments");
      }

      // Check if any base schedules are using this location in this rule set
      const schedulesUsingLocation = await ctx.db
        .query("baseSchedules")
        .withIndex("by_locationId", (q) => q.eq("locationId", args.locationId))
        .filter((q) => q.eq(q.field("ruleSetId"), args.ruleSetId))
        .first();

      if (schedulesUsingLocation) {
        throw new Error(
          "Cannot delete location that is used by base schedules",
        );
      }

      await ctx.db.delete(args.locationId);
      return null;
    } else {
      // Different rule set - trigger copy-on-write
      // This means: copy all locations from the source rule set to the target rule set,
      // EXCEPT the one being deleted
      const allLocations = await ctx.db
        .query("locations")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", location.ruleSetId))
        .collect();

      for (const sourceLocation of allLocations) {
        // Skip the location being deleted
        if (sourceLocation._id === args.locationId) {
          continue;
        }

        // Create a new location in the target rule set
        await ctx.db.insert("locations", {
          name: sourceLocation.name,
          practiceId: sourceLocation.practiceId,
          ruleSetId: args.ruleSetId,
        });
      }

      return null;
    }
  },
  returns: v.null(),
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
