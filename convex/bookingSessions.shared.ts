import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";

import type { DataModel, Doc, Id } from "./_generated/dataModel";
import type { BookingSessionStep } from "./schema";

export type MutationCtx = GenericMutationCtx<DataModel>;
export type QueryCtx = GenericQueryCtx<DataModel>;
export type SessionDoc = Doc<"bookingSessions">;
export type SessionWithState = SessionDoc & { state: BookingSessionState };

export interface StepReadCtx {
  db: MutationCtx["db"] | QueryCtx["db"];
}

export const SESSION_TTL_MS = 30 * 60 * 1000;
export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const APPOINTMENT_TIMEZONE = "Europe/Berlin";

export type BookingSessionState = BookingSessionStep;
export type DataSharingContact =
  Doc<"bookingNewDataSharingSteps">["dataSharingContacts"][number];
export type DataSharingContactInput = Omit<DataSharingContact, "userId">;

export type StateAtStep<S extends BookingSessionState["step"]> = Extract<
  BookingSessionState,
  { step: S }
>;

export type StepInsertMap = {
  [K in StepTableName]: (
    ctx: MutationCtx,
    data: StepTableInsert<K>,
  ) => Promise<Id<K>>;
};

export type StepPatchMap = {
  [K in StepTableName]: (
    ctx: MutationCtx,
    id: Id<K>,
    data: Partial<StepTableInsert<K>>,
  ) => Promise<void>;
};

export type StepQueryMap = {
  [K in StepTableName]: (
    ctx: StepReadCtx,
    sessionId: Id<"bookingSessions">,
  ) => Promise<StepTableDocMap[K][]>;
};

export type StepSnapshotMetaKeys =
  | "_creationTime"
  | "_id"
  | "createdAt"
  | "lastModified"
  | "practiceId"
  | "ruleSetId"
  | "sessionId"
  | "userId";

export interface StepTableDocMap {
  bookingExistingCalendarSelectionSteps: Doc<"bookingExistingCalendarSelectionSteps">;
  bookingExistingConfirmationSteps: Doc<"bookingExistingConfirmationSteps">;
  bookingExistingDataSharingSteps: Doc<"bookingExistingDataSharingSteps">;
  bookingExistingDoctorSelectionSteps: Doc<"bookingExistingDoctorSelectionSteps">;
  bookingExistingPersonalDataSteps: Doc<"bookingExistingPersonalDataSteps">;
  bookingLocationSteps: Doc<"bookingLocationSteps">;
  bookingNewCalendarSelectionSteps: Doc<"bookingNewCalendarSelectionSteps">;
  bookingNewConfirmationSteps: Doc<"bookingNewConfirmationSteps">;
  bookingNewDataSharingSteps: Doc<"bookingNewDataSharingSteps">;
  bookingNewGkvDetailSteps: Doc<"bookingNewGkvDetailSteps">;
  bookingNewInsuranceTypeSteps: Doc<"bookingNewInsuranceTypeSteps">;
  bookingNewPersonalDataSteps: Doc<"bookingNewPersonalDataSteps">;
  bookingNewPkvConsentSteps: Doc<"bookingNewPkvConsentSteps">;
  bookingNewPkvDetailSteps: Doc<"bookingNewPkvDetailSteps">;
  bookingPatientStatusSteps: Doc<"bookingPatientStatusSteps">;
  bookingPrivacySteps: Doc<"bookingPrivacySteps">;
}

export type StepTableInput<T extends StepTableName> = Omit<
  StepTableInsert<T>,
  "createdAt" | "lastModified"
>;

export type StepTableInsert<T extends StepTableName> = Omit<
  StepTableDocMap[T],
  "_creationTime" | "_id"
>;

export type StepTableName = keyof Pick<
  DataModel,
  | "bookingExistingCalendarSelectionSteps"
  | "bookingExistingConfirmationSteps"
  | "bookingExistingDataSharingSteps"
  | "bookingExistingDoctorSelectionSteps"
  | "bookingExistingPersonalDataSteps"
  | "bookingLocationSteps"
  | "bookingNewCalendarSelectionSteps"
  | "bookingNewConfirmationSteps"
  | "bookingNewDataSharingSteps"
  | "bookingNewGkvDetailSteps"
  | "bookingNewInsuranceTypeSteps"
  | "bookingNewPersonalDataSteps"
  | "bookingNewPkvConsentSteps"
  | "bookingNewPkvDetailSteps"
  | "bookingPatientStatusSteps"
  | "bookingPrivacySteps"
>;
