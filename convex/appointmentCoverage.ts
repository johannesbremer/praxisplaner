import { type Infer, v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, QueryCtx } from "./_generated/server";

import { getPractitionerVacationRangesForDate } from "../lib/vacation-utils";
import { internal } from "./_generated/api";
import { query } from "./_generated/server";
import { getEffectiveAppointmentsForScope } from "./appointmentConflicts";
import { resolvePractitionerLineageKey } from "./appointmentReferences";
import { ensurePracticeAccessForQuery } from "./practiceAccess";
import { ensureAuthenticatedIdentity } from "./userIdentity";

const vacationPortionValidator = v.union(
  v.literal("full"),
  v.literal("morning"),
  v.literal("afternoon"),
);

const coverageSuggestionValidator = v.object({
  appointmentId: v.id("appointments"),
  end: v.string(),
  locationId: v.id("locations"),
  patientId: v.optional(v.id("patients")),
  start: v.string(),
  targetPractitionerId: v.optional(v.id("practitioners")),
  targetPractitionerName: v.optional(v.string()),
  title: v.string(),
  userId: v.optional(v.id("users")),
});

export type CoverageSuggestion = Infer<typeof coverageSuggestionValidator>;

export async function resolveAppointmentTypeIdForRuleSet(
  db: DatabaseReader,
  args: {
    appointmentTypeId: Id<"appointmentTypes">;
    practiceId: Id<"practices">;
    targetRuleSetId: Id<"ruleSets">;
  },
): Promise<Id<"appointmentTypes">> {
  const appointmentType = await db.get(
    "appointmentTypes",
    args.appointmentTypeId,
  );
  if (!appointmentType) {
    throw new Error(`Terminart ${args.appointmentTypeId} nicht gefunden.`);
  }
  if (appointmentType.practiceId !== args.practiceId) {
    throw new Error("Terminart gehört nicht zu dieser Praxis.");
  }
  if (appointmentType.ruleSetId === args.targetRuleSetId) {
    return appointmentType._id;
  }

  const lineageKey = appointmentType.lineageKey ?? appointmentType._id;
  const mappedAppointmentType = await db
    .query("appointmentTypes")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", args.targetRuleSetId).eq("lineageKey", lineageKey),
    )
    .first();

  if (mappedAppointmentType?.practiceId !== args.practiceId) {
    throw new Error(
      "Terminart konnte im Ziel-Regelset nicht aufgelöst werden.",
    );
  }

  return mappedAppointmentType._id;
}

export async function resolveLocationIdForRuleSet(
  db: DatabaseReader,
  args: {
    locationId: Id<"locations">;
    practiceId: Id<"practices">;
    targetRuleSetId: Id<"ruleSets">;
  },
): Promise<Id<"locations">> {
  const location = await db.get("locations", args.locationId);
  if (!location) {
    throw new Error(`Standort ${args.locationId} nicht gefunden.`);
  }
  if (location.practiceId !== args.practiceId) {
    throw new Error("Standort gehört nicht zu dieser Praxis.");
  }
  if (location.ruleSetId === args.targetRuleSetId) {
    return location._id;
  }

  const lineageKey = location.lineageKey ?? location._id;
  const mappedLocation = await db
    .query("locations")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", args.targetRuleSetId).eq("lineageKey", lineageKey),
    )
    .first();

  if (mappedLocation?.practiceId !== args.practiceId) {
    throw new Error("Standort konnte im Ziel-Regelset nicht aufgelöst werden.");
  }

  return mappedLocation._id;
}

export async function resolvePractitionerIdForRuleSet(
  db: DatabaseReader,
  args: {
    practiceId: Id<"practices">;
    practitionerId: Id<"practitioners">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<Id<"practitioners">> {
  return await resolvePractitionerIdInRuleSet(db, {
    practiceId: args.practiceId,
    practitionerId: args.practitionerId,
    targetRuleSetId: args.ruleSetId,
  });
}

async function getLatestSeenPractitionerDates(
  db: DatabaseReader,
  appointment: Doc<"appointments">,
): Promise<Map<Id<"practitioners">, string>> {
  const history = new Map<Id<"practitioners">, string>();

  const recordHistory = (items: Doc<"appointments">[]) => {
    for (const item of items) {
      if (
        item.cancelledAt !== undefined ||
        !item.practitionerLineageKey ||
        item.start >= appointment.start
      ) {
        continue;
      }

      const previous = history.get(item.practitionerLineageKey);
      if (!previous || previous < item.start) {
        history.set(item.practitionerLineageKey, item.start);
      }
    }
  };

  if (appointment.patientId) {
    const patientAppointments = await db
      .query("appointments")
      .withIndex("by_patientId", (q) =>
        q.eq("patientId", appointment.patientId),
      )
      .collect();
    recordHistory(patientAppointments);
  }

  if (appointment.userId) {
    const userAppointments = await db
      .query("appointments")
      .withIndex("by_userId_start", (q) =>
        q.eq("userId", appointment.userId).lt("start", appointment.start),
      )
      .collect();
    recordHistory(userAppointments);
  }

  return history;
}

async function getPatientDateOfBirth(
  db: DatabaseReader,
  appointment: Doc<"appointments">,
): Promise<string | undefined> {
  if (!appointment.patientId) {
    return undefined;
  }

  const patient = await db.get("patients", appointment.patientId);
  return patient?.dateOfBirth;
}

async function previewPractitionerCoverageForAppointment(
  ctx: QueryCtx,
  args: {
    activeRuleSetId: Id<"ruleSets">;
    appointment: Doc<"appointments">;
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
    selectedPractitionerId: Id<"practitioners">;
  },
): Promise<{
  appointmentId: Id<"appointments">;
  end: string;
  locationId: Id<"locations">;
  patientId?: Id<"patients">;
  start: string;
  targetPractitionerId?: Id<"practitioners">;
  targetPractitionerName?: string;
  title: string;
  userId?: Id<"users">;
}> {
  const selectedLocationId = await resolveLocationIdForRuleSet(ctx.db, {
    locationId: args.appointment.locationLineageKey,
    practiceId: args.practiceId,
    targetRuleSetId: args.ruleSetId,
  });

  const suggestionBase = {
    appointmentId: args.appointment._id,
    end: args.appointment.end,
    locationId: selectedLocationId,
    ...(args.appointment.patientId
      ? { patientId: args.appointment.patientId }
      : {}),
    start: args.appointment.start,
    title: args.appointment.title,
    ...(args.appointment.userId ? { userId: args.appointment.userId } : {}),
  };

  if (!args.appointment.practitionerLineageKey) {
    return suggestionBase;
  }

  if (args.appointment.seriesId !== undefined) {
    return suggestionBase;
  }

  const selectedAppointmentTypeId = await resolveAppointmentTypeIdForRuleSet(
    ctx.db,
    {
      appointmentTypeId: args.appointment.appointmentTypeLineageKey,
      practiceId: args.practiceId,
      targetRuleSetId: args.ruleSetId,
    },
  );
  const selectedAppointmentType = await ctx.db.get(
    "appointmentTypes",
    selectedAppointmentTypeId,
  );
  if (!selectedAppointmentType) {
    throw new Error(`Terminart ${selectedAppointmentTypeId} nicht gefunden.`);
  }
  const day = Temporal.ZonedDateTime.from(args.appointment.start)
    .withTimeZone("Europe/Berlin")
    .toPlainDate();
  const patientDateOfBirth = await getPatientDateOfBirth(
    ctx.db,
    args.appointment,
  );

  const slotResult = await ctx.runQuery(
    internal.scheduling.getSlotsForDayInternal,
    {
      date: day.toString(),
      excludedAppointmentIds: [args.appointment._id],
      practiceId: args.practiceId,
      ruleSetId: args.ruleSetId,
      simulatedContext: {
        appointmentTypeId: selectedAppointmentTypeId,
        locationId: selectedLocationId,
        patient: {
          ...(patientDateOfBirth ? { dateOfBirth: patientDateOfBirth } : {}),
          isNew: false,
        },
      },
    },
  );

  const matchingSlots = slotResult.slots.filter(
    (slot) =>
      slot.status === "AVAILABLE" &&
      slot.startTime === args.appointment.start &&
      slot.practitionerId !== args.selectedPractitionerId,
  );

  if (matchingSlots.length === 0) {
    return suggestionBase;
  }

  const latestSeenByPractitioner = await getLatestSeenPractitionerDates(
    ctx.db,
    args.appointment,
  );

  const candidates = await Promise.all(
    matchingSlots.map(async (slot) => {
      let activePractitionerId: Id<"practitioners"> | undefined;

      try {
        activePractitionerId = await resolvePractitionerIdInRuleSet(ctx.db, {
          practiceId: args.practiceId,
          practitionerId: slot.practitionerId,
          targetRuleSetId: args.activeRuleSetId,
        });
      } catch {
        activePractitionerId = undefined;
      }

      return {
        activePractitionerId,
        isAllowedInSelectedRuleSet:
          selectedAppointmentType.allowedPractitionerIds.includes(
            slot.practitionerId,
          ),
        lastSeenAt: activePractitionerId
          ? (latestSeenByPractitioner.get(activePractitionerId) ?? null)
          : null,
        name: slot.practitionerName,
        selectedPractitionerId: slot.practitionerId,
      };
    }),
  );

  const bestCandidate = candidates
    .filter(
      (
        candidate,
      ): candidate is typeof candidate & {
        isAllowedInSelectedRuleSet: true;
        selectedPractitionerId: Id<"practitioners">;
      } => candidate.isAllowedInSelectedRuleSet,
    )
    .toSorted((left, right) => {
      if (left.lastSeenAt && right.lastSeenAt) {
        return right.lastSeenAt.localeCompare(left.lastSeenAt);
      }
      if (left.lastSeenAt) {
        return -1;
      }
      if (right.lastSeenAt) {
        return 1;
      }
      return left.name.localeCompare(right.name, "de");
    })[0];

  if (!bestCandidate) {
    return suggestionBase;
  }

  return {
    ...suggestionBase,
    targetPractitionerId: bestCandidate.selectedPractitionerId,
    targetPractitionerName: bestCandidate.name,
  };
}

async function resolvePractitionerIdInRuleSet(
  db: DatabaseReader,
  args: {
    practiceId: Id<"practices">;
    practitionerId: Id<"practitioners">;
    targetRuleSetId: Id<"ruleSets">;
  },
): Promise<Id<"practitioners">> {
  const practitioner = await db.get("practitioners", args.practitionerId);
  if (!practitioner) {
    const mappedPractitioner = await db
      .query("practitioners")
      .withIndex("by_ruleSetId_lineageKey", (q) =>
        q
          .eq("ruleSetId", args.targetRuleSetId)
          .eq("lineageKey", args.practitionerId),
      )
      .first();

    if (mappedPractitioner?.practiceId !== args.practiceId) {
      throw new Error(`Behandler ${args.practitionerId} nicht gefunden.`);
    }

    return mappedPractitioner._id;
  }
  if (practitioner.practiceId !== args.practiceId) {
    throw new Error("Behandler gehört nicht zu dieser Praxis.");
  }
  if (practitioner.ruleSetId === args.targetRuleSetId) {
    return practitioner._id;
  }

  const lineageKey = practitioner.lineageKey ?? practitioner._id;
  const mappedPractitioner = await db
    .query("practitioners")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", args.targetRuleSetId).eq("lineageKey", lineageKey),
    )
    .first();

  if (mappedPractitioner?.practiceId !== args.practiceId) {
    throw new Error(
      "Behandler konnte im Ziel-Regelset nicht aufgelöst werden.",
    );
  }

  return mappedPractitioner._id;
}

export const previewPractitionerAbsenceCoverage = query({
  args: {
    date: v.string(),
    portion: vacationPortionValidator,
    practiceId: v.id("practices"),
    practitionerId: v.id("practitioners"),
    replacingVacationLineageKeys: v.optional(v.array(v.id("vacations"))),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForQuery(ctx, args.practiceId);

    const practice = await ctx.db.get("practices", args.practiceId);
    if (!practice?.currentActiveRuleSetId) {
      return {
        affectedCount: 0,
        movableCount: 0,
        suggestions: [],
        unmovedCount: 0,
      };
    }

    const activeRuleSetId = practice.currentActiveRuleSetId;
    const selectedPractitionerId = await resolvePractitionerIdForRuleSet(
      ctx.db,
      {
        practiceId: args.practiceId,
        practitionerId: args.practitionerId,
        ruleSetId: args.ruleSetId,
      },
    );
    const activePractitionerId = await resolvePractitionerIdForRuleSet(ctx.db, {
      practiceId: args.practiceId,
      practitionerId: args.practitionerId,
      ruleSetId: activeRuleSetId,
    });
    const activePractitionerLineageKey = await resolvePractitionerLineageKey(
      ctx.db,
      activePractitionerId,
    );

    const baseSchedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();
    const vacations = await ctx.db
      .query("vacations")
      .withIndex("by_ruleSetId_date", (q) =>
        q.eq("ruleSetId", args.ruleSetId).eq("date", args.date),
      )
      .collect();
    const replacingVacationLineageKeys = new Set(
      args.replacingVacationLineageKeys,
    );

    const vacationRanges = getPractitionerVacationRangesForDate(
      Temporal.PlainDate.from(args.date),
      selectedPractitionerId,
      baseSchedules,
      [
        ...vacations.filter(
          (vacation) =>
            !replacingVacationLineageKeys.has(
              vacation.lineageKey ?? vacation._id,
            ),
        ),
        {
          date: args.date,
          portion: args.portion,
          practitionerId: selectedPractitionerId,
          staffType: "practitioner" as const,
        },
      ],
    );

    if (vacationRanges.length === 0) {
      return {
        affectedCount: 0,
        movableCount: 0,
        suggestions: [],
        unmovedCount: 0,
      };
    }

    const dayStart = Temporal.PlainDate.from(args.date)
      .toZonedDateTime({
        plainTime: Temporal.PlainTime.from("00:00"),
        timeZone: "Europe/Berlin",
      })
      .toString();
    const dayEnd = Temporal.PlainDate.from(args.date)
      .add({ days: 1 })
      .toZonedDateTime({
        plainTime: Temporal.PlainTime.from("00:00"),
        timeZone: "Europe/Berlin",
      })
      .toString();

    const appointments = await ctx.db
      .query("appointments")
      .withIndex("by_practiceId_start", (q) =>
        q
          .eq("practiceId", args.practiceId)
          .gte("start", dayStart)
          .lt("start", dayEnd),
      )
      .collect();
    const effectiveAppointments = getEffectiveAppointmentsForScope(
      appointments.filter(
        (appointment) =>
          !(
            appointment.isSimulation === true &&
            appointment.simulationRuleSetId === args.ruleSetId &&
            appointment.reassignmentSourceVacationLineageKey &&
            replacingVacationLineageKeys.has(
              appointment.reassignmentSourceVacationLineageKey,
            )
          ),
      ),
      "simulation",
      args.ruleSetId,
    );

    const affectedAppointments = effectiveAppointments
      .filter(
        (appointment) =>
          appointment.cancelledAt === undefined &&
          appointment.isSimulation !== true &&
          appointment.practitionerLineageKey === activePractitionerLineageKey,
      )
      .filter((appointment) => {
        const start = Temporal.ZonedDateTime.from(appointment.start);
        const end = Temporal.ZonedDateTime.from(appointment.end);
        const startMinutes = start.hour * 60 + start.minute;
        const endMinutes = end.hour * 60 + end.minute;

        return vacationRanges.some(
          (range) =>
            startMinutes < range.endMinutes && endMinutes > range.startMinutes,
        );
      })
      .toSorted((left, right) => left.start.localeCompare(right.start));

    const suggestions = await Promise.all(
      affectedAppointments.map((appointment) =>
        previewPractitionerCoverageForAppointment(ctx, {
          activeRuleSetId,
          appointment,
          practiceId: args.practiceId,
          ruleSetId: args.ruleSetId,
          selectedPractitionerId,
        }),
      ),
    );

    const movableCount = suggestions.filter(
      (suggestion) => suggestion.targetPractitionerId !== undefined,
    ).length;

    return {
      affectedCount: suggestions.length,
      movableCount,
      suggestions,
      unmovedCount: suggestions.length - movableCount,
    };
  },
  returns: v.object({
    affectedCount: v.number(),
    movableCount: v.number(),
    suggestions: v.array(coverageSuggestionValidator),
    unmovedCount: v.number(),
  }),
});
