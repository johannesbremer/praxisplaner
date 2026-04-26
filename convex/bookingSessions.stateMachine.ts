import { type GenericValidator } from "convex/values";

import type {
  BookingPersonalData,
  BookingSessionState,
  DataSharingContact,
  InternalBookingSessionState,
  InternalStateAtStep,
  StateAtStep,
  StepTableInput,
  StepTableName,
} from "./bookingSessions.shared";

import { isIsoDateString, isZonedDateTimeString } from "../lib/typed-regex.js";
import { bookingSessionStepValidator } from "./schema";

const STEP_SNAPSHOT_TABLES_BY_STEP: Record<
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

const STEP_SNAPSHOT_ALLOWED_FIELDS: Record<
  BookingSessionState["step"],
  string[]
> = {
  "existing-calendar-selection": [
    "isNewPatient",
    "locationLineageKey",
    "locationName",
    "practitionerLineageKey",
    "practitionerName",
    "personalData",
    "dataSharingContacts",
  ],
  "existing-confirmation": [
    "appointmentId",
    "appointmentTypeLineageKey",
    "appointmentTypeName",
    "bookedDurationMinutes",
    "isNewPatient",
    "locationLineageKey",
    "locationName",
    "practitionerLineageKey",
    "practitionerName",
    "personalData",
    "dataSharingContacts",
    "reasonDescription",
    "selectedSlot",
    "patientId",
  ],
  "existing-data-input": [
    "isNewPatient",
    "locationLineageKey",
    "locationName",
    "practitionerLineageKey",
    "practitionerName",
  ],
  "existing-data-input-complete": [
    "isNewPatient",
    "locationLineageKey",
    "locationName",
    "practitionerLineageKey",
    "practitionerName",
    "personalData",
  ],
  "existing-doctor-selection": [
    "isNewPatient",
    "locationLineageKey",
    "locationName",
  ],
  location: [],
  "new-calendar-selection": [
    "insuranceType",
    "isNewPatient",
    "locationLineageKey",
    "locationName",
    "hzvStatus",
    "pvsConsent",
    "pkvInsuranceType",
    "pkvTariff",
    "beihilfeStatus",
    "personalData",
    "medicalHistory",
    "dataSharingContacts",
  ],
  "new-confirmation": [
    "appointmentId",
    "appointmentTypeLineageKey",
    "appointmentTypeName",
    "bookedDurationMinutes",
    "insuranceType",
    "isNewPatient",
    "locationLineageKey",
    "locationName",
    "hzvStatus",
    "pvsConsent",
    "pkvInsuranceType",
    "pkvTariff",
    "beihilfeStatus",
    "personalData",
    "medicalHistory",
    "dataSharingContacts",
    "reasonDescription",
    "emergencyContacts",
    "selectedSlot",
    "patientId",
  ],
  "new-data-input": [
    "insuranceType",
    "isNewPatient",
    "locationLineageKey",
    "locationName",
    "hzvStatus",
    "pvsConsent",
    "pkvInsuranceType",
    "pkvTariff",
    "beihilfeStatus",
  ],
  "new-data-input-complete": [
    "insuranceType",
    "isNewPatient",
    "locationLineageKey",
    "locationName",
    "hzvStatus",
    "pvsConsent",
    "pkvInsuranceType",
    "pkvTariff",
    "beihilfeStatus",
    "personalData",
    "medicalHistory",
  ],
  "new-data-sharing": [
    "insuranceType",
    "isNewPatient",
    "locationLineageKey",
    "locationName",
    "hzvStatus",
    "pvsConsent",
    "pkvInsuranceType",
    "pkvTariff",
    "beihilfeStatus",
    "personalData",
    "medicalHistory",
  ],
  "new-gkv-details": [
    "insuranceType",
    "isNewPatient",
    "locationLineageKey",
    "locationName",
  ],
  "new-gkv-details-complete": [
    "insuranceType",
    "isNewPatient",
    "locationLineageKey",
    "locationName",
    "hzvStatus",
  ],
  "new-insurance-type": ["isNewPatient", "locationLineageKey", "locationName"],
  "new-pkv-details": [
    "insuranceType",
    "isNewPatient",
    "locationLineageKey",
    "locationName",
    "pvsConsent",
  ],
  "new-pkv-details-complete": [
    "insuranceType",
    "isNewPatient",
    "locationLineageKey",
    "locationName",
    "pvsConsent",
    "pkvInsuranceType",
    "pkvTariff",
    "beihilfeStatus",
  ],
  "new-pvs-consent": [
    "insuranceType",
    "isNewPatient",
    "locationLineageKey",
    "locationName",
  ],
  "patient-status": ["locationLineageKey", "locationName"],
  privacy: [],
};

const STEP_SNAPSHOT_ALLOWED_INTERNAL_FIELDS: Record<
  InternalBookingSessionState["step"],
  string[]
> = {
  "existing-calendar-selection": [
    "isNewPatient",
    "locationLineageKey",
    "practitionerLineageKey",
    "personalData",
    "dataSharingContacts",
  ],
  "existing-confirmation": [
    "appointmentId",
    "appointmentTypeLineageKey",
    "bookedDurationMinutes",
    "isNewPatient",
    "locationLineageKey",
    "practitionerLineageKey",
    "personalData",
    "dataSharingContacts",
    "reasonDescription",
    "selectedSlot",
    "patientId",
  ],
  "existing-data-input": [
    "isNewPatient",
    "locationLineageKey",
    "practitionerLineageKey",
  ],
  "existing-data-input-complete": [
    "isNewPatient",
    "locationLineageKey",
    "practitionerLineageKey",
    "personalData",
  ],
  "existing-doctor-selection": ["isNewPatient", "locationLineageKey"],
  location: [],
  "new-calendar-selection": [
    "insuranceType",
    "isNewPatient",
    "locationLineageKey",
    "hzvStatus",
    "pvsConsent",
    "pkvInsuranceType",
    "pkvTariff",
    "beihilfeStatus",
    "personalData",
    "medicalHistory",
    "dataSharingContacts",
  ],
  "new-confirmation": [
    "appointmentId",
    "appointmentTypeLineageKey",
    "bookedDurationMinutes",
    "insuranceType",
    "isNewPatient",
    "locationLineageKey",
    "hzvStatus",
    "pvsConsent",
    "pkvInsuranceType",
    "pkvTariff",
    "beihilfeStatus",
    "personalData",
    "medicalHistory",
    "dataSharingContacts",
    "reasonDescription",
    "emergencyContacts",
    "selectedSlot",
    "patientId",
  ],
  "new-data-input": [
    "insuranceType",
    "isNewPatient",
    "locationLineageKey",
    "hzvStatus",
    "pvsConsent",
    "pkvInsuranceType",
    "pkvTariff",
    "beihilfeStatus",
  ],
  "new-data-input-complete": [
    "insuranceType",
    "isNewPatient",
    "locationLineageKey",
    "hzvStatus",
    "pvsConsent",
    "pkvInsuranceType",
    "pkvTariff",
    "beihilfeStatus",
    "personalData",
    "medicalHistory",
  ],
  "new-data-sharing": [
    "insuranceType",
    "isNewPatient",
    "locationLineageKey",
    "hzvStatus",
    "pvsConsent",
    "pkvInsuranceType",
    "pkvTariff",
    "beihilfeStatus",
    "personalData",
    "medicalHistory",
  ],
  "new-gkv-details": ["insuranceType", "isNewPatient", "locationLineageKey"],
  "new-gkv-details-complete": [
    "insuranceType",
    "isNewPatient",
    "locationLineageKey",
    "hzvStatus",
  ],
  "new-insurance-type": ["isNewPatient", "locationLineageKey"],
  "new-pkv-details": [
    "insuranceType",
    "isNewPatient",
    "locationLineageKey",
    "pvsConsent",
  ],
  "new-pkv-details-complete": [
    "insuranceType",
    "isNewPatient",
    "locationLineageKey",
    "pvsConsent",
    "pkvInsuranceType",
    "pkvTariff",
    "beihilfeStatus",
  ],
  "new-pvs-consent": ["insuranceType", "isNewPatient", "locationLineageKey"],
  "patient-status": ["locationLineageKey"],
  privacy: [],
};

const PKV_STEPS_REQUIRING_PVS_CONSENT = new Set<BookingSessionState["step"]>([
  "new-calendar-selection",
  "new-confirmation",
  "new-data-input",
  "new-data-input-complete",
  "new-data-sharing",
  "new-pkv-details",
  "new-pkv-details-complete",
]);

export interface BookingSessionMaterializers {
  resolveAppointmentTypeName: (
    appointmentTypeLineageKey: Extract<
      InternalBookingSessionState,
      { appointmentTypeLineageKey: unknown }
    >["appointmentTypeLineageKey"],
  ) => Promise<string>;
  resolveLocationName: (
    locationLineageKey: Extract<
      InternalBookingSessionState,
      { locationLineageKey: unknown }
    >["locationLineageKey"],
  ) => Promise<string>;
  resolvePractitionerName: (
    practitionerLineageKey: Extract<
      InternalBookingSessionState,
      { practitionerLineageKey: unknown }
    >["practitionerLineageKey"],
  ) => Promise<string>;
}

export interface BookingSessionTransition {
  nextStep: BookingSessionState["step"];
  writes: StepSnapshotWrite[];
}

export type BookingSessionTransitionInput =
  | {
      base: StepBase;
      dataSharingContacts: DataSharingContact[];
      kind: "submitExistingDataSharing";
      state: InternalBookingSessionState;
    }
  | {
      base: StepBase;
      dataSharingContacts: DataSharingContact[];
      kind: "submitNewDataSharing";
      personalData: BookingPersonalData;
      state: InternalBookingSessionState;
    }
  | {
      base: StepBase;
      details: {
        beihilfeStatus?: StepTableInput<"bookingNewPkvDetailSteps">["beihilfeStatus"];
        pkvInsuranceType?: StepTableInput<"bookingNewPkvDetailSteps">["pkvInsuranceType"];
        pkvTariff?: StepTableInput<"bookingNewPkvDetailSteps">["pkvTariff"];
      };
      kind: "confirmPkvDetails";
      state: InternalBookingSessionState;
    }
  | {
      base: StepBase;
      hzvStatus: StepTableInput<"bookingNewGkvDetailSteps">["hzvStatus"];
      kind: "confirmGkvDetails";
      state: InternalBookingSessionState;
    }
  | {
      base: StepBase;
      insuranceType: StepTableInput<"bookingNewInsuranceTypeSteps">["insuranceType"];
      kind: "selectInsuranceType";
      state: InternalBookingSessionState;
    }
  | {
      base: StepBase;
      kind: "acceptPrivacy";
      state: InternalBookingSessionState;
    }
  | {
      base: StepBase;
      kind: "acceptPvsConsent";
      state: InternalBookingSessionState;
    }
  | {
      base: StepBase;
      kind: "selectDoctor";
      practitionerLineageKey: StepTableInput<"bookingExistingDoctorSelectionSteps">["practitionerLineageKey"];
      state: InternalBookingSessionState;
    }
  | {
      base: StepBase;
      kind: "selectExistingPatient";
      state: InternalBookingSessionState;
    }
  | {
      base: StepBase;
      kind: "selectExistingPatientSlot";
      slotAttempt: Pick<
        StepTableInput<"bookingExistingConfirmationSteps">,
        | "appointmentId"
        | "appointmentTypeLineageKey"
        | "bookedDurationMinutes"
        | "reasonDescription"
        | "selectedSlot"
      > & { personalData: BookingPersonalData };
      state: InternalBookingSessionState;
    }
  | {
      base: StepBase;
      kind: "selectLocation";
      locationLineageKey: StepTableInput<"bookingLocationSteps">["locationLineageKey"];
      state: InternalBookingSessionState;
    }
  | {
      base: StepBase;
      kind: "selectNewPatient";
      state: InternalBookingSessionState;
    }
  | {
      base: StepBase;
      kind: "selectNewPatientSlot";
      slotAttempt: Pick<
        StepTableInput<"bookingNewConfirmationSteps">,
        | "appointmentId"
        | "appointmentTypeLineageKey"
        | "bookedDurationMinutes"
        | "reasonDescription"
        | "selectedSlot"
      > & { personalData: BookingPersonalData };
      state: InternalBookingSessionState;
    }
  | {
      base: StepBase;
      kind: "submitExistingPatientData";
      personalData: BookingPersonalData;
      state: InternalBookingSessionState;
    }
  | {
      base: StepBase;
      kind: "submitNewPatientData";
      medicalHistory?: StepTableInput<"bookingNewPersonalDataSteps">["medicalHistory"];
      personalData: BookingPersonalData;
      state: InternalBookingSessionState;
    };

type StepBase = Pick<
  StepTableInput<"bookingPrivacySteps">,
  "practiceId" | "ruleSetId" | "sessionId" | "userId"
>;

type StepName = BookingSessionState["step"];

interface StepNavNode {
  canGoBack: boolean;
  computePrev?: (state: InternalBookingSessionState) => null | StepName;
  prev: null | StepName;
}

type StepSnapshotWrite = {
  [K in StepTableName]: {
    data: StepTableInput<K>;
    tableName: K;
  };
}[StepTableName];

export function applyBookingSessionTransition(
  input: BookingSessionTransitionInput,
): BookingSessionTransition {
  switch (input.kind) {
    case "acceptPrivacy": {
      return transitionAcceptPrivacy(input.base, input.state);
    }
    case "acceptPvsConsent": {
      return transitionAcceptPvsConsent(input.base, input.state);
    }
    case "confirmGkvDetails": {
      return transitionConfirmGkvDetails(
        input.base,
        input.state,
        input.hzvStatus,
      );
    }
    case "confirmPkvDetails": {
      return transitionConfirmPkvDetails(
        input.base,
        input.state,
        input.details,
      );
    }
    case "selectDoctor": {
      return transitionSelectDoctor(
        input.base,
        input.state,
        input.practitionerLineageKey,
      );
    }
    case "selectExistingPatient": {
      return transitionSelectExistingPatient(input.base, input.state);
    }
    case "selectExistingPatientSlot": {
      return transitionSelectExistingPatientSlot(
        input.base,
        input.state,
        input.slotAttempt,
      );
    }
    case "selectInsuranceType": {
      return transitionSelectInsuranceType(
        input.base,
        input.state,
        input.insuranceType,
      );
    }
    case "selectLocation": {
      return transitionSelectLocation(
        input.base,
        input.state,
        input.locationLineageKey,
      );
    }
    case "selectNewPatient": {
      return transitionSelectNewPatient(input.base, input.state);
    }
    case "selectNewPatientSlot": {
      return transitionSelectNewPatientSlot(
        input.base,
        input.state,
        input.slotAttempt,
      );
    }
    case "submitExistingDataSharing": {
      return transitionSubmitExistingDataSharing(
        input.base,
        input.state,
        input.dataSharingContacts,
      );
    }
    case "submitExistingPatientData": {
      return transitionSubmitExistingPatientData(
        input.base,
        input.state,
        input.personalData,
      );
    }
    case "submitNewDataSharing": {
      return transitionSubmitNewDataSharing(
        input.base,
        input.state,
        input.personalData,
        input.dataSharingContacts,
      );
    }
    case "submitNewPatientData": {
      return transitionSubmitNewPatientData(input.base, input.state, {
        ...(input.medicalHistory === undefined
          ? {}
          : { medicalHistory: input.medicalHistory }),
        personalData: input.personalData,
      });
    }
  }
}

export function getBookingSessionSnapshotTables(
  step: BookingSessionState["step"],
): StepTableName[] {
  return STEP_SNAPSHOT_TABLES_BY_STEP[step];
}

export function hydrateBookingSessionInternalState(
  step: InternalBookingSessionState["step"],
  snapshot: null | Record<string, unknown>,
): InternalBookingSessionState {
  if (STEP_SNAPSHOT_TABLES_BY_STEP[step].length > 0 && snapshot === null) {
    throw new Error(`Missing snapshot for booking session step '${step}'`);
  }

  const mergedState = snapshot === null ? { step } : { step, ...snapshot };
  const sanitizedState = sanitizeInternalState(step, mergedState);
  assertInternalHydratedStateConsistency(step, sanitizedState);
  return sanitizedState;
}

export async function materializeBookingSessionUiState(
  state: InternalBookingSessionState,
  materializers: BookingSessionMaterializers,
): Promise<BookingSessionState> {
  const materialized: Record<string, unknown> = { ...state };

  if ("appointmentTypeLineageKey" in state) {
    materialized["appointmentTypeName"] =
      await materializers.resolveAppointmentTypeName(
        state.appointmentTypeLineageKey,
      );
  }
  if ("locationLineageKey" in state) {
    materialized["locationName"] = await materializers.resolveLocationName(
      state.locationLineageKey,
    );
  }
  if ("practitionerLineageKey" in state) {
    materialized["practitionerName"] =
      await materializers.resolvePractitionerName(state.practitionerLineageKey);
  }

  const publicState = sanitizeState(state.step, {
    step: state.step,
    ...materialized,
  });
  assertHydratedStateConsistency(state.step, publicState);
  return publicState;
}

function transitionAcceptPrivacy(
  base: StepBase,
  state: InternalBookingSessionState,
): BookingSessionTransition {
  assertInternalStep(state, "privacy");
  return {
    nextStep: "location",
    writes: [
      {
        data: { ...base, consent: true },
        tableName: "bookingPrivacySteps",
      },
    ],
  };
}

function transitionAcceptPvsConsent(
  base: StepBase,
  state: InternalBookingSessionState,
): BookingSessionTransition {
  const current = assertInternalStep(state, "new-pvs-consent");
  return {
    nextStep: "new-pkv-details",
    writes: [
      {
        data: {
          ...base,
          insuranceType: "pkv",
          isNewPatient: true,
          locationLineageKey: current.locationLineageKey,
          pvsConsent: true,
        },
        tableName: "bookingNewPkvConsentSteps",
      },
    ],
  };
}

function transitionConfirmGkvDetails(
  base: StepBase,
  state: InternalBookingSessionState,
  hzvStatus: StepTableInput<"bookingNewGkvDetailSteps">["hzvStatus"],
): BookingSessionTransition {
  if (
    state.step !== "new-gkv-details" &&
    state.step !== "new-gkv-details-complete"
  ) {
    throw invalidStepError(
      "new-gkv-details' or 'new-gkv-details-complete",
      state.step,
    );
  }

  return {
    nextStep: "new-data-input",
    writes: [
      {
        data: {
          ...base,
          hzvStatus,
          insuranceType: "gkv",
          isNewPatient: true,
          locationLineageKey: state.locationLineageKey,
        },
        tableName: "bookingNewGkvDetailSteps",
      },
    ],
  };
}

function transitionConfirmPkvDetails(
  base: StepBase,
  state: InternalBookingSessionState,
  details: {
    beihilfeStatus?: StepTableInput<"bookingNewPkvDetailSteps">["beihilfeStatus"];
    pkvInsuranceType?: StepTableInput<"bookingNewPkvDetailSteps">["pkvInsuranceType"];
    pkvTariff?: StepTableInput<"bookingNewPkvDetailSteps">["pkvTariff"];
  },
): BookingSessionTransition {
  if (
    state.step !== "new-pkv-details" &&
    state.step !== "new-pkv-details-complete"
  ) {
    throw invalidStepError(
      "new-pkv-details' or 'new-pkv-details-complete",
      state.step,
    );
  }

  return {
    nextStep: "new-data-input",
    writes: [
      {
        data: {
          ...base,
          ...(details.beihilfeStatus === undefined
            ? {}
            : { beihilfeStatus: details.beihilfeStatus }),
          insuranceType: "pkv",
          isNewPatient: true,
          locationLineageKey: state.locationLineageKey,
          ...(details.pkvInsuranceType === undefined
            ? {}
            : { pkvInsuranceType: details.pkvInsuranceType }),
          ...(details.pkvTariff === undefined
            ? {}
            : { pkvTariff: details.pkvTariff }),
          pvsConsent: true,
        },
        tableName: "bookingNewPkvDetailSteps",
      },
    ],
  };
}

function transitionSelectDoctor(
  base: StepBase,
  state: InternalBookingSessionState,
  practitionerLineageKey: StepTableInput<"bookingExistingDoctorSelectionSteps">["practitionerLineageKey"],
): BookingSessionTransition {
  const current = assertInternalStep(state, "existing-doctor-selection");
  return {
    nextStep: "existing-data-input",
    writes: [
      {
        data: {
          ...base,
          isNewPatient: false,
          locationLineageKey: current.locationLineageKey,
          practitionerLineageKey,
        },
        tableName: "bookingExistingDoctorSelectionSteps",
      },
    ],
  };
}

function transitionSelectExistingPatient(
  base: StepBase,
  state: InternalBookingSessionState,
): BookingSessionTransition {
  const current = assertInternalStep(state, "patient-status");
  return {
    nextStep: "existing-doctor-selection",
    writes: [
      {
        data: {
          ...base,
          isNewPatient: false,
          locationLineageKey: current.locationLineageKey,
        },
        tableName: "bookingPatientStatusSteps",
      },
    ],
  };
}

function transitionSelectExistingPatientSlot(
  base: StepBase,
  state: InternalBookingSessionState,
  args: Pick<
    StepTableInput<"bookingExistingConfirmationSteps">,
    | "appointmentId"
    | "appointmentTypeLineageKey"
    | "bookedDurationMinutes"
    | "reasonDescription"
    | "selectedSlot"
  > & {
    personalData: BookingPersonalData;
  },
): BookingSessionTransition {
  const current = assertInternalStep(state, "existing-calendar-selection");
  const calendarSnapshot = {
    ...base,
    appointmentTypeLineageKey: args.appointmentTypeLineageKey,
    dataSharingContacts: current.dataSharingContacts,
    isNewPatient: false,
    locationLineageKey: current.locationLineageKey,
    personalData: args.personalData,
    practitionerLineageKey: current.practitionerLineageKey,
    reasonDescription: args.reasonDescription,
    selectedSlot: args.selectedSlot,
  } satisfies StepTableInput<"bookingExistingCalendarSelectionSteps">;

  return {
    nextStep: "existing-confirmation",
    writes: [
      {
        data: calendarSnapshot,
        tableName: "bookingExistingCalendarSelectionSteps",
      },
      {
        data: {
          ...calendarSnapshot,
          appointmentId: args.appointmentId,
          bookedDurationMinutes: args.bookedDurationMinutes,
        },
        tableName: "bookingExistingConfirmationSteps",
      },
    ],
  };
}

function transitionSelectInsuranceType(
  base: StepBase,
  state: InternalBookingSessionState,
  insuranceType: StepTableInput<"bookingNewInsuranceTypeSteps">["insuranceType"],
): BookingSessionTransition {
  const current = assertInternalStep(state, "new-insurance-type");
  return {
    nextStep: insuranceType === "gkv" ? "new-gkv-details" : "new-pvs-consent",
    writes: [
      {
        data: {
          ...base,
          insuranceType,
          isNewPatient: true,
          locationLineageKey: current.locationLineageKey,
        },
        tableName: "bookingNewInsuranceTypeSteps",
      },
    ],
  };
}

function transitionSelectLocation(
  base: StepBase,
  state: InternalBookingSessionState,
  locationLineageKey: StepTableInput<"bookingLocationSteps">["locationLineageKey"],
): BookingSessionTransition {
  assertInternalStep(state, "location");
  return {
    nextStep: "patient-status",
    writes: [
      {
        data: { ...base, locationLineageKey },
        tableName: "bookingLocationSteps",
      },
    ],
  };
}

function transitionSelectNewPatient(
  base: StepBase,
  state: InternalBookingSessionState,
): BookingSessionTransition {
  const current = assertInternalStep(state, "patient-status");
  return {
    nextStep: "new-insurance-type",
    writes: [
      {
        data: {
          ...base,
          isNewPatient: true,
          locationLineageKey: current.locationLineageKey,
        },
        tableName: "bookingPatientStatusSteps",
      },
    ],
  };
}

function transitionSelectNewPatientSlot(
  base: StepBase,
  state: InternalBookingSessionState,
  args: Pick<
    StepTableInput<"bookingNewConfirmationSteps">,
    | "appointmentId"
    | "appointmentTypeLineageKey"
    | "bookedDurationMinutes"
    | "reasonDescription"
    | "selectedSlot"
  > & {
    personalData: BookingPersonalData;
  },
): BookingSessionTransition {
  const current = assertInternalStep(state, "new-calendar-selection");
  const calendarSnapshot = newPatientSlotSnapshot({
    base,
    personalData: args.personalData,
    reasonDescription: args.reasonDescription,
    selectedSlot: args.selectedSlot,
    state: current,
  });

  return {
    nextStep: "new-confirmation",
    writes: [
      {
        data: {
          ...calendarSnapshot,
          appointmentTypeLineageKey: args.appointmentTypeLineageKey,
        },
        tableName: "bookingNewCalendarSelectionSteps",
      },
      {
        data: {
          ...calendarSnapshot,
          appointmentId: args.appointmentId,
          appointmentTypeLineageKey: args.appointmentTypeLineageKey,
          bookedDurationMinutes: args.bookedDurationMinutes,
        },
        tableName: "bookingNewConfirmationSteps",
      },
    ],
  };
}

function transitionSubmitExistingDataSharing(
  base: StepBase,
  state: InternalBookingSessionState,
  dataSharingContacts: DataSharingContact[],
): BookingSessionTransition {
  const current = assertInternalStep(state, "existing-calendar-selection");
  return {
    nextStep: "existing-calendar-selection",
    writes: [
      {
        data: {
          ...base,
          dataSharingContacts,
          isNewPatient: false,
          locationLineageKey: current.locationLineageKey,
          personalData: current.personalData,
          practitionerLineageKey: current.practitionerLineageKey,
        },
        tableName: "bookingExistingDataSharingSteps",
      },
    ],
  };
}

function transitionSubmitExistingPatientData(
  base: StepBase,
  state: InternalBookingSessionState,
  personalData: BookingPersonalData,
): BookingSessionTransition {
  if (
    state.step !== "existing-data-input" &&
    state.step !== "existing-data-input-complete"
  ) {
    throw invalidStepError(
      "existing-data-input' or 'existing-data-input-complete",
      state.step,
    );
  }

  return {
    nextStep: "existing-calendar-selection",
    writes: [
      {
        data: {
          ...base,
          isNewPatient: false,
          locationLineageKey: state.locationLineageKey,
          personalData,
          practitionerLineageKey: state.practitionerLineageKey,
        },
        tableName: "bookingExistingPersonalDataSteps",
      },
      {
        data: {
          ...base,
          dataSharingContacts: [],
          isNewPatient: false,
          locationLineageKey: state.locationLineageKey,
          personalData,
          practitionerLineageKey: state.practitionerLineageKey,
        },
        tableName: "bookingExistingDataSharingSteps",
      },
    ],
  };
}

function transitionSubmitNewDataSharing(
  base: StepBase,
  state: InternalBookingSessionState,
  personalData: BookingPersonalData,
  dataSharingContacts: DataSharingContact[],
): BookingSessionTransition {
  const current = assertInternalStep(state, "new-data-sharing");
  return {
    nextStep: "new-calendar-selection",
    writes: [
      {
        data: newDataSharingSnapshot({
          base,
          dataSharingContacts,
          personalData,
          state: current,
        }),
        tableName: "bookingNewDataSharingSteps",
      },
    ],
  };
}

function transitionSubmitNewPatientData(
  base: StepBase,
  state: InternalBookingSessionState,
  args: {
    medicalHistory?: StepTableInput<"bookingNewPersonalDataSteps">["medicalHistory"];
    personalData: BookingPersonalData;
  },
): BookingSessionTransition {
  if (
    state.step !== "new-data-input" &&
    state.step !== "new-data-input-complete"
  ) {
    throw invalidStepError(
      "new-data-input' or 'new-data-input-complete",
      state.step,
    );
  }

  return {
    nextStep: "new-data-sharing",
    writes: [
      {
        data: newPersonalDataSnapshot({
          base,
          medicalHistory: args.medicalHistory,
          personalData: args.personalData,
          state,
        }),
        tableName: "bookingNewPersonalDataSteps",
      },
    ],
  };
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

export function assertHydratedStateConsistency(
  step: BookingSessionState["step"],
  state: BookingSessionState,
): void {
  if (
    "insuranceType" in state &&
    state.insuranceType === "pkv" &&
    PKV_STEPS_REQUIRING_PVS_CONSENT.has(step) &&
    !("pvsConsent" in state)
  ) {
    throw new Error(`Missing snapshot for booking session step '${step}'`);
  }
}

export function assertValidSanitizedBookingSessionState(
  step: BookingSessionState["step"],
  state: Record<string, unknown>,
): asserts state is BookingSessionState {
  if (
    !isPlainObject(state) ||
    state["step"] !== step ||
    !matchesConvexValidator(bookingSessionStepValidator, state) ||
    !hasValidTypedBookingStrings(state)
  ) {
    throw new Error(`Invalid booking session snapshot for step '${step}'`);
  }
}

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

export function sanitizeState(
  step: BookingSessionState["step"],
  state: Record<string, unknown>,
): BookingSessionState {
  const allow = new Set(["step", ...STEP_SNAPSHOT_ALLOWED_FIELDS[step]]);
  const sanitized: Record<string, unknown> = { step };
  for (const [key, value] of Object.entries(state)) {
    if (allow.has(key)) {
      sanitized[key] = value;
    }
  }
  assertValidSanitizedBookingSessionState(step, sanitized);
  if (!hasStep(sanitized, step)) {
    throw new Error(`Invalid booking session snapshot for step '${step}'`);
  }
  return sanitized;
}

function assertInternalHydratedStateConsistency(
  step: InternalBookingSessionState["step"],
  state: InternalBookingSessionState,
): void {
  if (
    "insuranceType" in state &&
    state.insuranceType === "pkv" &&
    PKV_STEPS_REQUIRING_PVS_CONSENT.has(step) &&
    !("pvsConsent" in state)
  ) {
    throw new Error(`Missing snapshot for booking session step '${step}'`);
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

function assertValidSanitizedInternalBookingSessionState(
  step: InternalBookingSessionState["step"],
  state: Record<string, unknown>,
): asserts state is InternalBookingSessionState {
  if (
    !isPlainObject(state) ||
    state["step"] !== step ||
    !hasValidInternalTypedBookingStrings(state)
  ) {
    throw new Error(`Invalid booking session snapshot for step '${step}'`);
  }
}

function hasInternalStep<S extends InternalBookingSessionState["step"]>(
  state: InternalBookingSessionState,
  expected: S,
): state is InternalStateAtStep<S> {
  return state.step === expected;
}

function hasStep<S extends BookingSessionState["step"]>(
  state: BookingSessionState,
  expected: S,
): state is StateAtStep<S> {
  return state.step === expected;
}

function hasValidBookingStrings(state: Record<string, unknown>): boolean {
  const personalData = state["personalData"];
  if (
    personalData !== undefined &&
    (!isPlainObject(personalData) ||
      typeof personalData["dateOfBirth"] !== "string" ||
      !isIsoDateString(personalData["dateOfBirth"]))
  ) {
    return false;
  }

  const dataSharingContacts = state["dataSharingContacts"];
  if (
    dataSharingContacts !== undefined &&
    (!Array.isArray(dataSharingContacts) ||
      dataSharingContacts.some(
        (contact) =>
          !isPlainObject(contact) ||
          typeof contact["dateOfBirth"] !== "string" ||
          !isIsoDateString(contact["dateOfBirth"]),
      ))
  ) {
    return false;
  }

  const selectedSlot = state["selectedSlot"];
  if (
    selectedSlot !== undefined &&
    (!isPlainObject(selectedSlot) ||
      typeof selectedSlot["startTime"] !== "string" ||
      !isZonedDateTimeString(selectedSlot["startTime"]) ||
      typeof selectedSlot["practitionerLineageKey"] !== "string")
  ) {
    return false;
  }

  return true;
}

function hasValidInternalTypedBookingStrings(
  state: Record<string, unknown>,
): boolean {
  return hasValidBookingStrings(state);
}

function hasValidTypedBookingStrings(state: Record<string, unknown>): boolean {
  return hasValidBookingStrings(state);
}

function invalidStepError(expected: string, actual: string): Error {
  return new Error(`Invalid step: expected '${expected}', got '${actual}'`);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.getPrototypeOf(value) === Object.prototype;
}

function matchesConvexValidator(
  validator: GenericValidator,
  value: unknown,
): boolean {
  if (validator.isOptional === "optional" && value === undefined) {
    return true;
  }

  switch (validator.kind) {
    case "any": {
      return true;
    }
    case "array": {
      return (
        Array.isArray(value) &&
        value.every((entry) => matchesConvexValidator(validator.element, entry))
      );
    }
    case "boolean": {
      return typeof value === "boolean";
    }
    case "bytes": {
      return value instanceof ArrayBuffer;
    }
    case "float64": {
      return typeof value === "number";
    }
    case "id": {
      return isNonEmptyString(value);
    }
    case "int64": {
      return typeof value === "bigint";
    }
    case "literal": {
      return value === validator.value;
    }
    case "null": {
      return value === null;
    }
    case "object": {
      return (
        isPlainObject(value) &&
        Object.entries(validator.fields).every(([key, fieldValidator]) =>
          matchesConvexValidator(fieldValidator, value[key]),
        ) &&
        Object.keys(value).every((key) => key in validator.fields)
      );
    }
    case "record": {
      return (
        isPlainObject(value) &&
        Object.entries(value).every(
          ([key, entryValue]) =>
            matchesConvexValidator(validator.key, key) &&
            matchesConvexValidator(validator.value, entryValue),
        )
      );
    }
    case "string": {
      return typeof value === "string";
    }
    case "union": {
      return validator.members.some((member) =>
        matchesConvexValidator(member, value),
      );
    }
  }
}

function newDataSharingSnapshot(args: {
  base: StepBase;
  dataSharingContacts: DataSharingContact[];
  personalData: BookingPersonalData;
  state: InternalStateAtStep<"new-data-sharing">;
}): StepTableInput<"bookingNewDataSharingSteps"> {
  if (args.state.insuranceType === "gkv") {
    return {
      ...args.base,
      ...(args.state.medicalHistory === undefined
        ? {}
        : { medicalHistory: args.state.medicalHistory }),
      dataSharingContacts: args.dataSharingContacts,
      hzvStatus: args.state.hzvStatus,
      insuranceType: "gkv",
      isNewPatient: true,
      locationLineageKey: args.state.locationLineageKey,
      personalData: args.personalData,
    };
  }

  return {
    ...args.base,
    ...(args.state.beihilfeStatus === undefined
      ? {}
      : { beihilfeStatus: args.state.beihilfeStatus }),
    ...(args.state.medicalHistory === undefined
      ? {}
      : { medicalHistory: args.state.medicalHistory }),
    ...(args.state.pkvInsuranceType === undefined
      ? {}
      : { pkvInsuranceType: args.state.pkvInsuranceType }),
    ...(args.state.pkvTariff === undefined
      ? {}
      : { pkvTariff: args.state.pkvTariff }),
    dataSharingContacts: args.dataSharingContacts,
    insuranceType: "pkv",
    isNewPatient: true,
    locationLineageKey: args.state.locationLineageKey,
    personalData: args.personalData,
    pvsConsent: true,
  };
}

function newPatientSlotSnapshot(args: {
  base: StepBase;
  personalData: BookingPersonalData;
  reasonDescription: StepTableInput<"bookingNewCalendarSelectionSteps">["reasonDescription"];
  selectedSlot: StepTableInput<"bookingNewCalendarSelectionSteps">["selectedSlot"];
  state: InternalStateAtStep<"new-calendar-selection">;
}): Omit<
  StepTableInput<"bookingNewCalendarSelectionSteps">,
  "appointmentTypeLineageKey"
> {
  if (args.state.insuranceType === "gkv") {
    return {
      ...args.base,
      ...(args.state.medicalHistory === undefined
        ? {}
        : { medicalHistory: args.state.medicalHistory }),
      dataSharingContacts: args.state.dataSharingContacts,
      hzvStatus: args.state.hzvStatus,
      insuranceType: "gkv",
      isNewPatient: true,
      locationLineageKey: args.state.locationLineageKey,
      personalData: args.personalData,
      reasonDescription: args.reasonDescription,
      selectedSlot: args.selectedSlot,
    };
  }

  return {
    ...args.base,
    ...(args.state.beihilfeStatus === undefined
      ? {}
      : { beihilfeStatus: args.state.beihilfeStatus }),
    ...(args.state.medicalHistory === undefined
      ? {}
      : { medicalHistory: args.state.medicalHistory }),
    ...(args.state.pkvInsuranceType === undefined
      ? {}
      : { pkvInsuranceType: args.state.pkvInsuranceType }),
    ...(args.state.pkvTariff === undefined
      ? {}
      : { pkvTariff: args.state.pkvTariff }),
    dataSharingContacts: args.state.dataSharingContacts,
    insuranceType: "pkv",
    isNewPatient: true,
    locationLineageKey: args.state.locationLineageKey,
    personalData: args.personalData,
    pvsConsent: true,
    reasonDescription: args.reasonDescription,
    selectedSlot: args.selectedSlot,
  };
}

function newPersonalDataSnapshot(args: {
  base: StepBase;
  medicalHistory?: StepTableInput<"bookingNewPersonalDataSteps">["medicalHistory"];
  personalData: BookingPersonalData;
  state:
    | InternalStateAtStep<"new-data-input">
    | InternalStateAtStep<"new-data-input-complete">;
}): StepTableInput<"bookingNewPersonalDataSteps"> {
  if (args.state.insuranceType === "gkv") {
    return {
      ...args.base,
      ...(args.medicalHistory === undefined
        ? {}
        : { medicalHistory: args.medicalHistory }),
      hzvStatus: args.state.hzvStatus,
      insuranceType: "gkv",
      isNewPatient: true,
      locationLineageKey: args.state.locationLineageKey,
      personalData: args.personalData,
    };
  }

  return {
    ...args.base,
    ...(args.state.beihilfeStatus === undefined
      ? {}
      : { beihilfeStatus: args.state.beihilfeStatus }),
    ...(args.medicalHistory === undefined
      ? {}
      : { medicalHistory: args.medicalHistory }),
    ...(args.state.pkvInsuranceType === undefined
      ? {}
      : { pkvInsuranceType: args.state.pkvInsuranceType }),
    ...(args.state.pkvTariff === undefined
      ? {}
      : { pkvTariff: args.state.pkvTariff }),
    insuranceType: "pkv",
    isNewPatient: true,
    locationLineageKey: args.state.locationLineageKey,
    personalData: args.personalData,
    pvsConsent: true,
  };
}

function sanitizeInternalState(
  step: InternalBookingSessionState["step"],
  state: Record<string, unknown>,
): InternalBookingSessionState {
  const allow = new Set([
    "step",
    ...STEP_SNAPSHOT_ALLOWED_INTERNAL_FIELDS[step],
  ]);
  const sanitized: Record<string, unknown> = { step };
  for (const [key, value] of Object.entries(state)) {
    if (allow.has(key)) {
      sanitized[key] = value;
    }
  }
  assertValidSanitizedInternalBookingSessionState(step, sanitized);
  if (!hasInternalStep(sanitized, step)) {
    throw new Error(`Invalid booking session snapshot for step '${step}'`);
  }
  return sanitized;
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
