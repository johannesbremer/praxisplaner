import { ConvexError, type Infer, v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import type { Doc, Id } from "./_generated/dataModel";
import type {
  DatabaseReader,
  MutationCtx,
  QueryCtx,
} from "./_generated/server";

import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import {
  type AppointmentBookingScope,
  findConflictingAppointment,
} from "./appointmentConflicts";
import {
  resolveAppointmentTypeIdForRuleSetByLineage,
  resolveLocationIdForRuleSetByLineage,
  resolvePractitionerIdForRuleSetByLineage,
  resolveStoredAppointmentReferencesForWrite,
} from "./appointmentReferences";
import {
  appointmentSeriesArgsValidator,
  appointmentSeriesCreateResultValidator,
  appointmentSeriesPreviewResultValidator,
  createAppointmentSeries as createAppointmentSeriesHelper,
  previewAppointmentSeries as previewAppointmentSeriesHelper,
  replanAppointmentSeries,
} from "./appointmentSeries";
import {
  type AppointmentSimulationKind,
  appointmentSimulationKindValidator,
  isActivationBoundSimulation,
} from "./appointmentSimulation";
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
type AppointmentListItem = AppointmentResult &
  Pick<
    AppointmentDoc,
    | "cancelledAt"
    | "isSimulation"
    | "replacesAppointmentId"
    | "simulationKind"
    | "simulationRuleSetId"
  >;
type AppointmentScope = "all" | "real" | "simulation";
type AppointmentSeriesDoc = Doc<"appointmentSeries">;

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
  reassignmentSourceVacationLineageKey: v.optional(v.id("vacations")),
  replacesAppointmentId: v.optional(v.id("appointments")),
  seriesId: v.optional(v.string()),
  seriesStepId: v.optional(v.string()),
  seriesStepIndex: v.optional(v.int64()),
  simulationKind: v.optional(appointmentSimulationKindValidator),
  simulationRuleSetId: v.optional(v.id("ruleSets")),
  simulationValidatedAt: v.optional(v.int64()),
  start: v.string(),
  title: v.string(),
  userId: v.optional(v.id("users")),
});

export type AppointmentResult = Infer<typeof appointmentResultValidator>;

function appointmentChainError(code: string, message: string) {
  return new ConvexError({ code, message });
}

function calculateDurationMinutes(end: string, start: string): number {
  const minutes =
    (Temporal.ZonedDateTime.from(end).epochMilliseconds -
      Temporal.ZonedDateTime.from(start).epochMilliseconds) /
    60_000;

  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw appointmentChainError(
      "CHAIN_REPLAN_FAILED",
      "Die Terminlänge muss eine positive ganze Zahl sein.",
    );
  }

  return minutes;
}

function calculateEndFromDuration(start: string, durationMinutes: number) {
  return Temporal.ZonedDateTime.from(start)
    .add({ minutes: durationMinutes })
    .toString();
}

function calculateShiftedEnd(end: string, start: string, nextStart: string) {
  const durationMinutes = calculateDurationMinutes(end, start);
  return Temporal.ZonedDateTime.from(nextStart)
    .add({ minutes: durationMinutes })
    .toString();
}

async function getAppointmentSeriesRecord(
  db: DatabaseReader,
  seriesId: string,
): Promise<AppointmentSeriesDoc | null> {
  return await db
    .query("appointmentSeries")
    .withIndex("by_seriesId", (q) => q.eq("seriesId", seriesId))
    .first();
}

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

function getSeriesStepKey(appointment: AppointmentDoc): string {
  if (appointment.seriesStepId) {
    return appointment.seriesStepId;
  }

  if (appointment.seriesStepIndex === 0n) {
    return "root";
  }

  return `index:${Number(appointment.seriesStepIndex ?? 0n)}`;
}

function isAppointmentCancelled(
  appointment: Pick<AppointmentDoc, "cancelledAt">,
): boolean {
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

function isVisibleAppointment(
  appointment: Pick<AppointmentDoc, "cancelledAt">,
): boolean {
  return !isAppointmentCancelled(appointment);
}

async function resolveAppointmentPatientDateOfBirth(
  db: DatabaseReader,
  args: {
    fallbackDateOfBirth?: string;
    patientId?: Id<"patients">;
  },
): Promise<string | undefined> {
  if (args.patientId) {
    const patient = await db.get("patients", args.patientId);
    return patient?.dateOfBirth;
  }

  return args.fallbackDateOfBirth;
}

async function resolveAppointmentTypeIdForDisplayRuleSet(
  db: DatabaseReader,
  appointmentTypeLineageKey: Id<"appointmentTypes">,
  targetRuleSetId: Id<"ruleSets">,
): Promise<Id<"appointmentTypes">> {
  return await resolveAppointmentTypeIdForRuleSetByLineage(db, {
    lineageKey: appointmentTypeLineageKey,
    ruleSetId: targetRuleSetId,
  });
}

async function resolveLocationIdForDisplayRuleSet(
  db: DatabaseReader,
  locationLineageKey: Id<"locations">,
  targetRuleSetId: Id<"ruleSets">,
): Promise<Id<"locations">> {
  return await resolveLocationIdForRuleSetByLineage(db, {
    lineageKey: locationLineageKey,
    ruleSetId: targetRuleSetId,
  });
}

async function resolvePractitionerIdForDisplayRuleSet(
  db: DatabaseReader,
  practitionerLineageKey: Id<"practitioners">,
  targetRuleSetId: Id<"ruleSets">,
): Promise<Id<"practitioners">> {
  return await resolvePractitionerIdForRuleSetByLineage(db, {
    lineageKey: practitionerLineageKey,
    ruleSetId: targetRuleSetId,
  });
}

/**
 * Resolves blocked-slot references into the displayed rule set via lineage.
 */
async function remapBlockedSlotIds(
  ctx: { db: DatabaseReader },
  blockedSlots: BlockedSlotDoc[],
  targetRuleSetId: Id<"ruleSets">,
): Promise<BlockedSlotDoc[]> {
  return await Promise.all(
    blockedSlots.map(async (slot) => {
      const remappedSlot: BlockedSlotDoc = {
        ...slot,
        locationId: await resolveLocationIdForDisplayRuleSet(
          ctx.db,
          slot.locationId,
          targetRuleSetId,
        ),
      };
      if (slot.practitionerId) {
        remappedSlot.practitionerId =
          await resolvePractitionerIdForDisplayRuleSet(
            ctx.db,
            slot.practitionerId,
            targetRuleSetId,
          );
      }
      return remappedSlot;
    }),
  );
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
  appointments: AppointmentListItem[],
): AppointmentListItem[] {
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

function filterAppointmentsForScope<T extends AppointmentDoc>(
  appointments: T[],
  args: {
    activeRuleSetId?: Id<"ruleSets">;
    selectedRuleSetId?: Id<"ruleSets">;
  },
  scope: AppointmentScope,
) {
  return appointments.filter((appointment) =>
    isAppointmentVisibleInScope(appointment, args, scope),
  );
}

function getDisplayRuleSetId(args: {
  activeRuleSetId?: Id<"ruleSets">;
  selectedRuleSetId?: Id<"ruleSets">;
}) {
  return args.selectedRuleSetId ?? args.activeRuleSetId;
}

function getSimulationScopeRuleSetId(args: {
  activeRuleSetId?: Id<"ruleSets">;
  selectedRuleSetId?: Id<"ruleSets">;
}) {
  return args.selectedRuleSetId ?? args.activeRuleSetId;
}

function isAppointmentVisibleInScope(
  appointment: Pick<AppointmentDoc, "isSimulation" | "simulationRuleSetId">,
  args: {
    activeRuleSetId?: Id<"ruleSets">;
    selectedRuleSetId?: Id<"ruleSets">;
  },
  scope: AppointmentScope,
) {
  if (scope === "real") {
    return appointment.isSimulation !== true;
  }

  return (
    appointment.isSimulation !== true ||
    appointment.simulationRuleSetId === undefined ||
    appointment.simulationRuleSetId === getSimulationScopeRuleSetId(args)
  );
}

async function remapAppointmentIds(
  ctx: { db: DatabaseReader },
  appointments: AppointmentDoc[],
  targetRuleSetId: Id<"ruleSets">,
): Promise<AppointmentListItem[]> {
  return await Promise.all(
    appointments.map(async (appointment) => {
      const remappedAppointment: AppointmentListItem = {
        ...toAppointmentListItem(appointment),
        appointmentTypeId: await resolveAppointmentTypeIdForDisplayRuleSet(
          ctx.db,
          appointment.appointmentTypeLineageKey,
          targetRuleSetId,
        ),
        locationId: await resolveLocationIdForDisplayRuleSet(
          ctx.db,
          appointment.locationLineageKey,
          targetRuleSetId,
        ),
      };
      if (appointment.practitionerLineageKey) {
        remappedAppointment.practitionerId =
          await resolvePractitionerIdForDisplayRuleSet(
            ctx.db,
            appointment.practitionerLineageKey,
            targetRuleSetId,
          );
      }
      return remappedAppointment;
    }),
  );
}

function toAppointmentListItem(
  appointment: AppointmentDoc,
): AppointmentListItem {
  return {
    _creationTime: appointment._creationTime,
    _id: appointment._id,
    appointmentTypeId: appointment.appointmentTypeLineageKey,
    appointmentTypeTitle: appointment.appointmentTypeTitle,
    createdAt: appointment.createdAt,
    end: appointment.end,
    lastModified: appointment.lastModified,
    locationId: appointment.locationLineageKey,
    practiceId: appointment.practiceId,
    ...(appointment.cancelledAt === undefined
      ? {}
      : { cancelledAt: appointment.cancelledAt }),
    ...(appointment.isSimulation === undefined
      ? {}
      : { isSimulation: appointment.isSimulation }),
    ...(appointment.patientId === undefined
      ? {}
      : { patientId: appointment.patientId }),
    ...(appointment.practitionerLineageKey
      ? { practitionerId: appointment.practitionerLineageKey }
      : {}),
    ...(appointment.reassignmentSourceVacationLineageKey === undefined
      ? {}
      : {
          reassignmentSourceVacationLineageKey:
            appointment.reassignmentSourceVacationLineageKey,
        }),
    ...(appointment.replacesAppointmentId === undefined
      ? {}
      : { replacesAppointmentId: appointment.replacesAppointmentId }),
    ...(appointment.seriesId === undefined
      ? {}
      : { seriesId: appointment.seriesId }),
    ...(appointment.seriesStepId === undefined
      ? {}
      : { seriesStepId: appointment.seriesStepId }),
    ...(appointment.seriesStepIndex === undefined
      ? {}
      : { seriesStepIndex: appointment.seriesStepIndex }),
    ...(appointment.simulationKind === undefined
      ? {}
      : { simulationKind: appointment.simulationKind }),
    ...(appointment.simulationRuleSetId === undefined
      ? {}
      : { simulationRuleSetId: appointment.simulationRuleSetId }),
    ...(appointment.simulationValidatedAt === undefined
      ? {}
      : { simulationValidatedAt: appointment.simulationValidatedAt }),
    start: appointment.start,
    title: appointment.title,
    ...(appointment.userId === undefined ? {} : { userId: appointment.userId }),
  };
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
    const visibleAppointments = appointmentDocs.filter(
      (appointment) =>
        accessiblePracticeIds.has(appointment.practiceId) &&
        isVisibleAppointment(appointment),
    );
    const scopedAppointments = filterAppointmentsForScope(
      visibleAppointments,
      args,
      scope,
    );
    const displayRuleSetId = getDisplayRuleSetId(args);
    const appointments: AppointmentListItem[] = displayRuleSetId
      ? await remapAppointmentIds(ctx, scopedAppointments, displayRuleSetId)
      : scopedAppointments.map((appointment) =>
          toAppointmentListItem(appointment),
        );

    let resultAppointments: AppointmentListItem[];

    if (scope === "simulation") {
      resultAppointments = combineForSimulationScope(appointments);
    } else if (scope === "all") {
      resultAppointments = appointments.toSorted((a, b) =>
        a.start.localeCompare(b.start),
      );
    } else {
      resultAppointments = appointments.toSorted((a, b) =>
        a.start.localeCompare(b.start),
      );
    }

    return resultAppointments;
  },
  returns: v.array(appointmentResultValidator),
});

// Query to get appointments in a date range
export const getAppointmentsInRange = query({
  args: {
    activeRuleSetId: v.optional(v.id("ruleSets")),
    end: v.string(),
    scope: v.optional(
      v.union(v.literal("real"), v.literal("simulation"), v.literal("all")),
    ),
    selectedRuleSetId: v.optional(v.id("ruleSets")),
    start: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    const accessiblePracticeIds = new Set(
      await getAccessiblePracticeIdsForQuery(ctx),
    );
    // Use index range query instead of filter for better performance
    const appointmentDocs = await ctx.db
      .query("appointments")
      .withIndex("by_start", (q) => q.gte("start", args.start))
      .collect();

    // Filter in code for end date (more efficient than .filter())
    const filteredAppointments = appointmentDocs.filter(
      (appointment) =>
        appointment.start <= args.end &&
        accessiblePracticeIds.has(appointment.practiceId) &&
        isVisibleAppointment(appointment),
    );
    const scope: AppointmentScope = args.scope ?? "real";
    const scopedAppointments = filterAppointmentsForScope(
      filteredAppointments,
      args,
      scope,
    );

    const displayRuleSetId = getDisplayRuleSetId(args);
    const appointments: AppointmentListItem[] = displayRuleSetId
      ? await remapAppointmentIds(ctx, scopedAppointments, displayRuleSetId)
      : scopedAppointments.map((appointment) =>
          toAppointmentListItem(appointment),
        );

    if (scope === "simulation") {
      return combineForSimulationScope(appointments);
    }

    if (scope === "all") {
      return appointments.toSorted((a, b) => a.start.localeCompare(b.start));
    }

    return appointments.toSorted((a, b) => a.start.localeCompare(b.start));
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

export async function createAppointmentFromTrustedSource(
  ctx: MutationCtx,
  args: {
    appointmentTypeId: Id<"appointmentTypes">;
    isNewPatient?: boolean;
    isSimulation?: boolean;
    locationId: Id<"locations">;
    patientDateOfBirth?: string;
    patientId?: Id<"patients">;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    replacesAppointmentId?: Id<"appointments">;
    simulationKind?: AppointmentSimulationKind;
    simulationRuleSetId?: Id<"ruleSets">;
    start: string;
    title: string;
    userId?: Id<"users">;
  },
) {
  const now = BigInt(Date.now());
  const {
    appointmentTypeId,
    isNewPatient,
    isSimulation,
    locationId,
    patientDateOfBirth,
    patientId,
    practiceId,
    practitionerId,
    replacesAppointmentId,
    simulationKind,
    simulationRuleSetId,
    userId,
    ...rest
  } = args;

  if (replacesAppointmentId && isSimulation !== true) {
    throw new Error(
      "Only simulated appointments can replace existing appointments.",
    );
  }

  // For non-simulation appointments, require at least one identifier to tie the booking to a user or patient
  if (!isSimulation && !patientId && !userId) {
    throw new Error("Either patientId or userId must be provided.");
  }

  if (simulationKind && isSimulation !== true) {
    throw new Error(
      "simulationKind can only be used with simulated appointments.",
    );
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
    appointmentTypeId,
  );
  if (!appointmentType) {
    throw new Error(`Appointment type with ID ${appointmentTypeId} not found`);
  }

  const resolvedSimulationRuleSetId =
    isSimulation === true
      ? (simulationRuleSetId ?? appointmentType.ruleSetId)
      : undefined;

  const storedReferences = await resolveStoredAppointmentReferencesForWrite(
    ctx.db,
    {
      appointmentTypeId,
      locationId,
      ...(practitionerId ? { practitionerId } : {}),
    },
  );

  if (appointmentType.followUpPlan && appointmentType.followUpPlan.length > 0) {
    if (!practitionerId) {
      throw new Error(
        "Kettentermine benötigen einen ausgewählten Behandler für den Starttermin.",
      );
    }

    const result = await createAppointmentSeriesHelper(ctx, {
      locationId,
      ...(isNewPatient !== undefined && { isNewPatient }),
      ...(patientDateOfBirth && { patientDateOfBirth }),
      ...(patientId && { patientId }),
      practiceId,
      practitionerId,
      rootAppointmentTypeId: appointmentTypeId,
      ...(replacesAppointmentId && {
        rootReplacesAppointmentId: replacesAppointmentId,
      }),
      rootTitle: args.title.trim(),
      ruleSetId: appointmentType.ruleSetId,
      scope: getAppointmentBookingScope(isSimulation),
      ...(resolvedSimulationRuleSetId && {
        simulationRuleSetId: resolvedSimulationRuleSetId,
      }),
      start: args.start,
      ...(userId && { userId }),
    });

    return result.rootAppointmentId;
  }

  const end = calculateEndFromDuration(args.start, appointmentType.duration);

  const conflictingAppointment = await findConflictingAppointment(ctx.db, {
    candidate: {
      end,
      locationLineageKey: storedReferences.locationLineageKey,
      ...(storedReferences.practitionerLineageKey && {
        practitionerLineageKey: storedReferences.practitionerLineageKey,
      }),
      start: args.start,
    },
    practiceId,
    ...(resolvedSimulationRuleSetId
      ? { simulationRuleSetId: resolvedSimulationRuleSetId }
      : {}),
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
    ...storedReferences,
    appointmentTypeTitle: appointmentType.name,
    createdAt: now,
    end,
    isSimulation: isSimulation ?? false,
    lastModified: now,
    practiceId,
    ...(patientId && { patientId }),
    ...(userId && { userId }),
    ...(replacesAppointmentId !== undefined && {
      replacesAppointmentId,
    }),
    ...(isSimulation === true && {
      simulationKind: simulationKind ?? "draft",
      ...(resolvedSimulationRuleSetId && {
        simulationRuleSetId: resolvedSimulationRuleSetId,
      }),
      simulationValidatedAt: now,
    }),
  };
  return await ctx.db.insert("appointments", insertData);
}

// Mutation to create a new appointment
export const createAppointment = mutation({
  args: {
    appointmentTypeId: v.id("appointmentTypes"),
    isNewPatient: v.optional(v.boolean()),
    isSimulation: v.optional(v.boolean()),
    locationId: v.id("locations"),
    patientDateOfBirth: v.optional(v.string()),
    patientId: v.optional(v.id("patients")),
    practiceId: v.id("practices"),
    practitionerId: v.optional(v.id("practitioners")),
    replacesAppointmentId: v.optional(v.id("appointments")),
    simulationKind: v.optional(appointmentSimulationKindValidator),
    simulationRuleSetId: v.optional(v.id("ruleSets")),
    start: v.string(),
    title: v.string(),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    return await createAppointmentFromTrustedSource(ctx, args);
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
    simulationKind: v.optional(appointmentSimulationKindValidator),
    simulationRuleSetId: v.optional(v.id("ruleSets")),
    start: v.optional(v.string()),
    title: v.optional(v.string()),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    const { id, ...updateData } = args;
    const existingAppointment = await ctx.db.get("appointments", id);
    if (!existingAppointment) {
      throw appointmentChainError("CHAIN_NOT_FOUND", "Appointment not found");
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

    const appointmentTypeRecord =
      filteredUpdateData.appointmentTypeId === undefined
        ? undefined
        : await ctx.db.get(
            "appointmentTypes",
            filteredUpdateData.appointmentTypeId,
          );
    const locationRecord =
      filteredUpdateData.locationId === undefined
        ? undefined
        : await ctx.db.get("locations", filteredUpdateData.locationId);
    const practitionerRecord =
      filteredUpdateData.practitionerId === undefined
        ? undefined
        : await ctx.db.get("practitioners", filteredUpdateData.practitionerId);

    const editingRuleSetId =
      appointmentTypeRecord?.ruleSetId ??
      practitionerRecord?.ruleSetId ??
      locationRecord?.ruleSetId;

    const resolvedStoredReferences =
      filteredUpdateData.appointmentTypeId !== undefined ||
      filteredUpdateData.locationId !== undefined ||
      filteredUpdateData.practitionerId !== undefined
        ? await (async () => {
            if (!editingRuleSetId) {
              throw new Error(
                "Das Regelset fuer die Terminbearbeitung konnte nicht bestimmt werden.",
              );
            }
            const appointmentTypeIdForWrite =
              filteredUpdateData.appointmentTypeId ??
              (await resolveAppointmentTypeIdForRuleSetByLineage(ctx.db, {
                lineageKey: existingAppointment.appointmentTypeLineageKey,
                ruleSetId: editingRuleSetId,
              }));
            const locationIdForWrite =
              filteredUpdateData.locationId ??
              (await resolveLocationIdForRuleSetByLineage(ctx.db, {
                lineageKey: existingAppointment.locationLineageKey,
                ruleSetId: editingRuleSetId,
              }));
            const practitionerIdForWrite =
              filteredUpdateData.practitionerId ??
              (existingAppointment.practitionerLineageKey
                ? await resolvePractitionerIdForRuleSetByLineage(ctx.db, {
                    lineageKey: existingAppointment.practitionerLineageKey,
                    ruleSetId: editingRuleSetId,
                  })
                : undefined);

            return resolveStoredAppointmentReferencesForWrite(ctx.db, {
              appointmentTypeId: appointmentTypeIdForWrite,
              locationId: locationIdForWrite,
              ...(practitionerIdForWrite
                ? { practitionerId: practitionerIdForWrite }
                : {}),
            });
          })()
        : {
            appointmentTypeLineageKey:
              existingAppointment.appointmentTypeLineageKey,
            locationLineageKey: existingAppointment.locationLineageKey,
            ...(existingAppointment.practitionerLineageKey
              ? {
                  practitionerLineageKey:
                    existingAppointment.practitionerLineageKey,
                }
              : {}),
          };
    const resolvedAppointmentTypeId =
      resolvedStoredReferences.appointmentTypeLineageKey;
    const resolvedLocationId = resolvedStoredReferences.locationLineageKey;
    const resolvedPractitionerId =
      resolvedStoredReferences.practitionerLineageKey;
    const resolvedStart = filteredUpdateData.start ?? existingAppointment.start;
    const resolvedEnd = filteredUpdateData.end ?? existingAppointment.end;
    const resolvedIsSimulation =
      filteredUpdateData.isSimulation ?? existingAppointment.isSimulation;
    const resolvedSimulationRuleSetId =
      filteredUpdateData.simulationRuleSetId ??
      existingAppointment.simulationRuleSetId;
    const shouldDowngradeActivationBinding =
      resolvedIsSimulation === true &&
      filteredUpdateData.simulationKind === undefined &&
      isActivationBoundSimulation(existingAppointment);
    const resolvedSimulationKind =
      resolvedIsSimulation === true
        ? shouldDowngradeActivationBinding
          ? "draft"
          : (filteredUpdateData.simulationKind ??
            existingAppointment.simulationKind ??
            "draft")
        : undefined;

    if (
      filteredUpdateData.appointmentTypeId !== undefined ||
      filteredUpdateData.practitionerId !== undefined
    ) {
      const appointmentTypeRuleSetId =
        appointmentTypeRecord?.ruleSetId ?? practitionerRecord?.ruleSetId;

      if (!appointmentTypeRuleSetId) {
        throw new Error("Die Terminart konnte nicht validiert werden.");
      }

      const appointmentTypeIdForValidation =
        filteredUpdateData.appointmentTypeId ??
        (await resolveAppointmentTypeIdForRuleSetByLineage(ctx.db, {
          lineageKey: existingAppointment.appointmentTypeLineageKey,
          ruleSetId: appointmentTypeRuleSetId,
        }));
      const appointmentType = await ctx.db.get(
        "appointmentTypes",
        appointmentTypeIdForValidation,
      );
      if (!appointmentType) {
        throw new Error(
          `Appointment type with ID ${appointmentTypeIdForValidation} not found`,
        );
      }

      const practitionerIdForValidation =
        filteredUpdateData.practitionerId ??
        (existingAppointment.practitionerLineageKey
          ? await resolvePractitionerIdForRuleSetByLineage(ctx.db, {
              lineageKey: existingAppointment.practitionerLineageKey,
              ruleSetId: appointmentType.ruleSetId,
            })
          : undefined);

      if (
        practitionerIdForValidation &&
        !appointmentType.allowedPractitionerIds.includes(
          practitionerIdForValidation,
        )
      ) {
        throw new Error(
          "Der gewählte Behandler ist für diese Terminart nicht freigegeben.",
        );
      }
    }

    const hasSchedulingChange =
      resolvedLocationId !== existingAppointment.locationLineageKey ||
      resolvedPractitionerId !== existingAppointment.practitionerLineageKey ||
      resolvedStart !== existingAppointment.start ||
      resolvedEnd !== existingAppointment.end ||
      resolvedIsSimulation !== existingAppointment.isSimulation;

    if (hasSchedulingChange) {
      const conflictingAppointment = await findConflictingAppointment(ctx.db, {
        candidate: {
          end: resolvedEnd,
          locationLineageKey: resolvedLocationId,
          ...(resolvedPractitionerId
            ? { practitionerLineageKey: resolvedPractitionerId }
            : {}),
          start: resolvedStart,
        },
        excludeAppointmentIds: [existingAppointment._id],
        practiceId: existingAppointment.practiceId,
        ...(resolvedIsSimulation === true && resolvedSimulationRuleSetId
          ? { simulationRuleSetId: resolvedSimulationRuleSetId }
          : {}),
        scope: getAppointmentBookingScope(resolvedIsSimulation),
      });

      if (conflictingAppointment) {
        throw new Error("Der gewaehlte Zeitraum ist bereits belegt.");
      }
    }

    if (existingAppointment.seriesId !== undefined) {
      const seriesId = existingAppointment.seriesId;
      if (!seriesId) {
        throw appointmentChainError(
          "CHAIN_NOT_FOUND",
          "Appointment series metadata is incomplete.",
        );
      }

      if (existingAppointment.seriesStepIndex !== 0n) {
        throw appointmentChainError(
          "CHAIN_NON_ROOT_UPDATE_FORBIDDEN",
          "Folgetermine können nicht einzeln bearbeitet werden. Bitte den Starttermin bearbeiten.",
        );
      }

      if (filteredUpdateData.appointmentTypeId !== undefined) {
        const nextSeriesStoredReferences =
          await resolveStoredAppointmentReferencesForWrite(ctx.db, {
            appointmentTypeId: filteredUpdateData.appointmentTypeId,
            locationId:
              filteredUpdateData.locationId ??
              existingAppointment.locationLineageKey,
            ...(filteredUpdateData.practitionerId
              ? { practitionerId: filteredUpdateData.practitionerId }
              : {}),
          });
        if (
          nextSeriesStoredReferences.appointmentTypeLineageKey !==
          existingAppointment.appointmentTypeLineageKey
        ) {
          throw appointmentChainError(
            "CHAIN_REPLAN_FAILED",
            "Die Terminart eines Kettentermins kann nach der Buchung nicht geändert werden.",
          );
        }
      }

      const seriesRecord = await getAppointmentSeriesRecord(ctx.db, seriesId);
      if (!seriesRecord) {
        throw appointmentChainError(
          "CHAIN_NOT_FOUND",
          "Die gespeicherte Kettentermin-Serie wurde nicht gefunden.",
        );
      }

      const seriesAppointments = await getSeriesAppointments(ctx.db, seriesId);
      const seriesAppointmentIds = seriesAppointments.map(
        (appointment) => appointment._id,
      );
      const resolvedPatientId =
        filteredUpdateData.patientId ?? existingAppointment.patientId;
      const resolvedPatientDateOfBirth =
        await resolveAppointmentPatientDateOfBirth(ctx.db, {
          ...(filteredUpdateData.patientId === undefined &&
            seriesRecord.patientDateOfBirth && {
              fallbackDateOfBirth: seriesRecord.patientDateOfBirth,
            }),
          ...(resolvedPatientId && { patientId: resolvedPatientId }),
        });
      const updatedStart =
        filteredUpdateData.start ?? existingAppointment.start;
      const updatedEnd =
        filteredUpdateData.end ??
        (filteredUpdateData.start === undefined
          ? existingAppointment.end
          : calculateShiftedEnd(
              existingAppointment.end,
              existingAppointment.start,
              filteredUpdateData.start,
            ));
      const practitionerId =
        filteredUpdateData.practitionerId ??
        (existingAppointment.practitionerLineageKey
          ? await resolvePractitionerIdForRuleSetByLineage(ctx.db, {
              lineageKey: existingAppointment.practitionerLineageKey,
              ruleSetId: seriesRecord.ruleSetIdAtBooking,
            })
          : undefined);

      if (!practitionerId) {
        throw appointmentChainError(
          "CHAIN_REPLAN_FAILED",
          "Kettentermine benötigen einen Behandler auf dem Starttermin.",
        );
      }

      const plannedSteps = await replanAppointmentSeries(ctx, {
        excludedAppointmentIds: seriesAppointmentIds,
        locationId:
          filteredUpdateData.locationId ??
          (await resolveLocationIdForRuleSetByLineage(ctx.db, {
            lineageKey: existingAppointment.locationLineageKey,
            ruleSetId: seriesRecord.ruleSetIdAtBooking,
          })),
        ...(resolvedPatientDateOfBirth && {
          patientDateOfBirth: resolvedPatientDateOfBirth,
        }),
        ...(resolvedPatientId && { patientId: resolvedPatientId }),
        practiceId: existingAppointment.practiceId,
        practitionerId,
        rootDurationMinutes: calculateDurationMinutes(updatedEnd, updatedStart),
        scope: getAppointmentBookingScope(existingAppointment.isSimulation),
        series: seriesRecord,
        start: updatedStart,
        ...((filteredUpdateData.userId ?? existingAppointment.userId)
          ? { userId: filteredUpdateData.userId ?? existingAppointment.userId }
          : {}),
      });

      const now = BigInt(Date.now());
      const resolvedUserId =
        filteredUpdateData.userId ?? existingAppointment.userId;
      const existingByStepKey = new Map(
        seriesAppointments.map((appointment) => [
          getSeriesStepKey(appointment),
          appointment,
        ]),
      );
      const touchedAppointmentIds = new Set<Id<"appointments">>();

      for (const step of plannedSteps) {
        const matchingAppointment = existingByStepKey.get(step.stepId);
        const title =
          step.seriesStepIndex === 0
            ? (filteredUpdateData.title?.trim() ?? existingAppointment.title)
            : `Folgetermin: ${step.appointmentTypeTitle}`;

        if (matchingAppointment) {
          const stepStoredReferences =
            await resolveStoredAppointmentReferencesForWrite(ctx.db, {
              appointmentTypeId: step.appointmentTypeId,
              locationId: step.locationId,
              practitionerId: step.practitionerId,
            });
          await ctx.db.patch("appointments", matchingAppointment._id, {
            ...stepStoredReferences,
            appointmentTypeTitle: step.appointmentTypeTitle,
            end: step.end,
            lastModified: now,
            ...(resolvedPatientId && { patientId: resolvedPatientId }),
            seriesId,
            seriesStepId: step.stepId,
            seriesStepIndex: BigInt(step.seriesStepIndex),
            start: step.start,
            title,
            ...(resolvedUserId && { userId: resolvedUserId }),
          });
          touchedAppointmentIds.add(matchingAppointment._id);
          continue;
        }

        const stepStoredReferences =
          await resolveStoredAppointmentReferencesForWrite(ctx.db, {
            appointmentTypeId: step.appointmentTypeId,
            locationId: step.locationId,
            practitionerId: step.practitionerId,
          });
        const insertedAppointmentId = await ctx.db.insert("appointments", {
          ...stepStoredReferences,
          appointmentTypeTitle: step.appointmentTypeTitle,
          createdAt: now,
          end: step.end,
          ...(existingAppointment.isSimulation === true && {
            isSimulation: true,
          }),
          lastModified: now,
          ...(resolvedPatientId && { patientId: resolvedPatientId }),
          practiceId: existingAppointment.practiceId,
          seriesId,
          seriesStepId: step.stepId,
          seriesStepIndex: BigInt(step.seriesStepIndex),
          start: step.start,
          title,
          ...(resolvedUserId && { userId: resolvedUserId }),
        });
        touchedAppointmentIds.add(insertedAppointmentId);
      }

      for (const seriesAppointment of seriesAppointments) {
        if (!touchedAppointmentIds.has(seriesAppointment._id)) {
          await ctx.db.delete("appointments", seriesAppointment._id);
        }
      }

      await ctx.db.replace("appointmentSeries", seriesRecord._id, {
        createdAt: seriesRecord.createdAt,
        followUpPlanSnapshot: seriesRecord.followUpPlanSnapshot,
        lastModified: now,
        ...(resolvedPatientDateOfBirth && {
          patientDateOfBirth: resolvedPatientDateOfBirth,
        }),
        ...(resolvedPatientId && { patientId: resolvedPatientId }),
        practiceId: seriesRecord.practiceId,
        rootAppointmentId: id,
        rootAppointmentTypeId: seriesRecord.rootAppointmentTypeId,
        rootAppointmentTypeLineageKey:
          seriesRecord.rootAppointmentTypeLineageKey,
        rootDurationMinutes: calculateDurationMinutes(updatedEnd, updatedStart),
        ruleSetIdAtBooking: seriesRecord.ruleSetIdAtBooking,
        scope: seriesRecord.scope,
        seriesId: seriesRecord.seriesId,
        ...(resolvedUserId && { userId: resolvedUserId }),
      });

      return null;
    }

    const persistedUpdateData = Object.fromEntries(
      Object.entries(filteredUpdateData).filter(
        ([key]) =>
          key !== "appointmentTypeId" &&
          key !== "locationId" &&
          key !== "practitionerId",
      ),
    ) as Omit<
      typeof filteredUpdateData,
      "appointmentTypeId" | "locationId" | "practitionerId"
    >;

    await ctx.db.patch("appointments", id, {
      ...persistedUpdateData,
      appointmentTypeLineageKey: resolvedAppointmentTypeId,
      locationLineageKey: resolvedLocationId,
      ...(resolvedPractitionerId
        ? { practitionerLineageKey: resolvedPractitionerId }
        : filteredUpdateData.practitionerId === undefined
          ? {}
          : { practitionerLineageKey: undefined }),
      ...(resolvedIsSimulation === true && resolvedSimulationKind
        ? { simulationKind: resolvedSimulationKind }
        : {}),
      ...(shouldDowngradeActivationBinding
        ? { reassignmentSourceVacationLineageKey: undefined }
        : {}),
      ...(resolvedIsSimulation === true
        ? { simulationValidatedAt: BigInt(Date.now()) }
        : {}),
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
      throw appointmentChainError("CHAIN_NOT_FOUND", "Appointment not found");
    }
    await ensurePracticeAccessForMutation(ctx, existingAppointment.practiceId);

    if (existingAppointment.seriesId !== undefined) {
      const seriesId = existingAppointment.seriesId;
      if (!seriesId) {
        throw appointmentChainError(
          "CHAIN_NOT_FOUND",
          "Appointment series metadata is incomplete.",
        );
      }
      const seriesAppointments = await getSeriesAppointments(ctx.db, seriesId);
      for (const seriesAppointment of seriesAppointments) {
        await ctx.db.delete("appointments", seriesAppointment._id);
      }
      const seriesRecord = await getAppointmentSeriesRecord(ctx.db, seriesId);
      if (seriesRecord) {
        await ctx.db.delete("appointmentSeries", seriesRecord._id);
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
      throw appointmentChainError("CHAIN_NOT_FOUND", "Appointment not found");
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
    if (appointment.seriesId !== undefined) {
      const seriesId = appointment.seriesId;
      if (!seriesId) {
        throw appointmentChainError(
          "CHAIN_NOT_FOUND",
          "Appointment series metadata is incomplete.",
        );
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
): Promise<AppointmentListItem[]> {
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

  const appointments: AppointmentListItem[] = [];
  for await (const appointment of appointmentQuery) {
    if (
      appointment.isSimulation !== true &&
      isVisibleAppointment(appointment) &&
      isAppointmentInFuture(appointment, nowEpochMilliseconds)
    ) {
      appointments.push(toAppointmentListItem(appointment));
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

    const appointments: AppointmentListItem[] = [];

    // Query by patient ID if provided
    if (args.patientId) {
      const patientAppointments = await ctx.db
        .query("appointments")
        .withIndex("by_patientId", (q) => q.eq("patientId", args.patientId))
        .collect();
      appointments.push(
        ...patientAppointments.map((appointment) =>
          toAppointmentListItem(appointment),
        ),
      );
    }

    if (args.userId) {
      const userAppointments = await ctx.db
        .query("appointments")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId))
        .collect();
      appointments.push(
        ...userAppointments.map((appointment) =>
          toAppointmentListItem(appointment),
        ),
      );
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
      if (isActivationBoundSimulation(appointment)) {
        continue;
      }
      await ctx.db.delete("appointments", appointment._id);
    }

    return simulatedAppointments.filter(
      (appointment) => !isActivationBoundSimulation(appointment),
    ).length;
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

    const displayRuleSetId = getDisplayRuleSetId(args);
    if (displayRuleSetId) {
      blockedSlots = await remapBlockedSlotIds(
        ctx,
        blockedSlots,
        displayRuleSetId,
      );
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
