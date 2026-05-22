import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";

import type { DataModel, Doc, Id } from "./_generated/dataModel";
import type { BookingSessionStep } from "./schema";
import type {
  MedicalHistoryInput,
  PersonalDataInput,
  SelectedSlotInput,
  DataSharingContactInput as TypedDataSharingContactInput,
} from "./typedDtos";

export { ISO_DATE_REGEX } from "../lib/typed-regex.js";
export const APPOINTMENT_TIMEZONE = "Europe/Berlin";

export interface BookingFlowKey {
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
  userId: Id<"users">;
}
export type BookingMedicalHistory = MedicalHistoryInput;

export type BookingPersonalData = PersonalDataInput;

export type BookingSelectedSlot = SelectedSlotInput;
export type BookingSessionState = BookingSessionStep;
export type BookingStepRowMap = {
  [K in BookingStepTableName]: Doc<K>;
};
export type BookingStepTableName =
  | "bookingExistingDoctorSelectionSteps"
  | "bookingLocationSteps"
  | "bookingNewDataSharingSteps"
  | "bookingNewGkvDetailSteps"
  | "bookingNewInsuranceTypeSteps"
  | "bookingNewPkvConsentSteps"
  | "bookingNewPkvDetailSteps"
  | "bookingPatientStatusSteps"
  | "bookingPersonalDataSteps"
  | "bookingPrivacySteps";
export type DataSharingContactInput = TypedDataSharingContactInput;
export type DataSharingContactRow = Doc<"bookingNewDataSharingContactRows">;

export type FlowScopedStepDoc<T extends BookingStepTableName> =
  BookingStepRowMap[T];

export type FlowScopedStepInsert<T extends BookingStepTableName> = Omit<
  FlowScopedStepDoc<T>,
  "_creationTime" | "_id"
>;

export type MutationCtx = GenericMutationCtx<DataModel>;

export type QueryCtx = GenericQueryCtx<DataModel>;
