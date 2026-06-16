import { v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import type { Doc, Id } from "./_generated/dataModel";

import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import {
  resolveAppointmentTypeIdForRuleSetByLineage,
  resolveLocationIdForRuleSetByLineage,
  resolvePractitionerIdForRuleSetByLineage,
} from "./appointmentReferences";
import { createAppointmentFromTrustedSource } from "./appointments";
import {
  APPOINTMENT_TIMEZONE,
  type BookingFlowKey,
  type BookingMedicalHistory,
  type BookingPersonalData,
  type BookingSessionState,
  type DataSharingContactInput,
  ISO_DATE_REGEX,
  type MutationCtx,
  type QueryCtx,
} from "./bookingSessions.shared";
import {
  asAppointmentTypeLineageKey,
  asLocationLineageKey,
  asPractitionerLineageKey,
  type LocationLineageKey,
  type PractitionerLineageKey,
} from "./identity";
import { getFutureLegacyUnmatchedBookingHoldsForUser } from "./legacyUnmatchedFutureBookingHolds";
import {
  type PatientBookingScope,
  requirePatientBookingScopeForMutation,
} from "./practiceAccess";
import { isRuleSetEntityDeleted } from "./ruleSetEntityDeletion";
import {
  beihilfeStatusValidator,
  bookingSessionStepValidator,
  dataSharingContactInputValidator,
  hzvStatusValidator,
  insuranceTypeValidator,
  medicalHistoryValidator,
  personalDataValidator,
  pkvInsuranceTypeValidator,
  pkvTariffValidator,
  selectedSlotValidator,
} from "./schema";
import {
  asDataSharingContactInput,
  asPersonalDataInput,
  asSelectedSlotInput,
  type ZonedDateTimeString,
} from "./typedDtos";
import {
  ensureAuthenticatedUserId,
  requireAuthenticatedUserIdForQuery,
} from "./userIdentity";

const FLOW_KEY_VALIDATOR = {
  practiceId: v.id("practices"),
  ruleSetId: v.id("ruleSets"),
} as const;

const BOOKING_SESSION_RETURN_VALIDATOR = v.union(
  v.object({
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
    state: bookingSessionStepValidator,
    userId: v.id("users"),
  }),
  v.null(),
);

const BACK_TARGET_STEP_VALIDATOR = v.union(
  v.literal("existing-data-input"),
  v.literal("existing-doctor-selection"),
  v.literal("location"),
  v.literal("new-data-input"),
  v.literal("new-data-sharing"),
  v.literal("new-gkv-details"),
  v.literal("new-insurance-type"),
  v.literal("new-pkv-details"),
  v.literal("new-pvs-consent"),
  v.literal("patient-status"),
  v.literal("privacy"),
);

type BackTargetStep = Exclude<
  BookingSessionState["step"],
  | "existing-calendar-selection"
  | "new-calendar-selection"
  | "new-data-input-complete"
  | "new-gkv-details-complete"
  | "new-pkv-details-complete"
>;
type BookingFlowRows = Awaited<ReturnType<typeof loadFlowRows>>;
type DeletableFlowRow<T extends DeletableFlowTable> = Doc<T>;

type DeletableFlowTable =
  | "bookingCalendarReachedSteps"
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

async function assertCalendarNotReached(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
): Promise<void> {
  const calendarReached = await getFlowRow(
    ctx,
    "bookingCalendarReachedSteps",
    flowKey,
  );
  if (calendarReached) {
    throw new Error(
      "This booking decision can no longer be changed after appointment selection was reached.",
    );
  }
}

async function assertSlotAllowedByRules(
  ctx: MutationCtx,
  args: {
    appointmentTypeId: Id<"appointmentTypes">;
    locationLineageKey: LocationLineageKey;
    patientDateOfBirth: string;
    practitionerLineageKey: PractitionerLineageKey;
    scope: PatientBookingScope;
    startTime: ZonedDateTimeString;
  },
): Promise<void> {
  const [locationId, practitionerId] = await Promise.all([
    resolveLocationIdForRuleSetByLineage(ctx.db, {
      lineageKey: args.locationLineageKey,
      ruleSetId: args.scope.ruleSetId,
    }),
    resolvePractitionerIdForRuleSetByLineage(ctx.db, {
      lineageKey: args.practitionerLineageKey,
      ruleSetId: args.scope.ruleSetId,
    }),
  ]);

  const ruleCheckResult = await ctx.runQuery(
    internal.ruleEngine.checkRulesForAppointment,
    {
      context: {
        appointmentTypeId: args.appointmentTypeId,
        clientType: "Online",
        dateTime: args.startTime,
        locationId,
        patientDateOfBirth: args.patientDateOfBirth,
        practiceId: args.scope.practiceId,
        practitionerId,
        requestedAt: Temporal.Now.instant()
          .toZonedDateTimeISO(APPOINTMENT_TIMEZONE)
          .toString(),
      },
      ruleSetId: args.scope.ruleSetId,
    },
  );

  if (ruleCheckResult.isBlocked) {
    throw new Error("Selected slot is no longer available");
  }
}

function assertSlotStartIsInFuture(startTime: string): void {
  let slotStartInstant: Temporal.Instant;
  try {
    slotStartInstant = Temporal.ZonedDateTime.from(startTime).toInstant();
  } catch {
    throw new Error("Invalid slot start time");
  }

  if (Temporal.Instant.compare(slotStartInstant, Temporal.Now.instant()) <= 0) {
    throw new Error("Appointments must be booked in the future");
  }
}

function assertValidDataSharingContacts(
  contacts: Parameters<typeof asDataSharingContactInput>[0][],
): asserts contacts is DataSharingContactInput[] {
  for (const [index, contact] of contacts.entries()) {
    const requiredTextFields: [keyof DataSharingContactInput, string][] = [
      ["city", "Ort"],
      ["firstName", "Vorname"],
      ["lastName", "Nachname"],
      ["phoneNumber", "Telefonnummer"],
      ["postalCode", "PLZ"],
      ["street", "Straße"],
    ];

    for (const [field, label] of requiredTextFields) {
      const value = contact[field];
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`Invalid data-sharing contact #${index + 1}: ${label}`);
      }
    }

    if (!ISO_DATE_REGEX.test(contact.dateOfBirth)) {
      throw new Error(
        `Invalid data-sharing contact #${index + 1}: Geburtsdatum format`,
      );
    }

    try {
      Temporal.PlainDate.from(contact.dateOfBirth);
    } catch {
      throw new Error(
        `Invalid data-sharing contact #${index + 1}: Geburtsdatum`,
      );
    }
  }
}

async function deleteDataSharingContacts(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
): Promise<void> {
  const rows = await ctx.db
    .query("bookingNewDataSharingContactRows")
    .withIndex("by_userId_practiceId_ruleSetId_index", (q) =>
      q
        .eq("userId", flowKey.userId)
        .eq("practiceId", flowKey.practiceId)
        .eq("ruleSetId", flowKey.ruleSetId),
    )
    .collect();

  for (const row of rows) {
    await ctx.db.delete("bookingNewDataSharingContactRows", row._id);
  }
}

async function deleteFlowRow<T extends DeletableFlowTable>(
  ctx: MutationCtx,
  tableName: T,
  row: DeletableFlowRow<T> | null,
): Promise<void> {
  if (!row) {
    return;
  }

  await ctx.db.delete(tableName, row._id);
}

async function deleteFlowRows(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
): Promise<void> {
  const rows = await loadFlowRows(ctx, flowKey);

  await deleteDataSharingContacts(ctx, flowKey);
  if (rows.medicalHistoryEntry) {
    await ctx.db.delete(
      "bookingMedicalHistoryEntries",
      rows.medicalHistoryEntry._id,
    );
  }
  if (rows.newDataSharing) {
    await ctx.db.delete("bookingNewDataSharingSteps", rows.newDataSharing._id);
  }
  if (rows.personalData) {
    await ctx.db.delete("bookingPersonalDataSteps", rows.personalData._id);
  }
  if (rows.newPkvDetail) {
    await ctx.db.delete("bookingNewPkvDetailSteps", rows.newPkvDetail._id);
  }
  if (rows.newPkvConsent) {
    await ctx.db.delete("bookingNewPkvConsentSteps", rows.newPkvConsent._id);
  }
  if (rows.newGkvDetail) {
    await ctx.db.delete("bookingNewGkvDetailSteps", rows.newGkvDetail._id);
  }
  if (rows.newInsuranceType) {
    await ctx.db.delete(
      "bookingNewInsuranceTypeSteps",
      rows.newInsuranceType._id,
    );
  }
  if (rows.existingDoctor) {
    await ctx.db.delete(
      "bookingExistingDoctorSelectionSteps",
      rows.existingDoctor._id,
    );
  }
  if (rows.patientStatus) {
    await ctx.db.delete("bookingPatientStatusSteps", rows.patientStatus._id);
  }
  if (rows.location) {
    await ctx.db.delete("bookingLocationSteps", rows.location._id);
  }
  if (rows.privacy) {
    await ctx.db.delete("bookingPrivacySteps", rows.privacy._id);
  }
  if (rows.calendarReached) {
    await ctx.db.delete(
      "bookingCalendarReachedSteps",
      rows.calendarReached._id,
    );
  }
}

function flowScope<T extends object>(
  flowKey: BookingFlowKey,
  data: T,
): BookingFlowKey & T {
  return {
    ...data,
    practiceId: flowKey.practiceId,
    ruleSetId: flowKey.ruleSetId,
    userId: flowKey.userId,
  };
}

function getAllowedBackTargetStep(
  state: BookingSessionState,
  calendarReached: boolean,
): BackTargetStep | null {
  switch (state.step) {
    case "existing-calendar-selection": {
      return null;
    }
    case "existing-data-input": {
      if (calendarReached) {
        return null;
      }
      return "existing-doctor-selection";
    }
    case "existing-doctor-selection": {
      return "patient-status";
    }
    case "location": {
      return "privacy";
    }
    case "new-calendar-selection": {
      return null;
    }
    case "new-data-input": {
      return state.insuranceType === "pkv"
        ? "new-pkv-details"
        : "new-gkv-details";
    }
    case "new-data-input-complete": {
      return "new-data-input";
    }
    case "new-data-sharing": {
      if (calendarReached) {
        return null;
      }
      return "new-data-input";
    }
    case "new-gkv-details": {
      return "new-insurance-type";
    }
    case "new-gkv-details-complete": {
      return "new-gkv-details";
    }
    case "new-insurance-type": {
      return "patient-status";
    }
    case "new-pkv-details": {
      return "new-pvs-consent";
    }
    case "new-pkv-details-complete": {
      return "new-pkv-details";
    }
    case "new-pvs-consent": {
      return "new-insurance-type";
    }
    case "patient-status": {
      return "location";
    }
    case "privacy": {
      return null;
    }
  }
}

async function getFlowKeyForMutation(
  ctx: MutationCtx,
  args: Pick<BookingFlowKey, "practiceId" | "ruleSetId">,
): Promise<BookingFlowKey> {
  await requireBookingRuleSetBelongsToPractice(ctx, args);
  return {
    ...args,
    userId: await ensureAuthenticatedUserId(ctx),
  };
}

async function getFlowKeyForQuery(
  ctx: QueryCtx,
  args: Pick<BookingFlowKey, "practiceId" | "ruleSetId">,
): Promise<BookingFlowKey> {
  const userId = await requireAuthenticatedUserIdForQuery(ctx);
  await requireBookingRuleSetBelongsToPractice(ctx, args);

  return {
    ...args,
    userId,
  };
}
function getFlowRow(
  ctx: MutationCtx | QueryCtx,
  tableName: "bookingCalendarReachedSteps",
  flowKey: BookingFlowKey,
): Promise<Doc<"bookingCalendarReachedSteps"> | null>;
function getFlowRow(
  ctx: MutationCtx | QueryCtx,
  tableName: "bookingExistingDoctorSelectionSteps",
  flowKey: BookingFlowKey,
): Promise<Doc<"bookingExistingDoctorSelectionSteps"> | null>;
function getFlowRow(
  ctx: MutationCtx | QueryCtx,
  tableName: "bookingLocationSteps",
  flowKey: BookingFlowKey,
): Promise<Doc<"bookingLocationSteps"> | null>;
function getFlowRow(
  ctx: MutationCtx | QueryCtx,
  tableName: "bookingNewDataSharingSteps",
  flowKey: BookingFlowKey,
): Promise<Doc<"bookingNewDataSharingSteps"> | null>;
function getFlowRow(
  ctx: MutationCtx | QueryCtx,
  tableName: "bookingNewGkvDetailSteps",
  flowKey: BookingFlowKey,
): Promise<Doc<"bookingNewGkvDetailSteps"> | null>;
function getFlowRow(
  ctx: MutationCtx | QueryCtx,
  tableName: "bookingNewInsuranceTypeSteps",
  flowKey: BookingFlowKey,
): Promise<Doc<"bookingNewInsuranceTypeSteps"> | null>;
function getFlowRow(
  ctx: MutationCtx | QueryCtx,
  tableName: "bookingNewPkvConsentSteps",
  flowKey: BookingFlowKey,
): Promise<Doc<"bookingNewPkvConsentSteps"> | null>;
function getFlowRow(
  ctx: MutationCtx | QueryCtx,
  tableName: "bookingNewPkvDetailSteps",
  flowKey: BookingFlowKey,
): Promise<Doc<"bookingNewPkvDetailSteps"> | null>;
function getFlowRow(
  ctx: MutationCtx | QueryCtx,
  tableName: "bookingPatientStatusSteps",
  flowKey: BookingFlowKey,
): Promise<Doc<"bookingPatientStatusSteps"> | null>;
function getFlowRow(
  ctx: MutationCtx | QueryCtx,
  tableName: "bookingPersonalDataSteps",
  flowKey: BookingFlowKey,
): Promise<Doc<"bookingPersonalDataSteps"> | null>;
function getFlowRow(
  ctx: MutationCtx | QueryCtx,
  tableName: "bookingPrivacySteps",
  flowKey: BookingFlowKey,
): Promise<Doc<"bookingPrivacySteps"> | null>;
async function getFlowRow(
  ctx: MutationCtx | QueryCtx,
  tableName:
    | "bookingCalendarReachedSteps"
    | "bookingExistingDoctorSelectionSteps"
    | "bookingLocationSteps"
    | "bookingNewDataSharingSteps"
    | "bookingNewGkvDetailSteps"
    | "bookingNewInsuranceTypeSteps"
    | "bookingNewPkvConsentSteps"
    | "bookingNewPkvDetailSteps"
    | "bookingPatientStatusSteps"
    | "bookingPersonalDataSteps"
    | "bookingPrivacySteps",
  flowKey: BookingFlowKey,
) {
  switch (tableName) {
    case "bookingCalendarReachedSteps": {
      return (
        (await ctx.db
          .query("bookingCalendarReachedSteps")
          .withIndex("by_userId_practiceId_ruleSetId", (q) =>
            q
              .eq("userId", flowKey.userId)
              .eq("practiceId", flowKey.practiceId)
              .eq("ruleSetId", flowKey.ruleSetId),
          )
          .first()) ?? null
      );
    }
    case "bookingExistingDoctorSelectionSteps": {
      return (
        (await ctx.db
          .query("bookingExistingDoctorSelectionSteps")
          .withIndex("by_userId_practiceId_ruleSetId", (q) =>
            q
              .eq("userId", flowKey.userId)
              .eq("practiceId", flowKey.practiceId)
              .eq("ruleSetId", flowKey.ruleSetId),
          )
          .first()) ?? null
      );
    }
    case "bookingLocationSteps": {
      return (
        (await ctx.db
          .query("bookingLocationSteps")
          .withIndex("by_userId_practiceId_ruleSetId", (q) =>
            q
              .eq("userId", flowKey.userId)
              .eq("practiceId", flowKey.practiceId)
              .eq("ruleSetId", flowKey.ruleSetId),
          )
          .first()) ?? null
      );
    }
    case "bookingNewDataSharingSteps": {
      return (
        (await ctx.db
          .query("bookingNewDataSharingSteps")
          .withIndex("by_userId_practiceId_ruleSetId", (q) =>
            q
              .eq("userId", flowKey.userId)
              .eq("practiceId", flowKey.practiceId)
              .eq("ruleSetId", flowKey.ruleSetId),
          )
          .first()) ?? null
      );
    }
    case "bookingNewGkvDetailSteps": {
      return (
        (await ctx.db
          .query("bookingNewGkvDetailSteps")
          .withIndex("by_userId_practiceId_ruleSetId", (q) =>
            q
              .eq("userId", flowKey.userId)
              .eq("practiceId", flowKey.practiceId)
              .eq("ruleSetId", flowKey.ruleSetId),
          )
          .first()) ?? null
      );
    }
    case "bookingNewInsuranceTypeSteps": {
      return (
        (await ctx.db
          .query("bookingNewInsuranceTypeSteps")
          .withIndex("by_userId_practiceId_ruleSetId", (q) =>
            q
              .eq("userId", flowKey.userId)
              .eq("practiceId", flowKey.practiceId)
              .eq("ruleSetId", flowKey.ruleSetId),
          )
          .first()) ?? null
      );
    }
    case "bookingNewPkvConsentSteps": {
      return (
        (await ctx.db
          .query("bookingNewPkvConsentSteps")
          .withIndex("by_userId_practiceId_ruleSetId", (q) =>
            q
              .eq("userId", flowKey.userId)
              .eq("practiceId", flowKey.practiceId)
              .eq("ruleSetId", flowKey.ruleSetId),
          )
          .first()) ?? null
      );
    }
    case "bookingNewPkvDetailSteps": {
      return (
        (await ctx.db
          .query("bookingNewPkvDetailSteps")
          .withIndex("by_userId_practiceId_ruleSetId", (q) =>
            q
              .eq("userId", flowKey.userId)
              .eq("practiceId", flowKey.practiceId)
              .eq("ruleSetId", flowKey.ruleSetId),
          )
          .first()) ?? null
      );
    }
    case "bookingPatientStatusSteps": {
      return (
        (await ctx.db
          .query("bookingPatientStatusSteps")
          .withIndex("by_userId_practiceId_ruleSetId", (q) =>
            q
              .eq("userId", flowKey.userId)
              .eq("practiceId", flowKey.practiceId)
              .eq("ruleSetId", flowKey.ruleSetId),
          )
          .first()) ?? null
      );
    }
    case "bookingPersonalDataSteps": {
      return (
        (await ctx.db
          .query("bookingPersonalDataSteps")
          .withIndex("by_userId_practiceId_ruleSetId", (q) =>
            q
              .eq("userId", flowKey.userId)
              .eq("practiceId", flowKey.practiceId)
              .eq("ruleSetId", flowKey.ruleSetId),
          )
          .first()) ?? null
      );
    }
    case "bookingPrivacySteps": {
      return (
        (await ctx.db
          .query("bookingPrivacySteps")
          .withIndex("by_userId_practiceId_ruleSetId", (q) =>
            q
              .eq("userId", flowKey.userId)
              .eq("practiceId", flowKey.practiceId)
              .eq("ruleSetId", flowKey.ruleSetId),
          )
          .first()) ?? null
      );
    }
  }
}
function hasFlowStepRows(rows: BookingFlowRows): boolean {
  return (
    rows.privacy !== null ||
    rows.location !== null ||
    rows.patientStatus !== null ||
    rows.existingDoctor !== null ||
    rows.newInsuranceType !== null ||
    rows.newGkvDetail !== null ||
    rows.newPkvConsent !== null ||
    rows.newPkvDetail !== null ||
    rows.personalData !== null ||
    rows.newDataSharing !== null
  );
}
function hasRequiredMedicalHistoryEntries(
  row: BookingFlowRows["medicalHistoryEntry"],
): boolean {
  return row?.isComplete === true;
}
async function loadFlowRows(
  ctx: MutationCtx | QueryCtx,
  flowKey: BookingFlowKey,
) {
  const [
    calendarReached,
    existingDoctor,
    location,
    newDataSharing,
    newGkvDetail,
    newInsuranceType,
    newPkvConsent,
    newPkvDetail,
    patientStatus,
    personalData,
    privacy,
    dataSharingContacts,
    medicalHistoryEntry,
  ] = await Promise.all([
    getFlowRow(ctx, "bookingCalendarReachedSteps", flowKey),
    getFlowRow(ctx, "bookingExistingDoctorSelectionSteps", flowKey),
    getFlowRow(ctx, "bookingLocationSteps", flowKey),
    getFlowRow(ctx, "bookingNewDataSharingSteps", flowKey),
    getFlowRow(ctx, "bookingNewGkvDetailSteps", flowKey),
    getFlowRow(ctx, "bookingNewInsuranceTypeSteps", flowKey),
    getFlowRow(ctx, "bookingNewPkvConsentSteps", flowKey),
    getFlowRow(ctx, "bookingNewPkvDetailSteps", flowKey),
    getFlowRow(ctx, "bookingPatientStatusSteps", flowKey),
    getFlowRow(ctx, "bookingPersonalDataSteps", flowKey),
    getFlowRow(ctx, "bookingPrivacySteps", flowKey),
    ctx.db
      .query("bookingNewDataSharingContactRows")
      .withIndex("by_userId_practiceId_ruleSetId_index", (q) =>
        q
          .eq("userId", flowKey.userId)
          .eq("practiceId", flowKey.practiceId)
          .eq("ruleSetId", flowKey.ruleSetId),
      )
      .collect(),
    ctx.db
      .query("bookingMedicalHistoryEntries")
      .withIndex("by_userId_practiceId_ruleSetId", (q) =>
        q
          .eq("userId", flowKey.userId)
          .eq("practiceId", flowKey.practiceId)
          .eq("ruleSetId", flowKey.ruleSetId),
      )
      .first(),
  ]);

  return {
    calendarReached,
    dataSharingContacts,
    existingDoctor,
    location,
    medicalHistoryEntry,
    newDataSharing,
    newGkvDetail,
    newInsuranceType,
    newPkvConsent,
    newPkvDetail,
    patientStatus,
    personalData,
    privacy,
  };
}

async function markCalendarReached(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
): Promise<void> {
  const existing = await getFlowRow(
    ctx,
    "bookingCalendarReachedSteps",
    flowKey,
  );
  const now = BigInt(Date.now());
  if (existing) {
    await ctx.db.patch("bookingCalendarReachedSteps", existing._id, {
      lastModified: now,
    });
    return;
  }
  await ctx.db.insert(
    "bookingCalendarReachedSteps",
    flowScope(flowKey, {
      createdAt: now,
      lastModified: now,
    }),
  );
}

function materializeDataSharingContacts(
  rows: BookingFlowRows["dataSharingContacts"],
): DataSharingContactInput[] {
  return rows
    .toSorted((left, right) => left.index - right.index)
    .map((row) =>
      asDataSharingContactInput({
        city: row.city,
        dateOfBirth: row.dateOfBirth,
        firstName: row.firstName,
        gender: row.gender,
        lastName: row.lastName,
        phoneNumber: row.phoneNumber,
        postalCode: row.postalCode,
        street: row.street,
        ...(row.title === undefined ? {} : { title: row.title }),
      }),
    );
}

function materializeMedicalHistory(
  row: BookingFlowRows["medicalHistoryEntry"],
): BookingMedicalHistory | undefined {
  if (!row) {
    return undefined;
  }

  const allergiesDescription = [row.allergyNotes, row.intoleranceNotes]
    .filter((value) => value !== undefined && value.trim() !== "")
    .join("; ");
  const otherConditionParts = [
    row.hasThyroidCondition ? "Schilddrüsenerkrankung" : undefined,
    row.hasLiverCondition ? "Lebererkrankung" : undefined,
    row.hasKidneyCondition ? "Nierenerkrankung" : undefined,
    row.hasLipidDisorder ? "Fettstoffwechselstörung" : undefined,
    row.hasGout ? "Gicht" : undefined,
    row.hasHypertension ? "Bluthochdruck" : undefined,
    row.hasCirculationDisorder ? "Durchblutungsstörung" : undefined,
    row.hasVaricoseVeins ? "Krampfadern" : undefined,
    row.hasCancer ? "Krebserkrankung" : undefined,
    row.hasDepression ? "Depression" : undefined,
    row.smokes ? "Rauchen" : undefined,
    row.operationNotes,
    row.symptomNotes,
    row.otherConditionNotes,
  ].filter((value) => value !== undefined && value.trim() !== "");

  return {
    ...(allergiesDescription.length === 0 ? {} : { allergiesDescription }),
    ...(row.medicationNotes === undefined
      ? {}
      : { currentMedications: row.medicationNotes }),
    hasAllergies: row.hasAllergies || row.hasIntolerance,
    hasDiabetes: row.hasDiabetes,
    hasHeartCondition:
      row.hasHeartCondition ||
      row.hasHypertension ||
      row.hasCirculationDisorder,
    hasLungCondition: row.hasLungCondition,
    ...(otherConditionParts.length === 0
      ? {}
      : { otherConditions: otherConditionParts.join("; ") }),
  };
}

function materializePersonalData(
  row: BookingFlowRows["personalData"],
): BookingPersonalData | undefined {
  if (!row) {
    return undefined;
  }

  return asPersonalDataInput({
    city: row.city,
    dateOfBirth: row.dateOfBirth,
    email: row.email,
    firstName: row.firstName,
    gender: row.gender,
    lastName: row.lastName,
    phoneNumber: row.phoneNumber,
    postalCode: row.postalCode,
    street: row.street,
    ...(row.title === undefined ? {} : { title: row.title }),
  });
}

async function materializeState(
  ctx: MutationCtx | QueryCtx,
  flowKey: BookingFlowKey,
  rows: BookingFlowRows,
): Promise<BookingSessionState | null> {
  if (!hasFlowStepRows(rows)) {
    return null;
  }

  if (!rows.privacy?.consent) {
    return { step: "privacy" };
  }

  if (!rows.location) {
    return { step: "location" };
  }

  const locationName = await resolveLocationNameForPublicState(
    ctx.db,
    flowKey.ruleSetId,
    asLocationLineageKey(rows.location.locationLineageKey),
  );
  const locationLineageKey = rows.location.locationLineageKey;

  if (!rows.patientStatus) {
    return {
      locationLineageKey,
      locationName,
      step: "patient-status",
    };
  }

  if (rows.patientStatus.isNewPatient) {
    if (!rows.newInsuranceType) {
      return {
        isNewPatient: true,
        locationLineageKey,
        locationName,
        step: "new-insurance-type",
      };
    }

    if (rows.newInsuranceType.insuranceType === "gkv") {
      if (!rows.newGkvDetail) {
        return {
          insuranceType: "gkv",
          isNewPatient: true,
          locationLineageKey,
          locationName,
          step: "new-gkv-details",
        };
      }

      const personalData = materializePersonalData(rows.personalData);
      const medicalHistory = materializeMedicalHistory(
        rows.medicalHistoryEntry,
      );
      if (
        !personalData ||
        !hasRequiredMedicalHistoryEntries(rows.medicalHistoryEntry)
      ) {
        return {
          hzvStatus: rows.newGkvDetail.hzvStatus,
          insuranceType: "gkv",
          isNewPatient: true,
          locationLineageKey,
          locationName,
          ...(medicalHistory === undefined ? {} : { medicalHistory }),
          ...(personalData === undefined ? {} : { personalData }),
          step: "new-data-input",
        };
      }

      if (!rows.newDataSharing) {
        return {
          hzvStatus: rows.newGkvDetail.hzvStatus,
          insuranceType: "gkv",
          isNewPatient: true,
          locationLineageKey,
          locationName,
          ...(medicalHistory === undefined ? {} : { medicalHistory }),
          personalData,
          step: "new-data-sharing",
        };
      }

      return {
        dataSharingContacts: materializeDataSharingContacts(
          rows.dataSharingContacts,
        ),
        hzvStatus: rows.newGkvDetail.hzvStatus,
        insuranceType: "gkv",
        isNewPatient: true,
        locationLineageKey,
        locationName,
        ...(medicalHistory === undefined ? {} : { medicalHistory }),
        personalData,
        step: "new-calendar-selection",
      };
    }

    if (!rows.newPkvConsent) {
      return {
        insuranceType: "pkv",
        isNewPatient: true,
        locationLineageKey,
        locationName,
        step: "new-pvs-consent",
      };
    }

    if (!rows.newPkvDetail) {
      return {
        insuranceType: "pkv",
        isNewPatient: true,
        locationLineageKey,
        locationName,
        pvsConsent: true,
        step: "new-pkv-details",
      };
    }

    const personalData = materializePersonalData(rows.personalData);
    const medicalHistory = materializeMedicalHistory(rows.medicalHistoryEntry);
    if (
      !personalData ||
      !hasRequiredMedicalHistoryEntries(rows.medicalHistoryEntry)
    ) {
      return {
        ...(rows.newPkvDetail.beihilfeStatus === undefined
          ? {}
          : { beihilfeStatus: rows.newPkvDetail.beihilfeStatus }),
        insuranceType: "pkv",
        isNewPatient: true,
        locationLineageKey,
        locationName,
        ...(medicalHistory === undefined ? {} : { medicalHistory }),
        ...(personalData === undefined ? {} : { personalData }),
        ...(rows.newPkvDetail.pkvInsuranceType === undefined
          ? {}
          : { pkvInsuranceType: rows.newPkvDetail.pkvInsuranceType }),
        ...(rows.newPkvDetail.pkvTariff === undefined
          ? {}
          : { pkvTariff: rows.newPkvDetail.pkvTariff }),
        pvsConsent: true,
        step: "new-data-input",
      };
    }

    if (!rows.newDataSharing) {
      return {
        ...(rows.newPkvDetail.beihilfeStatus === undefined
          ? {}
          : { beihilfeStatus: rows.newPkvDetail.beihilfeStatus }),
        insuranceType: "pkv",
        isNewPatient: true,
        locationLineageKey,
        locationName,
        ...(medicalHistory === undefined ? {} : { medicalHistory }),
        personalData,
        ...(rows.newPkvDetail.pkvInsuranceType === undefined
          ? {}
          : { pkvInsuranceType: rows.newPkvDetail.pkvInsuranceType }),
        ...(rows.newPkvDetail.pkvTariff === undefined
          ? {}
          : { pkvTariff: rows.newPkvDetail.pkvTariff }),
        pvsConsent: true,
        step: "new-data-sharing",
      };
    }

    return {
      ...(rows.newPkvDetail.beihilfeStatus === undefined
        ? {}
        : { beihilfeStatus: rows.newPkvDetail.beihilfeStatus }),
      dataSharingContacts: materializeDataSharingContacts(
        rows.dataSharingContacts,
      ),
      insuranceType: "pkv",
      isNewPatient: true,
      locationLineageKey,
      locationName,
      ...(medicalHistory === undefined ? {} : { medicalHistory }),
      personalData,
      ...(rows.newPkvDetail.pkvInsuranceType === undefined
        ? {}
        : { pkvInsuranceType: rows.newPkvDetail.pkvInsuranceType }),
      ...(rows.newPkvDetail.pkvTariff === undefined
        ? {}
        : { pkvTariff: rows.newPkvDetail.pkvTariff }),
      pvsConsent: true,
      step: "new-calendar-selection",
    };
  }

  if (!rows.existingDoctor) {
    return {
      isNewPatient: false,
      locationLineageKey,
      locationName,
      step: "existing-doctor-selection",
    };
  }

  const practitionerLineageKey = rows.existingDoctor.practitionerLineageKey;
  const practitionerName = await resolvePractitionerNameForPublicState(
    ctx.db,
    flowKey.ruleSetId,
    asPractitionerLineageKey(practitionerLineageKey),
  );
  const personalData = materializePersonalData(rows.personalData);

  if (!personalData) {
    return {
      isNewPatient: false,
      locationLineageKey,
      locationName,
      practitionerLineageKey,
      practitionerName,
      step: "existing-data-input",
    };
  }

  return {
    isNewPatient: false,
    locationLineageKey,
    locationName,
    personalData,
    practitionerLineageKey,
    practitionerName,
    step: "existing-calendar-selection",
  };
}

function medicalHistoryRowFromInput(
  flowKey: BookingFlowKey,
  medicalHistory: BookingMedicalHistory,
  now: bigint,
): Omit<Doc<"bookingMedicalHistoryEntries">, "_creationTime" | "_id"> {
  const medicationNotes = medicalHistory.currentMedications?.trim();
  const allergyNotes = medicalHistory.allergiesDescription?.trim();
  const otherConditionNotes = medicalHistory.otherConditions?.trim();
  return {
    ...(allergyNotes === undefined || allergyNotes === ""
      ? {}
      : { allergyNotes }),
    createdAt: now,
    hasAllergies: medicalHistory.hasAllergies,
    hasCancer: false,
    hasCirculationDisorder: false,
    hasDepression: false,
    hasDiabetes: medicalHistory.hasDiabetes,
    hasGout: false,
    hasHeartCondition: medicalHistory.hasHeartCondition,
    hasHypertension: false,
    hasIntolerance: false,
    hasKidneyCondition: false,
    hasLipidDisorder: false,
    hasLiverCondition: false,
    hasLungCondition: medicalHistory.hasLungCondition,
    hasOperations: false,
    hasSymptoms: false,
    hasThyroidCondition: false,
    hasVaricoseVeins: false,
    isComplete: true,
    lastModified: now,
    ...(medicationNotes === undefined || medicationNotes === ""
      ? {}
      : { medicationNotes }),
    noAdditionalDetails:
      !medicalHistory.hasAllergies && (medicationNotes?.length ?? 0) === 0,
    noKnownConditions:
      !medicalHistory.hasDiabetes &&
      !medicalHistory.hasHeartCondition &&
      !medicalHistory.hasLungCondition &&
      (otherConditionNotes?.length ?? 0) === 0,
    ...(otherConditionNotes === undefined || otherConditionNotes === ""
      ? {}
      : { otherConditionNotes }),
    practiceId: flowKey.practiceId,
    ruleSetId: flowKey.ruleSetId,
    smokes: false,
    takesMedication: (medicationNotes?.length ?? 0) > 0,
    userId: flowKey.userId,
  };
}

async function persistDataSharingContacts(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
  contacts: DataSharingContactInput[],
): Promise<void> {
  await deleteDataSharingContacts(ctx, flowKey);
  const now = BigInt(Date.now());
  for (const [index, contact] of contacts.entries()) {
    await ctx.db.insert("bookingNewDataSharingContactRows", {
      ...contact,
      createdAt: now,
      index,
      lastModified: now,
      practiceId: flowKey.practiceId,
      ruleSetId: flowKey.ruleSetId,
      userId: flowKey.userId,
    });
  }
}

async function persistMedicalHistory(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
  medicalHistory: BookingMedicalHistory,
): Promise<void> {
  const existingRows = await ctx.db
    .query("bookingMedicalHistoryEntries")
    .withIndex("by_userId_practiceId_ruleSetId", (q) =>
      q
        .eq("userId", flowKey.userId)
        .eq("practiceId", flowKey.practiceId)
        .eq("ruleSetId", flowKey.ruleSetId),
    )
    .first();

  const row = medicalHistoryRowFromInput(
    flowKey,
    medicalHistory,
    BigInt(Date.now()),
  );
  if (existingRows) {
    await ctx.db.patch("bookingMedicalHistoryEntries", existingRows._id, row);
  } else {
    await ctx.db.insert("bookingMedicalHistoryEntries", row);
  }
}

async function removeRowsAfterInsuranceType(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
): Promise<void> {
  const rows = await loadFlowRows(ctx, flowKey);
  await deleteDataSharingContacts(ctx, flowKey);
  if (rows.medicalHistoryEntry) {
    await ctx.db.delete(
      "bookingMedicalHistoryEntries",
      rows.medicalHistoryEntry._id,
    );
  }
  await deleteFlowRow(ctx, "bookingNewDataSharingSteps", rows.newDataSharing);
  await deleteFlowRow(ctx, "bookingPersonalDataSteps", rows.personalData);
  await deleteFlowRow(ctx, "bookingNewPkvDetailSteps", rows.newPkvDetail);
  await deleteFlowRow(ctx, "bookingNewPkvConsentSteps", rows.newPkvConsent);
  await deleteFlowRow(ctx, "bookingNewGkvDetailSteps", rows.newGkvDetail);
}

async function removeRowsAfterLocationSelection(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
): Promise<void> {
  const rows = await loadFlowRows(ctx, flowKey);
  await deleteDataSharingContacts(ctx, flowKey);
  if (rows.medicalHistoryEntry) {
    await ctx.db.delete(
      "bookingMedicalHistoryEntries",
      rows.medicalHistoryEntry._id,
    );
  }
  await deleteFlowRow(ctx, "bookingNewDataSharingSteps", rows.newDataSharing);
  await deleteFlowRow(ctx, "bookingPersonalDataSteps", rows.personalData);
  await deleteFlowRow(ctx, "bookingNewPkvDetailSteps", rows.newPkvDetail);
  await deleteFlowRow(ctx, "bookingNewPkvConsentSteps", rows.newPkvConsent);
  await deleteFlowRow(ctx, "bookingNewGkvDetailSteps", rows.newGkvDetail);
  await deleteFlowRow(
    ctx,
    "bookingNewInsuranceTypeSteps",
    rows.newInsuranceType,
  );
  await deleteFlowRow(
    ctx,
    "bookingExistingDoctorSelectionSteps",
    rows.existingDoctor,
  );
  await deleteFlowRow(ctx, "bookingPatientStatusSteps", rows.patientStatus);
}

async function removeRowsAfterNewPatientData(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
): Promise<void> {
  const rows = await loadFlowRows(ctx, flowKey);
  if (rows.newDataSharing) {
    await ctx.db.delete("bookingNewDataSharingSteps", rows.newDataSharing._id);
  }
  await deleteDataSharingContacts(ctx, flowKey);
}

async function removeRowsAfterPatientStatus(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
): Promise<void> {
  const rows = await loadFlowRows(ctx, flowKey);
  await deleteDataSharingContacts(ctx, flowKey);
  if (rows.medicalHistoryEntry) {
    await ctx.db.delete(
      "bookingMedicalHistoryEntries",
      rows.medicalHistoryEntry._id,
    );
  }
  await deleteFlowRow(ctx, "bookingNewDataSharingSteps", rows.newDataSharing);
  await deleteFlowRow(ctx, "bookingPersonalDataSteps", rows.personalData);
  await deleteFlowRow(ctx, "bookingNewPkvDetailSteps", rows.newPkvDetail);
  await deleteFlowRow(ctx, "bookingNewPkvConsentSteps", rows.newPkvConsent);
  await deleteFlowRow(ctx, "bookingNewGkvDetailSteps", rows.newGkvDetail);
  await deleteFlowRow(
    ctx,
    "bookingNewInsuranceTypeSteps",
    rows.newInsuranceType,
  );
  await deleteFlowRow(
    ctx,
    "bookingExistingDoctorSelectionSteps",
    rows.existingDoctor,
  );
}

async function removeRowsFromExistingDataInput(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
): Promise<void> {
  const rows = await loadFlowRows(ctx, flowKey);
  await deleteDataSharingContacts(ctx, flowKey);
  if (rows.medicalHistoryEntry) {
    await ctx.db.delete(
      "bookingMedicalHistoryEntries",
      rows.medicalHistoryEntry._id,
    );
  }
  await deleteFlowRow(ctx, "bookingNewDataSharingSteps", rows.newDataSharing);
  await deleteFlowRow(ctx, "bookingPersonalDataSteps", rows.personalData);
}

async function removeRowsFromNewDataInput(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
): Promise<void> {
  await removeRowsFromExistingDataInput(ctx, flowKey);
}

async function removeRowsFromNewDataSharing(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
): Promise<void> {
  const rows = await loadFlowRows(ctx, flowKey);
  await deleteDataSharingContacts(ctx, flowKey);
  if (rows.newDataSharing) {
    await ctx.db.delete("bookingNewDataSharingSteps", rows.newDataSharing._id);
  }
}

async function removeRowsFromNewPkvDetails(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
): Promise<void> {
  const rows = await loadFlowRows(ctx, flowKey);
  await deleteDataSharingContacts(ctx, flowKey);
  if (rows.medicalHistoryEntry) {
    await ctx.db.delete(
      "bookingMedicalHistoryEntries",
      rows.medicalHistoryEntry._id,
    );
  }
  await deleteFlowRow(ctx, "bookingNewDataSharingSteps", rows.newDataSharing);
  await deleteFlowRow(ctx, "bookingPersonalDataSteps", rows.personalData);
  await deleteFlowRow(ctx, "bookingNewPkvDetailSteps", rows.newPkvDetail);
}

async function requireActiveFlow(
  ctx: MutationCtx | QueryCtx,
  flowKey: BookingFlowKey,
): Promise<{
  rows: BookingFlowRows;
  state: BookingSessionState;
}> {
  const rows = await loadFlowRows(ctx, flowKey);
  const state = await materializeState(ctx, flowKey, rows);
  if (!state) {
    throw new Error("Booking flow not found");
  }
  return { rows, state };
}

async function requireActiveFlowAtStep(
  ctx: MutationCtx | QueryCtx,
  flowKey: BookingFlowKey,
  expectedStep: BookingSessionState["step"],
  errorMessage: string,
): Promise<{
  rows: BookingFlowRows;
  state: BookingSessionState;
}> {
  const activeFlow = await requireActiveFlow(ctx, flowKey);
  if (activeFlow.state.step !== expectedStep) {
    throw new Error(errorMessage);
  }
  return activeFlow;
}

async function requireBookingRuleSetBelongsToPractice(
  ctx: MutationCtx | QueryCtx,
  args: Pick<BookingFlowKey, "practiceId" | "ruleSetId">,
): Promise<void> {
  const practice = await ctx.db.get("practices", args.practiceId);
  if (!practice) {
    throw new Error("Practice not found.");
  }
  if (practice.currentActiveRuleSetId !== args.ruleSetId) {
    throw new Error("Rule set is not active for this practice.");
  }
  const ruleSet = await ctx.db.get("ruleSets", args.ruleSetId);
  if (!ruleSet) {
    throw new Error("Rule set not found.");
  }
  if (ruleSet.practiceId !== args.practiceId) {
    throw new Error("Rule set does not belong to this practice.");
  }
}

async function requireCurrentUserCanStartBooking(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
): Promise<void> {
  const bookingBlock = await ctx.db
    .query("onlineAccountBlocks")
    .withIndex("by_userId_practiceId", (q) =>
      q.eq("userId", flowKey.userId).eq("practiceId", flowKey.practiceId),
    )
    .first();

  if (bookingBlock) {
    throw new Error("This account is blocked from online booking.");
  }

  const unresolvedFutureHolds =
    await getFutureLegacyUnmatchedBookingHoldsForUser(ctx, {
      scope: { practiceId: flowKey.practiceId },
      userId: flowKey.userId,
    });
  if (unresolvedFutureHolds.length > 0) {
    throw new Error(
      "This account has an unresolved imported future booking and cannot start another online booking.",
    );
  }

  const userAppointments = await ctx.db
    .query("appointments")
    .withIndex("by_userId", (q) => q.eq("userId", flowKey.userId))
    .collect();
  const now = Temporal.Now.instant().epochMilliseconds;
  const hasFutureAppointment = userAppointments.some((appointment) => {
    if (
      appointment.practiceId !== flowKey.practiceId ||
      appointment.cancelledAt !== undefined ||
      appointment.isSimulation === true
    ) {
      return false;
    }

    try {
      return (
        Temporal.ZonedDateTime.from(appointment.start).epochMilliseconds > now
      );
    } catch {
      return false;
    }
  });

  if (hasFutureAppointment) {
    throw new Error(
      "This account already has a future appointment and cannot start another online booking.",
    );
  }
}

async function requireOfferedNewPatientSlot(
  ctx: MutationCtx,
  args: {
    appointmentTypeLineageKey: Id<"appointmentTypes">;
    locationLineageKey: LocationLineageKey;
    patientDateOfBirth: string;
    scope: PatientBookingScope;
    selectedSlot: {
      practitionerLineageKey: Id<"practitioners">;
      startTime: ZonedDateTimeString;
    };
  },
): Promise<void> {
  await requireOfferedPatientSlot(ctx, {
    appointmentTypeLineageKey: args.appointmentTypeLineageKey,
    isNewPatient: true,
    locationLineageKey: args.locationLineageKey,
    patientDateOfBirth: args.patientDateOfBirth,
    practitionerLineageKey: asPractitionerLineageKey(
      args.selectedSlot.practitionerLineageKey,
    ),
    scope: args.scope,
    startTime: args.selectedSlot.startTime,
  });
}

async function requireOfferedPatientSlot(
  ctx: MutationCtx,
  args: {
    appointmentTypeLineageKey: Id<"appointmentTypes">;
    isNewPatient: boolean;
    locationLineageKey: LocationLineageKey;
    patientDateOfBirth: string;
    practitionerLineageKey: PractitionerLineageKey;
    scope: PatientBookingScope;
    startTime: ZonedDateTimeString;
  },
): Promise<void> {
  const selectedDate = Temporal.ZonedDateTime.from(args.startTime)
    .toPlainDate()
    .toString();
  const slotsResult = await ctx.runQuery(
    internal.scheduling.getSlotsForDayInternal,
    {
      date: selectedDate,
      enforceFutureOnly: true,
      practiceId: args.scope.practiceId,
      ruleSetId: args.scope.ruleSetId,
      scope: "real",
      simulatedContext: {
        appointmentTypeLineageKey: args.appointmentTypeLineageKey,
        clientType: "Online",
        locationLineageKey: args.locationLineageKey,
        patient: {
          dateOfBirth: args.patientDateOfBirth,
          isNew: args.isNewPatient,
        },
      },
    },
  );
  const matchingSlot = slotsResult.slots.some(
    (slot) =>
      slot.status === "AVAILABLE" &&
      slot.startTime === args.startTime &&
      slot.locationLineageKey === args.locationLineageKey &&
      slot.practitionerLineageKey === args.practitionerLineageKey,
  );
  if (!matchingSlot) {
    throw new Error("Selected slot is no longer available");
  }
}

function requireSelectableRuleSetEntity<
  T extends {
    deleted?: boolean;
    practiceId?: Id<"practices">;
    ruleSetId?: Id<"ruleSets">;
  },
>(params: {
  entity: null | T | undefined;
  entityLabel: "Behandler" | "Standort" | "Terminart";
  expectedPracticeId?: Id<"practices">;
  expectedRuleSetId?: Id<"ruleSets">;
}): T {
  const { entity, entityLabel, expectedPracticeId, expectedRuleSetId } = params;
  if (!entity) {
    throw new Error(`Ungültige ${entityLabel.toLowerCase()}.`);
  }
  if (
    expectedPracticeId !== undefined &&
    entity.practiceId !== expectedPracticeId
  ) {
    throw new Error(`Ungültige ${entityLabel.toLowerCase()}.`);
  }
  if (
    expectedRuleSetId !== undefined &&
    entity.ruleSetId !== expectedRuleSetId
  ) {
    throw new Error(`Ungültige ${entityLabel.toLowerCase()}.`);
  }
  if (isRuleSetEntityDeleted(entity)) {
    throw new Error(
      `${entityLabel} wurde in diesem Regelset gelöscht und kann nicht mehr neu ausgewählt werden.`,
    );
  }
  return entity;
}

async function resolveLocationNameForPublicState(
  db: MutationCtx["db"] | QueryCtx["db"],
  ruleSetId: Id<"ruleSets">,
  locationLineageKey: LocationLineageKey,
): Promise<string> {
  const locationId = await resolveLocationIdForRuleSetByLineage(db, {
    lineageKey: locationLineageKey,
    ruleSetId,
  });
  const location = await db.get("locations", locationId);
  if (!location || isRuleSetEntityDeleted(location)) {
    throw new Error(`Standort ${locationLineageKey} ist nicht verfügbar.`);
  }
  return location.name;
}

async function resolvePractitionerNameForPublicState(
  db: MutationCtx["db"] | QueryCtx["db"],
  ruleSetId: Id<"ruleSets">,
  practitionerLineageKey: PractitionerLineageKey,
): Promise<string> {
  const practitionerId = await resolvePractitionerIdForRuleSetByLineage(db, {
    lineageKey: practitionerLineageKey,
    ruleSetId,
  });
  const practitioner = await db.get("practitioners", practitionerId);
  if (!practitioner || isRuleSetEntityDeleted(practitioner)) {
    throw new Error(`Behandler ${practitionerLineageKey} ist nicht verfügbar.`);
  }
  return practitioner.name;
}

async function rewindFlowToStep(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
  targetStep: BackTargetStep,
): Promise<void> {
  switch (targetStep) {
    case "existing-data-input": {
      await removeRowsFromExistingDataInput(ctx, flowKey);
      return;
    }
    case "existing-doctor-selection": {
      await removeRowsAfterPatientStatus(ctx, flowKey);
      return;
    }
    case "location": {
      await removeRowsAfterLocationSelection(ctx, flowKey);
      const rows = await loadFlowRows(ctx, flowKey);
      await deleteFlowRow(ctx, "bookingLocationSteps", rows.location);
      return;
    }
    case "new-data-input": {
      await removeRowsFromNewDataInput(ctx, flowKey);
      return;
    }
    case "new-data-sharing": {
      await removeRowsFromNewDataSharing(ctx, flowKey);
      return;
    }
    case "new-gkv-details":
    case "new-pvs-consent": {
      await removeRowsAfterInsuranceType(ctx, flowKey);
      return;
    }
    case "new-insurance-type": {
      await removeRowsAfterPatientStatus(ctx, flowKey);
      return;
    }
    case "new-pkv-details": {
      await removeRowsFromNewPkvDetails(ctx, flowKey);
      return;
    }
    case "patient-status": {
      await removeRowsAfterPatientStatus(ctx, flowKey);
      const rows = await loadFlowRows(ctx, flowKey);
      await deleteFlowRow(ctx, "bookingPatientStatusSteps", rows.patientStatus);
      return;
    }
    case "privacy": {
      await deleteFlowRows(ctx, flowKey);
      await upsertPrivacyStep(ctx, flowKey, false);
      return;
    }
  }
}

async function upsertExistingDoctorStep(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
  practitionerLineageKey: Id<"practitioners">,
) {
  const existing = await getFlowRow(
    ctx,
    "bookingExistingDoctorSelectionSteps",
    flowKey,
  );
  const now = BigInt(Date.now());
  const data = flowScope(flowKey, {
    createdAt: now,
    lastModified: now,
    practitionerLineageKey,
  });
  if (existing) {
    await ctx.db.patch("bookingExistingDoctorSelectionSteps", existing._id, {
      lastModified: now,
      practitionerLineageKey,
    });
    return;
  }
  await ctx.db.insert("bookingExistingDoctorSelectionSteps", data);
}

async function upsertLocationStep(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
  locationLineageKey: Id<"locations">,
) {
  const existing = await getFlowRow(ctx, "bookingLocationSteps", flowKey);
  const now = BigInt(Date.now());
  if (existing) {
    await ctx.db.patch("bookingLocationSteps", existing._id, {
      lastModified: now,
      locationLineageKey,
    });
    return;
  }
  await ctx.db.insert(
    "bookingLocationSteps",
    flowScope(flowKey, {
      createdAt: now,
      lastModified: now,
      locationLineageKey,
    }),
  );
}

async function upsertNewDataSharingStep(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
) {
  const existing = await getFlowRow(ctx, "bookingNewDataSharingSteps", flowKey);
  const now = BigInt(Date.now());
  if (existing) {
    await ctx.db.patch("bookingNewDataSharingSteps", existing._id, {
      lastModified: now,
    });
    return;
  }
  await ctx.db.insert(
    "bookingNewDataSharingSteps",
    flowScope(flowKey, {
      createdAt: now,
      lastModified: now,
    }),
  );
}

async function upsertNewGkvDetailStep(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
  hzvStatus: Doc<"bookingNewGkvDetailSteps">["hzvStatus"],
) {
  const existing = await getFlowRow(ctx, "bookingNewGkvDetailSteps", flowKey);
  const now = BigInt(Date.now());
  if (existing) {
    await ctx.db.patch("bookingNewGkvDetailSteps", existing._id, {
      hzvStatus,
      lastModified: now,
    });
    return;
  }
  await ctx.db.insert(
    "bookingNewGkvDetailSteps",
    flowScope(flowKey, {
      createdAt: now,
      hzvStatus,
      lastModified: now,
    }),
  );
}

async function upsertNewInsuranceTypeStep(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
  insuranceType: Doc<"bookingNewInsuranceTypeSteps">["insuranceType"],
) {
  const existing = await getFlowRow(
    ctx,
    "bookingNewInsuranceTypeSteps",
    flowKey,
  );
  const now = BigInt(Date.now());
  if (existing) {
    await ctx.db.patch("bookingNewInsuranceTypeSteps", existing._id, {
      insuranceType,
      lastModified: now,
    });
    return;
  }
  await ctx.db.insert(
    "bookingNewInsuranceTypeSteps",
    flowScope(flowKey, {
      createdAt: now,
      insuranceType,
      lastModified: now,
    }),
  );
}

async function upsertNewPkvConsentStep(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
) {
  const existing = await getFlowRow(ctx, "bookingNewPkvConsentSteps", flowKey);
  const now = BigInt(Date.now());
  if (existing) {
    await ctx.db.patch("bookingNewPkvConsentSteps", existing._id, {
      lastModified: now,
    });
    return;
  }
  await ctx.db.insert(
    "bookingNewPkvConsentSteps",
    flowScope(flowKey, {
      createdAt: now,
      lastModified: now,
    }),
  );
}

async function upsertNewPkvDetailStep(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
  details: Pick<
    Doc<"bookingNewPkvDetailSteps">,
    "beihilfeStatus" | "pkvInsuranceType" | "pkvTariff"
  >,
) {
  const existing = await getFlowRow(ctx, "bookingNewPkvDetailSteps", flowKey);
  const now = BigInt(Date.now());
  if (existing) {
    await ctx.db.patch("bookingNewPkvDetailSteps", existing._id, {
      ...(details.beihilfeStatus === undefined
        ? { beihilfeStatus: undefined }
        : { beihilfeStatus: details.beihilfeStatus }),
      lastModified: now,
      ...(details.pkvInsuranceType === undefined
        ? { pkvInsuranceType: undefined }
        : { pkvInsuranceType: details.pkvInsuranceType }),
      ...(details.pkvTariff === undefined
        ? { pkvTariff: undefined }
        : { pkvTariff: details.pkvTariff }),
    });
    return;
  }
  await ctx.db.insert(
    "bookingNewPkvDetailSteps",
    flowScope(flowKey, {
      ...(details.beihilfeStatus === undefined
        ? {}
        : { beihilfeStatus: details.beihilfeStatus }),
      createdAt: now,
      lastModified: now,
      ...(details.pkvInsuranceType === undefined
        ? {}
        : { pkvInsuranceType: details.pkvInsuranceType }),
      ...(details.pkvTariff === undefined
        ? {}
        : { pkvTariff: details.pkvTariff }),
    }),
  );
}

async function upsertPatientStatusStep(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
  isNewPatient: boolean,
) {
  const existing = await getFlowRow(ctx, "bookingPatientStatusSteps", flowKey);
  const now = BigInt(Date.now());
  if (existing) {
    await ctx.db.patch("bookingPatientStatusSteps", existing._id, {
      isNewPatient,
      lastModified: now,
    });
    return;
  }
  await ctx.db.insert(
    "bookingPatientStatusSteps",
    flowScope(flowKey, {
      createdAt: now,
      isNewPatient,
      lastModified: now,
    }),
  );
}

async function upsertPersonalDataStep(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
  personalData: BookingPersonalData,
) {
  const existing = await getFlowRow(ctx, "bookingPersonalDataSteps", flowKey);
  const now = BigInt(Date.now());
  const patch = {
    city: personalData.city,
    dateOfBirth: personalData.dateOfBirth,
    email: personalData.email,
    firstName: personalData.firstName,
    gender: personalData.gender,
    lastModified: now,
    lastName: personalData.lastName,
    phoneNumber: personalData.phoneNumber,
    postalCode: personalData.postalCode,
    street: personalData.street,
    ...(personalData.title === undefined
      ? { title: undefined }
      : { title: personalData.title }),
  };
  const insertData = {
    city: personalData.city,
    createdAt: now,
    dateOfBirth: personalData.dateOfBirth,
    email: personalData.email,
    firstName: personalData.firstName,
    gender: personalData.gender,
    lastModified: now,
    lastName: personalData.lastName,
    phoneNumber: personalData.phoneNumber,
    postalCode: personalData.postalCode,
    street: personalData.street,
    ...(personalData.title === undefined ? {} : { title: personalData.title }),
  };
  if (existing) {
    await ctx.db.patch("bookingPersonalDataSteps", existing._id, patch);
    return;
  }
  await ctx.db.insert(
    "bookingPersonalDataSteps",
    flowScope(flowKey, insertData),
  );
}

async function upsertPrivacyStep(
  ctx: MutationCtx,
  flowKey: BookingFlowKey,
  consent: boolean,
) {
  const existing = await getFlowRow(ctx, "bookingPrivacySteps", flowKey);
  const now = BigInt(Date.now());
  if (existing) {
    await ctx.db.patch("bookingPrivacySteps", existing._id, {
      consent,
      lastModified: now,
    });
    return;
  }
  await ctx.db.insert(
    "bookingPrivacySteps",
    flowScope(flowKey, {
      consent,
      createdAt: now,
      lastModified: now,
    }),
  );
}

export const getActiveForUser = query({
  args: FLOW_KEY_VALIDATOR,
  handler: async (ctx, args) => {
    const flowKey = await getFlowKeyForQuery(ctx, args);

    const rows = await loadFlowRows(ctx, flowKey);
    const state = await materializeState(ctx, flowKey, rows);
    if (!state) {
      return null;
    }

    return {
      practiceId: flowKey.practiceId,
      ruleSetId: flowKey.ruleSetId,
      state,
      userId: flowKey.userId,
    };
  },
  returns: BOOKING_SESSION_RETURN_VALIDATOR,
});

export const create = mutation({
  args: FLOW_KEY_VALIDATOR,
  handler: async (ctx, args) => {
    const flowKey = await getFlowKeyForMutation(ctx, args);
    await requireCurrentUserCanStartBooking(ctx, flowKey);
    await upsertPrivacyStep(ctx, flowKey, false);
    return null;
  },
  returns: v.null(),
});

export const remove = mutation({
  args: FLOW_KEY_VALIDATOR,
  handler: async (ctx, args) => {
    const flowKey = await getFlowKeyForMutation(ctx, args);
    await deleteFlowRows(ctx, flowKey);
    return null;
  },
  returns: v.null(),
});

export const goBackToStep = mutation({
  args: {
    ...FLOW_KEY_VALIDATOR,
    targetStep: BACK_TARGET_STEP_VALIDATOR,
  },
  handler: async (ctx, args) => {
    const flowKey = await getFlowKeyForMutation(ctx, args);
    await requireCurrentUserCanStartBooking(ctx, flowKey);
    const { rows, state } = await requireActiveFlow(ctx, flowKey);
    const allowedTargetStep = getAllowedBackTargetStep(
      state,
      rows.calendarReached !== null,
    );
    if (allowedTargetStep !== args.targetStep) {
      throw new Error(
        "This booking step cannot go back to the requested step.",
      );
    }
    await rewindFlowToStep(ctx, flowKey, args.targetStep);
    return null;
  },
  returns: v.null(),
});

export const acceptPrivacy = mutation({
  args: FLOW_KEY_VALIDATOR,
  handler: async (ctx, args) => {
    const flowKey = await getFlowKeyForMutation(ctx, args);
    await assertCalendarNotReached(ctx, flowKey);
    await requireActiveFlowAtStep(
      ctx,
      flowKey,
      "privacy",
      "Privacy consent is not available in the current flow.",
    );
    await upsertPrivacyStep(ctx, flowKey, true);
    return null;
  },
  returns: v.null(),
});

export const selectLocation = mutation({
  args: {
    ...FLOW_KEY_VALIDATOR,
    locationLineageKey: v.id("locations"),
  },
  handler: async (ctx, args) => {
    const flowKey = await getFlowKeyForMutation(ctx, args);
    await assertCalendarNotReached(ctx, flowKey);
    await requireActiveFlowAtStep(
      ctx,
      flowKey,
      "location",
      "Location selection is not available in the current flow.",
    );

    const locationId = await resolveLocationIdForRuleSetByLineage(ctx.db, {
      lineageKey: asLocationLineageKey(args.locationLineageKey),
      ruleSetId: flowKey.ruleSetId,
    });
    requireSelectableRuleSetEntity({
      entity: await ctx.db.get("locations", locationId),
      entityLabel: "Standort",
      expectedPracticeId: flowKey.practiceId,
      expectedRuleSetId: flowKey.ruleSetId,
    });

    await upsertLocationStep(ctx, flowKey, args.locationLineageKey);
    await removeRowsAfterLocationSelection(ctx, flowKey);
    return null;
  },
  returns: v.null(),
});

export const selectNewPatient = mutation({
  args: FLOW_KEY_VALIDATOR,
  handler: async (ctx, args) => {
    const flowKey = await getFlowKeyForMutation(ctx, args);
    await assertCalendarNotReached(ctx, flowKey);
    await requireActiveFlowAtStep(
      ctx,
      flowKey,
      "patient-status",
      "Patient status is not available in the current flow.",
    );
    await upsertPatientStatusStep(ctx, flowKey, true);
    await removeRowsAfterPatientStatus(ctx, flowKey);
    return null;
  },
  returns: v.null(),
});

export const selectExistingPatient = mutation({
  args: FLOW_KEY_VALIDATOR,
  handler: async (ctx, args) => {
    const flowKey = await getFlowKeyForMutation(ctx, args);
    await assertCalendarNotReached(ctx, flowKey);
    await requireActiveFlowAtStep(
      ctx,
      flowKey,
      "patient-status",
      "Patient status is not available in the current flow.",
    );
    await upsertPatientStatusStep(ctx, flowKey, false);
    await removeRowsAfterPatientStatus(ctx, flowKey);
    return null;
  },
  returns: v.null(),
});

export const selectInsuranceType = mutation({
  args: {
    ...FLOW_KEY_VALIDATOR,
    insuranceType: insuranceTypeValidator,
  },
  handler: async (ctx, args) => {
    const flowKey = await getFlowKeyForMutation(ctx, args);
    await assertCalendarNotReached(ctx, flowKey);
    await requireActiveFlowAtStep(
      ctx,
      flowKey,
      "new-insurance-type",
      "Insurance type is not available in the current flow.",
    );

    await upsertNewInsuranceTypeStep(ctx, flowKey, args.insuranceType);
    await removeRowsAfterInsuranceType(ctx, flowKey);
    return null;
  },
  returns: v.null(),
});

export const confirmGkvDetails = mutation({
  args: {
    ...FLOW_KEY_VALIDATOR,
    hzvStatus: hzvStatusValidator,
  },
  handler: async (ctx, args) => {
    const flowKey = await getFlowKeyForMutation(ctx, args);
    await assertCalendarNotReached(ctx, flowKey);
    const { rows } = await requireActiveFlowAtStep(
      ctx,
      flowKey,
      "new-gkv-details",
      "GKV details are not available in the current flow.",
    );
    if (rows.newInsuranceType?.insuranceType !== "gkv") {
      throw new Error("GKV details are not available in the current flow.");
    }

    await upsertNewGkvDetailStep(ctx, flowKey, args.hzvStatus);
    return null;
  },
  returns: v.null(),
});

export const acceptPvsConsent = mutation({
  args: FLOW_KEY_VALIDATOR,
  handler: async (ctx, args) => {
    const flowKey = await getFlowKeyForMutation(ctx, args);
    await assertCalendarNotReached(ctx, flowKey);
    const { rows } = await requireActiveFlowAtStep(
      ctx,
      flowKey,
      "new-pvs-consent",
      "PVS consent is not available in the current flow.",
    );
    if (rows.newInsuranceType?.insuranceType !== "pkv") {
      throw new Error("PVS consent is not available in the current flow.");
    }

    await upsertNewPkvConsentStep(ctx, flowKey);
    return null;
  },
  returns: v.null(),
});

export const confirmPkvDetails = mutation({
  args: {
    ...FLOW_KEY_VALIDATOR,
    beihilfeStatus: v.optional(beihilfeStatusValidator),
    pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
    pkvTariff: v.optional(pkvTariffValidator),
    pvsConsent: v.literal(true),
  },
  handler: async (ctx, args) => {
    const flowKey = await getFlowKeyForMutation(ctx, args);
    await assertCalendarNotReached(ctx, flowKey);
    const { rows } = await requireActiveFlowAtStep(
      ctx,
      flowKey,
      "new-pkv-details",
      "PKV details are not available in the current flow.",
    );
    if (rows.newInsuranceType?.insuranceType !== "pkv" || !rows.newPkvConsent) {
      throw new Error("PKV details are not available in the current flow.");
    }

    await upsertNewPkvDetailStep(ctx, flowKey, {
      ...(args.beihilfeStatus === undefined
        ? {}
        : { beihilfeStatus: args.beihilfeStatus }),
      ...(args.pkvInsuranceType === undefined
        ? {}
        : { pkvInsuranceType: args.pkvInsuranceType }),
      ...(args.pkvTariff === undefined ? {} : { pkvTariff: args.pkvTariff }),
    });
    return null;
  },
  returns: v.null(),
});

export const submitNewPatientData = mutation({
  args: {
    ...FLOW_KEY_VALIDATOR,
    medicalHistory: v.optional(medicalHistoryValidator),
    personalData: personalDataValidator,
  },
  handler: async (ctx, args) => {
    const flowKey = await getFlowKeyForMutation(ctx, args);
    await assertCalendarNotReached(ctx, flowKey);
    const { rows } = await requireActiveFlowAtStep(
      ctx,
      flowKey,
      "new-data-input",
      "Personal data is not available in the current flow.",
    );
    const isGkv =
      rows.newInsuranceType?.insuranceType === "gkv" && !!rows.newGkvDetail;
    const isPkv =
      rows.newInsuranceType?.insuranceType === "pkv" &&
      !!rows.newPkvConsent &&
      !!rows.newPkvDetail;
    if (!isGkv && !isPkv) {
      throw new Error("Personal data is not available in the current flow.");
    }

    const personalData = asPersonalDataInput(args.personalData);
    await upsertPersonalDataStep(ctx, flowKey, personalData);
    await persistMedicalHistory(
      ctx,
      flowKey,
      args.medicalHistory ?? {
        hasAllergies: false,
        hasDiabetes: false,
        hasHeartCondition: false,
        hasLungCondition: false,
      },
    );
    await removeRowsAfterNewPatientData(ctx, flowKey);
    return null;
  },
  returns: v.null(),
});

export const submitNewDataSharing = mutation({
  args: {
    ...FLOW_KEY_VALIDATOR,
    dataSharingContacts: v.array(dataSharingContactInputValidator),
  },
  handler: async (ctx, args) => {
    const flowKey = await getFlowKeyForMutation(ctx, args);
    await assertCalendarNotReached(ctx, flowKey);
    await requireActiveFlowAtStep(
      ctx,
      flowKey,
      "new-data-sharing",
      "Data sharing is not available in the current flow.",
    );

    assertValidDataSharingContacts(args.dataSharingContacts);
    await upsertNewDataSharingStep(ctx, flowKey);
    await persistDataSharingContacts(
      ctx,
      flowKey,
      args.dataSharingContacts.map((contact) =>
        asDataSharingContactInput(contact),
      ),
    );
    await markCalendarReached(ctx, flowKey);
    return null;
  },
  returns: v.null(),
});

export const selectDoctor = mutation({
  args: {
    ...FLOW_KEY_VALIDATOR,
    practitionerLineageKey: v.id("practitioners"),
  },
  handler: async (ctx, args) => {
    const flowKey = await getFlowKeyForMutation(ctx, args);
    await assertCalendarNotReached(ctx, flowKey);
    await requireActiveFlowAtStep(
      ctx,
      flowKey,
      "existing-doctor-selection",
      "Doctor selection is not available in the current flow.",
    );
    const practitionerId = await resolvePractitionerIdForRuleSetByLineage(
      ctx.db,
      {
        lineageKey: asPractitionerLineageKey(args.practitionerLineageKey),
        ruleSetId: flowKey.ruleSetId,
      },
    );
    requireSelectableRuleSetEntity({
      entity: await ctx.db.get("practitioners", practitionerId),
      entityLabel: "Behandler",
      expectedPracticeId: flowKey.practiceId,
      expectedRuleSetId: flowKey.ruleSetId,
    });

    await upsertExistingDoctorStep(ctx, flowKey, args.practitionerLineageKey);
    return null;
  },
  returns: v.null(),
});

export const submitExistingPatientData = mutation({
  args: {
    ...FLOW_KEY_VALIDATOR,
    personalData: personalDataValidator,
  },
  handler: async (ctx, args) => {
    const flowKey = await getFlowKeyForMutation(ctx, args);
    await assertCalendarNotReached(ctx, flowKey);
    const { rows } = await requireActiveFlowAtStep(
      ctx,
      flowKey,
      "existing-data-input",
      "Personal data is not available in the current flow.",
    );
    if (!rows.existingDoctor) {
      throw new Error("Personal data is not available in the current flow.");
    }

    await upsertPersonalDataStep(
      ctx,
      flowKey,
      asPersonalDataInput(args.personalData),
    );
    await markCalendarReached(ctx, flowKey);
    return null;
  },
  returns: v.null(),
});

export const selectNewPatientSlot = mutation({
  args: {
    ...FLOW_KEY_VALIDATOR,
    appointmentTypeLineageKey: v.id("appointmentTypes"),
    reasonDescription: v.string(),
    selectedSlot: selectedSlotValidator,
  },
  handler: async (ctx, args) => {
    const flowKey = await getFlowKeyForMutation(ctx, args);
    const bookingScope = await requirePatientBookingScopeForMutation(ctx, {
      practiceId: flowKey.practiceId,
      ruleSetId: flowKey.ruleSetId,
    });
    await requireCurrentUserCanStartBooking(ctx, flowKey);
    const { rows, state } = await requireActiveFlow(ctx, flowKey);
    if (state.step !== "new-calendar-selection" || !rows.location) {
      throw new Error(
        "Calendar selection is not available in the current flow.",
      );
    }

    const personalData = materializePersonalData(rows.personalData);
    if (!personalData) {
      throw new Error("Missing personal data");
    }

    const selectedSlot = asSelectedSlotInput(args.selectedSlot);
    const reasonDescription = args.reasonDescription.trim();
    if (reasonDescription.length === 0) {
      throw new Error("Reason description is required");
    }
    assertSlotStartIsInFuture(selectedSlot.startTime);

    const appointmentTypeId = await resolveAppointmentTypeIdForRuleSetByLineage(
      ctx.db,
      {
        lineageKey: asAppointmentTypeLineageKey(args.appointmentTypeLineageKey),
        ruleSetId: flowKey.ruleSetId,
      },
    );
    const appointmentType = requireSelectableRuleSetEntity({
      entity: await ctx.db.get("appointmentTypes", appointmentTypeId),
      entityLabel: "Terminart",
      expectedRuleSetId: flowKey.ruleSetId,
    });
    await assertSlotAllowedByRules(ctx, {
      appointmentTypeId,
      locationLineageKey: asLocationLineageKey(
        rows.location.locationLineageKey,
      ),
      patientDateOfBirth: personalData.dateOfBirth,
      practitionerLineageKey: asPractitionerLineageKey(
        selectedSlot.practitionerLineageKey,
      ),
      scope: bookingScope,
      startTime: selectedSlot.startTime,
    });
    await requireOfferedNewPatientSlot(ctx, {
      appointmentTypeLineageKey: args.appointmentTypeLineageKey,
      locationLineageKey: asLocationLineageKey(
        rows.location.locationLineageKey,
      ),
      patientDateOfBirth: personalData.dateOfBirth,
      scope: bookingScope,
      selectedSlot,
    });

    const [locationId, practitionerId] = await Promise.all([
      resolveLocationIdForRuleSetByLineage(ctx.db, {
        lineageKey: asLocationLineageKey(rows.location.locationLineageKey),
        ruleSetId: flowKey.ruleSetId,
      }),
      resolvePractitionerIdForRuleSetByLineage(ctx.db, {
        lineageKey: asPractitionerLineageKey(
          selectedSlot.practitionerLineageKey,
        ),
        ruleSetId: flowKey.ruleSetId,
      }),
    ]);

    const appointmentId = await createAppointmentFromTrustedSource(ctx, {
      allowUnrelatedUserId: true,
      appointmentTypeId,
      isNewPatient: true,
      locationId,
      patientDateOfBirth: personalData.dateOfBirth,
      practiceId: flowKey.practiceId,
      practitionerId,
      start: selectedSlot.startTime,
      title: `Online-Termin: ${appointmentType.name}`,
      userId: flowKey.userId,
    });
    return { appointmentId };
  },
  returns: v.object({
    appointmentId: v.id("appointments"),
  }),
});

export const selectExistingPatientSlot = mutation({
  args: {
    ...FLOW_KEY_VALIDATOR,
    appointmentTypeLineageKey: v.id("appointmentTypes"),
    reasonDescription: v.string(),
    selectedSlot: selectedSlotValidator,
  },
  handler: async (ctx, args) => {
    const flowKey = await getFlowKeyForMutation(ctx, args);
    const bookingScope = await requirePatientBookingScopeForMutation(ctx, {
      practiceId: flowKey.practiceId,
      ruleSetId: flowKey.ruleSetId,
    });
    await requireCurrentUserCanStartBooking(ctx, flowKey);
    const { rows, state } = await requireActiveFlow(ctx, flowKey);
    if (
      state.step !== "existing-calendar-selection" ||
      !rows.location ||
      !rows.existingDoctor
    ) {
      throw new Error(
        "Calendar selection is not available in the current flow.",
      );
    }

    const personalData = materializePersonalData(rows.personalData);
    if (!personalData) {
      throw new Error("Missing personal data");
    }

    const selectedSlot = asSelectedSlotInput(args.selectedSlot);
    const reasonDescription = args.reasonDescription.trim();
    if (reasonDescription.length === 0) {
      throw new Error("Reason description is required");
    }
    assertSlotStartIsInFuture(selectedSlot.startTime);

    const appointmentTypeId = await resolveAppointmentTypeIdForRuleSetByLineage(
      ctx.db,
      {
        lineageKey: asAppointmentTypeLineageKey(args.appointmentTypeLineageKey),
        ruleSetId: flowKey.ruleSetId,
      },
    );
    const appointmentType = requireSelectableRuleSetEntity({
      entity: await ctx.db.get("appointmentTypes", appointmentTypeId),
      entityLabel: "Terminart",
      expectedRuleSetId: flowKey.ruleSetId,
    });
    await assertSlotAllowedByRules(ctx, {
      appointmentTypeId,
      locationLineageKey: asLocationLineageKey(
        rows.location.locationLineageKey,
      ),
      patientDateOfBirth: personalData.dateOfBirth,
      practitionerLineageKey: asPractitionerLineageKey(
        rows.existingDoctor.practitionerLineageKey,
      ),
      scope: bookingScope,
      startTime: selectedSlot.startTime,
    });
    await requireOfferedPatientSlot(ctx, {
      appointmentTypeLineageKey: args.appointmentTypeLineageKey,
      isNewPatient: false,
      locationLineageKey: asLocationLineageKey(
        rows.location.locationLineageKey,
      ),
      patientDateOfBirth: personalData.dateOfBirth,
      practitionerLineageKey: asPractitionerLineageKey(
        rows.existingDoctor.practitionerLineageKey,
      ),
      scope: bookingScope,
      startTime: selectedSlot.startTime,
    });

    const [locationId, practitionerId] = await Promise.all([
      resolveLocationIdForRuleSetByLineage(ctx.db, {
        lineageKey: asLocationLineageKey(rows.location.locationLineageKey),
        ruleSetId: flowKey.ruleSetId,
      }),
      resolvePractitionerIdForRuleSetByLineage(ctx.db, {
        lineageKey: asPractitionerLineageKey(
          rows.existingDoctor.practitionerLineageKey,
        ),
        ruleSetId: flowKey.ruleSetId,
      }),
    ]);

    const appointmentId = await createAppointmentFromTrustedSource(ctx, {
      allowUnrelatedUserId: true,
      appointmentTypeId,
      isNewPatient: false,
      locationId,
      patientDateOfBirth: personalData.dateOfBirth,
      practiceId: flowKey.practiceId,
      practitionerId,
      start: selectedSlot.startTime,
      title: `Online-Termin: ${appointmentType.name}`,
      userId: flowKey.userId,
    });
    return { appointmentId };
  },
  returns: v.object({
    appointmentId: v.id("appointments"),
  }),
});
