import type {
  AppointmentResult,
  BlockedSlotResult,
} from "../../../convex/appointments";
import type {
  Appointment,
  CalendarAppointmentRecord,
  CalendarBlockedSlotRecord,
} from "./types";

import { formatTime, safeParseISOToZoned } from "../../utils/time-calculations";
import { APPOINTMENT_COLORS } from "./types";

export function buildCalendarAppointments(args: {
  appointments: readonly CalendarAppointmentRecord[];
  patientData:
    | null
    | Record<string, { firstName?: string; lastName?: string; name?: string }>
    | undefined;
  userData:
    | null
    | Record<string, { email: string; firstName?: string; lastName?: string }>
    | undefined;
}): Appointment[] {
  return args.appointments
    .map((appointment, index): Appointment | null => {
      const startZoned = safeParseISOToZoned(appointment.start);
      const endZoned = safeParseISOToZoned(appointment.end);

      if (!startZoned || !endZoned) {
        console.warn(
          `Invalid appointment dates: start=${appointment.start}, end=${appointment.end}`,
        );
        return null;
      }

      const duration = Math.round(
        startZoned.until(endZoned, { largestUnit: "minutes" }).minutes,
      );

      let patientName: string | undefined;
      if (appointment.patientId && args.patientData) {
        const patientInfo = args.patientData[appointment.patientId];
        if (patientInfo) {
          patientName =
            patientInfo.name ??
            [patientInfo.lastName, patientInfo.firstName]
              .filter(Boolean)
              .join(", ");
        }
      }

      if (!patientName && appointment.userId && args.userData) {
        const userInfo = args.userData[appointment.userId];
        if (userInfo) {
          const parts = [userInfo.lastName, userInfo.firstName].filter(Boolean);
          patientName = parts.length > 0 ? parts.join(", ") : userInfo.email;
        }
      }

      return {
        appointmentTypeTitle: appointment.appointmentTypeTitle,
        color:
          APPOINTMENT_COLORS[index % APPOINTMENT_COLORS.length] ??
          "bg-gray-500",
        column: appointment.practitionerLineageKey || "ekg",
        convexId: appointment._id,
        duration,
        id: appointment._id,
        isSimulation: appointment.isSimulation === true,
        ...(patientName && { patientName }),
        replacesAppointmentId: appointment.replacesAppointmentId ?? null,
        resource: {
          appointmentTypeLineageKey: appointment.appointmentTypeLineageKey,
          appointmentTypeTitle: appointment.appointmentTypeTitle,
          isSimulation: appointment.isSimulation === true,
          locationLineageKey: appointment.locationLineageKey,
          patientId: appointment.patientId,
          practitionerLineageKey: appointment.practitionerLineageKey,
          seriesId: appointment.seriesId,
          title: appointment.title,
          userId: appointment.userId,
        },
        startTime: formatTime(startZoned.toPlainTime()),
        title: appointment.title,
      };
    })
    .filter((appointment): appointment is Appointment => appointment !== null);
}

export function toCalendarAppointmentRecord(
  appointment: AppointmentResult,
): CalendarAppointmentRecord {
  const {
    appointmentTypeId: _appointmentTypeId,
    locationId: _locationId,
    practitionerId: _practitionerId,
    ...record
  } = appointment;
  void _appointmentTypeId;
  void _locationId;
  void _practitionerId;
  return record;
}

export function toCalendarAppointmentResult(args: {
  appointmentTypeId: AppointmentResult["appointmentTypeId"];
  locationId: AppointmentResult["locationId"];
  practitionerId?: AppointmentResult["practitionerId"];
  record: CalendarAppointmentRecord;
}): AppointmentResult {
  return {
    ...args.record,
    appointmentTypeId: args.appointmentTypeId,
    locationId: args.locationId,
    ...(args.practitionerId === undefined
      ? {}
      : { practitionerId: args.practitionerId }),
  };
}

export function toCalendarBlockedSlotRecord(
  blockedSlot: BlockedSlotResult,
): CalendarBlockedSlotRecord {
  const {
    locationId: _locationId,
    practitionerId: _practitionerId,
    ...record
  } = blockedSlot;
  void _locationId;
  void _practitionerId;
  return record;
}

export function toCalendarBlockedSlotResult(args: {
  locationId: BlockedSlotResult["locationId"];
  practitionerId?: BlockedSlotResult["practitionerId"];
  record: CalendarBlockedSlotRecord;
}): BlockedSlotResult {
  return {
    ...args.record,
    locationId: args.locationId,
    ...(args.practitionerId === undefined
      ? {}
      : { practitionerId: args.practitionerId }),
  };
}
