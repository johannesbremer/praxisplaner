// Types for the booking wizard components

import type { Doc, Id } from "@/convex/_generated/dataModel";

// The session state from Convex
export type BookingSessionState = Doc<"bookingSessions">["state"];

// Type helper to extract state at a specific step
export type StateAtStep<S extends BookingSessionState["step"]> = Extract<
  BookingSessionState,
  { step: S }
>;

// Common props for step components
export interface StepComponentProps {
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
  sessionId: Id<"bookingSessions">;
  state: BookingSessionState;
}

// Step names mapped to readable labels
export const STEP_LABELS: Record<BookingSessionState["step"], string> = {
  "existing-appointment-type": "Termingrund",
  "existing-calendar-selection": "Terminauswahl",
  "existing-confirmation": "Bestätigung",
  "existing-data-input": "Persönliche Daten",
  "existing-doctor-selection": "Arztauswahl",
  location: "Standort",
  "new-age-check": "Altersabfrage",
  "new-appointment-type": "Termingrund",
  "new-calendar-selection": "Terminauswahl",
  "new-confirmation": "Bestätigung",
  "new-data-input": "Persönliche Daten",
  "new-gkv-details": "Kassendetails",
  "new-insurance-type": "Versicherungsart",
  "new-pkv-details": "Privatversicherung",
  "new-pvs-consent": "PVS-Einwilligung",
  "patient-status": "Patientenstatus",
  privacy: "Datenschutz",
};

// Group steps for progress indicator
export type StepGroup = "booking" | "confirmation" | "consent" | "info";

// Helper for exhaustive switch checks - errors at compile time if a case is missing
export function getStepGroup(step: BookingSessionState["step"]): StepGroup {
  switch (step) {
    case "existing-appointment-type":
    case "existing-data-input":
    case "existing-doctor-selection":
    case "new-age-check":
    case "new-appointment-type":
    case "new-data-input":
    case "new-gkv-details":
    case "new-insurance-type":
    case "new-pkv-details":
    case "patient-status": {
      return "info";
    }
    case "existing-calendar-selection":
    case "new-calendar-selection": {
      return "booking";
    }
    case "existing-confirmation":
    case "new-confirmation": {
      return "confirmation";
    }
    case "location":
    case "new-pvs-consent":
    case "privacy": {
      return "consent";
    }
    default: {
      return assertNever(step, "Unhandled step in getStepGroup");
    }
  }
}

function assertNever(value: never, message: string): never {
  throw new Error(`${message}: ${value as string}`);
}

// Check if we can go back from a given step
// Cannot go back once you've passed doctor selection in existing patient flow
export function canGoBack(step: BookingSessionState["step"]): boolean {
  switch (step) {
    // After doctor selection, cannot go back
    case "existing-appointment-type":
    case "existing-calendar-selection":
    case "existing-confirmation":
    case "existing-data-input": {
      return false;
    }
    // After confirmation, cannot go back
    case "new-confirmation": {
      return false;
    }
    case "privacy": {
      return false;
    }
    default: {
      return true;
    }
  }
}
