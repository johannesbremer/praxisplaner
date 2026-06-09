export const BOOKING_SESSION_STEP_KIND = {
  "existing-calendar-selection": "calendar-selection",
  "existing-data-input": "data-input",
  "existing-doctor-selection": "doctor-selection",
  location: "location",
  "new-calendar-selection": "calendar-selection",
  "new-data-input": "data-input",
  "new-data-input-complete": "data-input",
  "new-data-sharing": "data-sharing",
  "new-gkv-details": "gkv-details",
  "new-gkv-details-complete": "gkv-details",
  "new-insurance-type": "insurance-type",
  "new-pkv-details": "pkv-details",
  "new-pkv-details-complete": "pkv-details",
  "new-pvs-consent": "pvs-consent",
  "patient-status": "patient-status",
  privacy: "privacy",
} as const;

export type BookingSessionStepKind =
  (typeof BOOKING_SESSION_STEP_KIND)[BookingSessionStepName];
export type BookingSessionStepName = keyof typeof BOOKING_SESSION_STEP_KIND;

export const STEP_LABEL_BY_KIND: Record<BookingSessionStepKind, string> = {
  "calendar-selection": "Terminauswahl",
  "data-input": "Persönliche Daten",
  "data-sharing": "Datenweitergabe",
  "doctor-selection": "Arztauswahl",
  "gkv-details": "Kassendetails",
  "insurance-type": "Versicherungsart",
  location: "Standort",
  "patient-status": "Patientenstatus",
  "pkv-details": "Privatversicherung",
  privacy: "Datenschutz",
  "pvs-consent": "PVS-Einwilligung",
};

export type BookingStepGroup = "booking" | "consent" | "info";

export const STEP_GROUP_BY_KIND: Record<
  BookingSessionStepKind,
  BookingStepGroup
> = {
  "calendar-selection": "booking",
  "data-input": "info",
  "data-sharing": "info",
  "doctor-selection": "info",
  "gkv-details": "info",
  "insurance-type": "info",
  location: "consent",
  "patient-status": "info",
  "pkv-details": "info",
  privacy: "consent",
  "pvs-consent": "consent",
};

export const LOCKED_BACK_STEPS = new Set<BookingSessionStepName>([
  "existing-calendar-selection",
  "new-calendar-selection",
  "privacy",
]);

export const CALENDAR_SELECTION_STEPS = [
  "existing-calendar-selection",
  "new-calendar-selection",
] as const;

export const DATA_INPUT_STEPS = [
  "existing-data-input",
  "new-data-input",
  "new-data-input-complete",
] as const;

export type CalendarSelectionStepName =
  (typeof CALENDAR_SELECTION_STEPS)[number];
export type DataInputStepName = (typeof DATA_INPUT_STEPS)[number];

export function getBookingSessionStepGroup(
  step: BookingSessionStepName,
): BookingStepGroup {
  return STEP_GROUP_BY_KIND[getBookingSessionStepKind(step)];
}

export function getBookingSessionStepKind(
  step: BookingSessionStepName,
): BookingSessionStepKind {
  return BOOKING_SESSION_STEP_KIND[step];
}

export function getBookingSessionStepLabel(
  step: BookingSessionStepName,
): string {
  return STEP_LABEL_BY_KIND[getBookingSessionStepKind(step)];
}

export function isBackLockedStep(step: BookingSessionStepName): boolean {
  return LOCKED_BACK_STEPS.has(step);
}

export function isCalendarSelectionStepName(
  step: BookingSessionStepName,
): step is CalendarSelectionStepName {
  return ["existing-calendar-selection", "new-calendar-selection"].includes(
    step,
  );
}

export function isDataInputStepName(
  step: BookingSessionStepName,
): step is DataInputStepName {
  return [
    "existing-data-input",
    "new-data-input",
    "new-data-input-complete",
  ].includes(step);
}
