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
  "existing-calendar-selection": "Terminauswahl",
  "existing-confirmation": "Bestätigung",
  "existing-data-input": "Persönliche Daten",
  "existing-data-input-complete": "Persönliche Daten",
  "existing-doctor-selection": "Arztauswahl",
  location: "Standort",
  "new-calendar-selection": "Terminauswahl",
  "new-confirmation": "Bestätigung",
  "new-data-input": "Persönliche Daten",
  "new-data-input-complete": "Persönliche Daten",
  "new-gkv-details": "Kassendetails",
  "new-gkv-details-complete": "Kassendetails",
  "new-insurance-type": "Versicherungsart",
  "new-pkv-details": "Privatversicherung",
  "new-pkv-details-complete": "Privatversicherung",
  "new-pvs-consent": "PVS-Einwilligung",
  "patient-status": "Patientenstatus",
  privacy: "Datenschutz",
};

// Group steps for progress indicator
export type StepGroup = "booking" | "confirmation" | "consent" | "info";

const STEP_GROUP_BY_STEP: Record<BookingSessionState["step"], StepGroup> = {
  "existing-calendar-selection": "booking",
  "existing-confirmation": "confirmation",
  "existing-data-input": "info",
  "existing-data-input-complete": "info",
  "existing-doctor-selection": "info",
  location: "consent",
  "new-calendar-selection": "booking",
  "new-confirmation": "confirmation",
  "new-data-input": "info",
  "new-data-input-complete": "info",
  "new-gkv-details": "info",
  "new-gkv-details-complete": "info",
  "new-insurance-type": "info",
  "new-pkv-details": "info",
  "new-pkv-details-complete": "info",
  "new-pvs-consent": "consent",
  "patient-status": "info",
  privacy: "consent",
};

export function getStepGroup(step: BookingSessionState["step"]): StepGroup {
  return STEP_GROUP_BY_STEP[step];
}

// Check if we can go back from a given step
// Cannot go back once you've passed doctor selection in existing patient flow
export function canGoBack(step: BookingSessionState["step"]): boolean {
  switch (step) {
    // After doctor selection, cannot go back
    case "existing-calendar-selection":
    case "existing-confirmation":
    case "existing-data-input":
    case "existing-data-input-complete": {
      return false;
    }
    case "new-calendar-selection": {
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
