import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";

import { Temporal } from "temporal-polyfill";

import type { DataModel, Doc, Id } from "./_generated/dataModel";

export type AppointmentBookingScope = "real" | "simulation";
export type AppointmentOccupancyView = "draftEffective" | "live";

type DatabaseLike =
  | GenericDatabaseReader<DataModel>
  | GenericDatabaseWriter<DataModel>;

export function appointmentOverlapsCandidate(
  appointment: Pick<
    Doc<"appointments">,
    "end" | "locationLineageKey" | "practitionerLineageKey" | "start"
  >,
  candidate: {
    end: string;
    locationLineageKey: Id<"locations">;
    practitionerLineageKey?: Id<"practitioners">;
    start: string;
  },
): boolean {
  if (appointment.locationLineageKey !== candidate.locationLineageKey) {
    return false;
  }

  if (appointment.practitionerLineageKey !== candidate.practitionerLineageKey) {
    return false;
  }

  const candidateStart = Temporal.ZonedDateTime.from(
    candidate.start,
  ).epochMilliseconds;
  const candidateEnd = Temporal.ZonedDateTime.from(
    candidate.end,
  ).epochMilliseconds;
  const existingStart = Temporal.ZonedDateTime.from(
    appointment.start,
  ).epochMilliseconds;
  const existingEnd = Temporal.ZonedDateTime.from(
    appointment.end,
  ).epochMilliseconds;

  return candidateStart < existingEnd && existingStart < candidateEnd;
}

export async function findConflictingAppointment(
  db: DatabaseLike,
  args: {
    candidate: {
      end: string;
      locationLineageKey: Id<"locations">;
      practitionerLineageKey?: Id<"practitioners">;
      start: string;
    };
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

    return (
      appointment.simulationRuleSetId === undefined ||
      appointment.simulationRuleSetId === draftRuleSetId
    );
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
