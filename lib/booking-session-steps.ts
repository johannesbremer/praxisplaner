export const BOOKING_SESSION_STEP_KIND = {
  "existing-calendar-selection": "calendar-selection",
  "existing-confirmation": "confirmation",
  "existing-data-input": "data-input",
  "existing-doctor-selection": "doctor-selection",
  location: "location",
  "new-calendar-selection": "calendar-selection",
  "new-confirmation": "confirmation",
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
  confirmation: "Bestätigung",
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

export type BookingStepGroup = "booking" | "confirmation" | "consent" | "info";

export const STEP_GROUP_BY_KIND: Record<
  BookingSessionStepKind,
  BookingStepGroup
> = {
  "calendar-selection": "booking",
  confirmation: "confirmation",
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
  "existing-confirmation",
  "existing-data-input",
  "new-calendar-selection",
  "new-confirmation",
  "privacy",
]);

export const CALENDAR_SELECTION_STEPS = [
  "existing-calendar-selection",
  "new-calendar-selection",
] as const;

export const CONFIRMATION_STEPS = [
  "existing-confirmation",
  "new-confirmation",
] as const;

export const DATA_INPUT_STEPS = [
  "existing-data-input",
  "new-data-input",
  "new-data-input-complete",
] as const;

export type CalendarSelectionStepName =
  (typeof CALENDAR_SELECTION_STEPS)[number];
export type ConfirmationStepName = (typeof CONFIRMATION_STEPS)[number];
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

export function getCalendarSelectionStepForConfirmationStep(
  step: ConfirmationStepName,
): CalendarSelectionStepName {
  return step === "new-confirmation"
    ? "new-calendar-selection"
    : "existing-calendar-selection";
}

export function isBackLockedStep(step: BookingSessionStepName): boolean {
  return LOCKED_BACK_STEPS.has(step);
}

export function isCalendarSelectionStepName(
  step: BookingSessionStepName,
): step is CalendarSelectionStepName {
  return (
    step === "existing-calendar-selection" || step === "new-calendar-selection"
  );
}

export function isConfirmationStepName(
  step: BookingSessionStepName,
): step is ConfirmationStepName {
  return step === "existing-confirmation" || step === "new-confirmation";
}

export function isDataInputStepName(
  step: BookingSessionStepName,
): step is DataInputStepName {
  return (
    step === "existing-data-input" ||
    step === "new-data-input" ||
    step === "new-data-input-complete"
  );
}
