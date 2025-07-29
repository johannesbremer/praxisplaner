import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";

import { mutation, query } from "./_generated/server";

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
  },
  handler: async (ctx, args) => {
    // Verify the practice exists
    const practice = await ctx.db.get(args.practiceId);
    if (!practice) {
      throw new Error("Practice not found");
    }

    // Check if appointment type already exists
    const existing = await ctx.db
      .query("appointmentTypes")
      .withIndex("by_practiceId_name", (q) =>
        q.eq("practiceId", args.practiceId).eq("name", args.name),
      )
      .first();

    if (existing) {
      // If it exists, update the durations
      await ctx.db.patch(existing._id, {
        ...(args.durations && { durations: args.durations }),
        lastModified: BigInt(Date.now()),
      });
      return existing._id;
    }

    // Create new appointment type
    const appointmentTypeData = {
      createdAt: BigInt(Date.now()),
      durations: args.durations ?? [],
      lastModified: BigInt(Date.now()),
      name: args.name,
      practiceId: args.practiceId,
    };

    const appointmentTypeId = await ctx.db.insert(
      "appointmentTypes",
      appointmentTypeData,
    );

    return appointmentTypeId;
  },
  returns: v.id("appointmentTypes"),
});

export const getAppointmentTypes = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    const appointmentTypes = await ctx.db
      .query("appointmentTypes")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    return appointmentTypes.sort((a, b) => a.name.localeCompare(b.name));
  },
  returns: v.array(
    v.object({
      _creationTime: v.number(),
      _id: v.id("appointmentTypes"),
      createdAt: v.int64(),
      durations: v.optional(
        v.array(
          v.object({
            duration: v.number(),
            practitionerId: v.id("practitioners"),
          }),
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
  },
  handler: async (ctx, args) => {
    const appointmentType = await ctx.db.get(args.appointmentTypeId);
    if (!appointmentType) {
      throw new Error("Appointment type not found");
    }

    const updates: Record<string, unknown> = {
      lastModified: BigInt(Date.now()),
    };

    if (args.name !== undefined) {
      updates["name"] = args.name;
    }
    if (args.durations !== undefined) {
      updates["durations"] = args.durations;
    }

    await ctx.db.patch(args.appointmentTypeId, updates);
    return null;
  },
  returns: v.null(),
});

export const deleteAppointmentType = mutation({
  args: {
    appointmentTypeId: v.id("appointmentTypes"),
  },
  handler: async (ctx, args) => {
    const appointmentType = await ctx.db.get(args.appointmentTypeId);
    if (!appointmentType) {
      throw new Error("Appointment type not found");
    }

    await ctx.db.delete(args.appointmentTypeId);
    return null;
  },
  returns: v.null(),
});

export const importAppointmentTypesFromCsv = mutation({
  args: {
    csvData: v.string(),
    practiceId: v.id("practices"),
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

    // Get all practitioners for this practice
    const practitioners = await ctx.db
      .query("practitioners")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    // Create a map of practitioner names to IDs
    const practitionerNameToId = new Map<string, Id<"practitioners">>();
    for (const practitioner of practitioners) {
      practitionerNameToId.set(practitioner.name, practitioner._id);
    }

    // Create practitioners for column headers that don't exist yet
    const newPractitionerIds = new Map<string, Id<"practitioners">>();
    for (let i = 1; i < headers.length; i++) {
      const practitionerName = headers[i];
      if (practitionerName && !practitionerNameToId.has(practitionerName)) {
        // Create new practitioner
        const newPractitionerId = await ctx.db.insert("practitioners", {
          name: practitionerName,
          practiceId: args.practiceId,
        });
        practitionerNameToId.set(practitionerName, newPractitionerId);
        newPractitionerIds.set(practitionerName, newPractitionerId);
      }
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

      // Build durations array
      const durations: {
        duration: number;
        practitionerId: Id<"practitioners">;
      }[] = [];
      for (let j = 1; j < values.length; j++) {
        const valueStr = values[j];
        if (!valueStr) {
          continue;
        }

        const duration = Number.parseInt(valueStr, 10);
        const practitionerName = headers[j];

        if (practitionerName) {
          const practitionerId = practitionerNameToId.get(practitionerName);

          if (practitionerId && !Number.isNaN(duration) && duration > 0) {
            durations.push({
              duration,
              practitionerId,
            });
          }
        }
      }

      // Create or update appointment type
      await ctx.db
        .query("appointmentTypes")
        .withIndex("by_practiceId_name", (q) =>
          q.eq("practiceId", args.practiceId).eq("name", appointmentTypeName),
        )
        .first()
        .then(async (existing) => {
          if (existing) {
            // Update existing
            await ctx.db.patch(existing._id, {
              durations,
              lastModified: BigInt(Date.now()),
            });
          } else {
            // Create new
            await ctx.db.insert("appointmentTypes", {
              createdAt: BigInt(Date.now()),
              durations,
              lastModified: BigInt(Date.now()),
              name: appointmentTypeName,
              practiceId: args.practiceId,
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
