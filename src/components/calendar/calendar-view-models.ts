import type { AppointmentResult } from "../../../convex/appointments";
import type { Appointment } from "./types";

import { formatTime, safeParseISOToZoned } from "../../utils/time-calculations";
import { APPOINTMENT_COLORS } from "./types";

export function buildCalendarAppointments(args: {
  appointments: readonly AppointmentResult[];
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
        column: appointment.practitionerId || "ekg",
        convexId: appointment._id,
        duration,
        id: appointment._id,
        isSimulation: appointment.isSimulation === true,
        ...(patientName && { patientName }),
        replacesAppointmentId: appointment.replacesAppointmentId ?? null,
        resource: {
          appointmentTypeId: appointment.appointmentTypeId,
          isSimulation: appointment.isSimulation === true,
          locationId: appointment.locationId,
          patientId: appointment.patientId,
          practitionerId: appointment.practitionerId,
          seriesId: appointment.seriesId,
          userId: appointment.userId,
        },
        startTime: formatTime(startZoned.toPlainTime()),
        title: appointment.title,
      };
    })
    .filter((appointment): appointment is Appointment => appointment !== null);
}
