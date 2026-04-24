import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";

export { ISO_DATE_REGEX } from "../lib/typed-regex.js";

import type { DataModel, Doc, Id } from "./_generated/dataModel";
import type { BookingSessionStep } from "./schema";
import type {
  PersonalDataInput,
  SelectedSlotInput,
  DataSharingContactInput as TypedDataSharingContactInput,
} from "./typedDtos";

export type MutationCtx = GenericMutationCtx<DataModel>;
export type QueryCtx = GenericQueryCtx<DataModel>;
export type SessionDoc = Doc<"bookingSessions">;
export type SessionWithState = SessionDoc & { state: BookingSessionState };

export interface StepReadCtx {
  db: MutationCtx["db"] | QueryCtx["db"];
}

export const SESSION_TTL_MS = 30 * 60 * 1000;
export const APPOINTMENT_TIMEZONE = "Europe/Berlin";

export type BookingPersonalData = PersonalDataInput;
export type BookingSelectedSlot = SelectedSlotInput;
export type BookingSessionState = BookingSessionStep;
export type DataSharingContact =
  Doc<"bookingNewDataSharingSteps">["dataSharingContacts"][number];
export type DataSharingContactInput = TypedDataSharingContactInput;
export type InternalBookingSelectedSlot = SelectedSlotInput;
export type InternalBookingSessionState = RewriteBookingReferences<
  StripTopLevelPublicBookingLabels<BookingSessionStep>
>;
export type InternalStateAtStep<S extends InternalBookingSessionState["step"]> =
  Extract<InternalBookingSessionState, { step: S }>;
export type StateAtStep<S extends BookingSessionState["step"]> = Extract<
  BookingSessionState,
  { step: S }
>;

export type StepInsertMap = {
  [K in StepTableName]: (
    ctx: MutationCtx,
    data: StepTableInsertData<K>,
  ) => Promise<Id<K>>;
};
export type StepPatchMap = {
  [K in StepTableName]: (
    ctx: MutationCtx,
    id: Id<K>,
    data: StepTablePatch<K>,
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

export type StepTableInsertData<T extends StepTableName> = StepTableInput<T> & {
  createdAt: bigint;
  lastModified: bigint;
};

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

export type StepTablePatch<T extends StepTableName> = StepTableInput<T> & {
  lastModified: bigint;
};

type PublicBookingLabelKey =
  | "appointmentTypeName"
  | "locationName"
  | "practitionerName";

type RewriteBookingReferenceKey<Key extends string> =
  Key extends "appointmentTypeId"
    ? "appointmentTypeLineageKey"
    : Key extends "locationId"
      ? "locationLineageKey"
      : Key extends "practitionerId"
        ? "practitionerLineageKey"
        : Key;

type RewriteBookingReferences<Value> =
  Value extends Id<infer TableName>
    ? Id<TableName>
    : Value extends readonly (infer Item)[]
      ? RewriteBookingReferences<Item>[]
      : Value extends object
        ? {
            [Key in keyof Value as Key extends string
              ? RewriteBookingReferenceKey<Key>
              : Key]: RewriteBookingReferences<Value[Key]>;
          }
        : Value;

type StripTopLevelPublicBookingLabels<Value> = Value extends object
  ? {
      [Key in keyof Value as Key extends PublicBookingLabelKey
        ? never
        : Key]: Value[Key];
    }
  : Value;
