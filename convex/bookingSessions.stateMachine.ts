import type {
  BookingSessionState,
  InternalBookingSessionState,
  InternalStateAtStep,
  StepTableName,
} from "./bookingSessions.shared";

export const STEP_SNAPSHOT_TABLES_BY_STEP: Record<
  BookingSessionState["step"],
  StepTableName[]
> = {
  "existing-calendar-selection": ["bookingExistingDataSharingSteps"],
  "existing-confirmation": ["bookingExistingConfirmationSteps"],
  "existing-data-input": ["bookingExistingDoctorSelectionSteps"],
  "existing-data-input-complete": ["bookingExistingPersonalDataSteps"],
  "existing-doctor-selection": ["bookingPatientStatusSteps"],
  location: [],
  "new-calendar-selection": ["bookingNewDataSharingSteps"],
  "new-confirmation": ["bookingNewConfirmationSteps"],
  "new-data-input": ["bookingNewGkvDetailSteps", "bookingNewPkvDetailSteps"],
  "new-data-input-complete": ["bookingNewPersonalDataSteps"],
  "new-data-sharing": [
    "bookingNewDataSharingSteps",
    "bookingNewPersonalDataSteps",
  ],
  "new-gkv-details": ["bookingNewInsuranceTypeSteps"],
  "new-gkv-details-complete": ["bookingNewGkvDetailSteps"],
  "new-insurance-type": ["bookingPatientStatusSteps"],
  "new-pkv-details": ["bookingNewPkvConsentSteps"],
  "new-pkv-details-complete": ["bookingNewPkvDetailSteps"],
  "new-pvs-consent": ["bookingNewInsuranceTypeSteps"],
  "patient-status": ["bookingLocationSteps"],
  privacy: [],
};

type StepName = BookingSessionState["step"];

interface StepNavNode {
  canGoBack: boolean;
  computePrev?: (state: InternalBookingSessionState) => null | StepName;
  prev: null | StepName;
}

const STEP_NAV_GRAPH: Record<StepName, StepNavNode> = {
  "existing-calendar-selection": { canGoBack: false, prev: null },
  "existing-confirmation": { canGoBack: false, prev: null },
  "existing-data-input": { canGoBack: false, prev: null },
  "existing-data-input-complete": { canGoBack: false, prev: null },
  "existing-doctor-selection": { canGoBack: true, prev: "patient-status" },
  location: { canGoBack: true, prev: "privacy" },
  "new-calendar-selection": { canGoBack: false, prev: null },
  "new-confirmation": { canGoBack: false, prev: null },
  "new-data-input": {
    canGoBack: true,
    computePrev: (state) =>
      "insuranceType" in state && state.insuranceType === "pkv"
        ? "new-pkv-details-complete"
        : "new-gkv-details-complete",
    prev: "new-gkv-details-complete",
  },
  "new-data-input-complete": {
    canGoBack: true,
    computePrev: (state) =>
      "insuranceType" in state && state.insuranceType === "pkv"
        ? "new-pkv-details-complete"
        : "new-gkv-details-complete",
    prev: "new-gkv-details-complete",
  },
  "new-data-sharing": { canGoBack: true, prev: "new-data-input-complete" },
  "new-gkv-details": { canGoBack: true, prev: "new-insurance-type" },
  "new-gkv-details-complete": { canGoBack: true, prev: "new-insurance-type" },
  "new-insurance-type": { canGoBack: true, prev: "patient-status" },
  "new-pkv-details": { canGoBack: true, prev: "new-pvs-consent" },
  "new-pkv-details-complete": { canGoBack: true, prev: "new-pvs-consent" },
  "new-pvs-consent": { canGoBack: true, prev: "new-insurance-type" },
  "patient-status": { canGoBack: true, prev: "location" },
  privacy: { canGoBack: false, prev: null },
};

export function computePreviousInternalState(
  state: InternalBookingSessionState,
): InternalBookingSessionState | null {
  const navNode = STEP_NAV_GRAPH[state.step];
  if (!navNode.canGoBack) {
    return null;
  }

  const prevStep = navNode.computePrev
    ? navNode.computePrev(state)
    : navNode.prev;

  if (!prevStep) {
    return null;
  }

  switch (prevStep) {
    case "location": {
      return { step: "location" };
    }

    case "new-data-input-complete": {
      const currentState = assertInternalStep(state, "new-data-sharing");
      return currentState.insuranceType === "gkv"
        ? toGkvDataInputCompleteState(currentState)
        : toPkvDataInputCompleteState(currentState);
    }

    case "new-gkv-details": {
      if (!("locationLineageKey" in state)) {
        throw new Error("Cannot go back: missing required fields");
      }
      return {
        insuranceType: "gkv",
        isNewPatient: true,
        locationLineageKey: state.locationLineageKey,
        step: "new-gkv-details",
      };
    }

    case "new-gkv-details-complete": {
      if (!("locationLineageKey" in state) || !("hzvStatus" in state)) {
        throw new Error("Cannot go back: missing required fields");
      }
      return {
        hzvStatus: state.hzvStatus,
        insuranceType: "gkv",
        isNewPatient: true,
        locationLineageKey: state.locationLineageKey,
        step: "new-gkv-details-complete",
      };
    }

    case "new-insurance-type": {
      if (!("locationLineageKey" in state)) {
        throw new Error("Cannot go back: missing required fields");
      }
      return {
        isNewPatient: true,
        locationLineageKey: state.locationLineageKey,
        step: "new-insurance-type",
      };
    }

    case "new-pkv-details": {
      if (!("locationLineageKey" in state)) {
        throw new Error("Cannot go back: missing required fields");
      }
      return {
        insuranceType: "pkv",
        isNewPatient: true,
        locationLineageKey: state.locationLineageKey,
        pvsConsent: true,
        step: "new-pkv-details",
      };
    }

    case "new-pkv-details-complete": {
      if (!("locationLineageKey" in state)) {
        throw new Error("Cannot go back: missing required fields");
      }
      return {
        ...("beihilfeStatus" in state
          ? { beihilfeStatus: state.beihilfeStatus }
          : {}),
        ...("pkvInsuranceType" in state
          ? { pkvInsuranceType: state.pkvInsuranceType }
          : {}),
        ...("pkvTariff" in state ? { pkvTariff: state.pkvTariff } : {}),
        insuranceType: "pkv",
        isNewPatient: true,
        locationLineageKey: state.locationLineageKey,
        pvsConsent: true,
        step: "new-pkv-details-complete",
      };
    }

    case "new-pvs-consent": {
      if (!("locationLineageKey" in state)) {
        throw new Error("Cannot go back: missing required fields");
      }
      return {
        insuranceType: "pkv",
        isNewPatient: true,
        locationLineageKey: state.locationLineageKey,
        step: "new-pvs-consent",
      };
    }

    case "patient-status": {
      if (!("locationLineageKey" in state)) {
        throw new Error("Cannot go back: missing locationId");
      }
      return {
        locationLineageKey: state.locationLineageKey,
        step: "patient-status",
      };
    }

    case "privacy": {
      return { step: "privacy" };
    }

    default: {
      return null;
    }
  }
}

function assertInternalStep<S extends InternalBookingSessionState["step"]>(
  state: InternalBookingSessionState,
  expected: S,
): InternalStateAtStep<S> {
  if (!hasInternalStep(state, expected)) {
    throw new Error(
      `Invalid step: expected '${expected}', got '${state.step}'`,
    );
  }
  return state;
}

function hasInternalStep<S extends InternalBookingSessionState["step"]>(
  state: InternalBookingSessionState,
  expected: S,
): state is InternalStateAtStep<S> {
  return state.step === expected;
}

function toGkvDataInputCompleteState(
  currentState: Extract<
    InternalStateAtStep<"new-data-sharing">,
    { insuranceType: "gkv" }
  >,
): Extract<
  InternalStateAtStep<"new-data-input-complete">,
  { insuranceType: "gkv" }
> {
  return {
    ...(currentState.medicalHistory === undefined
      ? {}
      : { medicalHistory: currentState.medicalHistory }),
    hzvStatus: currentState.hzvStatus,
    insuranceType: "gkv",
    isNewPatient: true,
    locationLineageKey: currentState.locationLineageKey,
    personalData: currentState.personalData,
    step: "new-data-input-complete",
  };
}

function toPkvDataInputCompleteState(
  currentState: Extract<
    InternalStateAtStep<"new-data-sharing">,
    { insuranceType: "pkv" }
  >,
): Extract<
  InternalStateAtStep<"new-data-input-complete">,
  { insuranceType: "pkv" }
> {
  return {
    ...(currentState.beihilfeStatus === undefined
      ? {}
      : { beihilfeStatus: currentState.beihilfeStatus }),
    ...(currentState.medicalHistory === undefined
      ? {}
      : { medicalHistory: currentState.medicalHistory }),
    ...(currentState.pkvInsuranceType === undefined
      ? {}
      : { pkvInsuranceType: currentState.pkvInsuranceType }),
    ...(currentState.pkvTariff === undefined
      ? {}
      : { pkvTariff: currentState.pkvTariff }),
    insuranceType: "pkv",
    isNewPatient: true,
    locationLineageKey: currentState.locationLineageKey,
    personalData: currentState.personalData,
    pvsConsent: true,
    step: "new-data-input-complete",
  };
}
