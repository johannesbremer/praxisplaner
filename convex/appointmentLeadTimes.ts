import type { Infer } from "convex/values";

import { v } from "convex/values";

export const appointmentLeadTimesValidator = v.object({
  onlineMinutes: v.number(),
  staffMinutes: v.number(),
  telefonkiMinutes: v.number(),
});

export type AppointmentLeadTimes = Infer<typeof appointmentLeadTimesValidator>;

export const DEFAULT_APPOINTMENT_LEAD_TIMES: AppointmentLeadTimes = {
  onlineMinutes: 0,
  staffMinutes: 0,
  telefonkiMinutes: 0,
};

export const MAX_APPOINTMENT_LEAD_TIME_MINUTES = 30 * 24 * 60;

export function getAppointmentLeadTimeMinutesForClientType(args: {
  clientType: string;
  leadTimes: AppointmentLeadTimes | undefined;
}): number {
  const leadTimes = normalizeAppointmentLeadTimes(
    args.leadTimes ?? DEFAULT_APPOINTMENT_LEAD_TIMES,
  );
  switch (args.clientType) {
    case "MFA": {
      return leadTimes.staffMinutes;
    }
    case "Online": {
      return leadTimes.onlineMinutes;
    }
    case "Phone-AI": {
      return leadTimes.telefonkiMinutes;
    }
    default: {
      return leadTimes.onlineMinutes;
    }
  }
}

export function normalizeAppointmentLeadTimes(
  leadTimes: AppointmentLeadTimes,
): AppointmentLeadTimes {
  return {
    onlineMinutes: normalizeLeadTimeMinutes(leadTimes.onlineMinutes),
    staffMinutes: normalizeLeadTimeMinutes(leadTimes.staffMinutes),
    telefonkiMinutes: normalizeLeadTimeMinutes(leadTimes.telefonkiMinutes),
  };
}

function normalizeLeadTimeMinutes(value: number): number {
  if (!Number.isFinite(value)) {
    throw new TypeError("Termin-Vorlaufzeiten müssen gültige Zahlen sein.");
  }
  const rounded = Math.round(value);
  if (rounded < 0) {
    throw new Error("Termin-Vorlaufzeiten dürfen nicht negativ sein.");
  }
  if (rounded > MAX_APPOINTMENT_LEAD_TIME_MINUTES) {
    throw new Error(
      `Termin-Vorlaufzeiten dürfen maximal ${MAX_APPOINTMENT_LEAD_TIME_MINUTES} Minuten betragen.`,
    );
  }
  return rounded;
}
