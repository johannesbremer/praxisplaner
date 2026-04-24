import type {
  AppointmentResult,
  BlockedSlotResult,
} from "../../../convex/appointments";
import type {
  CalendarAppointmentLayout,
  CalendarAppointmentRecord,
  CalendarAppointmentView,
  CalendarBlockedSlotRecord,
} from "./types";

import { formatTime, safeParseISOToZoned } from "../../utils/time-calculations";
import { APPOINTMENT_COLORS } from "./types";

export function buildCalendarAppointmentLayouts(args: {
  appointments: readonly CalendarAppointmentRecord[];
}): CalendarAppointmentLayout[] {
  return args.appointments
    .map((appointment): CalendarAppointmentLayout | null => {
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

      return {
        column: appointment.practitionerLineageKey || "ekg",
        duration,
        id: appointment._id,
        record: appointment,
        startTime: formatTime(startZoned.toPlainTime()),
      };
    })
    .filter(
      (appointment): appointment is CalendarAppointmentLayout =>
        appointment !== null,
    );
}

export function buildCalendarAppointmentViews(args: {
  appointments: readonly CalendarAppointmentLayout[];
  patientData:
    | null
    | Record<string, { firstName?: string; lastName?: string; name?: string }>
    | undefined;
  userData:
    | null
    | Record<string, { email: string; firstName?: string; lastName?: string }>
    | undefined;
}): CalendarAppointmentView[] {
  return args.appointments
    .map((appointment, index): CalendarAppointmentView | null => {
      let patientName: string | undefined;
      if (appointment.record.patientId && args.patientData) {
        const patientInfo = args.patientData[appointment.record.patientId];
        if (patientInfo) {
          patientName =
            patientInfo.name ??
            [patientInfo.lastName, patientInfo.firstName]
              .filter(Boolean)
              .join(", ");
        }
      }

      if (!patientName && appointment.record.userId && args.userData) {
        const userInfo = args.userData[appointment.record.userId];
        if (userInfo) {
          const parts = [userInfo.lastName, userInfo.firstName].filter(Boolean);
          patientName = parts.length > 0 ? parts.join(", ") : userInfo.email;
        }
      }

      return {
        color:
          APPOINTMENT_COLORS[index % APPOINTMENT_COLORS.length] ??
          "bg-gray-500",
        layout: appointment,
        ...(patientName && { patientName }),
      };
    })
    .filter(
      (appointment): appointment is CalendarAppointmentView =>
        appointment !== null,
    );
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
