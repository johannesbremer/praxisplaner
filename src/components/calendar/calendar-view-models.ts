import type {
  AppointmentResult,
  BlockedSlotResult,
} from "../../../convex/appointments";
import type {
  CalendarAppointmentLayout,
  CalendarAppointmentRecord,
  CalendarAppointmentView,
  CalendarBlockedSlotRecord,
  CalendarColumnScope,
} from "./types";

import {
  asAppointmentTypeLineageKey,
  asLocationLineageKey,
  asPractitionerLineageKey,
} from "../../../convex/identity";
import { calendarColumnScopeFromAppointmentOccupancy } from "../../../lib/calendar-occupancy";
import { formatTime, safeParseISOToZoned } from "../../utils/time-calculations";
import {
  APPOINTMENT_COLORS,
  CALENDAR_APPOINTMENT_COLOR_CLASSES,
} from "./types";

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
        column: getCalendarAppointmentColumn(appointment),
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
          CALENDAR_APPOINTMENT_COLOR_CLASSES.slate,
        layout: appointment,
        ...(patientName && { patientName }),
      };
    })
    .filter(
      (appointment): appointment is CalendarAppointmentView =>
        appointment !== null,
    );
}

export function getCalendarAppointmentColumn(
  appointment: Pick<CalendarAppointmentRecord, "placement">,
): CalendarColumnScope {
  return calendarColumnScopeFromAppointmentOccupancy(
    appointment.placement.occupancyScope,
  );
}

export function toCalendarAppointmentRecord(
  appointment: AppointmentResult,
): CalendarAppointmentRecord {
  const {
    appointmentTypeId: _appointmentTypeId,
    locationId: _locationId,
    locationLineageKey,
    occupancyScope,
    practitionerId: _practitionerId,
    ...record
  } = appointment;
  void _appointmentTypeId;
  void _locationId;
  void _practitionerId;
  const locationLineageKeyValue = asLocationLineageKey(locationLineageKey);
  const placementOccupancyScope =
    occupancyScope.kind === "practitioner"
      ? {
          kind: "practitioner" as const,
          practitionerLineageKey: asPractitionerLineageKey(
            occupancyScope.practitionerLineageKey,
          ),
        }
      : occupancyScope;

  return {
    ...record,
    appointmentTypeLineageKey: asAppointmentTypeLineageKey(
      record.appointmentTypeLineageKey,
    ),
    placement: {
      locationLineageKey: locationLineageKeyValue,
      occupancyScope: placementOccupancyScope,
    },
  };
}

export function toCalendarAppointmentResult(args: {
  appointmentTypeId: AppointmentResult["appointmentTypeId"];
  locationId: AppointmentResult["locationId"];
  practitionerId?: AppointmentResult["practitionerId"];
  record: CalendarAppointmentRecord;
}): AppointmentResult {
  const { placement, ...record } = args.record;
  return {
    ...record,
    appointmentTypeId: args.appointmentTypeId,
    locationId: args.locationId,
    locationLineageKey: placement.locationLineageKey,
    occupancyScope: placement.occupancyScope,
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
    locationLineageKey,
    occupancyScope,
    practitionerId: _practitionerId,
    ...record
  } = blockedSlot;
  void _locationId;
  void _practitionerId;
  return {
    ...record,
    placement: {
      locationLineageKey: asLocationLineageKey(locationLineageKey),
      occupancyScope:
        occupancyScope.kind === "practitioner"
          ? {
              kind: "practitioner",
              practitionerLineageKey: asPractitionerLineageKey(
                occupancyScope.practitionerLineageKey,
              ),
            }
          : occupancyScope,
    },
  };
}

export function toCalendarBlockedSlotResult(args: {
  locationId: BlockedSlotResult["locationId"];
  practitionerId?: BlockedSlotResult["practitionerId"];
  record: CalendarBlockedSlotRecord;
}): BlockedSlotResult {
  const { placement, ...record } = args.record;
  return {
    ...record,
    locationId: args.locationId,
    locationLineageKey: placement.locationLineageKey,
    occupancyScope: placement.occupancyScope,
    ...(args.practitionerId === undefined
      ? {}
      : { practitionerId: args.practitionerId }),
  };
}
