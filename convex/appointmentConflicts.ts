import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";

import { Temporal } from "temporal-polyfill";

import type { DataModel, Doc, Id } from "./_generated/dataModel";

export type AppointmentBookingScope = "real" | "simulation";

type DatabaseLike =
  | GenericDatabaseReader<DataModel>
  | GenericDatabaseWriter<DataModel>;

export function appointmentOverlapsCandidate(
  appointment: Pick<
    Doc<"appointments">,
    "end" | "locationId" | "practitionerId" | "start"
  >,
  candidate: {
    end: string;
    locationId: Id<"locations">;
    practitionerId?: Id<"practitioners">;
    start: string;
  },
): boolean {
  if (appointment.locationId !== candidate.locationId) {
    return false;
  }

  if (appointment.practitionerId !== candidate.practitionerId) {
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
      locationId: Id<"locations">;
      practitionerId?: Id<"practitioners">;
      start: string;
    };
    excludeAppointmentIds?: Id<"appointments">[];
    practiceId: Id<"practices">;
    scope: AppointmentBookingScope;
    simulationRuleSetId?: Id<"ruleSets">;
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
  const effectiveAppointments = getEffectiveAppointmentsForScope(
    rawAppointments,
    args.scope,
    args.simulationRuleSetId,
  );

  return (
    effectiveAppointments.find(
      (appointment) =>
        !excludeAppointmentIds.has(appointment._id) &&
        appointmentOverlapsCandidate(appointment, args.candidate),
    ) ?? null
  );
}

export function getEffectiveAppointmentsForScope(
  appointments: Doc<"appointments">[],
  scope: AppointmentBookingScope,
  simulationRuleSetId?: Id<"ruleSets">,
): Doc<"appointments">[] {
  const visibleAppointments = appointments.filter(
    (appointment) => appointment.cancelledAt === undefined,
  );

  if (scope === "real") {
    return visibleAppointments.filter(
      (appointment) => appointment.isSimulation !== true,
    );
  }

  const simulationAppointments = visibleAppointments.filter((appointment) => {
    if (appointment.isSimulation !== true) {
      return false;
    }

    if (!simulationRuleSetId) {
      return true;
    }

    return (
      appointment.simulationRuleSetId === undefined ||
      appointment.simulationRuleSetId === simulationRuleSetId
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
