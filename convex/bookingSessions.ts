import { type GenericValidator, v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import type { Doc, Id } from "./_generated/dataModel";

import { isIsoDateString, isZonedDateTimeString } from "../lib/typed-regex.js";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import {
  resolveAppointmentTypeIdForRuleSetByLineage,
  resolveLocationIdForRuleSetByLineage,
  resolvePractitionerIdForRuleSetByLineage,
} from "./appointmentReferences";
import { createAppointmentFromTrustedSource } from "./appointments";
import {
  APPOINTMENT_TIMEZONE,
  type BookingSessionState,
  type DataSharingContact,
  type DataSharingContactInput,
  type InternalBookingSessionState,
  type InternalStateAtStep,
  ISO_DATE_REGEX,
  type MutationCtx,
  type QueryCtx,
  SESSION_TTL_MS,
  type SessionDoc,
  type SessionWithState,
  type StateAtStep,
  type StepInsertMap,
  type StepPatchMap,
  type StepQueryMap,
  type StepReadCtx,
  type StepSnapshotMetaKeys,
  type StepTableDocMap,
  type StepTableInput,
  type StepTableInsertData,
  type StepTableName,
  type StepTablePatch,
} from "./bookingSessions.shared";
import {
  type AppointmentTypeLineageKey,
  asAppointmentTypeLineageKey,
  asLocationLineageKey,
  asPractitionerLineageKey,
  type LocationLineageKey,
  type PractitionerLineageKey,
} from "./identity";
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
  type PersonalDataInput,
  type ZonedDateTimeString,
} from "./typedDtos";
import {
  ensureAuthenticatedUserId,
  getAuthenticatedUserIdForQuery,
} from "./userIdentity";

type SessionWithInternalState = SessionDoc & {
  state: InternalBookingSessionState;
};

const STALE_PUBLIC_SESSION_STATE_ERROR_PREFIX =
  "[BOOKING_SESSION:STALE_PUBLIC_STATE]";

function getCalendarStepForConfirmationState(
  state: Extract<
    BookingSessionState,
    { step: "existing-confirmation" | "new-confirmation" }
  >,
): "existing-calendar-selection" | "new-calendar-selection" {
  return state.step === "new-confirmation"
    ? "new-calendar-selection"
    : "existing-calendar-selection";
}

async function hasUpcomingVisibleAppointmentForConfirmationState(
  ctx: MutationCtx | QueryCtx,
  state: Extract<
    InternalBookingSessionState,
    { step: "existing-confirmation" | "new-confirmation" }
  >,
): Promise<boolean> {
  const appointment = await ctx.db.get("appointments", state.appointmentId);
  if (!appointment) {
    return false;
  }

  if (
    appointment.cancelledAt !== undefined ||
    appointment.isSimulation === true
  ) {
    return false;
  }

  try {
    return (
      Temporal.ZonedDateTime.from(appointment.start).epochMilliseconds >
      Temporal.Now.instant().epochMilliseconds
    );
  } catch {
    return false;
  }
}

async function hydrateInternalSessionState(
  ctx: MutationCtx | QueryCtx,
  session: SessionDoc,
): Promise<InternalBookingSessionState> {
  const step = session.state.step;
  const snapshot = await loadInternalStepSnapshot(ctx, session, step);
  if (STEP_SNAPSHOT_TABLES_BY_STEP[step].length > 0 && snapshot === null) {
    throw new Error(`Missing snapshot for booking session step '${step}'`);
  }

  const mergedState = snapshot === null ? { step } : { step, ...snapshot };
  const sanitizedState = sanitizeInternalState(step, mergedState);
  assertInternalHydratedStateConsistency(step, sanitizedState);
  return sanitizedState;
}

function isConfirmationState(
  state: BookingSessionState | InternalBookingSessionState,
): state is Extract<
  InternalBookingSessionState,
  { step: "existing-confirmation" | "new-confirmation" }
> {
  return (
    state.step === "existing-confirmation" || state.step === "new-confirmation"
  );
}

function isRecoverableSessionHydrationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.startsWith("Missing snapshot for booking session step") ||
      error.message.startsWith(STALE_PUBLIC_SESSION_STATE_ERROR_PREFIX))
  );
}

async function materializeInternalState(
  ctx: StepReadCtx,
  session: SessionDoc,
  state: InternalBookingSessionState,
): Promise<BookingSessionState> {
  const materialized: Record<string, unknown> = { ...state };

  if ("appointmentTypeLineageKey" in state) {
    materialized["appointmentTypeName"] =
      await resolveAppointmentTypeNameForPublicState(
        ctx.db,
        session.ruleSetId,
        asAppointmentTypeLineageKey(state.appointmentTypeLineageKey),
      );
  }
  if ("locationLineageKey" in state) {
    materialized["locationName"] = await resolveLocationNameForPublicState(
      ctx.db,
      session.ruleSetId,
      asLocationLineageKey(state.locationLineageKey),
    );
  }
  if ("practitionerLineageKey" in state) {
    materialized["practitionerName"] =
      await resolvePractitionerNameForPublicState(
        ctx.db,
        session.ruleSetId,
        asPractitionerLineageKey(state.practitionerLineageKey),
      );
  }

  const publicState = sanitizeState(session.state.step, {
    step: session.state.step,
    ...materialized,
  });
  return publicState;
}

async function materializePublicSessionState(
  ctx: StepReadCtx,
  session: SessionDoc,
  internalState: InternalBookingSessionState,
): Promise<BookingSessionState> {
  const materialized = await materializeInternalState(
    ctx,
    session,
    internalState,
  );
  assertHydratedStateConsistency(internalState.step, materialized);
  return materialized;
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

async function resolveAppointmentTypeNameForPublicState(
  db: MutationCtx["db"] | QueryCtx["db"],
  ruleSetId: Id<"ruleSets">,
  appointmentTypeLineageKey: AppointmentTypeLineageKey,
): Promise<string> {
  try {
    const appointmentTypeId = await resolveAppointmentTypeIdForRuleSetByLineage(
      db,
      {
        lineageKey: asAppointmentTypeLineageKey(appointmentTypeLineageKey),
        ruleSetId,
      },
    );
    const appointmentType = await db.get("appointmentTypes", appointmentTypeId);
    if (!appointmentType) {
      throw new Error(
        `Terminart ${appointmentTypeLineageKey} konnte nicht geladen werden.`,
      );
    }
    if (isRuleSetEntityDeleted(appointmentType)) {
      throw new Error(
        `Terminart ${appointmentTypeLineageKey} ist im Regelset nicht mehr verfügbar.`,
      );
    }
    return appointmentType.name;
  } catch (error) {
    if (error instanceof Error) {
      throw stalePublicSessionStateError(error);
    }
    throw error;
  }
}

async function resolveLocationIdForInternalState(
  db: MutationCtx["db"] | QueryCtx["db"],
  ruleSetId: Id<"ruleSets">,
  locationLineageKey: LocationLineageKey,
) {
  return await resolveLocationIdForRuleSetByLineage(db, {
    lineageKey: locationLineageKey,
    ruleSetId,
  });
}

async function resolveLocationNameForPublicState(
  db: MutationCtx["db"] | QueryCtx["db"],
  ruleSetId: Id<"ruleSets">,
  locationLineageKey: LocationLineageKey,
): Promise<string> {
  try {
    const locationId = await resolveLocationIdForRuleSetByLineage(db, {
      lineageKey: locationLineageKey,
      ruleSetId,
    });
    const location = await db.get("locations", locationId);
    if (!location) {
      throw new Error(
        `Standort ${locationLineageKey} konnte nicht geladen werden.`,
      );
    }
    if (isRuleSetEntityDeleted(location)) {
      throw new Error(
        `Standort ${locationLineageKey} ist im Regelset nicht mehr verfügbar.`,
      );
    }
    return location.name;
  } catch (error) {
    if (error instanceof Error) {
      throw stalePublicSessionStateError(error);
    }
    throw error;
  }
}

async function resolvePractitionerIdForInternalState(
  db: MutationCtx["db"] | QueryCtx["db"],
  ruleSetId: Id<"ruleSets">,
  practitionerLineageKey: PractitionerLineageKey,
) {
  return await resolvePractitionerIdForRuleSetByLineage(db, {
    lineageKey: practitionerLineageKey,
    ruleSetId,
  });
}

async function resolvePractitionerNameForPublicState(
  db: MutationCtx["db"] | QueryCtx["db"],
  ruleSetId: Id<"ruleSets">,
  practitionerLineageKey: PractitionerLineageKey,
): Promise<string> {
  try {
    const practitionerId = await resolvePractitionerIdForRuleSetByLineage(db, {
      lineageKey: practitionerLineageKey,
      ruleSetId,
    });
    const practitioner = await db.get("practitioners", practitionerId);
    if (!practitioner) {
      throw new Error(
        `Behandler ${practitionerLineageKey} konnte nicht geladen werden.`,
      );
    }
    if (isRuleSetEntityDeleted(practitioner)) {
      throw new Error(
        `Behandler ${practitionerLineageKey} ist im Regelset nicht mehr verfügbar.`,
      );
    }
    return practitioner.name;
  } catch (error) {
    if (error instanceof Error) {
      throw stalePublicSessionStateError(error);
    }
    throw error;
  }
}

function resolveStoredAppointmentTypeLineageKey(
  _db: MutationCtx["db"] | QueryCtx["db"],
  appointmentTypeLineageKey: AppointmentTypeLineageKey,
) {
  return appointmentTypeLineageKey;
}

function resolveStoredLocationLineageKey(
  _db: MutationCtx["db"] | QueryCtx["db"],
  locationLineageKey: LocationLineageKey,
) {
  return locationLineageKey;
}

function resolveStoredPractitionerLineageKey(
  _db: MutationCtx["db"] | QueryCtx["db"],
  practitionerLineageKey: PractitionerLineageKey,
) {
  return practitionerLineageKey;
}

function stalePublicSessionStateError(error: Error): Error {
  return new Error(
    `${STALE_PUBLIC_SESSION_STATE_ERROR_PREFIX} ${error.message}`,
  );
}

function toStoredSelectedSlot(
  db: MutationCtx["db"] | QueryCtx["db"],
  selectedSlot: ReturnType<typeof asSelectedSlotInput>,
): StepTableDocMap["bookingExistingCalendarSelectionSteps"]["selectedSlot"] {
  return {
    practitionerLineageKey: resolveStoredPractitionerLineageKey(
      db,
      asPractitionerLineageKey(selectedSlot.practitionerLineageKey),
    ),
    practitionerName: selectedSlot.practitionerName,
    startTime: selectedSlot.startTime,
  };
}

async function tryHydrateInternalSessionState(
  ctx: MutationCtx | QueryCtx,
  session: SessionDoc,
): Promise<InternalBookingSessionState | null> {
  try {
    return await hydrateInternalSessionState(ctx, session);
  } catch (error) {
    if (isRecoverableSessionHydrationError(error)) {
      return null;
    }
    throw error;
  }
}

async function tryHydrateSessionState(
  ctx: MutationCtx | QueryCtx,
  session: SessionDoc,
): Promise<BookingSessionState | null> {
  try {
    const internalState = await hydrateInternalSessionState(ctx, session);
    return await materializePublicSessionState(ctx, session, internalState);
  } catch (error) {
    if (isRecoverableSessionHydrationError(error)) {
      return null;
    }
    throw error;
  }
}

function withHydratedState(
  session: SessionDoc,
  state: BookingSessionState,
): SessionWithState {
  return {
    ...session,
    state,
  };
}

function withInternalHydratedState(
  session: SessionDoc,
  state: InternalBookingSessionState,
): SessionWithInternalState {
  return {
    ...session,
    state,
  };
}

const STEP_QUERY_MAP: StepQueryMap = {
  bookingExistingCalendarSelectionSteps: (ctx, sessionId) =>
    ctx.db
      .query("bookingExistingCalendarSelectionSteps")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(1),
  bookingExistingConfirmationSteps: (ctx, sessionId) =>
    ctx.db
      .query("bookingExistingConfirmationSteps")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(1),
  bookingExistingDataSharingSteps: (ctx, sessionId) =>
    ctx.db
      .query("bookingExistingDataSharingSteps")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(1),
  bookingExistingDoctorSelectionSteps: (ctx, sessionId) =>
    ctx.db
      .query("bookingExistingDoctorSelectionSteps")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(1),
  bookingExistingPersonalDataSteps: (ctx, sessionId) =>
    ctx.db
      .query("bookingExistingPersonalDataSteps")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(1),
  bookingLocationSteps: (ctx, sessionId) =>
    ctx.db
      .query("bookingLocationSteps")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(1),
  bookingNewCalendarSelectionSteps: (ctx, sessionId) =>
    ctx.db
      .query("bookingNewCalendarSelectionSteps")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(1),
  bookingNewConfirmationSteps: (ctx, sessionId) =>
    ctx.db
      .query("bookingNewConfirmationSteps")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(1),
  bookingNewDataSharingSteps: (ctx, sessionId) =>
    ctx.db
      .query("bookingNewDataSharingSteps")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(1),
  bookingNewGkvDetailSteps: (ctx, sessionId) =>
    ctx.db
      .query("bookingNewGkvDetailSteps")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(1),
  bookingNewInsuranceTypeSteps: (ctx, sessionId) =>
    ctx.db
      .query("bookingNewInsuranceTypeSteps")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(1),
  bookingNewPersonalDataSteps: (ctx, sessionId) =>
    ctx.db
      .query("bookingNewPersonalDataSteps")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(1),
  bookingNewPkvConsentSteps: (ctx, sessionId) =>
    ctx.db
      .query("bookingNewPkvConsentSteps")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(1),
  bookingNewPkvDetailSteps: (ctx, sessionId) =>
    ctx.db
      .query("bookingNewPkvDetailSteps")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(1),
  bookingPatientStatusSteps: (ctx, sessionId) =>
    ctx.db
      .query("bookingPatientStatusSteps")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(1),
  bookingPrivacySteps: (ctx, sessionId) =>
    ctx.db
      .query("bookingPrivacySteps")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(1),
};

const STEP_INSERT_MAP: StepInsertMap = {
  bookingExistingCalendarSelectionSteps: (ctx, data) =>
    ctx.db.insert("bookingExistingCalendarSelectionSteps", data),
  bookingExistingConfirmationSteps: (ctx, data) =>
    ctx.db.insert("bookingExistingConfirmationSteps", data),
  bookingExistingDataSharingSteps: (ctx, data) =>
    ctx.db.insert("bookingExistingDataSharingSteps", data),
  bookingExistingDoctorSelectionSteps: (ctx, data) =>
    ctx.db.insert("bookingExistingDoctorSelectionSteps", data),
  bookingExistingPersonalDataSteps: (ctx, data) =>
    ctx.db.insert("bookingExistingPersonalDataSteps", data),
  bookingLocationSteps: (ctx, data) =>
    ctx.db.insert("bookingLocationSteps", data),
  bookingNewCalendarSelectionSteps: (ctx, data) =>
    ctx.db.insert("bookingNewCalendarSelectionSteps", data),
  bookingNewConfirmationSteps: (ctx, data) =>
    ctx.db.insert("bookingNewConfirmationSteps", data),
  bookingNewDataSharingSteps: (ctx, data) =>
    ctx.db.insert("bookingNewDataSharingSteps", data),
  bookingNewGkvDetailSteps: (ctx, data) =>
    ctx.db.insert("bookingNewGkvDetailSteps", data),
  bookingNewInsuranceTypeSteps: (ctx, data) =>
    ctx.db.insert("bookingNewInsuranceTypeSteps", data),
  bookingNewPersonalDataSteps: (ctx, data) =>
    ctx.db.insert("bookingNewPersonalDataSteps", data),
  bookingNewPkvConsentSteps: (ctx, data) =>
    ctx.db.insert("bookingNewPkvConsentSteps", data),
  bookingNewPkvDetailSteps: (ctx, data) =>
    ctx.db.insert("bookingNewPkvDetailSteps", data),
  bookingPatientStatusSteps: (ctx, data) =>
    ctx.db.insert("bookingPatientStatusSteps", data),
  bookingPrivacySteps: (ctx, data) =>
    ctx.db.insert("bookingPrivacySteps", data),
};

const STEP_PATCH_MAP: StepPatchMap = {
  bookingExistingCalendarSelectionSteps: (ctx, id, data) =>
    ctx.db.patch("bookingExistingCalendarSelectionSteps", id, data),
  bookingExistingConfirmationSteps: (ctx, id, data) =>
    ctx.db.patch("bookingExistingConfirmationSteps", id, data),
  bookingExistingDataSharingSteps: (ctx, id, data) =>
    ctx.db.patch("bookingExistingDataSharingSteps", id, data),
  bookingExistingDoctorSelectionSteps: (ctx, id, data) =>
    ctx.db.patch("bookingExistingDoctorSelectionSteps", id, data),
  bookingExistingPersonalDataSteps: (ctx, id, data) =>
    ctx.db.patch("bookingExistingPersonalDataSteps", id, data),
  bookingLocationSteps: (ctx, id, data) =>
    ctx.db.patch("bookingLocationSteps", id, data),
  bookingNewCalendarSelectionSteps: (ctx, id, data) =>
    ctx.db.patch("bookingNewCalendarSelectionSteps", id, data),
  bookingNewConfirmationSteps: (ctx, id, data) =>
    ctx.db.patch("bookingNewConfirmationSteps", id, data),
  bookingNewDataSharingSteps: (ctx, id, data) =>
    ctx.db.patch("bookingNewDataSharingSteps", id, data),
  bookingNewGkvDetailSteps: (ctx, id, data) =>
    ctx.db.patch("bookingNewGkvDetailSteps", id, data),
  bookingNewInsuranceTypeSteps: (ctx, id, data) =>
    ctx.db.patch("bookingNewInsuranceTypeSteps", id, data),
  bookingNewPersonalDataSteps: (ctx, id, data) =>
    ctx.db.patch("bookingNewPersonalDataSteps", id, data),
  bookingNewPkvConsentSteps: (ctx, id, data) =>
    ctx.db.patch("bookingNewPkvConsentSteps", id, data),
  bookingNewPkvDetailSteps: (ctx, id, data) =>
    ctx.db.patch("bookingNewPkvDetailSteps", id, data),
  bookingPatientStatusSteps: (ctx, id, data) =>
    ctx.db.patch("bookingPatientStatusSteps", id, data),
  bookingPrivacySteps: (ctx, id, data) =>
    ctx.db.patch("bookingPrivacySteps", id, data),
};

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Get a booking session by ID.
 * Returns null if the session doesn't exist, has expired, or belongs to another user.
 * Requires authentication.
 */
export const get = query({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthenticatedUserIdForQuery(ctx);
    if (!userId) {
      return null;
    }

    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      return null;
    }

    // Check session ownership
    if (session.userId !== userId) {
      return null;
    }

    const sessionUser = await ctx.db.get("users", session.userId);
    if (!sessionUser) {
      return null;
    }

    const hasValidStepAssociation = await hasValidStepEntryUserAssociation(
      ctx,
      session,
    );
    if (!hasValidStepAssociation) {
      return null;
    }

    // Check if session has expired
    const now = BigInt(Date.now());
    if (session.expiresAt < now) {
      return null;
    }

    const state = await tryHydrateSessionState(ctx, session);
    if (!state) {
      return null;
    }
    return withHydratedState(session, state);
  },
  returns: v.union(
    v.object({
      _creationTime: v.number(),
      _id: v.id("bookingSessions"),
      createdAt: v.int64(),
      expiresAt: v.int64(),
      lastModified: v.int64(),
      practiceId: v.id("practices"),
      ruleSetId: v.id("ruleSets"),
      state: bookingSessionStepValidator,
      userId: v.id("users"),
    }),
    v.null(),
  ),
});

/**
 * Get the latest active booking session for the authenticated user
 * within the given practice + rule set.
 * Returns null if none exists or it has expired.
 */
export const getActiveForUser = query({
  args: {
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthenticatedUserIdForQuery(ctx);
    if (!userId) {
      return null;
    }

    const sessions = await ctx.db
      .query("bookingSessions")
      .withIndex("by_userId_practiceId_ruleSetId", (q) =>
        q
          .eq("userId", userId)
          .eq("practiceId", args.practiceId)
          .eq("ruleSetId", args.ruleSetId),
      )
      .order("desc")
      .collect();

    const now = BigInt(Date.now());
    for (const session of sessions) {
      if (session.expiresAt < now) {
        continue;
      }
      const sessionUser = await ctx.db.get("users", session.userId);
      if (!sessionUser) {
        continue;
      }
      const hasValidStepAssociation = await hasValidStepEntryUserAssociation(
        ctx,
        session,
      );
      if (!hasValidStepAssociation) {
        continue;
      }

      const hydratedState = await tryHydrateSessionState(ctx, session);
      if (!hydratedState) {
        continue;
      }
      if (
        isConfirmationState(hydratedState) &&
        !(await hasUpcomingVisibleAppointmentForConfirmationState(
          ctx,
          hydratedState,
        ))
      ) {
        return null;
      }

      return withHydratedState(session, hydratedState);
    }

    return null;
  },
  returns: v.union(
    v.object({
      _creationTime: v.number(),
      _id: v.id("bookingSessions"),
      createdAt: v.int64(),
      expiresAt: v.int64(),
      lastModified: v.int64(),
      practiceId: v.id("practices"),
      ruleSetId: v.id("ruleSets"),
      state: bookingSessionStepValidator,
      userId: v.id("users"),
    }),
    v.null(),
  ),
});

// ============================================================================
// SESSION LIFECYCLE
// ============================================================================

/**
 * Create a new booking session starting at the privacy step.
 * Requires authentication - the session is tied to the authenticated user.
 */
export const create = mutation({
  args: {
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureAuthenticatedUserId(ctx);

    const now = BigInt(Date.now());

    const sessions = await ctx.db
      .query("bookingSessions")
      .withIndex("by_userId_practiceId_ruleSetId", (q) =>
        q
          .eq("userId", userId)
          .eq("practiceId", args.practiceId)
          .eq("ruleSetId", args.ruleSetId),
      )
      .order("desc")
      .collect();

    for (const session of sessions) {
      if (session.expiresAt >= now) {
        const hydratedState = await tryHydrateSessionState(ctx, session);
        if (!hydratedState) {
          await ctx.db.delete("bookingSessions", session._id);
          continue;
        }
        let nextStep = hydratedState.step;
        if (
          isConfirmationState(hydratedState) &&
          !(await hasUpcomingVisibleAppointmentForConfirmationState(
            ctx,
            hydratedState,
          ))
        ) {
          nextStep = getCalendarStepForConfirmationState(hydratedState);
        }

        await ctx.db.patch("bookingSessions", session._id, {
          expiresAt: now + BigInt(SESSION_TTL_MS),
          lastModified: now,
          state: { step: nextStep },
        });
        return session._id;
      }
      await ctx.db.delete("bookingSessions", session._id);
    }

    const sessionId = await ctx.db.insert("bookingSessions", {
      createdAt: now,
      expiresAt: now + BigInt(SESSION_TTL_MS),
      lastModified: now,
      practiceId: args.practiceId,
      ruleSetId: args.ruleSetId,
      state: {
        step: "privacy" as const,
      },
      userId,
    });

    return sessionId;
  },
  returns: v.id("bookingSessions"),
});

/**
 * Delete a booking session (e.g., after completion or abandonment).
 * Requires authentication and ownership of the session.
 */
export const remove = mutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const userId = await ensureAuthenticatedUserId(ctx);

    // Check session ownership
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      return null; // Already deleted
    }
    if (session.userId !== userId) {
      throw new Error("Access denied");
    }

    await ctx.db.delete("bookingSessions", args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * Internal mutation to clean up expired sessions.
 */
export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = BigInt(Date.now());
    const expiredSessions = await ctx.db
      .query("bookingSessions")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .collect();

    for (const session of expiredSessions) {
      await ctx.db.delete("bookingSessions", session._id);
    }

    return expiredSessions.length;
  },
  returns: v.number(),
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the authenticated user's ID from WorkOS and our users table.
 * If the user record is missing (e.g. after preview re-seeding), create it.
 */
async function getAuthenticatedUserId(ctx: MutationCtx): Promise<Id<"users">> {
  return await ensureAuthenticatedUserId(ctx);
}

/**
 * Verify that the session exists and belongs to the authenticated user.
 * Returns the session if valid.
 */
type StepRowIdParams = {
  [K in StepTableName]: [tableName: K, row: StepTableDocMap[K]];
}[StepTableName];

function getStepBase(session: Doc<"bookingSessions">) {
  return {
    practiceId: session.practiceId,
    ruleSetId: session.ruleSetId,
    sessionId: session._id,
    userId: session.userId,
  };
}

async function getStepRow<T extends StepTableName>(
  ctx: StepReadCtx,
  tableName: T,
  sessionId: Id<"bookingSessions">,
): Promise<null | StepTableDocMap[T]> {
  const rows = await STEP_QUERY_MAP[tableName](ctx, sessionId);
  return rows[0] ?? null;
}

function getStepRowId<T extends StepTableName>(
  tableName: T,
  row: StepTableDocMap[T],
): Id<T>;
function getStepRowId(...params: StepRowIdParams) {
  const [tableName, row] = params;
  switch (tableName) {
    case "bookingExistingCalendarSelectionSteps":
    case "bookingExistingConfirmationSteps":
    case "bookingExistingDataSharingSteps":
    case "bookingExistingDoctorSelectionSteps":
    case "bookingExistingPersonalDataSteps":
    case "bookingLocationSteps":
    case "bookingNewCalendarSelectionSteps":
    case "bookingNewConfirmationSteps":
    case "bookingNewDataSharingSteps":
    case "bookingNewGkvDetailSteps":
    case "bookingNewInsuranceTypeSteps":
    case "bookingNewPersonalDataSteps":
    case "bookingNewPkvConsentSteps":
    case "bookingNewPkvDetailSteps":
    case "bookingPatientStatusSteps":
    case "bookingPrivacySteps": {
      return row._id;
    }
  }
}

async function getVerifiedSession(
  ctx: MutationCtx,
  sessionId: Id<"bookingSessions">,
): Promise<SessionWithInternalState> {
  const userId = await getAuthenticatedUserId(ctx);

  const session = await ctx.db.get("bookingSessions", sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  if (session.userId !== userId) {
    throw new Error("Access denied");
  }

  // Check if session has expired
  const now = BigInt(Date.now());
  if (session.expiresAt < now) {
    throw new Error("Session has expired");
  }

  const state = await tryHydrateInternalSessionState(ctx, session);
  if (!state) {
    throw new Error(
      "Session data is incomplete. Please start the booking again.",
    );
  }
  return withInternalHydratedState(session, state);
}

async function hasValidStepEntryUserAssociation(
  ctx: QueryCtx,
  session: Doc<"bookingSessions">,
): Promise<boolean> {
  // The persisted step row owner (`booking*Steps.userId`) must match the
  // booking session owner. For data-sharing steps, each contact also carries
  // an owner `userId` which must match the authenticated session user.
  const tableNames = STEP_SNAPSHOT_TABLES_BY_STEP[session.state.step];
  if (tableNames.length === 0) {
    return true;
  }

  for (const tableName of tableNames) {
    const row = await getStepRow(ctx, tableName, session._id);
    if (!row) {
      continue;
    }

    if (row.userId !== session.userId) {
      return false;
    }

    if ("dataSharingContacts" in row) {
      return row.dataSharingContacts.every(
        (contact) => contact.userId === session.userId,
      );
    }

    return true;
  }

  return true;
}

async function refreshSession(
  ctx: MutationCtx,
  sessionId: Id<"bookingSessions">,
) {
  const now = BigInt(Date.now());
  await ctx.db.patch("bookingSessions", sessionId, {
    expiresAt: now + BigInt(SESSION_TTL_MS),
    lastModified: now,
  });
}

async function setSessionStep(
  ctx: MutationCtx,
  sessionId: Id<"bookingSessions">,
  step: BookingSessionState["step"],
) {
  await ctx.db.patch("bookingSessions", sessionId, {
    state: { step },
  });
}

function toStepInsertData<T extends StepTableName>(
  data: StepTableInput<T>,
  now: bigint,
): StepTableInsertData<T> {
  return withCreatedAndLastModified(data, now);
}

function toStepPatchData<T extends StepTableName>(
  data: StepTableInput<T>,
  now: bigint,
): StepTablePatch<T> {
  return withLastModified(data, now);
}

async function upsertStep<T extends StepTableName>(
  ctx: MutationCtx,
  tableName: T,
  session: Doc<"bookingSessions">,
  data: StepTableInput<T>,
) {
  const now = BigInt(Date.now());
  const expectedSessionId = session._id;
  const expectedUserId = session.userId;

  if ("sessionId" in data && data.sessionId !== expectedSessionId) {
    throw new Error("Invalid sessionId for step data");
  }

  if ("userId" in data && data.userId !== expectedUserId) {
    throw new Error("Invalid userId for step data");
  }

  const user = await ctx.db.get("users", expectedUserId);
  if (!user) {
    throw new Error("Invalid user for step data");
  }

  const existingRow = await getStepRow(ctx, tableName, expectedSessionId);
  if (existingRow) {
    await STEP_PATCH_MAP[tableName](
      ctx,
      getStepRowId(tableName, existingRow),
      toStepPatchData(data, now),
    );
    return;
  }

  await STEP_INSERT_MAP[tableName](ctx, toStepInsertData(data, now));
}

function withCreatedAndLastModified<T extends object>(data: T, now: bigint) {
  return {
    ...data,
    createdAt: now,
    lastModified: now,
  };
}

function withLastModified<T extends object>(data: T, now: bigint) {
  return {
    ...data,
    lastModified: now,
  };
}

/**
 * Validates data-sharing contact payload semantics.
 */
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

function attachOwnerToDataSharingContacts(
  contacts: DataSharingContactInput[],
  userId: Id<"users">,
): DataSharingContact[] {
  return contacts.map((contact) => ({
    ...asDataSharingContactInput(contact),
    userId,
  }));
}

/**
 * Enforce booking rules for a selected slot at mutation time.
 */
async function assertSlotAllowedByRules(
  ctx: MutationCtx,
  args: {
    appointmentTypeId: Id<"appointmentTypes">;
    locationLineageKey: LocationLineageKey;
    patientDateOfBirth: PersonalDataInput["dateOfBirth"];
    practiceId: Id<"practices">;
    practitionerLineageKey: PractitionerLineageKey;
    ruleSetId: Id<"ruleSets">;
    startTime: ZonedDateTimeString;
  },
): Promise<void> {
  const [locationId, practitionerId] = await Promise.all([
    resolveLocationIdForInternalState(
      ctx.db,
      args.ruleSetId,
      args.locationLineageKey,
    ),
    resolvePractitionerIdForInternalState(
      ctx.db,
      args.ruleSetId,
      args.practitionerLineageKey,
    ),
  ]);
  const ruleCheckResult = await ctx.runQuery(
    internal.ruleEngine.checkRulesForAppointment,
    {
      context: {
        appointmentTypeId: args.appointmentTypeId,
        dateTime: args.startTime,
        locationId,
        patientDateOfBirth: args.patientDateOfBirth,
        practiceId: args.practiceId,
        practitionerId,
        requestedAt: Temporal.Now.instant()
          .toZonedDateTimeISO(APPOINTMENT_TIMEZONE)
          .toString(),
      },
      ruleSetId: args.ruleSetId,
    },
  );

  if (ruleCheckResult.isBlocked) {
    throw new Error("Selected slot is no longer available");
  }
}

function assertSlotStartIsInFuture(startTime: string): void {
  const slotStartInstant = parseSlotStartInstant(startTime);
  const now = Temporal.Now.instant();
  if (Temporal.Instant.compare(slotStartInstant, now) <= 0) {
    throw new Error("Appointments must be booked in the future");
  }
}

async function loadInternalStepSnapshot(
  ctx: StepReadCtx,
  session: SessionDoc,
  step: InternalBookingSessionState["step"],
): Promise<null | Record<string, unknown>> {
  const tableNames = STEP_SNAPSHOT_TABLES_BY_STEP[step];
  if (tableNames.length === 0) {
    return null;
  }

  for (const tableName of tableNames) {
    const row = await getStepRow(ctx, tableName, session._id);
    if (!row) {
      continue;
    }

    const snapshot = Object.fromEntries(
      Object.entries(stripStepSnapshotFields(row)),
    );
    return filterInternalStepSnapshot(step, snapshot);
  }

  return null;
}

function parseSlotStartInstant(startTime: string): Temporal.Instant {
  try {
    return Temporal.ZonedDateTime.from(startTime).toInstant();
  } catch {
    throw new Error("Invalid slot start time");
  }
}

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

function stripStepSnapshotFields<T extends StepTableName>(
  row: StepTableDocMap[T],
): Omit<StepTableDocMap[T], StepSnapshotMetaKeys> {
  const {
    _creationTime,
    _id,
    createdAt,
    lastModified,
    practiceId,
    ruleSetId,
    sessionId,
    userId,
    ...rest
  } = row;
  void [
    _creationTime,
    _id,
    createdAt,
    lastModified,
    practiceId,
    ruleSetId,
    sessionId,
    userId,
  ];
  return rest;
}

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

function filterInternalStepSnapshot(
  step: InternalBookingSessionState["step"],
  snapshot: Record<string, unknown>,
): Record<string, unknown> {
  const allow = new Set(STEP_SNAPSHOT_ALLOWED_INTERNAL_FIELDS[step]);
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (allow.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

function hasValidInternalTypedBookingStrings(
  state: Record<string, unknown>,
): boolean {
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

function hasValidTypedBookingStrings(state: Record<string, unknown>): boolean {
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

const PKV_STEPS_REQUIRING_PVS_CONSENT = new Set<BookingSessionState["step"]>([
  "new-calendar-selection",
  "new-confirmation",
  "new-data-input",
  "new-data-input-complete",
  "new-data-sharing",
  "new-pkv-details",
  "new-pkv-details-complete",
]);

function assertHydratedStateConsistency(
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

// ============================================================================
// NAVIGATION GRAPH
// ============================================================================

/**
 * Step navigation graph - defines valid back transitions for each step.
 * This is a single source of truth for navigation logic.
 */
type StepName = BookingSessionState["step"];

interface StepNavNode {
  /** Whether back navigation is allowed from this step */
  canGoBack: boolean;
  /** The previous step (or null for root/no-back steps) */
  prev: null | StepName;
  /** For steps with dynamic predecessors, a function to compute the previous step */
  computePrev?: (state: InternalBookingSessionState) => null | StepName;
}

const STEP_NAV_GRAPH: Record<StepName, StepNavNode> = {
  // Root step - cannot go back
  privacy: { canGoBack: false, prev: null },

  // Main flow
  location: { canGoBack: true, prev: "privacy" },
  "patient-status": { canGoBack: true, prev: "location" },

  // PATH A: New patient
  "new-calendar-selection": { canGoBack: false, prev: null },
  "new-confirmation": { canGoBack: false, prev: null }, // Final step - no back
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

  // PATH B: Existing patient (no back after doctor selection)
  "existing-calendar-selection": { canGoBack: false, prev: null },
  "existing-confirmation": { canGoBack: false, prev: null },
  "existing-data-input": { canGoBack: false, prev: null },
  "existing-data-input-complete": { canGoBack: false, prev: null },
  "existing-doctor-selection": { canGoBack: true, prev: "patient-status" },
};

/**
 * Compute the previous state based on current state.
 * Returns the new state to transition to, or null if back is not allowed.
 */
function computePreviousInternalState(
  state: InternalBookingSessionState,
): InternalBookingSessionState | null {
  const currentStep = state.step;
  const navNode = STEP_NAV_GRAPH[currentStep];

  if (!navNode.canGoBack) {
    return null;
  }

  // Compute the previous step
  const prevStep = navNode.computePrev
    ? navNode.computePrev(state)
    : navNode.prev;

  if (!prevStep) {
    return null;
  }

  // Build the previous state based on what step we're going back to
  switch (prevStep) {
    case "location": {
      return { step: "location" };
    }

    case "new-data-input-complete": {
      const currentState = assertInternalStep(state, "new-data-sharing");

      if (currentState.insuranceType === "gkv") {
        type GkvDataInputComplete = Extract<
          InternalStateAtStep<"new-data-input-complete">,
          { insuranceType: "gkv" }
        >;
        const previousState: GkvDataInputComplete = {
          hzvStatus: currentState.hzvStatus,
          insuranceType: "gkv",
          isNewPatient: true,
          locationLineageKey: currentState.locationLineageKey,
          personalData: currentState.personalData,
          step: "new-data-input-complete",
        };

        if (currentState.medicalHistory !== undefined) {
          previousState.medicalHistory = currentState.medicalHistory;
        }

        return previousState;
      }

      type PkvDataInputComplete = Extract<
        InternalStateAtStep<"new-data-input-complete">,
        { insuranceType: "pkv" }
      >;
      const previousState: PkvDataInputComplete = {
        insuranceType: "pkv",
        isNewPatient: true,
        locationLineageKey: currentState.locationLineageKey,
        personalData: currentState.personalData,
        pvsConsent: true,
        step: "new-data-input-complete",
      };

      if (currentState.medicalHistory !== undefined) {
        previousState.medicalHistory = currentState.medicalHistory;
      }
      if (currentState.pkvTariff !== undefined) {
        previousState.pkvTariff = currentState.pkvTariff;
      }
      if (currentState.pkvInsuranceType !== undefined) {
        previousState.pkvInsuranceType = currentState.pkvInsuranceType;
      }
      if (currentState.beihilfeStatus !== undefined) {
        previousState.beihilfeStatus = currentState.beihilfeStatus;
      }

      return previousState;
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

// ============================================================================
// UNIFIED BACK NAVIGATION
// ============================================================================

/**
 * Unified back navigation mutation.
 *
 * Uses the step navigation graph to determine the previous step and
 * compute the correct state to transition to.
 *
 * Benefits:
 * - Single source of truth for back navigation logic
 * - Easier to maintain and extend
 * - Fewer mutations to import and manage on the frontend
 *
 * Requires authentication.
 */
export const goBack = mutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);

    const previousState = computePreviousInternalState(session.state);
    if (!previousState) {
      throw new Error(
        `Cannot go back from step '${session.state.step}': back navigation not allowed`,
      );
    }

    await setSessionStep(ctx, args.sessionId, previousState.step);

    await refreshSession(ctx, args.sessionId);
    return previousState.step;
  },
  returns: v.string(),
});

/**
 * Move a confirmation session back to calendar selection after appointment cancellation.
 * Keeps the previously entered data and clears confirmation-only fields.
 */
export const returnToCalendarSelectionAfterCancellation = mutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);
    const state = session.state;

    let targetStep: BookingSessionState["step"] | null = null;
    if (state.step === "new-confirmation") {
      targetStep = "new-calendar-selection";
    } else if (state.step === "existing-confirmation") {
      targetStep = "existing-calendar-selection";
    }

    if (!targetStep) {
      if (
        state.step === "new-calendar-selection" ||
        state.step === "existing-calendar-selection"
      ) {
        return null;
      }

      throw new Error(
        `Cannot return to calendar selection from step '${state.step}'`,
      );
    }

    await setSessionStep(ctx, args.sessionId, targetStep);

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

// ============================================================================
// STEP TRANSITIONS - MAIN FLOW
// ============================================================================

/**
 * Step 1 → 2: Accept privacy and proceed to location selection.
 * Requires authentication.
 */
export const acceptPrivacy = mutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);
    assertInternalStep(session.state, "privacy");

    await setSessionStep(ctx, args.sessionId, "location");

    const base = getStepBase(session);
    await upsertStep(ctx, "bookingPrivacySteps", session, {
      ...base,
      consent: true,
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * Step 2 → 3: Select a location and proceed to patient status.
 * Requires authentication.
 */
export const selectLocation = mutation({
  args: {
    locationLineageKey: v.id("locations"),
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);
    assertInternalStep(session.state, "location");

    // Verify location exists and belongs to this practice
    const locationId = await resolveLocationIdForRuleSetByLineage(ctx.db, {
      lineageKey: asLocationLineageKey(args.locationLineageKey),
      ruleSetId: session.ruleSetId,
    });
    const location = await ctx.db.get("locations", locationId);
    requireSelectableRuleSetEntity({
      entity: location,
      entityLabel: "Standort",
      expectedPracticeId: session.practiceId,
      expectedRuleSetId: session.ruleSetId,
    });

    await setSessionStep(ctx, args.sessionId, "patient-status");

    const base = getStepBase(session);
    const locationLineageKey = resolveStoredLocationLineageKey(
      ctx.db,
      asLocationLineageKey(args.locationLineageKey),
    );
    await upsertStep(ctx, "bookingLocationSteps", session, {
      ...base,
      locationLineageKey,
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * Step 3 → A2: Select "new patient" path - proceed directly to insurance type.
 */
export const selectNewPatient = mutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);
    const state = assertInternalStep(session.state, "patient-status");

    await setSessionStep(ctx, args.sessionId, "new-insurance-type");

    const base = getStepBase(session);
    await upsertStep(ctx, "bookingPatientStatusSteps", session, {
      ...base,
      isNewPatient: true as const,
      locationLineageKey: state.locationLineageKey,
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * Step 3 → B1: Select "existing patient" path - proceed to doctor selection.
 * NOTE: After selecting a doctor, going back to this step is NOT allowed!
 * Requires authentication.
 */
export const selectExistingPatient = mutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);
    const state = assertInternalStep(session.state, "patient-status");

    await setSessionStep(ctx, args.sessionId, "existing-doctor-selection");

    const base = getStepBase(session);
    await upsertStep(ctx, "bookingPatientStatusSteps", session, {
      ...base,
      isNewPatient: false as const,
      locationLineageKey: state.locationLineageKey,
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

// ============================================================================
// PATH A: NEW PATIENT
// ============================================================================

/**
 * A2 → A3a/A3b: Select insurance type and proceed to GKV or PKV details.
 * Requires authentication.
 */
export const selectInsuranceType = mutation({
  args: {
    insuranceType: insuranceTypeValidator,
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);
    const state = assertInternalStep(session.state, "new-insurance-type");

    if (args.insuranceType === "gkv") {
      await setSessionStep(ctx, args.sessionId, "new-gkv-details");
    } else {
      await setSessionStep(ctx, args.sessionId, "new-pvs-consent");
    }

    const base = getStepBase(session);
    await upsertStep(ctx, "bookingNewInsuranceTypeSteps", session, {
      ...base,
      insuranceType: args.insuranceType,
      isNewPatient: true as const,
      locationLineageKey: state.locationLineageKey,
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * A3a → A4: Confirm HZV status (GKV) and proceed to data input.
 */
export const confirmGkvDetails = mutation({
  args: {
    hzvStatus: hzvStatusValidator,
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);
    if (
      session.state.step !== "new-gkv-details" &&
      session.state.step !== "new-gkv-details-complete"
    ) {
      throw new Error(
        `Invalid step: expected 'new-gkv-details' or 'new-gkv-details-complete', got '${session.state.step}'`,
      );
    }
    const state = session.state;

    await setSessionStep(ctx, args.sessionId, "new-data-input");

    const base = getStepBase(session);
    await upsertStep(ctx, "bookingNewGkvDetailSteps", session, {
      ...base,
      hzvStatus: args.hzvStatus,
      insuranceType: "gkv" as const,
      isNewPatient: true as const,
      locationLineageKey: state.locationLineageKey,
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * A3b-1 → A3b-2: Accept PVS consent and proceed to PKV details input.
 * Requires authentication.
 */
export const acceptPvsConsent = mutation({
  args: {
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);
    const state = assertInternalStep(session.state, "new-pvs-consent");

    await setSessionStep(ctx, args.sessionId, "new-pkv-details");

    const base = getStepBase(session);
    await upsertStep(ctx, "bookingNewPkvConsentSteps", session, {
      ...base,
      insuranceType: "pkv" as const,
      isNewPatient: true as const,
      locationLineageKey: state.locationLineageKey,
      pvsConsent: true as const,
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * A3b → A4: Confirm PKV details and proceed to data input.
 * Requires authentication.
 */
export const confirmPkvDetails = mutation({
  args: {
    beihilfeStatus: v.optional(beihilfeStatusValidator),
    pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
    pkvTariff: v.optional(pkvTariffValidator),
    pvsConsent: v.literal(true),
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);
    if (
      session.state.step !== "new-pkv-details" &&
      session.state.step !== "new-pkv-details-complete"
    ) {
      throw new Error(
        `Invalid step: expected 'new-pkv-details' or 'new-pkv-details-complete', got '${session.state.step}'`,
      );
    }
    const state = session.state;

    await setSessionStep(ctx, args.sessionId, "new-data-input");

    const base = getStepBase(session);
    const stepData: StepTableInput<"bookingNewPkvDetailSteps"> = {
      ...base,
      insuranceType: "pkv",
      isNewPatient: true,
      locationLineageKey: state.locationLineageKey,
      pvsConsent: true,
      ...(args.pkvTariff === undefined ? {} : { pkvTariff: args.pkvTariff }),
      ...(args.pkvInsuranceType === undefined
        ? {}
        : { pkvInsuranceType: args.pkvInsuranceType }),
      ...(args.beihilfeStatus === undefined
        ? {}
        : { beihilfeStatus: args.beihilfeStatus }),
    };

    await upsertStep(ctx, "bookingNewPkvDetailSteps", session, stepData);
    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * A5 → A6: Submit personal data and proceed to Datenweitergabe.
 */
export const submitNewPatientData = mutation({
  args: {
    medicalHistory: v.optional(medicalHistoryValidator),
    personalData: personalDataValidator,
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);

    if (
      session.state.step !== "new-data-input" &&
      session.state.step !== "new-data-input-complete"
    ) {
      throw new Error(
        `Invalid step: expected 'new-data-input' or 'new-data-input-complete', got '${session.state.step}'`,
      );
    }

    const state = session.state;
    const personalData = asPersonalDataInput(args.personalData);

    await setSessionStep(ctx, args.sessionId, "new-data-sharing");

    const base = getStepBase(session);
    const stepData: StepTableInput<"bookingNewPersonalDataSteps"> = {
      ...base,
      insuranceType: state.insuranceType,
      isNewPatient: true,
      locationLineageKey: state.locationLineageKey,
      personalData,
      ...(args.medicalHistory === undefined
        ? {}
        : { medicalHistory: args.medicalHistory }),
      ...(state.insuranceType === "gkv" ? { hzvStatus: state.hzvStatus } : {}),
      ...(state.insuranceType === "pkv" && state.pkvTariff !== undefined
        ? { pkvTariff: state.pkvTariff }
        : {}),
      ...(state.insuranceType === "pkv" && state.pkvInsuranceType !== undefined
        ? { pkvInsuranceType: state.pkvInsuranceType }
        : {}),
      ...(state.insuranceType === "pkv" && state.beihilfeStatus !== undefined
        ? { beihilfeStatus: state.beihilfeStatus }
        : {}),
      ...(state.insuranceType === "pkv" ? { pvsConsent: true } : {}),
    };

    await upsertStep(ctx, "bookingNewPersonalDataSteps", session, stepData);

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * A6 → A7: Submit Datenweitergabe and proceed to calendar selection.
 */
export const submitNewDataSharing = mutation({
  args: {
    dataSharingContacts: v.array(dataSharingContactInputValidator),
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);
    const state = assertInternalStep(session.state, "new-data-sharing");
    const personalData = asPersonalDataInput(state.personalData);
    assertValidDataSharingContacts(args.dataSharingContacts);
    const ownedContacts = attachOwnerToDataSharingContacts(
      args.dataSharingContacts,
      session.userId,
    );

    await setSessionStep(ctx, args.sessionId, "new-calendar-selection");

    const base = getStepBase(session);
    const stepData: StepTableInput<"bookingNewDataSharingSteps"> = {
      ...base,
      dataSharingContacts: ownedContacts,
      insuranceType: state.insuranceType,
      isNewPatient: true,
      locationLineageKey: state.locationLineageKey,
      personalData,
      ...(state.medicalHistory === undefined
        ? {}
        : { medicalHistory: state.medicalHistory }),
      ...(state.insuranceType === "gkv" ? { hzvStatus: state.hzvStatus } : {}),
      ...(state.insuranceType === "pkv" && state.pkvTariff !== undefined
        ? { pkvTariff: state.pkvTariff }
        : {}),
      ...(state.insuranceType === "pkv" && state.pkvInsuranceType !== undefined
        ? { pkvInsuranceType: state.pkvInsuranceType }
        : {}),
      ...(state.insuranceType === "pkv" && state.beihilfeStatus !== undefined
        ? { beihilfeStatus: state.beihilfeStatus }
        : {}),
      ...(state.insuranceType === "pkv" ? { pvsConsent: true } : {}),
    };

    await upsertStep(ctx, "bookingNewDataSharingSteps", session, stepData);

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * A7 → A8: Select slot and create appointment (new patient).
 * Requires authentication.
 */
export const selectNewPatientSlot = mutation({
  args: {
    appointmentTypeLineageKey: v.id("appointmentTypes"),
    reasonDescription: v.string(),
    selectedSlot: selectedSlotValidator,
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);

    if (session.state.step !== "new-calendar-selection") {
      throw new Error(
        `Invalid step: expected 'new-calendar-selection', got '${session.state.step}'`,
      );
    }

    const state = session.state;
    const personalData = asPersonalDataInput(state.personalData);
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
        ruleSetId: session.ruleSetId,
      },
    );
    const selectedAppointmentType = requireSelectableRuleSetEntity({
      entity: await ctx.db.get("appointmentTypes", appointmentTypeId),
      entityLabel: "Terminart",
      expectedRuleSetId: session.ruleSetId,
    });
    await assertSlotAllowedByRules(ctx, {
      appointmentTypeId,
      locationLineageKey: asLocationLineageKey(state.locationLineageKey),
      patientDateOfBirth: personalData.dateOfBirth,
      practiceId: session.practiceId,
      practitionerLineageKey: resolveStoredPractitionerLineageKey(
        ctx.db,
        asPractitionerLineageKey(selectedSlot.practitionerLineageKey),
      ),
      ruleSetId: session.ruleSetId,
      startTime: selectedSlot.startTime,
    });

    const base = getStepBase(session);
    const appointmentTypeLineageKey = resolveStoredAppointmentTypeLineageKey(
      ctx.db,
      asAppointmentTypeLineageKey(args.appointmentTypeLineageKey),
    );
    const storedSelectedSlot = toStoredSelectedSlot(ctx.db, selectedSlot);
    const calendarStep: StepTableInput<"bookingNewCalendarSelectionSteps"> = {
      ...base,
      appointmentTypeLineageKey,
      dataSharingContacts: state.dataSharingContacts,
      insuranceType: state.insuranceType,
      isNewPatient: true,
      locationLineageKey: state.locationLineageKey,
      personalData,
      reasonDescription,
      selectedSlot: storedSelectedSlot,
      ...(state.medicalHistory === undefined
        ? {}
        : { medicalHistory: state.medicalHistory }),
      ...(state.emergencyContacts === undefined
        ? {}
        : { emergencyContacts: state.emergencyContacts }),
      ...(state.insuranceType === "gkv" ? { hzvStatus: state.hzvStatus } : {}),
      ...(state.insuranceType === "pkv" && state.pkvTariff !== undefined
        ? { pkvTariff: state.pkvTariff }
        : {}),
      ...(state.insuranceType === "pkv" && state.pkvInsuranceType !== undefined
        ? { pkvInsuranceType: state.pkvInsuranceType }
        : {}),
      ...(state.insuranceType === "pkv" && state.beihilfeStatus !== undefined
        ? { beihilfeStatus: state.beihilfeStatus }
        : {}),
      ...(state.insuranceType === "pkv" ? { pvsConsent: true } : {}),
    };

    await upsertStep(
      ctx,
      "bookingNewCalendarSelectionSteps",
      session,
      calendarStep,
    );

    const locationId = await resolveLocationIdForInternalState(
      ctx.db,
      session.ruleSetId,
      asLocationLineageKey(state.locationLineageKey),
    );

    const appointmentId = await createAppointmentFromTrustedSource(ctx, {
      appointmentTypeId,
      isNewPatient: true,
      locationId,
      patientDateOfBirth: personalData.dateOfBirth,
      practiceId: session.practiceId,
      practitionerId: await resolvePractitionerIdForInternalState(
        ctx.db,
        session.ruleSetId,
        asPractitionerLineageKey(selectedSlot.practitionerLineageKey),
      ),
      start: selectedSlot.startTime,
      title: `Online-Termin: ${selectedAppointmentType.name}`,
      userId: session.userId,
    });
    const bookedDurationMinutes = selectedAppointmentType.duration;

    // Build confirmation state based on insurance type
    if (state.insuranceType === "gkv") {
      await upsertStep(ctx, "bookingNewConfirmationSteps", session, {
        ...base,
        appointmentId,
        appointmentTypeLineageKey,
        bookedDurationMinutes,
        dataSharingContacts: state.dataSharingContacts,
        hzvStatus: state.hzvStatus,
        insuranceType: "gkv" as const,
        isNewPatient: true as const,
        locationLineageKey: state.locationLineageKey,
        personalData,
        reasonDescription,
        selectedSlot: storedSelectedSlot,
        ...(state.medicalHistory === undefined
          ? {}
          : { medicalHistory: state.medicalHistory }),
        ...(state.emergencyContacts === undefined
          ? {}
          : { emergencyContacts: state.emergencyContacts }),
      });
    } else {
      // PKV path
      const confirmStep: StepTableInput<"bookingNewConfirmationSteps"> = {
        ...base,
        appointmentId,
        appointmentTypeLineageKey,
        bookedDurationMinutes,
        dataSharingContacts: state.dataSharingContacts,
        insuranceType: "pkv",
        isNewPatient: true,
        locationLineageKey: state.locationLineageKey,
        personalData,
        reasonDescription,
        selectedSlot: storedSelectedSlot,
        ...(state.medicalHistory === undefined
          ? {}
          : { medicalHistory: state.medicalHistory }),
        ...(state.emergencyContacts === undefined
          ? {}
          : { emergencyContacts: state.emergencyContacts }),
        ...(state.pkvTariff === undefined
          ? {}
          : { pkvTariff: state.pkvTariff }),
        ...(state.pkvInsuranceType === undefined
          ? {}
          : { pkvInsuranceType: state.pkvInsuranceType }),
        ...(state.beihilfeStatus === undefined
          ? {}
          : { beihilfeStatus: state.beihilfeStatus }),
        pvsConsent: true,
      };

      await upsertStep(
        ctx,
        "bookingNewConfirmationSteps",
        session,
        confirmStep,
      );
    }

    await setSessionStep(ctx, args.sessionId, "new-confirmation");
    await refreshSession(ctx, args.sessionId);

    return { appointmentId };
  },
  returns: v.object({
    appointmentId: v.id("appointments"),
  }),
});

// ============================================================================
// PATH B: EXISTING PATIENT
// ============================================================================

/**
 * B1 → B2: Select doctor and proceed to data input.
 * ⚠️ WARNING: After this step, going back to doctor selection is NOT allowed!
 * Requires authentication.
 */
export const selectDoctor = mutation({
  args: {
    practitionerLineageKey: v.id("practitioners"),
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);
    const state = assertInternalStep(
      session.state,
      "existing-doctor-selection",
    );

    // Verify practitioner exists
    const practitionerId = await resolvePractitionerIdForRuleSetByLineage(
      ctx.db,
      {
        lineageKey: asPractitionerLineageKey(args.practitionerLineageKey),
        ruleSetId: session.ruleSetId,
      },
    );
    const practitioner = await ctx.db.get("practitioners", practitionerId);
    requireSelectableRuleSetEntity({
      entity: practitioner,
      entityLabel: "Behandler",
      expectedPracticeId: session.practiceId,
      expectedRuleSetId: session.ruleSetId,
    });

    await setSessionStep(ctx, args.sessionId, "existing-data-input");

    const base = getStepBase(session);
    const practitionerLineageKey = resolveStoredPractitionerLineageKey(
      ctx.db,
      asPractitionerLineageKey(args.practitionerLineageKey),
    );
    await upsertStep(ctx, "bookingExistingDoctorSelectionSteps", session, {
      ...base,
      isNewPatient: false as const,
      locationLineageKey: state.locationLineageKey,
      practitionerLineageKey,
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * B3 → B5: Submit personal data and proceed directly to calendar selection.
 * Existing-patient flow skips the data-sharing step.
 * Requires authentication.
 */
export const submitExistingPatientData = mutation({
  args: {
    personalData: personalDataValidator,
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);
    if (
      session.state.step !== "existing-data-input" &&
      session.state.step !== "existing-data-input-complete"
    ) {
      throw new Error(
        `Invalid step: expected 'existing-data-input' or 'existing-data-input-complete', got '${session.state.step}'`,
      );
    }
    const state = session.state;
    const personalData = asPersonalDataInput(args.personalData);

    await setSessionStep(ctx, args.sessionId, "existing-calendar-selection");

    const base = getStepBase(session);
    await upsertStep(ctx, "bookingExistingPersonalDataSteps", session, {
      ...base,
      isNewPatient: false as const,
      locationLineageKey: state.locationLineageKey,
      personalData,
      practitionerLineageKey: state.practitionerLineageKey,
    });
    await upsertStep(ctx, "bookingExistingDataSharingSteps", session, {
      ...base,
      dataSharingContacts: [],
      isNewPatient: false as const,
      locationLineageKey: state.locationLineageKey,
      personalData,
      practitionerLineageKey: state.practitionerLineageKey,
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * Persist existing-patient data-sharing contacts from calendar selection.
 * Requires authentication.
 */
export const submitExistingDataSharing = mutation({
  args: {
    dataSharingContacts: v.array(dataSharingContactInputValidator),
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);
    if (session.state.step !== "existing-calendar-selection") {
      throw new Error(
        `Invalid step: expected 'existing-calendar-selection', got '${session.state.step}'`,
      );
    }
    const state = session.state;
    const personalData = asPersonalDataInput(state.personalData);
    assertValidDataSharingContacts(args.dataSharingContacts);
    const ownedContacts = attachOwnerToDataSharingContacts(
      args.dataSharingContacts,
      session.userId,
    );

    await setSessionStep(ctx, args.sessionId, "existing-calendar-selection");

    const base = getStepBase(session);
    await upsertStep(ctx, "bookingExistingDataSharingSteps", session, {
      ...base,
      dataSharingContacts: ownedContacts,
      isNewPatient: false as const,
      locationLineageKey: state.locationLineageKey,
      personalData,
      practitionerLineageKey: state.practitionerLineageKey,
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * B5 → B6: Select slot and create appointment (existing patient).
 * Requires authentication.
 */
export const selectExistingPatientSlot = mutation({
  args: {
    appointmentTypeLineageKey: v.id("appointmentTypes"),
    reasonDescription: v.string(),
    selectedSlot: selectedSlotValidator,
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);
    const state = assertInternalStep(
      session.state,
      "existing-calendar-selection",
    );
    const personalData = asPersonalDataInput(state.personalData);
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
        ruleSetId: session.ruleSetId,
      },
    );
    const appointmentType = requireSelectableRuleSetEntity({
      entity: await ctx.db.get("appointmentTypes", appointmentTypeId),
      entityLabel: "Terminart",
      expectedRuleSetId: session.ruleSetId,
    });
    await assertSlotAllowedByRules(ctx, {
      appointmentTypeId,
      locationLineageKey: asLocationLineageKey(state.locationLineageKey),
      patientDateOfBirth: personalData.dateOfBirth,
      practiceId: session.practiceId,
      practitionerLineageKey: asPractitionerLineageKey(
        state.practitionerLineageKey,
      ),
      ruleSetId: session.ruleSetId,
      startTime: selectedSlot.startTime,
    });

    const [locationId, practitionerId] = await Promise.all([
      resolveLocationIdForInternalState(
        ctx.db,
        session.ruleSetId,
        asLocationLineageKey(state.locationLineageKey),
      ),
      resolvePractitionerIdForInternalState(
        ctx.db,
        session.ruleSetId,
        asPractitionerLineageKey(state.practitionerLineageKey),
      ),
    ]);

    const appointmentId = await createAppointmentFromTrustedSource(ctx, {
      appointmentTypeId,
      isNewPatient: false,
      locationId,
      patientDateOfBirth: personalData.dateOfBirth,
      practiceId: session.practiceId,
      practitionerId,
      start: selectedSlot.startTime,
      title: `Online-Termin: ${appointmentType.name}`,
      userId: session.userId,
    });
    const bookedDurationMinutes = appointmentType.duration;

    await setSessionStep(ctx, args.sessionId, "existing-confirmation");

    const base = getStepBase(session);
    const appointmentTypeLineageKey = resolveStoredAppointmentTypeLineageKey(
      ctx.db,
      asAppointmentTypeLineageKey(args.appointmentTypeLineageKey),
    );
    const storedSelectedSlot = toStoredSelectedSlot(ctx.db, selectedSlot);
    await upsertStep(ctx, "bookingExistingCalendarSelectionSteps", session, {
      ...base,
      appointmentTypeLineageKey,
      dataSharingContacts: state.dataSharingContacts,
      isNewPatient: false as const,
      locationLineageKey: state.locationLineageKey,
      personalData,
      practitionerLineageKey: state.practitionerLineageKey,
      reasonDescription,
      selectedSlot: storedSelectedSlot,
    });

    await upsertStep(ctx, "bookingExistingConfirmationSteps", session, {
      ...base,
      appointmentId,
      appointmentTypeLineageKey,
      bookedDurationMinutes,
      dataSharingContacts: state.dataSharingContacts,
      isNewPatient: false as const,
      locationLineageKey: state.locationLineageKey,
      personalData,
      practitionerLineageKey: state.practitionerLineageKey,
      reasonDescription,
      selectedSlot: storedSelectedSlot,
    });

    await refreshSession(ctx, args.sessionId);

    return { appointmentId };
  },
  returns: v.object({
    appointmentId: v.id("appointments"),
  }),
});
