import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";

import { mutation, query } from "./_generated/server";
import {
  canModifyDirectly,
  validateEntityBelongsToRuleSet,
  validateRuleSetBelongsToPractice,
} from "./ruleSetValidation";

export const createAppointmentType = mutation({
  args: {
    durations: v.optional(
      v.array(
        v.object({
          duration: v.number(),
          practitionerId: v.id("practitioners"),
        }),
      ),
    ),
    name: v.string(),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Verify the practice exists
    const practice = await ctx.db.get(args.practiceId);
    if (!practice) {
      throw new Error("Practice not found");
    }

    // Validate that the rule set belongs to the practice
    await validateRuleSetBelongsToPractice(
      ctx,
      args.ruleSetId,
      args.practiceId,
    );

    // Check if appointment type already exists in this rule set
    const existing = await ctx.db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId_name", (q) =>
        q.eq("ruleSetId", args.ruleSetId).eq("name", args.name),
      )
      .first();

    if (existing) {
      throw new Error(
        "Appointment type with this name already exists in this rule set",
      );
    }

    // Create the appointment type
    const appointmentTypeId = await ctx.db.insert("appointmentTypes", {
      createdAt: BigInt(Date.now()),
      lastModified: BigInt(Date.now()),
      name: args.name,
      practiceId: args.practiceId,
      ruleSetId: args.ruleSetId,
    });

    // Create duration entries if provided
    if (args.durations) {
      for (const duration of args.durations) {
        await ctx.db.insert("appointmentTypeDurations", {
          appointmentTypeId,
          duration: duration.duration,
          practitionerId: duration.practitionerId,
        });
      }
    }

    return appointmentTypeId;
  },
  returns: v.id("appointmentTypes"),
});

/**
 * Get all appointment types for a specific rule set.
 * ruleSetId is required to prevent querying across all rule sets.
 */
export const getAppointmentTypes = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    const appointmentTypes = await ctx.db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    // For each appointment type, build the durations structure from the separate table
    const result = await Promise.all(
      appointmentTypes.map(async (appointmentType) => {
        const durationRecords = await ctx.db
          .query("appointmentTypeDurations")
          .withIndex("by_appointmentType", (q) =>
            q.eq("appointmentTypeId", appointmentType._id),
          )
          .collect();

        // Transform to a simple duration -> practitioners mapping
        const durations: Record<string, Id<"practitioners">[]> = {};

        for (const record of durationRecords) {
          const durationKey = record.duration.toString();
          durations[durationKey] ??= [];

          const practitionerList = durations[durationKey];
          if (!practitionerList.includes(record.practitionerId)) {
            practitionerList.push(record.practitionerId);
          }
        }

        const hasDurations = Object.keys(durations).length > 0;

        return {
          ...appointmentType,
          ...(hasDurations ? { durations } : {}),
        };
      }),
    );

    return result.toSorted((a, b) => a.name.localeCompare(b.name));
  },
  returns: v.array(
    v.object({
      _creationTime: v.number(),
      _id: v.id("appointmentTypes"),
      createdAt: v.int64(),
      durations: v.optional(
        v.record(
          v.string(), // duration in minutes as string key (e.g., "10", "15")
          v.array(v.id("practitioners")), // practitioners with this duration
        ),
      ),
      lastModified: v.int64(),
      name: v.string(),
      practiceId: v.id("practices"),
    }),
  ),
});

export const updateAppointmentType = mutation({
  args: {
    appointmentTypeId: v.id("appointmentTypes"),
    durations: v.optional(
      v.array(
        v.object({
          duration: v.number(),
          practitionerId: v.id("practitioners"),
        }),
      ),
    ),
    name: v.optional(v.string()),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    const appointmentType = await ctx.db.get(args.appointmentTypeId);
    if (!appointmentType) {
      throw new Error("Appointment type not found");
    }

    // Validate the entity and rule set relationship
    await validateEntityBelongsToRuleSet(
      ctx,
      appointmentType,
      "appointmentTypes",
      args.ruleSetId,
    );

    const updates: Record<string, unknown> = {
      lastModified: BigInt(Date.now()),
    };

    if (args.name !== undefined) {
      updates["name"] = args.name;
    }

    let targetAppointmentTypeId: Id<"appointmentTypes">;

    // Check if we can modify directly or need to copy
    const shouldCopyOnWrite = !canModifyDirectly(
      appointmentType.ruleSetId,
      args.ruleSetId,
    );

    if (shouldCopyOnWrite) {
      // Different rule set - create a new appointment type (copy-on-write)
      targetAppointmentTypeId = await ctx.db.insert("appointmentTypes", {
        createdAt: appointmentType.createdAt,
        lastModified: BigInt(Date.now()),
        name: args.name ?? appointmentType.name,
        practiceId: appointmentType.practiceId,
        ruleSetId: args.ruleSetId,
      });
    } else {
      // Same rule set - we can patch directly (for ungespeichert)
      await ctx.db.patch(args.appointmentTypeId, updates);
      targetAppointmentTypeId = args.appointmentTypeId;
    }

    // If durations are provided, update the durations table
    if (args.durations !== undefined) {
      // First, delete all existing duration records for this appointment type
      const existingDurations = await ctx.db
        .query("appointmentTypeDurations")
        .withIndex("by_appointmentType", (q) =>
          q.eq("appointmentTypeId", targetAppointmentTypeId),
        )
        .collect();

      for (const duration of existingDurations) {
        await ctx.db.delete(duration._id);
      }

      // Then, insert the new duration records
      for (const duration of args.durations) {
        await ctx.db.insert("appointmentTypeDurations", {
          appointmentTypeId: targetAppointmentTypeId,
          duration: duration.duration,
          practitionerId: duration.practitionerId,
        });
      }
    }

    return targetAppointmentTypeId;
  },
  returns: v.id("appointmentTypes"),
});

export const deleteAppointmentType = mutation({
  args: {
    appointmentTypeId: v.id("appointmentTypes"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    const appointmentType = await ctx.db.get(args.appointmentTypeId);
    if (!appointmentType) {
      throw new Error("Appointment type not found");
    }

    // Validate the entity and rule set relationship
    await validateEntityBelongsToRuleSet(
      ctx,
      appointmentType,
      "appointmentTypes",
      args.ruleSetId,
    );

    // Check if we can delete directly or need to copy-on-write
    const shouldCopyOnWrite = !canModifyDirectly(
      appointmentType.ruleSetId,
      args.ruleSetId,
    );

    if (shouldCopyOnWrite) {
      // Different rule set - trigger copy-on-write
      // This means: copy all appointment types from the source rule set to the target rule set,
      // EXCEPT the one being deleted
      const allAppointmentTypes = await ctx.db
        .query("appointmentTypes")
        .withIndex("by_ruleSetId", (q) =>
          q.eq("ruleSetId", appointmentType.ruleSetId),
        )
        .collect();

      for (const sourceType of allAppointmentTypes) {
        // Skip the appointment type being deleted
        if (sourceType._id === args.appointmentTypeId) {
          continue;
        }

        // Create a new appointment type in the target rule set
        const newAppointmentTypeId = await ctx.db.insert("appointmentTypes", {
          createdAt: sourceType.createdAt,
          lastModified: BigInt(Date.now()),
          name: sourceType.name,
          practiceId: sourceType.practiceId,
          ruleSetId: args.ruleSetId,
        });

        // Copy all durations for this appointment type
        const durations = await ctx.db
          .query("appointmentTypeDurations")
          .withIndex("by_appointmentType", (q) =>
            q.eq("appointmentTypeId", sourceType._id),
          )
          .collect();

        for (const duration of durations) {
          await ctx.db.insert("appointmentTypeDurations", {
            appointmentTypeId: newAppointmentTypeId,
            duration: duration.duration,
            practitionerId: duration.practitionerId,
          });
        }
      }

      return null;
    } else {
      // Same rule set - we can delete directly (for ungespeichert)
      // Delete all associated durations
      const durations = await ctx.db
        .query("appointmentTypeDurations")
        .withIndex("by_appointmentType", (q) =>
          q.eq("appointmentTypeId", args.appointmentTypeId),
        )
        .collect();

      for (const duration of durations) {
        await ctx.db.delete(duration._id);
      }

      await ctx.db.delete(args.appointmentTypeId);
      return null;
    }
  },
  returns: v.null(),
});

export const importAppointmentTypesFromCsv = mutation({
  args: {
    csvData: v.string(),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    const lines = args.csvData.trim().split("\n");
    if (lines.length < 2) {
      throw new Error("CSV must have at least a header and one data row");
    }

    // Parse the header
    const headerLine = lines[0];
    if (!headerLine) {
      throw new Error("CSV header is missing");
    }
    const headers = headerLine
      .split(",")
      .map((h) => h.replaceAll('"', "").trim());

    // First column should be "Terminart" (appointment type)
    if (headers[0] !== "Terminart") {
      throw new Error("First column must be 'Terminart'");
    }

    // Get all practitioners for this rule set
    const practitioners = await ctx.db
      .query("practitioners")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    const practitionerNameToId = new Map<string, Id<"practitioners">>();
    for (const practitioner of practitioners) {
      practitionerNameToId.set(practitioner.name, practitioner._id);
    }

    // Parse column headers to extract practitioner names (ignoring locations)
    const columnToPractitioner = new Map<number, Id<"practitioners">>();
    const newPractitionerIds = new Map<string, Id<"practitioners">>();

    for (let i = 1; i < headers.length; i++) {
      const header = headers[i];
      if (!header) {
        continue;
      }

      // Extract practitioner name by removing location suffix
      let practitionerName = header.trim();
      const lastSpaceIndex = header.lastIndexOf(" ");
      if (lastSpaceIndex > 0) {
        const potentialPractitionerName = header
          .slice(0, Math.max(0, lastSpaceIndex))
          .trim();
        const potentialLocation = header
          .slice(Math.max(0, lastSpaceIndex + 1))
          .trim();

        // If the potential location looks like a location name (alphabetic), use the first part as practitioner name
        if (/^[A-Za-z]+$/u.test(potentialLocation)) {
          practitionerName = potentialPractitionerName;
        }
      }

      // Get or create practitioner
      let practitionerId = practitionerNameToId.get(practitionerName);
      if (!practitionerId) {
        practitionerId = await ctx.db.insert("practitioners", {
          name: practitionerName,
          practiceId: args.practiceId,
          ruleSetId: args.ruleSetId,
        });
        practitionerNameToId.set(practitionerName, practitionerId);
        newPractitionerIds.set(practitionerName, practitionerId);
      }

      // Map this column to the practitioner
      columnToPractitioner.set(i, practitionerId);
    }

    // Process each data row
    const importedTypes: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) {
        continue;
      }

      const values = line.split(",").map((v) => v.replaceAll('"', "").trim());

      if (values.length !== headers.length) {
        continue; // Skip malformed rows
      }

      const appointmentTypeName = values[0];
      if (!appointmentTypeName) {
        continue; // Skip empty appointment type names
      }

      // Build durations with simple deduplication
      const practitionerDurations = new Map<Id<"practitioners">, number>();

      for (let j = 1; j < values.length; j++) {
        const valueStr = values[j];
        if (!valueStr) {
          continue;
        }

        const practitionerId = columnToPractitioner.get(j);
        if (!practitionerId) {
          continue;
        }

        const duration = Number.parseInt(valueStr, 10);

        if (
          !Number.isNaN(duration) &&
          duration > 0 && // Only store first duration encountered for each practitioner (deduplication)
          !practitionerDurations.has(practitionerId)
        ) {
          practitionerDurations.set(practitionerId, duration);
        }
      }

      // Convert to durationsArray
      const durationsArray = [...practitionerDurations.entries()].map(
        ([practitionerId, duration]) => ({ duration, practitionerId }),
      );

      // Create or update appointment type
      await ctx.db
        .query("appointmentTypes")
        .withIndex("by_practiceId_name", (q) =>
          q.eq("practiceId", args.practiceId).eq("name", appointmentTypeName),
        )
        .first()
        .then(async (existing) => {
          let appointmentTypeId: Id<"appointmentTypes">;

          if (existing) {
            // Update existing
            await ctx.db.patch(existing._id, {
              lastModified: BigInt(Date.now()),
            });
            appointmentTypeId = existing._id;

            // Delete existing durations for this appointment type
            const existingDurations = await ctx.db
              .query("appointmentTypeDurations")
              .withIndex("by_appointmentType", (q) =>
                q.eq("appointmentTypeId", existing._id),
              )
              .collect();

            for (const duration of existingDurations) {
              await ctx.db.delete(duration._id);
            }
          } else {
            // Create new
            appointmentTypeId = await ctx.db.insert("appointmentTypes", {
              createdAt: BigInt(Date.now()),
              lastModified: BigInt(Date.now()),
              name: appointmentTypeName,
              practiceId: args.practiceId,
              ruleSetId: args.ruleSetId,
            });
          }

          // Insert new duration records
          for (const durationItem of durationsArray) {
            await ctx.db.insert("appointmentTypeDurations", {
              appointmentTypeId,
              duration: durationItem.duration,
              practitionerId: durationItem.practitionerId,
            });
          }
        });

      importedTypes.push(appointmentTypeName);
    }

    return {
      importedTypes,
      newPractitioners: [...newPractitionerIds.keys()],
    };
  },
  returns: v.object({
    importedTypes: v.array(v.string()),
    newPractitioners: v.array(v.string()),
  }),
});
