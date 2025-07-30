import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";

import { mutation, query } from "./_generated/server";

export const createAppointmentType = mutation({
  args: {
    durations: v.optional(
      v.array(
        v.object({
          duration: v.number(),
          locationId: v.id("locations"),
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
      throw new Error("Appointment type with this name already exists");
    }

    // Create the appointment type
    const appointmentTypeId = await ctx.db.insert("appointmentTypes", {
      createdAt: BigInt(Date.now()),
      lastModified: BigInt(Date.now()),
      name: args.name,
      practiceId: args.practiceId,
    });

    // Create duration entries if provided
    if (args.durations) {
      for (const duration of args.durations) {
        await ctx.db.insert("appointmentTypeDurations", {
          appointmentTypeId,
          duration: duration.duration,
          locationId: duration.locationId,
          practitionerId: duration.practitionerId,
        });
      }
    }

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

    // For each appointment type, build the durations structure from the separate table
    const result = await Promise.all(
      appointmentTypes.map(async (appointmentType) => {
        const durationRecords = await ctx.db
          .query("appointmentTypeDurations")
          .withIndex("by_appointmentType", (q) =>
            q.eq("appointmentTypeId", appointmentType._id),
          )
          .collect();

        // Transform back to the nested structure for backward compatibility
        const durations: Record<
          string,
          Record<Id<"locations">, Id<"practitioners">[]>
        > = {};

        for (const record of durationRecords) {
          const durationKey = record.duration.toString();
          durations[durationKey] ??= {};
          durations[durationKey][record.locationId] ??= [];

          const practitionerList = durations[durationKey][record.locationId];
          if (
            practitionerList &&
            !practitionerList.includes(record.practitionerId)
          ) {
            practitionerList.push(record.practitionerId);
          }
        }

        return {
          ...appointmentType,
          durations: Object.keys(durations).length > 0 ? durations : undefined,
        };
      }),
    );

    return result.sort((a, b) => a.name.localeCompare(b.name));
  },
  returns: v.array(
    v.object({
      _creationTime: v.number(),
      _id: v.id("appointmentTypes"),
      createdAt: v.int64(),
      durations: v.optional(
        v.record(
          v.string(), // duration in minutes as string key (e.g., "10", "15")
          v.record(
            v.id("locations"), // location ID as key
            v.array(v.id("practitioners")), // practitioners at this location with this duration
          ),
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
          locationId: v.id("locations"),
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

    // Update the appointment type
    await ctx.db.patch(args.appointmentTypeId, updates);

    // If durations are provided, update the durations table
    if (args.durations !== undefined) {
      // First, delete all existing duration records for this appointment type
      const existingDurations = await ctx.db
        .query("appointmentTypeDurations")
        .withIndex("by_appointmentType", (q) =>
          q.eq("appointmentTypeId", args.appointmentTypeId),
        )
        .collect();

      for (const duration of existingDurations) {
        await ctx.db.delete(duration._id);
      }

      // Then, insert the new duration records
      for (const duration of args.durations) {
        await ctx.db.insert("appointmentTypeDurations", {
          appointmentTypeId: args.appointmentTypeId,
          duration: duration.duration,
          locationId: duration.locationId,
          practitionerId: duration.practitionerId,
        });
      }
    }

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

    // Get all locations for this practice
    const locations = await ctx.db
      .query("locations")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    const locationNameToId = new Map<string, Id<"locations">>();
    for (const location of locations) {
      locationNameToId.set(location.name, location._id);
    }

    // Get all practitioners for this practice
    const practitioners = await ctx.db
      .query("practitioners")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    const practitionerNameToId = new Map<string, Id<"practitioners">>();
    for (const practitioner of practitioners) {
      practitionerNameToId.set(practitioner.name, practitioner._id);
    }

    // Parse column headers to extract practitioner names and locations
    const columnMappings: {
      locationId: Id<"locations">;
      locationName: string;
      practitionerId: Id<"practitioners">;
      practitionerName: string;
    }[] = [];
    const newPractitionerIds = new Map<string, Id<"practitioners">>();
    const newLocationIds = new Map<string, Id<"locations">>();

    // Get existing location names from database
    const existingLocationNames = locations.map((loc) => loc.name);

    for (let i = 1; i < headers.length; i++) {
      const header = headers[i];
      if (!header) {
        continue;
      }

      // Try to extract location from the end of the header
      let practitionerName = "";
      let locationName = "";

      // Look for existing location names at the end of the header
      for (const locName of existingLocationNames) {
        if (header.endsWith(` ${locName}`)) {
          practitionerName = header
            .slice(0, Math.max(0, header.length - locName.length - 1))
            .trim();
          locationName = locName;
          break;
        }
      }

      // If no known location found, try to split by last space
      if (!locationName) {
        const lastSpaceIndex = header.lastIndexOf(" ");
        if (lastSpaceIndex > 0) {
          practitionerName = header
            .slice(0, Math.max(0, lastSpaceIndex))
            .trim();
          locationName = header.slice(Math.max(0, lastSpaceIndex + 1)).trim();
          // Only accept if location name looks like a valid location (alphabetic)
          if (!/^[A-Za-z]+$/u.test(locationName)) {
            practitionerName = "";
            locationName = "";
          }
        }

        if (!practitionerName || !locationName) {
          // Fallback: treat entire header as practitioner name, skip location
          console.warn(`Could not parse location from header: ${header}`);
          continue;
        }
      }

      if (!practitionerName || !locationName) {
        console.warn(
          `Could not parse practitioner and location from header: ${header}`,
        );
        continue;
      }

      // Get or create location
      let locationId = locationNameToId.get(locationName);
      if (!locationId) {
        // Create new location
        locationId = await ctx.db.insert("locations", {
          name: locationName,
          practiceId: args.practiceId,
        });
        locationNameToId.set(locationName, locationId);
        newLocationIds.set(locationName, locationId);
      }

      // Get or create practitioner
      let practitionerId = practitionerNameToId.get(practitionerName);
      if (!practitionerId) {
        // Create new practitioner
        practitionerId = await ctx.db.insert("practitioners", {
          name: practitionerName,
          practiceId: args.practiceId,
        });
        practitionerNameToId.set(practitionerName, practitionerId);
        newPractitionerIds.set(practitionerName, practitionerId);
      }

      columnMappings.push({
        locationId,
        locationName,
        practitionerId,
        practitionerName,
      });
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

      // Build durations array with location support
      const durationsArray: {
        duration: number;
        locationId: Id<"locations">;
        practitionerId: Id<"practitioners">;
      }[] = [];

      for (const [j, mapping] of columnMappings.entries()) {
        const valueStr = values[j + 1]; // +1 because first column is appointment type name
        if (!valueStr) {
          continue;
        }

        const duration = Number.parseInt(valueStr, 10);

        if (!Number.isNaN(duration) && duration > 0) {
          durationsArray.push({
            duration,
            locationId: mapping.locationId,
            practitionerId: mapping.practitionerId,
          });
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
            });
          }

          // Insert new duration records
          for (const durationItem of durationsArray) {
            await ctx.db.insert("appointmentTypeDurations", {
              appointmentTypeId,
              duration: durationItem.duration,
              locationId: durationItem.locationId,
              practitionerId: durationItem.practitionerId,
            });
          }
        });

      importedTypes.push(appointmentTypeName);
    }

    return {
      importedTypes,
      newLocations: [...newLocationIds.keys()],
      newPractitioners: [...newPractitionerIds.keys()],
    };
  },
  returns: v.object({
    importedTypes: v.array(v.string()),
    newLocations: v.array(v.string()),
    newPractitioners: v.array(v.string()),
  }),
});
