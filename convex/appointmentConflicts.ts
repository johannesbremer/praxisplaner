import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";

import { Temporal } from "temporal-polyfill";

import type { DataModel, Doc, Id } from "./_generated/dataModel";
import type { CalendarOccupancyScope } from "./appointmentOccupancy";
import type { LocationLineageKey } from "./identity";

import { calendarOccupancyScopesConflict } from "../lib/calendar-occupancy";

export type AppointmentBookingScope = "real" | "simulation";

export interface AppointmentConflictCandidate {
  end: string;
  locationLineageKey: LocationLineageKey;
  occupancyScope: CalendarOccupancyScope;
  start: string;
}
export type AppointmentOccupancyView = "draftEffective" | "live";

export type CalendarOccupancyConflict =
  | { kind: "appointment"; record: Doc<"appointments"> }
  | { kind: "blockedSlot"; record: Doc<"blockedSlots"> };

export interface CalendarOccupancyConflictSet {
  appointments: Doc<"appointments">[];
  blockedSlots: Doc<"blockedSlots">[];
}

export type CalendarOccupancyConflictSetCache = Map<
  string,
  Promise<CalendarOccupancyConflictSet>
>;

export interface CalendarOccupancyQueryWindow {
  queryEnd: string;
  queryStart: string;
}

type DatabaseLike =
  | GenericDatabaseReader<DataModel>
  | GenericDatabaseWriter<DataModel>;

export function appointmentOverlapsCandidate(
  appointment: Pick<
    Doc<"appointments">,
    "end" | "locationLineageKey" | "occupancyScope" | "start"
  >,
  candidate: AppointmentConflictCandidate,
): boolean {
  return overlapsCalendarOccupancyCandidate(
    {
      end: appointment.end,
      locationKey: appointment.locationLineageKey,
      occupancyScope: appointment.occupancyScope,
      start: appointment.start,
    },
    candidate,
  );
}

export async function findConflictingAppointment(
  db: DatabaseLike,
  args: {
    candidate: AppointmentConflictCandidate;
    draftRuleSetId?: Id<"ruleSets">;
    excludeAppointmentIds?: Id<"appointments">[];
    occupancyView: AppointmentOccupancyView;
    practiceId: Id<"practices">;
  },
): Promise<Doc<"appointments"> | null> {
  const conflict = await findConflictingCalendarOccupancy(db, args);
  return conflict?.kind === "appointment" ? conflict.record : null;
}

export async function findConflictingCalendarOccupancy(
  db: DatabaseLike,
  args: {
    candidate: AppointmentConflictCandidate;
    draftRuleSetId?: Id<"ruleSets">;
    excludeAppointmentIds?: Id<"appointments">[];
    excludeBlockedSlotIds?: Id<"blockedSlots">[];
    occupancyView: AppointmentOccupancyView;
    practiceId: Id<"practices">;
  },
): Promise<CalendarOccupancyConflict | null> {
  const conflictSet = await loadCalendarOccupancyConflictSet(db, {
    ...(args.draftRuleSetId === undefined
      ? {}
      : { draftRuleSetId: args.draftRuleSetId }),
    occupancyView: args.occupancyView,
    practiceId: args.practiceId,
    queryWindow: getCalendarOccupancyQueryWindow(args.candidate),
  });
  return findConflictingCalendarOccupancyInSet({
    candidate: args.candidate,
    conflictSet,
    ...(args.excludeAppointmentIds === undefined
      ? {}
      : { excludeAppointmentIds: args.excludeAppointmentIds }),
    ...(args.excludeBlockedSlotIds === undefined
      ? {}
      : { excludeBlockedSlotIds: args.excludeBlockedSlotIds }),
  });
}

export function findConflictingCalendarOccupancyInSet(args: {
  candidate: AppointmentConflictCandidate;
  conflictSet: CalendarOccupancyConflictSet;
  excludeAppointmentIds?: Id<"appointments">[];
  excludeBlockedSlotIds?: Id<"blockedSlots">[];
}): CalendarOccupancyConflict | null {
  return findFirstCalendarOccupancyConflict({
    appointments: args.conflictSet.appointments,
    blockedSlots: args.conflictSet.blockedSlots,
    candidate: args.candidate,
    excludeAppointmentIds: new Set(args.excludeAppointmentIds),
    excludeBlockedSlotIds: new Set(args.excludeBlockedSlotIds),
  });
}

export async function findConflictingCalendarOccupancyWithCache(
  db: DatabaseLike,
  args: {
    candidate: AppointmentConflictCandidate;
    conflictSetsByWindow: CalendarOccupancyConflictSetCache;
    draftRuleSetId?: Id<"ruleSets">;
    excludeAppointmentIds?: Id<"appointments">[];
    excludeBlockedSlotIds?: Id<"blockedSlots">[];
    occupancyView: AppointmentOccupancyView;
    practiceId: Id<"practices">;
  },
): Promise<CalendarOccupancyConflict | null> {
  const queryWindow = getCalendarOccupancyQueryWindow(args.candidate);
  const cacheKey = calendarOccupancyConflictSetCacheKey({
    ...(args.draftRuleSetId === undefined
      ? {}
      : { draftRuleSetId: args.draftRuleSetId }),
    occupancyView: args.occupancyView,
    practiceId: args.practiceId,
    queryEnd: queryWindow.queryEnd,
    queryStart: queryWindow.queryStart,
  });
  let conflictSetPromise = args.conflictSetsByWindow.get(cacheKey);
  if (conflictSetPromise === undefined) {
    conflictSetPromise = loadCalendarOccupancyConflictSet(db, {
      ...(args.draftRuleSetId === undefined
        ? {}
        : { draftRuleSetId: args.draftRuleSetId }),
      occupancyView: args.occupancyView,
      practiceId: args.practiceId,
      queryWindow,
    });
    args.conflictSetsByWindow.set(cacheKey, conflictSetPromise);
  }

  const conflictSet = await conflictSetPromise;
  return findConflictingCalendarOccupancyInSet({
    candidate: args.candidate,
    conflictSet,
    ...(args.excludeAppointmentIds === undefined
      ? {}
      : { excludeAppointmentIds: args.excludeAppointmentIds }),
    ...(args.excludeBlockedSlotIds === undefined
      ? {}
      : { excludeBlockedSlotIds: args.excludeBlockedSlotIds }),
  });
}

export function getCalendarOccupancyQueryWindow(
  candidate: AppointmentConflictCandidate,
): CalendarOccupancyQueryWindow {
  const windowStart = Temporal.ZonedDateTime.from(candidate.start);
  const windowEnd = Temporal.ZonedDateTime.from(candidate.end);
  return {
    queryEnd: windowEnd
      .toPlainDate()
      .add({ days: 2 })
      .toZonedDateTime({
        plainTime: new Temporal.PlainTime(0, 0),
        timeZone: windowEnd.timeZoneId,
      })
      .toString(),
    queryStart: windowStart
      .toPlainDate()
      .add({ days: -1 })
      .toZonedDateTime({
        plainTime: new Temporal.PlainTime(0, 0),
        timeZone: windowStart.timeZoneId,
      })
      .toString(),
  };
}

export function getEffectiveAppointmentsForOccupancyView(
  appointments: Doc<"appointments">[],
  occupancyView: AppointmentOccupancyView,
  draftRuleSetId?: Id<"ruleSets">,
): Doc<"appointments">[] {
  const visibleAppointments = appointments.filter(
    (appointment) => appointment.cancelledAt === undefined,
  );

  if (occupancyView === "live") {
    return visibleAppointments.filter(
      (appointment) => appointment.isSimulation !== true,
    );
  }

  const simulationAppointments = visibleAppointments.filter((appointment) => {
    if (appointment.isSimulation !== true) {
      return false;
    }

    if (!draftRuleSetId) {
      return true;
    }

    return appointment.simulationRuleSetId === draftRuleSetId;
  });
  const replacedIds = new Set(
    simulationAppointments
      .map((appointment) => appointment.replacesAppointmentId)
      .filter(Boolean),
  );
  const appointmentsById = new Map(
    visibleAppointments.map((appointment) => [appointment._id, appointment]),
  );
  const replacedSeriesIds = new Set<string>();
  for (const simulationAppointment of simulationAppointments) {
    const replacedAppointmentId = simulationAppointment.replacesAppointmentId;
    if (replacedAppointmentId === undefined) {
      continue;
    }
    const replacedAppointment = appointmentsById.get(replacedAppointmentId);
    if (isWholeSeriesReplacement(simulationAppointment, replacedAppointment)) {
      replacedSeriesIds.add(replacedAppointment.seriesId);
    }
  }

  const realAppointments = visibleAppointments.filter(
    (appointment) =>
      appointment.isSimulation !== true &&
      !replacedIds.has(appointment._id) &&
      (appointment.seriesId === undefined ||
        !replacedSeriesIds.has(appointment.seriesId)),
  );

  return [...realAppointments, ...simulationAppointments].toSorted((a, b) =>
    a.start.localeCompare(b.start),
  );
}

export function getOccupancyViewForBookingScope(
  scope: AppointmentBookingScope,
): AppointmentOccupancyView {
  return scope === "simulation" ? "draftEffective" : "live";
}

export async function loadCalendarOccupancyConflictSet(
  db: DatabaseLike,
  args: {
    draftRuleSetId?: Id<"ruleSets">;
    occupancyView: AppointmentOccupancyView;
    practiceId: Id<"practices">;
    queryWindow: CalendarOccupancyQueryWindow;
  },
): Promise<CalendarOccupancyConflictSet> {
  const [rawAppointments, rawBlockedSlots] = await Promise.all([
    db
      .query("appointments")
      .withIndex("by_practiceId_start", (q) =>
        q
          .eq("practiceId", args.practiceId)
          .gte("start", args.queryWindow.queryStart)
          .lt("start", args.queryWindow.queryEnd),
      )
      .collect(),
    db
      .query("blockedSlots")
      .withIndex("by_practiceId_start", (q) =>
        q
          .eq("practiceId", args.practiceId)
          .gte("start", args.queryWindow.queryStart)
          .lt("start", args.queryWindow.queryEnd),
      )
      .collect(),
  ]);
  const appointments = await loadAppointmentsForOccupancyView(db, {
    ...(args.draftRuleSetId === undefined
      ? {}
      : { draftRuleSetId: args.draftRuleSetId }),
    localAppointments: rawAppointments,
    occupancyView: args.occupancyView,
    practiceId: args.practiceId,
  });

  return {
    appointments,
    blockedSlots: getEffectiveBlockedSlotsForOccupancyView(
      rawBlockedSlots,
      args.occupancyView,
    ),
  };
}

function calendarOccupancyConflictSetCacheKey(args: {
  draftRuleSetId?: Id<"ruleSets">;
  occupancyView: AppointmentOccupancyView;
  practiceId: Id<"practices">;
  queryEnd: string;
  queryStart: string;
}): string {
  return [
    args.practiceId,
    args.occupancyView,
    args.draftRuleSetId ?? "active",
    args.queryStart,
    args.queryEnd,
  ].join("|");
}

function dedupeAppointmentsById(
  appointments: Doc<"appointments">[],
): Doc<"appointments">[] {
  return [
    ...new Map(
      appointments.map((appointment) => [appointment._id, appointment]),
    ).values(),
  ];
}

function findFirstCalendarOccupancyConflict(args: {
  appointments: Doc<"appointments">[];
  blockedSlots: Doc<"blockedSlots">[];
  candidate: AppointmentConflictCandidate;
  excludeAppointmentIds: ReadonlySet<Id<"appointments">>;
  excludeBlockedSlotIds: ReadonlySet<Id<"blockedSlots">>;
}): CalendarOccupancyConflict | null {
  const appointmentConflict = args.appointments.find(
    (appointment) =>
      !args.excludeAppointmentIds.has(appointment._id) &&
      appointmentOverlapsCandidate(appointment, args.candidate),
  );
  if (appointmentConflict) {
    return { kind: "appointment", record: appointmentConflict };
  }

  const blockedSlotConflict = args.blockedSlots.find(
    (blockedSlot) =>
      !args.excludeBlockedSlotIds.has(blockedSlot._id) &&
      overlapsCalendarOccupancyCandidate(
        {
          end: blockedSlot.end,
          locationKey: blockedSlot.locationLineageKey,
          occupancyScope: blockedSlot.occupancyScope,
          start: blockedSlot.start,
        },
        args.candidate,
      ),
  );
  return blockedSlotConflict
    ? { kind: "blockedSlot", record: blockedSlotConflict }
    : null;
}

function getEffectiveBlockedSlotsForOccupancyView(
  blockedSlots: Doc<"blockedSlots">[],
  occupancyView: AppointmentOccupancyView,
): Doc<"blockedSlots">[] {
  if (occupancyView === "live") {
    return blockedSlots.filter(
      (blockedSlot) => blockedSlot.isSimulation !== true,
    );
  }

  const simulationBlockedSlots = blockedSlots.filter(
    (blockedSlot) => blockedSlot.isSimulation === true,
  );
  const replacedIds = new Set(
    simulationBlockedSlots
      .map((blockedSlot) => blockedSlot.replacesBlockedSlotId)
      .filter(Boolean),
  );
  const realBlockedSlots = blockedSlots.filter(
    (blockedSlot) =>
      blockedSlot.isSimulation !== true && !replacedIds.has(blockedSlot._id),
  );

  return [...realBlockedSlots, ...simulationBlockedSlots].toSorted((a, b) =>
    a.start.localeCompare(b.start),
  );
}

function isWholeSeriesReplacement(
  simulationAppointment: Doc<"appointments">,
  replacedAppointment: Doc<"appointments"> | undefined,
): replacedAppointment is Doc<"appointments"> & { seriesId: string } {
  return (
    simulationAppointment.isSimulation === true &&
    simulationAppointment.replacesAppointmentId !== undefined &&
    simulationAppointment.seriesId !== undefined &&
    replacedAppointment?.seriesId !== undefined &&
    replacedAppointment.seriesStepIndex === 0n &&
    simulationAppointment.seriesId !== replacedAppointment.seriesId
  );
}

async function loadAppointmentsForOccupancyView(
  db: DatabaseLike,
  args: {
    draftRuleSetId?: Id<"ruleSets">;
    localAppointments: Doc<"appointments">[];
    occupancyView: AppointmentOccupancyView;
    practiceId: Id<"practices">;
  },
): Promise<Doc<"appointments">[]> {
  if (args.occupancyView === "live") {
    return getEffectiveAppointmentsForOccupancyView(
      args.localAppointments,
      args.occupancyView,
      args.draftRuleSetId,
    );
  }

  const rawSimulationAppointments = await db
    .query("appointments")
    .withIndex("by_practiceId_isSimulation", (q) =>
      q.eq("practiceId", args.practiceId).eq("isSimulation", true),
    )
    .collect();
  const simulationAppointments = rawSimulationAppointments.filter(
    (appointment) =>
      args.draftRuleSetId === undefined ||
      appointment.simulationRuleSetId === args.draftRuleSetId,
  );
  const rawReplacedAppointments = await Promise.all(
    simulationAppointments.map(async (appointment) => {
      const replacedAppointmentId = appointment.replacesAppointmentId;
      if (replacedAppointmentId === undefined) {
        return null;
      }
      return await db.get("appointments", replacedAppointmentId);
    }),
  );
  const replacedAppointments: Doc<"appointments">[] = [];
  for (const appointment of rawReplacedAppointments) {
    if (appointment !== null) {
      replacedAppointments.push(appointment);
    }
  }

  return getEffectiveAppointmentsForOccupancyView(
    dedupeAppointmentsById([
      ...args.localAppointments,
      ...simulationAppointments,
      ...replacedAppointments,
    ]),
    args.occupancyView,
    args.draftRuleSetId,
  );
}

function overlapsCalendarOccupancyCandidate(
  existing: {
    end: string;
    locationKey: string;
    occupancyScope: CalendarOccupancyScope;
    start: string;
  },
  candidate: AppointmentConflictCandidate,
): boolean {
  if (existing.locationKey !== candidate.locationLineageKey) {
    return false;
  }

  if (
    !calendarOccupancyScopesConflict(
      existing.occupancyScope,
      candidate.occupancyScope,
    )
  ) {
    return false;
  }

  const candidateStart = Temporal.ZonedDateTime.from(
    candidate.start,
  ).epochMilliseconds;
  const candidateEnd = Temporal.ZonedDateTime.from(
    candidate.end,
  ).epochMilliseconds;
  const existingStart = Temporal.ZonedDateTime.from(
    existing.start,
  ).epochMilliseconds;
  const existingEnd = Temporal.ZonedDateTime.from(
    existing.end,
  ).epochMilliseconds;

  return candidateStart < existingEnd && existingStart < candidateEnd;
}
