import type { FunctionArgs } from "convex/server";

import { Temporal } from "temporal-polyfill";

import type { Id } from "../../../convex/_generated/dataModel";
import type { PatientInfo } from "../../types";
import type { CalendarAppointmentPlacement } from "./types";

import { api } from "../../../convex/_generated/api";
import { TIMEZONE } from "./use-calendar-logic-helpers";

export type CalendarAppointmentCreateResult =
  | {
      kind: "error";
      message: string;
    }
  | {
      kind: "missing-patient";
      requestContext: {
        appointmentTypeLineageKey: Id<"appointmentTypes">;
        isSimulation: boolean;
        placement: CalendarAppointmentPlacement;
        practiceId: Id<"practices">;
        start: string;
        title: string;
      };
    }
  | {
      kind: "ok";
      request: CreateAppointmentArgs;
    };

type CreateAppointmentArgs = FunctionArgs<
  typeof api.appointments.createAppointment
>;

export function buildCalendarAppointmentRequest(args: {
  appointmentTypeId: Id<"appointmentTypes"> | undefined;
  appointmentTypeLineageKey: Id<"appointmentTypes"> | undefined;
  appointmentTypeName: string | undefined;
  businessStartHour: number;
  isNewPatient: boolean;
  locationId: Id<"locations"> | undefined;
  mode: "real" | "simulation";
  patient: PatientInfo | undefined;
  pendingAppointmentTitle: string | undefined;
  placement: CalendarAppointmentPlacement | undefined;
  practiceId: Id<"practices"> | undefined;
  practitionerId: Id<"practitioners"> | undefined;
  selectedDate: Temporal.PlainDate;
  slot: number;
  slotDurationMinutes: number;
}): CalendarAppointmentCreateResult {
  if (
    !args.appointmentTypeId ||
    !args.appointmentTypeLineageKey ||
    !args.appointmentTypeName
  ) {
    return {
      kind: "error",
      message: "Die Terminart konnte nicht geladen werden.",
    };
  }

  if (!args.locationId || !args.placement) {
    return {
      kind: "error",
      message: "Bitte wählen Sie zuerst einen Standort aus.",
    };
  }

  if (!args.practiceId) {
    return {
      kind: "error",
      message: "Praxis nicht gefunden",
    };
  }

  let startISO: string;
  try {
    const minutesFromStart =
      args.businessStartHour * 60 + args.slot * args.slotDurationMinutes;
    const hours = Math.floor(minutesFromStart / 60);
    const minutes = minutesFromStart % 60;
    const plainTime = new Temporal.PlainTime(hours, minutes);
    startISO = args.selectedDate
      .toZonedDateTime({
        plainTime,
        timeZone: TIMEZONE,
      })
      .toString();
  } catch {
    return {
      kind: "error",
      message: "Die Startzeit konnte nicht berechnet werden.",
    };
  }

  const title = args.pendingAppointmentTitle || args.appointmentTypeName;
  const temporaryPatient =
    args.patient?.recordType === "temporary" &&
    args.patient.convexPatientId === undefined &&
    args.patient.name.trim().length > 0 &&
    args.patient.phoneNumber.trim().length > 0
      ? args.patient
      : null;
  const hasTemporaryPatientDraft = temporaryPatient !== null;

  if (
    !args.patient?.convexPatientId &&
    !args.patient?.userId &&
    !hasTemporaryPatientDraft
  ) {
    return {
      kind: "missing-patient",
      requestContext: {
        appointmentTypeLineageKey: args.appointmentTypeLineageKey,
        isSimulation: args.mode === "simulation",
        placement: args.placement,
        practiceId: args.practiceId,
        start: startISO,
        title,
      },
    };
  }

  return {
    kind: "ok",
    request: {
      appointmentTypeId: args.appointmentTypeId,
      isNewPatient: args.isNewPatient,
      isSimulation: args.mode === "simulation",
      locationId: args.locationId,
      ...(args.patient?.dateOfBirth && {
        patientDateOfBirth: args.patient.dateOfBirth,
      }),
      ...(args.patient?.convexPatientId && {
        patientId: args.patient.convexPatientId,
      }),
      practiceId: args.practiceId,
      ...(args.placement.occupancyScope.kind === "resource"
        ? {
            calendarResourceColumn:
              args.placement.occupancyScope.calendarResourceColumn,
          }
        : {}),
      ...(args.practitionerId && { practitionerId: args.practitionerId }),
      start: startISO,
      ...(hasTemporaryPatientDraft
        ? {
            temporaryPatientName: temporaryPatient.name.trim(),
            temporaryPatientPhoneNumber: temporaryPatient.phoneNumber.trim(),
          }
        : {}),
      title,
      ...(args.patient?.userId && { userId: args.patient.userId }),
    },
  };
}
