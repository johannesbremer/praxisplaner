import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";

import { mutation, query } from "./_generated/server";

type AppointmentDoc = Doc<"appointments">;

type AppointmentScope = "all" | "real" | "simulation";

function combineForSimulationScope(
  appointments: AppointmentDoc[],
): AppointmentDoc[] {
  const simulationAppointments = appointments.filter(
    (appointment) => appointment.isSimulation === true,
  );

  const replacedIds = new Set(
    simulationAppointments
      .map((appointment) => appointment.replacesAppointmentId)
      .filter(Boolean),
  );

  const realAppointments = appointments.filter(
    (appointment) =>
      appointment.isSimulation !== true && !replacedIds.has(appointment._id),
  );

  const merged = [...realAppointments, ...simulationAppointments];

  return merged.toSorted((a, b) => a.start.localeCompare(b.start));
}

// Query to get all appointments
export const getAppointments = query({
  args: {
    scope: v.optional(
      v.union(v.literal("real"), v.literal("simulation"), v.literal("all")),
    ),
  },
  handler: async (ctx, args) => {
    const scope: AppointmentScope = args.scope ?? "real";

    const appointments = await ctx.db
      .query("appointments")
      .order("asc")
      .collect();

    if (scope === "simulation") {
      return combineForSimulationScope(appointments);
    }

    if (scope === "all") {
      return appointments.toSorted((a, b) => a.start.localeCompare(b.start));
    }

    return appointments
      .filter((appointment) => appointment.isSimulation !== true)
      .toSorted((a, b) => a.start.localeCompare(b.start));
  },
  returns: v.array(
    v.object({
      _creationTime: v.number(),
      _id: v.id("appointments"),
      appointmentType: v.optional(v.string()),
      createdAt: v.int64(),
      end: v.string(),
      isSimulation: v.optional(v.boolean()),
      lastModified: v.int64(),
      locationId: v.id("locations"),
      patientId: v.optional(v.id("patients")),
      practitionerId: v.optional(v.id("practitioners")),
      replacesAppointmentId: v.optional(v.id("appointments")),
      start: v.string(),
      title: v.string(),
    }),
  ),
});

// Query to get appointments in a date range
export const getAppointmentsInRange = query({
  args: {
    end: v.string(),
    scope: v.optional(
      v.union(v.literal("real"), v.literal("simulation"), v.literal("all")),
    ),
    start: v.string(),
  },
  handler: async (ctx, args) => {
    const appointments = await ctx.db
      .query("appointments")
      .withIndex("by_start")
      .filter((q) =>
        q.and(
          q.gte(q.field("start"), args.start),
          q.lte(q.field("start"), args.end),
        ),
      )
      .collect();

    const scope: AppointmentScope = args.scope ?? "real";

    if (scope === "simulation") {
      return combineForSimulationScope(appointments);
    }

    if (scope === "all") {
      return appointments.toSorted((a, b) => a.start.localeCompare(b.start));
    }

    return appointments
      .filter((appointment) => appointment.isSimulation !== true)
      .toSorted((a, b) => a.start.localeCompare(b.start));
  },
  returns: v.array(
    v.object({
      _creationTime: v.number(),
      _id: v.id("appointments"),
      appointmentType: v.optional(v.string()),
      createdAt: v.int64(),
      end: v.string(),
      isSimulation: v.optional(v.boolean()),
      lastModified: v.int64(),
      locationId: v.id("locations"),
      patientId: v.optional(v.id("patients")),
      practitionerId: v.optional(v.id("practitioners")),
      replacesAppointmentId: v.optional(v.id("appointments")),
      start: v.string(),
      title: v.string(),
    }),
  ),
});

// Mutation to create a new appointment
export const createAppointment = mutation({
  args: {
    appointmentType: v.optional(v.string()),
    end: v.string(),
    isSimulation: v.optional(v.boolean()),
    locationId: v.id("locations"),
    patientId: v.optional(v.id("patients")),
    practiceId: v.id("practices"),
    practitionerId: v.optional(v.id("practitioners")),
    replacesAppointmentId: v.optional(v.id("appointments")),
    start: v.string(),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const now = BigInt(Date.now());
    const { isSimulation, replacesAppointmentId, ...rest } = args;

    if (replacesAppointmentId && isSimulation !== true) {
      throw new Error(
        "Only simulated appointments can replace existing appointments.",
      );
    }

    return await ctx.db.insert("appointments", {
      ...rest,
      createdAt: now,
      isSimulation: isSimulation ?? false,
      lastModified: now,
      ...(replacesAppointmentId !== undefined && {
        replacesAppointmentId,
      }),
    });
  },
  returns: v.id("appointments"),
});

// Mutation to update an existing appointment
export const updateAppointment = mutation({
  args: {
    appointmentType: v.optional(v.string()),
    end: v.optional(v.string()),
    id: v.id("appointments"),
    isSimulation: v.optional(v.boolean()),
    locationId: v.optional(v.id("locations")),
    patientId: v.optional(v.id("patients")),
    practitionerId: v.optional(v.id("practitioners")),
    replacesAppointmentId: v.optional(v.id("appointments")),
    start: v.optional(v.string()),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updateData } = args;

    // Filter out undefined values

    const filteredUpdateData = Object.fromEntries(
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      Object.entries(updateData).filter(([, value]) => value !== undefined),
    );

    await ctx.db.patch(id, {
      ...filteredUpdateData,
      lastModified: BigInt(Date.now()),
    });

    return null;
  },
  returns: v.null(),
});

// Mutation to delete an appointment
export const deleteAppointment = mutation({
  args: {
    id: v.id("appointments"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return null;
  },
  returns: v.null(),
});

// Mutation to delete all simulated appointments
export const deleteAllSimulatedAppointments = mutation({
  args: {},
  handler: async (ctx) => {
    const simulatedAppointments = await ctx.db
      .query("appointments")
      .withIndex("by_isSimulation", (q) => q.eq("isSimulation", true))
      .collect();

    for (const appointment of simulatedAppointments) {
      await ctx.db.delete(appointment._id);
    }

    return simulatedAppointments.length;
  },
  returns: v.number(),
});

/**
 * Create a zone (blocking appointment) for rule-based scheduling
 * Zones block out time periods and optionally restrict which appointment types can be booked
 */
export const createZone = mutation({
  args: {
    practiceId: v.id("practices"),
    practitionerId: v.id("practitioners"),
    locationId: v.id("locations"),
    start: v.string(), // ISO timestamp
    end: v.string(), // ISO timestamp
    allowOnly: v.array(v.string()), // Appointment types allowed in this zone
    createdByRuleId: v.optional(v.id("rules")),
    createdByRuleName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Create zone as a special appointment
    // The appointmentType starting with "_zone_" identifies it as a zone
    // The allowOnly list can be stored in the title as JSON for now
    const zoneId = await ctx.db.insert("appointments", {
      practiceId: args.practiceId,
      start: args.start,
      end: args.end,
      title: `Zone: ${args.createdByRuleName || "Unnamed"} (allows: ${args.allowOnly.join(", ")})`,
      appointmentType: `_zone_${args.createdByRuleName || "unnamed"}`,
      practitionerId: args.practitionerId,
      locationId: args.locationId,
      createdAt: BigInt(Date.now()),
      lastModified: BigInt(Date.now()),
      // Note: zones don't have patientId - omit it entirely
    });

    return zoneId;
  },
  returns: v.id("appointments"),
});
