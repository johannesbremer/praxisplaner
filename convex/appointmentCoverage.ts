import { type Infer, v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import type { IsoDateString } from "../lib/typed-regex";
import type { Doc, Id } from "./_generated/dataModel";
import type {
  DatabaseReader,
  MutationCtx,
  QueryCtx,
} from "./_generated/server";

import { getPractitionerVacationRangesForDate } from "../lib/vacation-utils";
import { internal } from "./_generated/api";
import { query } from "./_generated/server";
import { getEffectiveAppointmentsForOccupancyView } from "./appointmentConflicts";
import {
  resolveActivePractitionerLineageKeys,
  resolveLocationIdForRuleSetByLineage,
  resolvePractitionerLineageKey,
} from "./appointmentReferences";
import {
  type AppointmentTypeId,
  type AppointmentTypeLineageKey,
  asAppointmentTypeId,
  asAppointmentTypeLineageKey,
  asLocationId,
  asLocationLineageKey,
  asPractitionerId,
  asPractitionerLineageKey,
  type LocationId,
  type LocationLineageKey,
  type PractitionerId,
  type PractitionerLineageKey,
} from "./identity";
import { requireLineageKey } from "./lineage";
import { ensurePracticeAccessForQuery } from "./practiceAccess";
import { isRuleSetEntityDeleted } from "./ruleSetEntityDeletion";
import { asOptionalIsoDateString } from "./typedDtos";
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
  targetPractitionerLineageKey: v.optional(v.id("practitioners")),
  targetPractitionerName: v.optional(v.string()),
  title: v.string(),
  userId: v.optional(v.id("users")),
});

export type CoverageSuggestion = Infer<typeof coverageSuggestionValidator>;

export async function resolveAppointmentTypeIdForRuleSet(
  db: DatabaseReader,
  args: {
    appointmentTypeLineageKey: AppointmentTypeLineageKey;
    practiceId: Id<"practices">;
    targetRuleSetId: Id<"ruleSets">;
  },
): Promise<AppointmentTypeId> {
  const appointmentType = await db.get(
    "appointmentTypes",
    args.appointmentTypeLineageKey,
  );
  if (!appointmentType) {
    throw new Error(
      `Terminart ${args.appointmentTypeLineageKey} nicht gefunden.`,
    );
  }
  if (appointmentType.practiceId !== args.practiceId) {
    throw new Error("Terminart gehört nicht zu dieser Praxis.");
  }
  if (appointmentType.ruleSetId === args.targetRuleSetId) {
    return asAppointmentTypeId(appointmentType._id);
  }

  const mappedAppointmentType = await db
    .query("appointmentTypes")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q
        .eq("ruleSetId", args.targetRuleSetId)
        .eq("lineageKey", args.appointmentTypeLineageKey),
    )
    .first();

  if (mappedAppointmentType?.practiceId !== args.practiceId) {
    throw new Error(
      "Terminart konnte im Ziel-Regelset nicht aufgelöst werden.",
    );
  }

  return asAppointmentTypeId(mappedAppointmentType._id);
}

export async function resolveLocationIdForRuleSet(
  db: DatabaseReader,
  args: {
    locationLineageKey: LocationLineageKey;
    practiceId: Id<"practices">;
    targetRuleSetId: Id<"ruleSets">;
  },
): Promise<LocationId> {
  const resolvedLocationId = await resolveLocationIdForRuleSetByLineage(db, {
    lineageKey: args.locationLineageKey,
    ruleSetId: args.targetRuleSetId,
  });
  const location = await db.get("locations", resolvedLocationId);
  if (!location) {
    throw new Error(
      `Standort ${args.locationLineageKey} konnte im Ziel-Regelset nicht geladen werden.`,
    );
  }
  if (location.practiceId !== args.practiceId) {
    throw new Error("Standort gehört nicht zu dieser Praxis.");
  }
  return asLocationId(resolvedLocationId);
}

export async function resolvePractitionerIdForRuleSet(
  db: DatabaseReader,
  args: {
    practiceId: Id<"practices">;
    practitionerLineageKey: PractitionerLineageKey;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<PractitionerId> {
  return await resolvePractitionerIdInRuleSet(db, {
    practiceId: args.practiceId,
    practitionerLineageKey: args.practitionerLineageKey,
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
): Promise<IsoDateString | undefined> {
  if (!appointment.patientId) {
    return undefined;
  }

  const patient = await db.get("patients", appointment.patientId);
  return asOptionalIsoDateString(patient?.dateOfBirth);
}

async function previewPractitionerCoverageForAppointment(
  ctx:
    | (Pick<MutationCtx, "runQuery"> & { db: DatabaseReader })
    | (Pick<QueryCtx, "runQuery"> & { db: DatabaseReader }),
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
  targetPractitionerLineageKey?: Id<"practitioners">;
  targetPractitionerName?: string;
  title: string;
  userId?: Id<"users">;
}> {
  const selectedLocationId = await resolveLocationIdForRuleSet(ctx.db, {
    locationLineageKey: asLocationLineageKey(
      args.appointment.locationLineageKey,
    ),
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

  const appointmentTypeLineageKey = asAppointmentTypeLineageKey(
    args.appointment.appointmentTypeLineageKey,
  );
  const [selectedAppointmentType, activeAppointmentType] = await Promise.all([
    ctx.db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId_lineageKey", (q) =>
        q
          .eq("ruleSetId", args.ruleSetId)
          .eq("lineageKey", appointmentTypeLineageKey),
      )
      .first(),
    ctx.db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId_lineageKey", (q) =>
        q
          .eq("ruleSetId", args.activeRuleSetId)
          .eq("lineageKey", appointmentTypeLineageKey),
      )
      .first(),
  ]);
  if (
    selectedAppointmentType?.practiceId !== args.practiceId ||
    isRuleSetEntityDeleted(selectedAppointmentType) ||
    activeAppointmentType?.practiceId !== args.practiceId ||
    isRuleSetEntityDeleted(activeAppointmentType)
  ) {
    return suggestionBase;
  }
  const selectedLocationLineageKey = asLocationLineageKey(
    args.appointment.locationLineageKey,
  );
  const selectedPractitionerLineageKey = await resolvePractitionerLineageKey(
    ctx.db,
    asPractitionerId(args.selectedPractitionerId),
    { allowDeleted: true },
  ).then((lineageKey) => asPractitionerLineageKey(lineageKey));
  const allowedPractitionerLineageKeys = new Set(
    await resolveActivePractitionerLineageKeys(
      ctx.db,
      selectedAppointmentType.allowedPractitionerIds.map((practitionerId) =>
        asPractitionerId(practitionerId),
      ),
    ),
  );
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
        appointmentTypeLineageKey,
        locationLineageKey: selectedLocationLineageKey,
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
      slot.practitionerLineageKey !== selectedPractitionerLineageKey,
  );

  if (matchingSlots.length === 0) {
    return suggestionBase;
  }

  const latestSeenByPractitioner = await getLatestSeenPractitionerDates(
    ctx.db,
    args.appointment,
  );

  const candidates = matchingSlots.map((slot) => ({
    activePractitionerLineageKey: slot.practitionerLineageKey,
    isAllowedInSelectedRuleSet: allowedPractitionerLineageKeys.has(
      slot.practitionerLineageKey,
    ),
    lastSeenAt:
      latestSeenByPractitioner.get(slot.practitionerLineageKey) ?? null,
    name: slot.practitionerName,
  }));

  const bestCandidate = candidates
    .filter(
      (
        candidate,
      ): candidate is typeof candidate & {
        isAllowedInSelectedRuleSet: true;
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
    targetPractitionerLineageKey: bestCandidate.activePractitionerLineageKey,
    targetPractitionerName: bestCandidate.name,
  };
}

export { previewPractitionerCoverageForAppointment };

async function resolvePractitionerIdInRuleSet(
  db: DatabaseReader,
  args: {
    practiceId: Id<"practices">;
    practitionerLineageKey: PractitionerLineageKey;
    targetRuleSetId: Id<"ruleSets">;
  },
): Promise<PractitionerId> {
  const practitioner = await db.get(
    "practitioners",
    args.practitionerLineageKey,
  );
  if (!practitioner) {
    const mappedPractitioner = await db
      .query("practitioners")
      .withIndex("by_ruleSetId_lineageKey", (q) =>
        q
          .eq("ruleSetId", args.targetRuleSetId)
          .eq("lineageKey", args.practitionerLineageKey),
      )
      .first();

    if (mappedPractitioner?.practiceId !== args.practiceId) {
      throw new Error(
        `Behandler ${args.practitionerLineageKey} nicht gefunden.`,
      );
    }

    return asPractitionerId(mappedPractitioner._id);
  }
  if (practitioner.practiceId !== args.practiceId) {
    throw new Error("Behandler gehört nicht zu dieser Praxis.");
  }
  if (practitioner.ruleSetId === args.targetRuleSetId) {
    return asPractitionerId(practitioner._id);
  }

  const mappedPractitioner = await db
    .query("practitioners")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q
        .eq("ruleSetId", args.targetRuleSetId)
        .eq("lineageKey", args.practitionerLineageKey),
    )
    .first();

  if (mappedPractitioner?.practiceId !== args.practiceId) {
    throw new Error(
      "Behandler konnte im Ziel-Regelset nicht aufgelöst werden.",
    );
  }

  return asPractitionerId(mappedPractitioner._id);
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
    const selectedPractitionerLineageKey = await resolvePractitionerLineageKey(
      ctx.db,
      asPractitionerId(args.practitionerId),
    ).then((lineageKey) => asPractitionerLineageKey(lineageKey));
    await resolvePractitionerIdForRuleSet(ctx.db, {
      practiceId: args.practiceId,
      practitionerLineageKey: selectedPractitionerLineageKey,
      ruleSetId: args.ruleSetId,
    });

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
      selectedPractitionerLineageKey,
      baseSchedules,
      [
        ...vacations.filter(
          (vacation) =>
            !replacingVacationLineageKeys.has(
              requireLineageKey({
                entityId: vacation._id,
                entityType: "vacation",
                lineageKey: vacation.lineageKey,
                ruleSetId: vacation.ruleSetId,
              }),
            ),
        ),
        {
          date: args.date,
          portion: args.portion,
          practitionerLineageKey: selectedPractitionerLineageKey,
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
    const effectiveAppointments = getEffectiveAppointmentsForOccupancyView(
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
      "draftEffective",
      args.ruleSetId,
    );

    const affectedAppointments = effectiveAppointments
      .filter(
        (appointment) =>
          appointment.cancelledAt === undefined &&
          appointment.isSimulation !== true &&
          appointment.practitionerLineageKey === selectedPractitionerLineageKey,
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
          selectedPractitionerId: args.practitionerId,
        }),
      ),
    );

    const movableCount = suggestions.filter(
      (suggestion) => suggestion.targetPractitionerLineageKey !== undefined,
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
