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

  return findFirstCalendarOccupancyConflict({
    appointments: getEffectiveAppointmentsForOccupancyView(
      rawAppointments,
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

  const realAppointments = visibleAppointments.filter(
    (appointment) =>
      appointment.isSimulation !== true && !replacedIds.has(appointment._id),
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
