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
  return calendarOccupancyOverlapsCandidate(
    {
      end: appointment.end,
      locationKey: appointment.locationLineageKey,
      practitionerKey: appointment.practitionerLineageKey,
      start: appointment.start,
    },
    candidate,
  );
}

export function blockedSlotOverlapsCandidate(
  blockedSlot: Pick<
    Doc<"blockedSlots">,
    "end" | "locationId" | "practitionerId" | "start"
  >,
  candidate: AppointmentConflictCandidate,
): boolean {
  return calendarOccupancyOverlapsCandidate(
    {
      end: blockedSlot.end,
      locationKey: blockedSlot.locationId,
      practitionerKey: blockedSlot.practitionerId,
      start: blockedSlot.start,
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
  const windowStart = Temporal.ZonedDateTime.from(args.candidate.start);
  const windowEnd = Temporal.ZonedDateTime.from(args.candidate.end);
  const queryStart = windowStart
    .toPlainDate()
    .add({ days: -1 })
    .toZonedDateTime({
      plainTime: new Temporal.PlainTime(0, 0),
      timeZone: windowStart.timeZoneId,
    })
    .toString();
  const queryEnd = windowEnd
    .toPlainDate()
    .add({ days: 2 })
    .toZonedDateTime({
      plainTime: new Temporal.PlainTime(0, 0),
      timeZone: windowEnd.timeZoneId,
    })
    .toString();

  const rawAppointments = await db
    .query("appointments")
    .withIndex("by_practiceId_start", (q) =>
      q
        .eq("practiceId", args.practiceId)
        .gte("start", queryStart)
        .lt("start", queryEnd),
    )
    .collect();

  const excludeAppointmentIds = new Set(args.excludeAppointmentIds);
  const effectiveAppointments = getEffectiveAppointmentsForOccupancyView(
    rawAppointments,
    args.occupancyView,
    args.draftRuleSetId,
  );

  return (
    effectiveAppointments.find(
      (appointment) =>
        !excludeAppointmentIds.has(appointment._id) &&
        appointmentOverlapsCandidate(appointment, args.candidate),
    ) ?? null
  );
}

export async function findConflictingBlockedSlot(
  db: DatabaseLike,
  args: {
    candidate: AppointmentConflictCandidate;
    excludeBlockedSlotIds?: Id<"blockedSlots">[];
    occupancyView: AppointmentOccupancyView;
    practiceId: Id<"practices">;
  },
): Promise<Doc<"blockedSlots"> | null> {
  const windowStart = Temporal.ZonedDateTime.from(args.candidate.start);
  const windowEnd = Temporal.ZonedDateTime.from(args.candidate.end);
  const queryStart = windowStart
    .toPlainDate()
    .add({ days: -1 })
    .toZonedDateTime({
      plainTime: new Temporal.PlainTime(0, 0),
      timeZone: windowStart.timeZoneId,
    })
    .toString();
  const queryEnd = windowEnd
    .toPlainDate()
    .add({ days: 2 })
    .toZonedDateTime({
      plainTime: new Temporal.PlainTime(0, 0),
      timeZone: windowEnd.timeZoneId,
    })
    .toString();

  const rawBlockedSlots = await db
    .query("blockedSlots")
    .withIndex("by_practiceId_start", (q) =>
      q
        .eq("practiceId", args.practiceId)
        .gte("start", queryStart)
        .lt("start", queryEnd),
    )
    .collect();

  const excludeBlockedSlotIds = new Set(args.excludeBlockedSlotIds);
  const effectiveBlockedSlots = getEffectiveBlockedSlotsForOccupancyView(
    rawBlockedSlots,
    args.occupancyView,
  );

  return (
    effectiveBlockedSlots.find(
      (blockedSlot) =>
        !excludeBlockedSlotIds.has(blockedSlot._id) &&
        blockedSlotOverlapsCandidate(blockedSlot, args.candidate),
    ) ?? null
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

function calendarOccupancyOverlapsCandidate(
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

  if (existing.practitionerKey !== candidate.practitionerLineageKey) {
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
