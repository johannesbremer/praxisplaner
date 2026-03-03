import { v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, QueryCtx } from "./_generated/server";

import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import {
  type AppointmentBookingScope,
  findConflictingAppointment,
} from "./appointmentConflicts";
import {
  appointmentSeriesArgsValidator,
  appointmentSeriesCreateResultValidator,
  appointmentSeriesPreviewResultValidator,
  createAppointmentSeries as createAppointmentSeriesHelper,
  previewAppointmentSeries as previewAppointmentSeriesHelper,
} from "./appointmentSeries";
import { mapEntityIdsBetweenRuleSets } from "./copyOnWrite";
import {
  ensurePracticeAccessForMutation,
  ensurePracticeAccessForQuery,
  getAccessiblePracticeIdsForQuery,
} from "./practiceAccess";
import {
  ensureAuthenticatedIdentity,
  ensureAuthenticatedUserId,
  getAuthenticatedUserIdForQuery,
} from "./userIdentity";

type AppointmentDoc = Doc<"appointments">;
type AppointmentScope = "all" | "real" | "simulation";

type BlockedSlotDoc = Doc<"blockedSlots">;
const APPOINTMENT_TIMEZONE = "Europe/Berlin";
const appointmentResultValidator = v.object({
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
  seriesId: v.optional(v.string()),
  seriesStepIndex: v.optional(v.int64()),
  start: v.string(),
  title: v.string(),
  userId: v.optional(v.id("users")),
});

async function getSeriesAppointments(
  db: DatabaseReader,
  seriesId: string,
): Promise<AppointmentDoc[]> {
  const appointments = await db
    .query("appointments")
    .withIndex("by_seriesId", (q) => q.eq("seriesId", seriesId))
    .collect();

  return appointments.toSorted((left, right) => {
    const leftIndex = Number(left.seriesStepIndex ?? 0n);
    const rightIndex = Number(right.seriesStepIndex ?? 0n);
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return left.start.localeCompare(right.start);
  });
}

function getSeriesTimeDeltaMilliseconds(
  currentTime: string,
  nextTime: string,
): number {
  return (
    Temporal.ZonedDateTime.from(nextTime).epochMilliseconds -
    Temporal.ZonedDateTime.from(currentTime).epochMilliseconds
  );
}

function isAppointmentCancelled(appointment: AppointmentDoc): boolean {
  return appointment.cancelledAt !== undefined;
}

function isAppointmentInFuture(
  appointment: AppointmentDoc,
  nowEpochMilliseconds: number,
): boolean {
  try {
    return (
      Temporal.ZonedDateTime.from(appointment.start).epochMilliseconds >
      nowEpochMilliseconds
    );
  } catch {
    return false;
  }
}

function isVisibleAppointment(appointment: AppointmentDoc): boolean {
  return !isAppointmentCancelled(appointment);
}

function shiftAppointmentTime(time: string, deltaMilliseconds: number): string {
  if (deltaMilliseconds === 0) {
    return time;
  }

  return Temporal.ZonedDateTime.from(time)
    .add({ milliseconds: deltaMilliseconds })
    .toString();
}

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
    await ensureAuthenticatedIdentity(ctx);
    const accessiblePracticeIds = new Set(
      await getAccessiblePracticeIdsForQuery(ctx),
    );
    const scope: AppointmentScope = args.scope ?? "real";

    const appointmentDocs = await ctx.db
      .query("appointments")
      .order("asc")
      .collect();
    let appointments = appointmentDocs.filter(
      (appointment) =>
        accessiblePracticeIds.has(appointment.practiceId) &&
        isVisibleAppointment(appointment),
    );

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
  returns: v.array(appointmentResultValidator),
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
    await ensureAuthenticatedIdentity(ctx);
    const accessiblePracticeIds = new Set(
      await getAccessiblePracticeIdsForQuery(ctx),
    );
    // Use index range query instead of filter for better performance
    const appointments = await ctx.db
      .query("appointments")
      .withIndex("by_start", (q) => q.gte("start", args.start))
      .collect();

    // Filter in code for end date (more efficient than .filter())
    const filteredAppointments = appointments.filter(
      (appointment) =>
        appointment.start <= args.end &&
        accessiblePracticeIds.has(appointment.practiceId) &&
        isVisibleAppointment(appointment),
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
  returns: v.array(appointmentResultValidator),
});

export const previewAppointmentSeries = query({
  args: appointmentSeriesArgsValidator,
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    return await previewAppointmentSeriesHelper(ctx, args);
  },
  returns: appointmentSeriesPreviewResultValidator,
});

export const createAppointmentSeries = mutation({
  args: {
    ...appointmentSeriesArgsValidator,
    rootReplacesAppointmentId: v.optional(v.id("appointments")),
    rootTitle: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);

    if (!args.patientId && !args.userId) {
      throw new Error("Either patientId or userId must be provided.");
    }

    if (args.patientId) {
      const patient = await ctx.db.get("patients", args.patientId);
      if (!patient) {
        throw new Error(`Patient with ID ${args.patientId} not found`);
      }
    }

    if (args.userId) {
      const user = await ctx.db.get("users", args.userId);
      if (!user) {
        throw new Error(`User with ID ${args.userId} not found`);
      }
    }

    return await createAppointmentSeriesHelper(ctx, {
      ...args,
      rootTitle: args.rootTitle.trim(),
    });
  },
  returns: appointmentSeriesCreateResultValidator,
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
    title: v.string(),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const now = BigInt(Date.now());
    const { isSimulation, patientId, replacesAppointmentId, userId, ...rest } =
      args;

    if (replacesAppointmentId && isSimulation !== true) {
      throw new Error(
        "Only simulated appointments can replace existing appointments.",
      );
    }

    // For non-simulation appointments, require at least one identifier to tie the booking to a user or patient
    if (!isSimulation && !patientId && !userId) {
      throw new Error("Either patientId or userId must be provided.");
    }

    // If a patientId is provided, verify it exists
    if (patientId) {
      const patient = await ctx.db.get("patients", patientId);
      if (!patient) {
        throw new Error(`Patient with ID ${patientId} not found`);
      }
    }

    if (userId) {
      const user = await ctx.db.get("users", userId);
      if (!user) {
        throw new Error(`User with ID ${userId} not found`);
      }
    }

    // Look up the appointment type to get its name at booking time
    const appointmentType = await ctx.db.get(
      "appointmentTypes",
      args.appointmentTypeId,
    );
    if (!appointmentType) {
      throw new Error(
        `Appointment type with ID ${args.appointmentTypeId} not found`,
      );
    }

    if (
      appointmentType.followUpPlan &&
      appointmentType.followUpPlan.length > 0
    ) {
      if (!args.practitionerId) {
        throw new Error(
          "Kettentermine benötigen einen ausgewählten Behandler für den Starttermin.",
        );
      }

      const result = await createAppointmentSeriesHelper(ctx, {
        locationId: args.locationId,
        ...(patientId && { patientId }),
        practiceId: args.practiceId,
        practitionerId: args.practitionerId,
        rootAppointmentTypeId: args.appointmentTypeId,
        ...(replacesAppointmentId && {
          rootReplacesAppointmentId: replacesAppointmentId,
        }),
        rootTitle: args.title.trim(),
        ruleSetId: appointmentType.ruleSetId,
        scope: getAppointmentBookingScope(isSimulation),
        start: args.start,
        ...(userId && { userId }),
      });

      return result.rootAppointmentId;
    }

    const conflictingAppointment = await findConflictingAppointment(ctx.db, {
      candidate: {
        end: args.end,
        locationId: args.locationId,
        ...(args.practitionerId && { practitionerId: args.practitionerId }),
        start: args.start,
      },
      practiceId: args.practiceId,
      scope: getAppointmentBookingScope(isSimulation),
      ...(replacesAppointmentId && {
        excludeAppointmentIds: [replacesAppointmentId],
      }),
    });

    if (conflictingAppointment) {
      throw new Error("Der gewaehlte Zeitraum ist bereits belegt.");
    }

    const insertData = {
      ...rest,
      appointmentTypeTitle: appointmentType.name, // Store appointment type name at booking time
      createdAt: now,
      isSimulation: isSimulation ?? false,
      lastModified: now,
      ...(patientId && { patientId }),
      ...(userId && { userId }),
      ...(replacesAppointmentId !== undefined && {
        replacesAppointmentId,
      }),
    };
    return await ctx.db.insert("appointments", insertData);
  },
  returns: v.id("appointments"),
});

function getAppointmentBookingScope(
  isSimulation: boolean | undefined,
): AppointmentBookingScope {
  return isSimulation === true ? "simulation" : "real";
}

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
    title: v.optional(v.string()),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    const { id, ...updateData } = args;
    const existingAppointment = await ctx.db.get("appointments", id);
    if (!existingAppointment) {
      throw new Error("Appointment not found");
    }
    await ensurePracticeAccessForMutation(ctx, existingAppointment.practiceId);

    // Filter out undefined values

    const filteredUpdateData = Object.fromEntries(
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      Object.entries(updateData).filter(([, value]) => value !== undefined),
    ) as Partial<typeof updateData>;

    const { patientId, userId } = filteredUpdateData;

    if (patientId) {
      const patient = await ctx.db.get("patients", patientId);
      if (!patient) {
        throw new Error(`Patient with ID ${patientId} not found`);
      }
    }

    if (userId) {
      const user = await ctx.db.get("users", userId);
      if (!user) {
        throw new Error(`User with ID ${userId} not found`);
      }
    }

    const isRootSeriesAppointment =
      existingAppointment.seriesId !== undefined &&
      existingAppointment.seriesStepIndex === 0n;

    if (isRootSeriesAppointment) {
      const seriesId = existingAppointment.seriesId;
      if (!seriesId) {
        throw new Error("Appointment series metadata is incomplete.");
      }
      const seriesAppointments = await getSeriesAppointments(ctx.db, seriesId);
      const seriesAppointmentIds = seriesAppointments.map(
        (appointment) => appointment._id,
      );
      const startDeltaMilliseconds =
        filteredUpdateData.start === undefined
          ? 0
          : getSeriesTimeDeltaMilliseconds(
              existingAppointment.start,
              filteredUpdateData.start,
            );
      const endDeltaMilliseconds =
        filteredUpdateData.end === undefined
          ? filteredUpdateData.start === undefined
            ? 0
            : startDeltaMilliseconds
          : getSeriesTimeDeltaMilliseconds(
              existingAppointment.end,
              filteredUpdateData.end,
            );
      for (const seriesAppointment of seriesAppointments) {
        const candidateStart =
          seriesAppointment._id === id && filteredUpdateData.start !== undefined
            ? filteredUpdateData.start
            : shiftAppointmentTime(
                seriesAppointment.start,
                startDeltaMilliseconds,
              );
        const candidateEnd =
          seriesAppointment._id === id && filteredUpdateData.end !== undefined
            ? filteredUpdateData.end
            : shiftAppointmentTime(seriesAppointment.end, endDeltaMilliseconds);
        const candidatePractitionerId =
          filteredUpdateData.practitionerId ?? seriesAppointment.practitionerId;
        const candidateLocationId =
          filteredUpdateData.locationId ?? seriesAppointment.locationId;
        const conflictingAppointment = await findConflictingAppointment(
          ctx.db,
          {
            candidate: {
              end: candidateEnd,
              locationId: candidateLocationId,
              ...(candidatePractitionerId && {
                practitionerId: candidatePractitionerId,
              }),
              start: candidateStart,
            },
            excludeAppointmentIds: seriesAppointmentIds,
            practiceId: existingAppointment.practiceId,
            scope: getAppointmentBookingScope(existingAppointment.isSimulation),
          },
        );

        if (conflictingAppointment) {
          throw new Error("Der gewaehlte Zeitraum ist bereits belegt.");
        }
      }

      for (const seriesAppointment of seriesAppointments) {
        const patchData: Record<string, unknown> = {
          end:
            seriesAppointment._id === id && filteredUpdateData.end !== undefined
              ? filteredUpdateData.end
              : shiftAppointmentTime(
                  seriesAppointment.end,
                  endDeltaMilliseconds,
                ),
          lastModified: BigInt(Date.now()),
          locationId:
            filteredUpdateData.locationId ?? seriesAppointment.locationId,
          ...(filteredUpdateData.patientId && {
            patientId: filteredUpdateData.patientId,
          }),
          ...(filteredUpdateData.practitionerId && {
            practitionerId: filteredUpdateData.practitionerId,
          }),
          start:
            seriesAppointment._id === id &&
            filteredUpdateData.start !== undefined
              ? filteredUpdateData.start
              : shiftAppointmentTime(
                  seriesAppointment.start,
                  startDeltaMilliseconds,
                ),
          ...(filteredUpdateData.userId && {
            userId: filteredUpdateData.userId,
          }),
        };

        if (seriesAppointment._id === id) {
          Object.assign(patchData, filteredUpdateData);
        }

        await ctx.db.patch("appointments", seriesAppointment._id, patchData);
      }

      return null;
    }

    await ctx.db.patch("appointments", id, {
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
    await ensureAuthenticatedIdentity(ctx);
    const existingAppointment = await ctx.db.get("appointments", args.id);
    if (!existingAppointment) {
      throw new Error("Appointment not found");
    }
    await ensurePracticeAccessForMutation(ctx, existingAppointment.practiceId);

    if (
      existingAppointment.seriesId !== undefined &&
      existingAppointment.seriesStepIndex === 0n
    ) {
      const seriesId = existingAppointment.seriesId;
      if (!seriesId) {
        throw new Error("Appointment series metadata is incomplete.");
      }
      const seriesAppointments = await getSeriesAppointments(ctx.db, seriesId);
      for (const seriesAppointment of seriesAppointments) {
        await ctx.db.delete("appointments", seriesAppointment._id);
      }
      return null;
    }

    await ctx.db.delete("appointments", args.id);
    return null;
  },
  returns: v.null(),
});

// Mutation for user self-service cancellation (soft-delete)
export const cancelOwnAppointment = mutation({
  args: {
    appointmentId: v.id("appointments"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureAuthenticatedUserId(ctx);
    const appointment = await ctx.db.get("appointments", args.appointmentId);

    if (!appointment) {
      throw new Error("Appointment not found");
    }

    if (appointment.userId !== userId) {
      throw new Error("Access denied");
    }

    if (appointment.isSimulation === true) {
      throw new Error("Simulation appointments cannot be cancelled");
    }

    if (isAppointmentCancelled(appointment)) {
      return null;
    }

    const nowEpochMilliseconds = Temporal.Now.instant().epochMilliseconds;
    if (!isAppointmentInFuture(appointment, nowEpochMilliseconds)) {
      throw new Error("Only future appointments can be cancelled");
    }

    const now = BigInt(nowEpochMilliseconds);
    const isRootSeriesAppointment =
      appointment.seriesId !== undefined && appointment.seriesStepIndex === 0n;

    if (isRootSeriesAppointment) {
      const seriesId = appointment.seriesId;
      if (!seriesId) {
        throw new Error("Appointment series metadata is incomplete.");
      }
      const seriesAppointments = await getSeriesAppointments(ctx.db, seriesId);
      for (const seriesAppointment of seriesAppointments) {
        if (
          seriesAppointment.userId !== userId ||
          seriesAppointment.isSimulation === true ||
          isAppointmentCancelled(seriesAppointment) ||
          !isAppointmentInFuture(seriesAppointment, nowEpochMilliseconds)
        ) {
          continue;
        }

        await ctx.db.patch("appointments", seriesAppointment._id, {
          cancelledAt: now,
          cancelledByUserId: userId,
          lastModified: now,
        });
      }
      return null;
    }

    await ctx.db.patch("appointments", args.appointmentId, {
      cancelledAt: now,
      cancelledByUserId: userId,
      lastModified: now,
    });

    return null;
  },
  returns: v.null(),
});

// Query to get the authenticated user's future booked appointments (future only)
export const getBookedAppointmentsForCurrentUser = query({
  args: {
    refreshNonce: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await getBookedAppointmentsForUser(ctx, args);
  },
  returns: v.array(appointmentResultValidator),
});

// Query to get the authenticated user's next booked appointment (future only)
export const getBookedAppointmentForCurrentUser = query({
  args: {
    refreshNonce: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const appointments = await getBookedAppointmentsForUser(ctx, args);
    return appointments[0] ?? null;
  },
  returns: v.union(appointmentResultValidator, v.null()),
});

async function getBookedAppointmentsForUser(
  ctx: QueryCtx,
  args: { refreshNonce?: number },
): Promise<AppointmentDoc[]> {
  const userId = await getAuthenticatedUserIdForQuery(ctx);
  if (!userId) {
    return [];
  }

  void args.refreshNonce;

  const nowInstant = Temporal.Now.instant();
  const nowEpochMilliseconds = nowInstant.epochMilliseconds;
  const nowStartLowerBound = nowInstant
    .toZonedDateTimeISO(APPOINTMENT_TIMEZONE)
    .toString();
  const appointmentQuery = ctx.db
    .query("appointments")
    .withIndex("by_userId_start", (q) =>
      q.eq("userId", userId).gte("start", nowStartLowerBound),
    );

  const appointments: AppointmentDoc[] = [];
  for await (const appointment of appointmentQuery) {
    if (
      appointment.isSimulation !== true &&
      isVisibleAppointment(appointment) &&
      isAppointmentInFuture(appointment, nowEpochMilliseconds)
    ) {
      appointments.push(appointment);
    }
  }

  return appointments;
}

// Query to get all appointments for a patient (past, present, and future)
export const getAppointmentsForPatient = query({
  args: {
    patientId: v.optional(v.id("patients")),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    const accessiblePracticeIds = new Set(
      await getAccessiblePracticeIdsForQuery(ctx),
    );
    // Need at least one patient ID
    if (!args.patientId && !args.userId) {
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

    if (args.userId) {
      const userAppointments = await ctx.db
        .query("appointments")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId))
        .collect();
      appointments.push(...userAppointments);
    }

    // Dedupe in case both queries return the same appointment, then sort by start time (ascending)
    const uniqueAppointments = [
      ...new Map(appointments.map((appt) => [appt._id, appt])).values(),
    ].filter((appointment) =>
      accessiblePracticeIds.has(appointment.practiceId),
    );

    return uniqueAppointments
      .filter((appointment) => isVisibleAppointment(appointment))
      .toSorted((a, b) => a.start.localeCompare(b.start));
  },
  returns: v.array(appointmentResultValidator),
});

// Internal mutation to delete all simulated appointments
export const deleteAllSimulatedAppointments = internalMutation({
  args: { practiceId: v.id("practices") },
  handler: async (ctx, args) => {
    const practiceAppointments = await ctx.db
      .query("appointments")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    const simulatedAppointments = practiceAppointments.filter(
      (appointment) => appointment.isSimulation === true,
    );

    for (const appointment of simulatedAppointments) {
      await ctx.db.delete("appointments", appointment._id);
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
    await ensureAuthenticatedIdentity(ctx);
    const accessiblePracticeIds = new Set(
      await getAccessiblePracticeIdsForQuery(ctx),
    );
    const scope: AppointmentScope = args.scope ?? "real";

    let blockedSlots = await ctx.db
      .query("blockedSlots")
      .order("asc")
      .collect();
    blockedSlots = blockedSlots.filter((blockedSlot) =>
      accessiblePracticeIds.has(blockedSlot.practiceId),
    );

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
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
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
    await ensureAuthenticatedIdentity(ctx);
    const { id, ...updates } = args;
    const existingBlockedSlot = await ctx.db.get("blockedSlots", id);
    if (!existingBlockedSlot) {
      throw new Error("Blocked slot not found");
    }
    await ensurePracticeAccessForMutation(ctx, existingBlockedSlot.practiceId);

    await ctx.db.patch("blockedSlots", id, {
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
    await ensureAuthenticatedIdentity(ctx);
    const existingBlockedSlot = await ctx.db.get("blockedSlots", args.id);
    if (!existingBlockedSlot) {
      throw new Error("Blocked slot not found");
    }
    await ensurePracticeAccessForMutation(ctx, existingBlockedSlot.practiceId);
    await ctx.db.delete("blockedSlots", args.id);
    return null;
  },
  returns: v.null(),
});

// Internal mutation to delete all simulated blocked slots
export const deleteAllSimulatedBlockedSlots = internalMutation({
  args: { practiceId: v.id("practices") },
  handler: async (ctx, args) => {
    const practiceBlockedSlots = await ctx.db
      .query("blockedSlots")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    const simulatedBlockedSlots = practiceBlockedSlots.filter(
      (blockedSlot) => blockedSlot.isSimulation === true,
    );

    for (const blockedSlot of simulatedBlockedSlots) {
      await ctx.db.delete("blockedSlots", blockedSlot._id);
    }

    return simulatedBlockedSlots.length;
  },
  returns: v.number(),
});

// Combined mutation to delete all simulated appointments and blocked slots
export const deleteAllSimulatedData = mutation({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    appointmentsDeleted: number;
    blockedSlotsDeleted: number;
    total: number;
  }> => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const appointmentsDeleted: number = await ctx.runMutation(
      internal.appointments.deleteAllSimulatedAppointments,
      { practiceId: args.practiceId },
    );
    const blockedSlotsDeleted: number = await ctx.runMutation(
      internal.appointments.deleteAllSimulatedBlockedSlots,
      { practiceId: args.practiceId },
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
