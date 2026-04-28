import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";

import { Temporal } from "temporal-polyfill";

import type { DataModel, Doc, Id } from "./_generated/dataModel";
import type { LocationLineageKey, PractitionerLineageKey } from "./identity";

export type AppointmentBookingScope = "real" | "simulation";
export interface AppointmentConflictCandidate {
  end: string;
  locationLineageKey: LocationLineageKey;
  practitionerLineageKey?: PractitionerLineageKey;
  start: string;
}

export type AppointmentOccupancyView = "draftEffective" | "live";

export type AppointmentReplacementView = "all" | "live" | "simulation";

type AppointmentReplacementRecord = Pick<
  Doc<"appointments">,
  | "_id"
  | "cancelledAt"
  | "isSimulation"
  | "replacesAppointmentId"
  | "simulationRuleSetId"
  | "start"
>;

type CalendarOccupancyConflict =
  | { kind: "appointment"; record: Doc<"appointments"> }
  | { kind: "blockedSlot"; record: Doc<"blockedSlots"> };

type DatabaseLike =
  | GenericDatabaseReader<DataModel>
  | GenericDatabaseWriter<DataModel>;

export function appointmentOverlapsCandidate(
  appointment: Pick<
    Doc<"appointments">,
    "end" | "locationLineageKey" | "practitionerLineageKey" | "start"
  >,
  candidate: AppointmentConflictCandidate,
): boolean {
  return overlapsCalendarOccupancyCandidate(
    {
      end: appointment.end,
      locationKey: appointment.locationLineageKey,
      practitionerKey: appointment.practitionerLineageKey,
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
  const { queryEnd, queryStart } = getCalendarOccupancyQueryWindow(
    args.candidate,
  );
  const [rawAppointments, rawBlockedSlots] = await Promise.all([
    db
      .query("appointments")
      .withIndex("by_practiceId_start", (q) =>
        q
          .eq("practiceId", args.practiceId)
          .gte("start", queryStart)
          .lt("start", queryEnd),
      )
      .collect(),
    db
      .query("blockedSlots")
      .withIndex("by_practiceId_start", (q) =>
        q
          .eq("practiceId", args.practiceId)
          .gte("start", queryStart)
          .lt("start", queryEnd),
      )
      .collect(),
  ]);

  const appointmentCandidates =
    args.occupancyView === "live"
      ? await includeLiveAppointmentReplacements(db, rawAppointments)
      : rawAppointments;

  return findFirstCalendarOccupancyConflict({
    appointments: getEffectiveAppointmentsForOccupancyView(
      appointmentCandidates,
      args.occupancyView,
      args.draftRuleSetId,
    ),
    blockedSlots: getEffectiveBlockedSlotsForOccupancyView(
      rawBlockedSlots,
      args.occupancyView,
    ),
    candidate: args.candidate,
    excludeAppointmentIds: new Set(args.excludeAppointmentIds),
    excludeBlockedSlotIds: new Set(args.excludeBlockedSlotIds),
  });
}

export function getEffectiveAppointmentReplacementView<
  T extends AppointmentReplacementRecord,
>(
  appointments: T[],
  args: {
    draftRuleSetId?: Id<"ruleSets">;
    view: AppointmentReplacementView;
  },
): T[] {
  const liveAppointments = getEffectiveLiveAppointments(appointments);
  const currentLiveAppointmentIds = new Set(
    liveAppointments.map((appointment) => appointment._id),
  );
  const requireDraftRuleSetForSimulation = args.view === "simulation";
  const validSimulationAppointments = appointments.filter((appointment) => {
    if (
      appointment.cancelledAt !== undefined ||
      appointment.isSimulation !== true
    ) {
      return false;
    }

    if (requireDraftRuleSetForSimulation && args.draftRuleSetId === undefined) {
      return false;
    }

    if (
      args.draftRuleSetId !== undefined &&
      appointment.simulationRuleSetId !== args.draftRuleSetId
    ) {
      return false;
    }

    return (
      appointment.replacesAppointmentId === undefined ||
      currentLiveAppointmentIds.has(appointment.replacesAppointmentId)
    );
  });

  if (args.view === "live") {
    return liveAppointments;
  }

  if (args.view === "all") {
    return [...liveAppointments, ...validSimulationAppointments].toSorted(
      (a, b) => a.start.localeCompare(b.start),
    );
  }

  const simulationReplacedLiveAppointmentIds = new Set(
    validSimulationAppointments
      .map((appointment) => appointment.replacesAppointmentId)
      .filter((id): id is Id<"appointments"> => id !== undefined),
  );
  const visibleLiveAppointments = liveAppointments.filter(
    (appointment) => !simulationReplacedLiveAppointmentIds.has(appointment._id),
  );

  return [...visibleLiveAppointments, ...validSimulationAppointments].toSorted(
    (a, b) => a.start.localeCompare(b.start),
  );
}

export function getEffectiveAppointmentsForOccupancyView(
  appointments: Doc<"appointments">[],
  occupancyView: AppointmentOccupancyView,
  draftRuleSetId?: Id<"ruleSets">,
): Doc<"appointments">[] {
  const visibleAppointments = appointments.filter(
    (appointment) => appointment.cancelledAt === undefined,
  );

  return getEffectiveAppointmentReplacementView(visibleAppointments, {
    ...(draftRuleSetId === undefined ? {} : { draftRuleSetId }),
    view: occupancyView === "live" ? "live" : "simulation",
  });
}

export function getEffectiveLiveAppointments<
  T extends AppointmentReplacementRecord,
>(appointments: T[]): T[] {
  const liveAppointments = appointments.filter(
    (appointment) =>
      appointment.cancelledAt === undefined &&
      appointment.isSimulation !== true,
  );
  const replacedLiveAppointmentIds = new Set<Id<"appointments">>();
  for (const appointment of liveAppointments) {
    if (appointment.replacesAppointmentId !== undefined) {
      replacedLiveAppointmentIds.add(appointment.replacesAppointmentId);
    }
  }

  return liveAppointments
    .filter((appointment) => !replacedLiveAppointmentIds.has(appointment._id))
    .toSorted((a, b) => a.start.localeCompare(b.start));
}

export function getOccupancyViewForBookingScope(
  scope: AppointmentBookingScope,
): AppointmentOccupancyView {
  return scope === "simulation" ? "draftEffective" : "live";
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
          practitionerKey: blockedSlot.practitionerLineageKey,
          start: blockedSlot.start,
        },
        args.candidate,
      ),
  );
  return blockedSlotConflict
    ? { kind: "blockedSlot", record: blockedSlotConflict }
    : null;
}

function getCalendarOccupancyQueryWindow(
  candidate: AppointmentConflictCandidate,
) {
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

async function includeLiveAppointmentReplacements(
  db: DatabaseLike,
  appointments: Doc<"appointments">[],
): Promise<Doc<"appointments">[]> {
  let candidateIds = appointments
    .filter(
      (appointment) =>
        appointment.cancelledAt === undefined &&
        appointment.isSimulation !== true,
    )
    .map((appointment) => appointment._id);
  const seenIds = new Set(candidateIds);
  const replacements: Doc<"appointments">[] = [];

  while (candidateIds.length > 0) {
    const replacementBatches = await Promise.all(
      candidateIds.map((appointmentId) =>
        db
          .query("appointments")
          .withIndex("by_replacesAppointmentId", (q) =>
            q.eq("replacesAppointmentId", appointmentId),
          )
          .collect(),
      ),
    );
    const liveReplacements = replacementBatches
      .flat()
      .filter(
        (appointment) =>
          appointment.cancelledAt === undefined &&
          appointment.isSimulation !== true &&
          !seenIds.has(appointment._id),
      );

    for (const replacement of liveReplacements) {
      seenIds.add(replacement._id);
    }
    replacements.push(...liveReplacements);
    candidateIds = liveReplacements.map((appointment) => appointment._id);
  }

  return [...appointments, ...replacements];
}

function overlapsCalendarOccupancyCandidate(
  existing: {
    end: string;
    locationKey: string;
    practitionerKey: string | undefined;
    start: string;
  },
  candidate: AppointmentConflictCandidate,
): boolean {
  if (existing.locationKey !== candidate.locationLineageKey) {
    return false;
  }

  if (
    existing.practitionerKey !== undefined &&
    candidate.practitionerLineageKey !== undefined &&
    existing.practitionerKey !== candidate.practitionerLineageKey
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
