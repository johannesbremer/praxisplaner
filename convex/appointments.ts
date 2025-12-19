import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";

import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { mapEntityIdsBetweenRuleSets } from "./copyOnWrite";

type AppointmentDoc = Doc<"appointments">;
type AppointmentScope = "all" | "real" | "simulation";

type BlockedSlotDoc = Doc<"blockedSlots">;

/**
 * Remaps entity IDs in blocked slots from source rule set to target rule set.
 * This is needed when viewing simulation data (from a different rule set) in the
 * context of the active rule set.
 */
async function remapBlockedSlotIds(
  ctx: { db: DatabaseReader },
  blockedSlots: BlockedSlotDoc[],
  sourceRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
): Promise<BlockedSlotDoc[]> {
  // If rule sets are the same, no remapping needed
  if (sourceRuleSetId === targetRuleSetId) {
    return blockedSlots;
  }

  // Get entity mappings
  const locationMapping = await mapEntityIdsBetweenRuleSets(
    ctx.db,
    sourceRuleSetId,
    targetRuleSetId,
    "locations",
  );
  const practitionerMapping = await mapEntityIdsBetweenRuleSets(
    ctx.db,
    sourceRuleSetId,
    targetRuleSetId,
    "practitioners",
  );

  // Remap IDs in blocked slots
  return blockedSlots.map((slot) => {
    const remappedSlot: BlockedSlotDoc = {
      ...slot,
      locationId: locationMapping.get(slot.locationId) ?? slot.locationId,
    };
    if (slot.practitionerId) {
      remappedSlot.practitionerId =
        practitionerMapping.get(slot.practitionerId) ?? slot.practitionerId;
    }
    return remappedSlot;
  });
}

/**
 * Remaps entity IDs in appointments from source rule set to target rule set.
 */
function combineBlockedSlotsForSimulation(
  blockedSlots: BlockedSlotDoc[],
): BlockedSlotDoc[] {
  const simulationSlots = blockedSlots.filter(
    (slot) => slot.isSimulation === true,
  );

  const replacedIds = new Set(
    simulationSlots.map((slot) => slot.replacesBlockedSlotId).filter(Boolean),
  );

  const realSlots = blockedSlots.filter(
    (slot) => slot.isSimulation !== true && !replacedIds.has(slot._id),
  );

  const merged = [...realSlots, ...simulationSlots];

  return merged.toSorted((a, b) => a.start.localeCompare(b.start));
}

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

async function remapAppointmentIds(
  ctx: { db: DatabaseReader },
  appointments: AppointmentDoc[],
  sourceRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
): Promise<AppointmentDoc[]> {
  // If rule sets are the same, no remapping needed
  if (sourceRuleSetId === targetRuleSetId) {
    return appointments;
  }

  // Get entity mappings
  const locationMapping = await mapEntityIdsBetweenRuleSets(
    ctx.db,
    sourceRuleSetId,
    targetRuleSetId,
    "locations",
  );
  const practitionerMapping = await mapEntityIdsBetweenRuleSets(
    ctx.db,
    sourceRuleSetId,
    targetRuleSetId,
    "practitioners",
  );
  const appointmentTypeMapping = await mapEntityIdsBetweenRuleSets(
    ctx.db,
    sourceRuleSetId,
    targetRuleSetId,
    "appointmentTypes",
  );

  // Remap IDs in appointments
  return appointments.map((appointment) => {
    const remappedAppointment: AppointmentDoc = {
      ...appointment,
      appointmentTypeId:
        appointmentTypeMapping.get(appointment.appointmentTypeId) ??
        appointment.appointmentTypeId,
      locationId:
        locationMapping.get(appointment.locationId) ?? appointment.locationId,
    };
    if (appointment.practitionerId) {
      remappedAppointment.practitionerId =
        practitionerMapping.get(appointment.practitionerId) ??
        appointment.practitionerId;
    }
    return remappedAppointment;
  });
}

// Query to get all appointments
export const getAppointments = query({
  args: {
    activeRuleSetId: v.optional(v.id("ruleSets")),
    scope: v.optional(
      v.union(v.literal("real"), v.literal("simulation"), v.literal("all")),
    ),
    selectedRuleSetId: v.optional(v.id("ruleSets")),
  },
  handler: async (ctx, args) => {
    const scope: AppointmentScope = args.scope ?? "real";

    let appointments = await ctx.db
      .query("appointments")
      .order("asc")
      .collect();

    // If both rule set IDs are provided and different, remap entity IDs in REAL appointments
    // from active rule set to selected rule set BEFORE combining with simulation data
    if (
      args.selectedRuleSetId &&
      args.activeRuleSetId &&
      args.selectedRuleSetId !== args.activeRuleSetId
    ) {
      // Only remap real appointments (simulation appointments already have correct IDs)
      const realAppointments = appointments.filter(
        (appointment) => appointment.isSimulation !== true,
      );
      const simulationAppointments = appointments.filter(
        (appointment) => appointment.isSimulation === true,
      );

      const remappedRealAppointments = await remapAppointmentIds(
        ctx,
        realAppointments,
        args.activeRuleSetId,
        args.selectedRuleSetId,
      );

      appointments = [...remappedRealAppointments, ...simulationAppointments];
    }

    let resultAppointments: AppointmentDoc[];

    if (scope === "simulation") {
      resultAppointments = combineForSimulationScope(appointments);
    } else if (scope === "all") {
      resultAppointments = appointments.toSorted((a, b) =>
        a.start.localeCompare(b.start),
      );
    } else {
      resultAppointments = appointments
        .filter((appointment) => appointment.isSimulation !== true)
        .toSorted((a, b) => a.start.localeCompare(b.start));
    }

    return resultAppointments;
  },
  returns: v.array(
    v.object({
      _creationTime: v.number(),
      _id: v.id("appointments"),
      appointmentTypeId: v.id("appointmentTypes"),
      appointmentTypeTitle: v.string(),
      createdAt: v.int64(),
      end: v.string(),
      isSimulation: v.optional(v.boolean()),
      lastModified: v.int64(),
      locationId: v.id("locations"),
      patientId: v.optional(v.id("patients")),
      practiceId: v.id("practices"),
      practitionerId: v.optional(v.id("practitioners")),
      replacesAppointmentId: v.optional(v.id("appointments")),
      start: v.string(),
      temporaryPatientId: v.optional(v.id("temporaryPatients")),
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
    // Use index range query instead of filter for better performance
    const appointments = await ctx.db
      .query("appointments")
      .withIndex("by_start", (q) => q.gte("start", args.start))
      .collect();

    // Filter in code for end date (more efficient than .filter())
    const filteredAppointments = appointments.filter(
      (a) => a.start <= args.end,
    );

    const scope: AppointmentScope = args.scope ?? "real";

    if (scope === "simulation") {
      return combineForSimulationScope(filteredAppointments);
    }

    if (scope === "all") {
      return filteredAppointments.toSorted((a, b) =>
        a.start.localeCompare(b.start),
      );
    }

    return filteredAppointments
      .filter((appointment) => appointment.isSimulation !== true)
      .toSorted((a, b) => a.start.localeCompare(b.start));
  },
  returns: v.array(
    v.object({
      _creationTime: v.number(),
      _id: v.id("appointments"),
      appointmentTypeId: v.id("appointmentTypes"),
      appointmentTypeTitle: v.string(),
      createdAt: v.int64(),
      end: v.string(),
      isSimulation: v.optional(v.boolean()),
      lastModified: v.int64(),
      locationId: v.id("locations"),
      patientId: v.optional(v.id("patients")),
      practiceId: v.id("practices"),
      practitionerId: v.optional(v.id("practitioners")),
      replacesAppointmentId: v.optional(v.id("appointments")),
      start: v.string(),
      temporaryPatientId: v.optional(v.id("temporaryPatients")),
      title: v.string(),
    }),
  ),
});

// Mutation to create a new appointment
export const createAppointment = mutation({
  args: {
    appointmentTypeId: v.id("appointmentTypes"),
    end: v.string(),
    isSimulation: v.optional(v.boolean()),
    locationId: v.id("locations"),
    patientId: v.optional(v.id("patients")),
    practiceId: v.id("practices"),
    practitionerId: v.optional(v.id("practitioners")),
    replacesAppointmentId: v.optional(v.id("appointments")),
    start: v.string(),
    temporaryPatientId: v.optional(v.id("temporaryPatients")),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const now = BigInt(Date.now());
    const {
      isSimulation,
      patientId,
      replacesAppointmentId,
      temporaryPatientId,
      ...rest
    } = args;

    if (replacesAppointmentId && isSimulation !== true) {
      throw new Error(
        "Only simulated appointments can replace existing appointments.",
      );
    }

    // For non-simulation appointments, validate that exactly one of patientId or temporaryPatientId is provided
    if (!isSimulation) {
      if (!patientId && !temporaryPatientId) {
        throw new Error(
          "Either patientId or temporaryPatientId must be provided.",
        );
      }
      if (patientId && temporaryPatientId) {
        throw new Error(
          "Cannot provide both patientId and temporaryPatientId. Choose one.",
        );
      }
    }

    // If both are provided (even for simulations), reject
    if (patientId && temporaryPatientId) {
      throw new Error(
        "Cannot provide both patientId and temporaryPatientId. Choose one.",
      );
    }

    // If a temporaryPatientId is provided, verify it exists
    if (temporaryPatientId) {
      const temporaryPatient = await ctx.db.get(temporaryPatientId);
      if (!temporaryPatient) {
        throw new Error(
          `Temporary patient with ID ${temporaryPatientId} not found`,
        );
      }
    }

    // If a patientId is provided, verify it exists
    if (patientId) {
      const patient = await ctx.db.get(patientId);
      if (!patient) {
        throw new Error(`Patient with ID ${patientId} not found`);
      }
    }

    // Look up the appointment type to get its name at booking time
    const appointmentType = await ctx.db.get(args.appointmentTypeId);
    if (!appointmentType) {
      throw new Error(
        `Appointment type with ID ${args.appointmentTypeId} not found`,
      );
    }

    const insertData = {
      ...rest,
      appointmentTypeTitle: appointmentType.name, // Store appointment type name at booking time
      createdAt: now,
      isSimulation: isSimulation ?? false,
      lastModified: now,
      ...(patientId && { patientId }),
      ...(temporaryPatientId && { temporaryPatientId }),
      ...(replacesAppointmentId !== undefined && {
        replacesAppointmentId,
      }),
    };
    return await ctx.db.insert("appointments", insertData);
  },
  returns: v.id("appointments"),
});

// Mutation to update an existing appointment
export const updateAppointment = mutation({
  args: {
    appointmentTypeId: v.optional(v.id("appointmentTypes")),
    end: v.optional(v.string()),
    id: v.id("appointments"),
    isSimulation: v.optional(v.boolean()),
    locationId: v.optional(v.id("locations")),
    patientId: v.optional(v.id("patients")),
    practitionerId: v.optional(v.id("practitioners")),
    replacesAppointmentId: v.optional(v.id("appointments")),
    start: v.optional(v.string()),
    temporaryPatientId: v.optional(v.id("temporaryPatients")),
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

// Query to get all appointments for a patient (past, present, and future)
export const getAppointmentsForPatient = query({
  args: {
    patientId: v.optional(v.id("patients")),
    temporaryPatientId: v.optional(v.id("temporaryPatients")),
  },
  handler: async (ctx, args) => {
    // Need at least one patient ID
    if (!args.patientId && !args.temporaryPatientId) {
      return [];
    }

    const appointments: AppointmentDoc[] = [];

    // Query by patient ID if provided
    if (args.patientId) {
      const patientAppointments = await ctx.db
        .query("appointments")
        .withIndex("by_patientId", (q) => q.eq("patientId", args.patientId))
        .collect();
      appointments.push(...patientAppointments);
    }

    // Query by temporary patient ID if provided
    if (args.temporaryPatientId) {
      const tempPatientAppointments = await ctx.db
        .query("appointments")
        .withIndex("by_temporaryPatientId", (q) =>
          q.eq("temporaryPatientId", args.temporaryPatientId),
        )
        .collect();
      appointments.push(...tempPatientAppointments);
    }

    // Sort by start time (ascending)
    return appointments.toSorted((a, b) => a.start.localeCompare(b.start));
  },
  returns: v.array(
    v.object({
      _creationTime: v.number(),
      _id: v.id("appointments"),
      appointmentTypeId: v.id("appointmentTypes"),
      appointmentTypeTitle: v.string(),
      createdAt: v.int64(),
      end: v.string(),
      isSimulation: v.optional(v.boolean()),
      lastModified: v.int64(),
      locationId: v.id("locations"),
      patientId: v.optional(v.id("patients")),
      practiceId: v.id("practices"),
      practitionerId: v.optional(v.id("practitioners")),
      replacesAppointmentId: v.optional(v.id("appointments")),
      start: v.string(),
      temporaryPatientId: v.optional(v.id("temporaryPatients")),
      title: v.string(),
    }),
  ),
});

// Internal mutation to delete all simulated appointments
export const deleteAllSimulatedAppointments = internalMutation({
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

// Query to get all blocked slots
export const getBlockedSlots = query({
  args: {
    activeRuleSetId: v.optional(v.id("ruleSets")),
    scope: v.optional(
      v.union(v.literal("real"), v.literal("simulation"), v.literal("all")),
    ),
    selectedRuleSetId: v.optional(v.id("ruleSets")),
  },
  handler: async (ctx, args) => {
    const scope: AppointmentScope = args.scope ?? "real";

    let blockedSlots = await ctx.db
      .query("blockedSlots")
      .order("asc")
      .collect();

    // If both rule set IDs are provided and different, remap entity IDs in REAL blocked slots
    // from active rule set to selected rule set BEFORE combining with simulation data
    if (
      args.selectedRuleSetId &&
      args.activeRuleSetId &&
      args.selectedRuleSetId !== args.activeRuleSetId
    ) {
      // Only remap real blocked slots (simulation slots already have correct IDs)
      const realSlots = blockedSlots.filter(
        (slot) => slot.isSimulation !== true,
      );
      const simulationSlots = blockedSlots.filter(
        (slot) => slot.isSimulation === true,
      );

      const remappedRealSlots = await remapBlockedSlotIds(
        ctx,
        realSlots,
        args.activeRuleSetId,
        args.selectedRuleSetId,
      );

      blockedSlots = [...remappedRealSlots, ...simulationSlots];
    }

    let resultSlots: BlockedSlotDoc[];

    if (scope === "simulation") {
      resultSlots = combineBlockedSlotsForSimulation(blockedSlots);
    } else if (scope === "real") {
      resultSlots = blockedSlots.filter(
        (blockedSlot) => blockedSlot.isSimulation !== true,
      );
    } else {
      resultSlots = blockedSlots;
    }

    return resultSlots;
  },
  returns: v.array(
    v.object({
      _creationTime: v.number(),
      _id: v.id("blockedSlots"),
      createdAt: v.int64(),
      end: v.string(),
      isSimulation: v.optional(v.boolean()),
      lastModified: v.int64(),
      locationId: v.id("locations"),
      practiceId: v.id("practices"),
      practitionerId: v.optional(v.id("practitioners")),
      replacesBlockedSlotId: v.optional(v.id("blockedSlots")),
      start: v.string(),
      title: v.string(),
    }),
  ),
});

// Mutation to create a blocked slot
export const createBlockedSlot = mutation({
  args: {
    end: v.string(),
    isSimulation: v.optional(v.boolean()),
    locationId: v.id("locations"),
    practiceId: v.id("practices"),
    practitionerId: v.optional(v.id("practitioners")),
    replacesBlockedSlotId: v.optional(v.id("blockedSlots")),
    start: v.string(),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const { isSimulation, replacesBlockedSlotId, ...rest } = args;

    if (replacesBlockedSlotId && isSimulation !== true) {
      throw new Error(
        "replacesBlockedSlotId can only be used with isSimulation=true",
      );
    }

    const id = await ctx.db.insert("blockedSlots", {
      ...rest,
      createdAt: BigInt(Date.now()),
      isSimulation: isSimulation ?? false,
      lastModified: BigInt(Date.now()),
      ...(replacesBlockedSlotId && { replacesBlockedSlotId }),
    });

    return id;
  },
  returns: v.id("blockedSlots"),
});

// Mutation to update a blocked slot
export const updateBlockedSlot = mutation({
  args: {
    end: v.optional(v.string()),
    id: v.id("blockedSlots"),
    isSimulation: v.optional(v.boolean()),
    locationId: v.optional(v.id("locations")),
    practitionerId: v.optional(v.id("practitioners")),
    replacesBlockedSlotId: v.optional(v.id("blockedSlots")),
    start: v.optional(v.string()),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;

    await ctx.db.patch(id, {
      ...updates,
      lastModified: BigInt(Date.now()),
    });

    return null;
  },
  returns: v.null(),
});

// Mutation to delete a blocked slot
export const deleteBlockedSlot = mutation({
  args: {
    id: v.id("blockedSlots"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return null;
  },
  returns: v.null(),
});

// Internal mutation to delete all simulated blocked slots
export const deleteAllSimulatedBlockedSlots = internalMutation({
  args: {},
  handler: async (ctx) => {
    const simulatedBlockedSlots = await ctx.db
      .query("blockedSlots")
      .withIndex("by_isSimulation", (q) => q.eq("isSimulation", true))
      .collect();

    for (const blockedSlot of simulatedBlockedSlots) {
      await ctx.db.delete(blockedSlot._id);
    }

    return simulatedBlockedSlots.length;
  },
  returns: v.number(),
});

// Combined mutation to delete all simulated appointments and blocked slots
export const deleteAllSimulatedData = mutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    appointmentsDeleted: number;
    blockedSlotsDeleted: number;
    total: number;
  }> => {
    const appointmentsDeleted: number = await ctx.runMutation(
      internal.appointments.deleteAllSimulatedAppointments,
    );
    const blockedSlotsDeleted: number = await ctx.runMutation(
      internal.appointments.deleteAllSimulatedBlockedSlots,
    );

    return {
      appointmentsDeleted,
      blockedSlotsDeleted,
      total: appointmentsDeleted + blockedSlotsDeleted,
    };
  },
  returns: v.object({
    appointmentsDeleted: v.number(),
    blockedSlotsDeleted: v.number(),
    total: v.number(),
  }),
});
