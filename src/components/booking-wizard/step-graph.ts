/**
 * Step Navigation Graph
 *
 * Defines the navigation structure for the booking wizard.
 * This provides a single source of truth for:
 * - Which step comes before/after each step
 * - Whether back navigation is allowed from each step
 * - Step metadata for progress indicators
 *
 * Benefits:
 * - Easy to understand the flow at a glance
 * - Reduces scattered navigation logic
 * - Enables a unified goBack mutation
 */

import type { BookingSessionState } from "./types";

export interface StepGraphNode {
  /** Whether user can navigate back from this step */
  canGoBack: boolean;
  /** Human-readable label for this step */
  label: string;
  /** The previous step(s) this step came from - undefined means it's a root step */
  prev?: StepName | StepName[];
}

export type StepName = BookingSessionState["step"];

/**
 * The complete step graph defining navigation relationships.
 *
 * Visual flow:
 *
 * privacy → location → patient-status ─┬─→ new-age-check → new-insurance-type ─┬─→ new-gkv-details ──────────────────────────────────┬─→ new-appointment-type → new-data-input → new-calendar-selection → new-confirmation
 *                                       │                                       └─→ new-pvs-consent → new-pkv-details ───────────────┘
 *                                       │
 *                                       └─→ existing-doctor-selection → existing-appointment-type → existing-data-input → existing-calendar-selection → existing-confirmation
 *                                           (no back after this point in existing flow)
 */
export const STEP_GRAPH: Record<StepName, StepGraphNode> = {
  // Step 1: Privacy consent (initial state)
  privacy: {
    canGoBack: false,
    label: "Datenschutz",
  },

  // Step 2: Location selection
  location: {
    canGoBack: true,
    label: "Standort",
    prev: "privacy",
  },

  // Step 3: Patient status selection (new or existing)
  "patient-status": {
    canGoBack: true,
    label: "Patientenstatus",
    prev: "location",
  },

  // ============================================================================
  // PATH A: NEW PATIENT
  // ============================================================================

  // A1: Age check
  "new-age-check": {
    canGoBack: true,
    label: "Altersabfrage",
    prev: "patient-status",
  },

  // A2: Insurance type selection
  "new-insurance-type": {
    canGoBack: true,
    label: "Versicherungsart",
    prev: "new-age-check",
  },

  // A3a: GKV details
  "new-gkv-details": {
    canGoBack: true,
    label: "Kassendetails",
    prev: "new-insurance-type",
  },

  // A3b-1: PKV PVS consent
  "new-pvs-consent": {
    canGoBack: true,
    label: "PVS-Einwilligung",
    prev: "new-insurance-type",
  },

  // A3b-2: PKV details (after PVS consent)
  "new-pkv-details": {
    canGoBack: true,
    label: "Privatversicherung",
    prev: "new-pvs-consent",
  },

  // A4: Appointment type selection (can come from GKV or PKV details)
  "new-appointment-type": {
    canGoBack: true,
    label: "Termingrund",
    prev: ["new-gkv-details", "new-pkv-details"],
  },

  // A5: Personal data input
  "new-data-input": {
    canGoBack: true,
    label: "Persönliche Daten",
    prev: "new-appointment-type",
  },

  // A6: Calendar selection
  "new-calendar-selection": {
    canGoBack: true,
    label: "Terminauswahl",
    prev: "new-data-input",
  },

  // A7: Confirmation (final step - no back)
  "new-confirmation": {
    canGoBack: false,
    label: "Bestätigung",
    prev: "new-calendar-selection",
  },

  // ============================================================================
  // PATH B: EXISTING PATIENT
  // ============================================================================

  // B1: Doctor selection
  "existing-doctor-selection": {
    canGoBack: true,
    label: "Arztauswahl",
    prev: "patient-status",
  },

  // B2: Appointment type selection - NO GOING BACK after this point!
  "existing-appointment-type": {
    canGoBack: false,
    label: "Termingrund",
    prev: "existing-doctor-selection",
  },

  // B3: Personal data input
  "existing-data-input": {
    canGoBack: false,
    label: "Persönliche Daten",
    prev: "existing-appointment-type",
  },

  // B4: Calendar selection
  "existing-calendar-selection": {
    canGoBack: false,
    label: "Terminauswahl",
    prev: "existing-data-input",
  },

  // B5: Confirmation
  "existing-confirmation": {
    canGoBack: false,
    label: "Bestätigung",
    prev: "existing-calendar-selection",
  },
} as const;

/**
 * Get the previous step for a given current step.
 * Returns undefined if there is no previous step (root step).
 *
 * For steps with multiple possible previous steps (like new-appointment-type),
 * you need to provide the current state to determine which one to return to.
 */
export function getPreviousStep(
  currentStep: StepName,
  state?: BookingSessionState,
): StepName | undefined {
  const node = STEP_GRAPH[currentStep];

  if (!node.canGoBack || !node.prev) {
    return undefined;
  }

  // If there's a single previous step, return it
  if (!Array.isArray(node.prev)) {
    return node.prev;
  }

  // For steps with multiple predecessors, we need state to determine which one
  if (!state) {
    // Default to first option if no state provided
    return node.prev[0];
  }

  // Determine correct predecessor based on state
  if (
    currentStep === "new-appointment-type" && // Check if we came from GKV or PKV path
    "insuranceType" in state
  ) {
    return state.insuranceType === "gkv"
      ? "new-gkv-details"
      : "new-pkv-details";
  }

  // Default to first option
  return node.prev[0];
}

/**
 * Check if back navigation is allowed from the current step.
 */
export function canNavigateBack(step: StepName): boolean {
  return STEP_GRAPH[step].canGoBack;
}

/**
 * Get the label for a step.
 */
export function getStepLabel(step: StepName): string {
  return STEP_GRAPH[step].label;
}

/**
 * Assert a value is never (for exhaustive switch statements).
 * Will cause a compile error if not all cases are handled.
 */
export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${String(x)}`);
}
