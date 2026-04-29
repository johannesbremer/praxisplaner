import { v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import type { Doc, Id } from "./_generated/dataModel";

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
  applyBookingSessionTransition,
  type BookingSessionTransition,
  computePreviousInternalState,
  getBookingSessionSnapshotTables,
  hydrateBookingSessionInternalState,
  materializeBookingSessionUiState,
} from "./bookingSessions.stateMachine";
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

export { assertValidSanitizedBookingSessionState } from "./bookingSessions.stateMachine";

type PublicSessionWithState = SessionWithActiveRuleSet & {
  state: BookingSessionState;
};

type SessionWithActiveRuleSet = SessionDoc & {
  activeRuleSetId: Id<"ruleSets">;
};

type SessionWithInternalState = SessionDoc & {
  activeRuleSetId: Id<"ruleSets">;
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
  return hydrateBookingSessionInternalState(step, snapshot);
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
  activeRuleSetId: Id<"ruleSets">,
  state: InternalBookingSessionState,
): Promise<BookingSessionState> {
  return await materializeBookingSessionUiState(state, {
    resolveAppointmentTypeName: async (appointmentTypeLineageKey) =>
      await resolveAppointmentTypeNameForPublicState(
        ctx.db,
        activeRuleSetId,
        asAppointmentTypeLineageKey(appointmentTypeLineageKey),
      ),
    resolveLocationName: async (locationLineageKey) =>
      await resolveLocationNameForPublicState(
        ctx.db,
        activeRuleSetId,
        asLocationLineageKey(locationLineageKey),
      ),
    resolvePractitionerName: async (practitionerLineageKey) =>
      await resolvePractitionerNameForPublicState(
        ctx.db,
        activeRuleSetId,
        asPractitionerLineageKey(practitionerLineageKey),
      ),
  });
}

async function materializePublicSessionState(
  ctx: StepReadCtx,
  activeRuleSetId: Id<"ruleSets">,
  internalState: InternalBookingSessionState,
): Promise<BookingSessionState> {
  return await materializeInternalState(ctx, activeRuleSetId, internalState);
}

async function requireActiveRuleSetIdForPractice(
  ctx: MutationCtx | QueryCtx,
  practiceId: Id<"practices">,
): Promise<Id<"ruleSets">> {
  const practice = await ctx.db.get("practices", practiceId);
  if (!practice?.currentActiveRuleSetId) {
    throw new Error("Terminbuchung ist derzeit nicht konfiguriert.");
  }
  return practice.currentActiveRuleSetId;
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
  session: SessionWithActiveRuleSet,
): Promise<BookingSessionState | null> {
  try {
    const internalState = await hydrateInternalSessionState(ctx, session);
    return await materializePublicSessionState(
      ctx,
      session.activeRuleSetId,
      internalState,
    );
  } catch (error) {
    if (isRecoverableSessionHydrationError(error)) {
      return null;
    }
    throw error;
  }
}

async function withActiveRuleSet(
  ctx: MutationCtx | QueryCtx,
  session: SessionDoc,
): Promise<SessionWithActiveRuleSet> {
  return {
    ...session,
    activeRuleSetId: await requireActiveRuleSetIdForPractice(
      ctx,
      session.practiceId,
    ),
  };
}

function withHydratedState(
  session: SessionWithActiveRuleSet,
  state: BookingSessionState,
): PublicSessionWithState {
  return {
    ...session,
    state,
  };
}

function withInternalHydratedState(
  session: SessionWithActiveRuleSet,
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
    const sessionWithActiveRuleSet = await withActiveRuleSet(ctx, session);

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

    const state = await tryHydrateSessionState(ctx, sessionWithActiveRuleSet);
    if (!state) {
      return null;
    }
    return withHydratedState(sessionWithActiveRuleSet, state);
  },
  returns: v.union(
    v.object({
      _creationTime: v.number(),
      _id: v.id("bookingSessions"),
      activeRuleSetId: v.id("ruleSets"),
      createdAt: v.int64(),
      expiresAt: v.int64(),
      lastModified: v.int64(),
      practiceId: v.id("practices"),
      state: bookingSessionStepValidator,
      userId: v.id("users"),
    }),
    v.null(),
  ),
});

/**
 * Get the latest active booking session for the authenticated user
 * within the given practice.
 * Returns null if none exists or it has expired.
 */
export const getActiveForUser = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthenticatedUserIdForQuery(ctx);
    if (!userId) {
      return null;
    }

    const activeRuleSetId = await requireActiveRuleSetIdForPractice(
      ctx,
      args.practiceId,
    );

    const sessions = await ctx.db
      .query("bookingSessions")
      .withIndex("by_userId_practiceId", (q) =>
        q.eq("userId", userId).eq("practiceId", args.practiceId),
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

      const sessionWithActiveRuleSet = { ...session, activeRuleSetId };
      const hydratedState = await tryHydrateSessionState(
        ctx,
        sessionWithActiveRuleSet,
      );
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

      return withHydratedState(sessionWithActiveRuleSet, hydratedState);
    }

    return null;
  },
  returns: v.union(
    v.object({
      _creationTime: v.number(),
      _id: v.id("bookingSessions"),
      activeRuleSetId: v.id("ruleSets"),
      createdAt: v.int64(),
      expiresAt: v.int64(),
      lastModified: v.int64(),
      practiceId: v.id("practices"),
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
  },
  handler: async (ctx, args) => {
    const userId = await ensureAuthenticatedUserId(ctx);
    const activeRuleSetId = await requireActiveRuleSetIdForPractice(
      ctx,
      args.practiceId,
    );

    const now = BigInt(Date.now());

    const sessions = await ctx.db
      .query("bookingSessions")
      .withIndex("by_userId_practiceId", (q) =>
        q.eq("userId", userId).eq("practiceId", args.practiceId),
      )
      .order("desc")
      .collect();

    for (const session of sessions) {
      if (session.expiresAt >= now) {
        const sessionWithActiveRuleSet = { ...session, activeRuleSetId };
        const hydratedState = await tryHydrateSessionState(
          ctx,
          sessionWithActiveRuleSet,
        );
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

function getStepBase(session: SessionWithActiveRuleSet) {
  return {
    practiceId: session.practiceId,
    ruleSetId: session.activeRuleSetId,
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

  const sessionWithActiveRuleSet = await withActiveRuleSet(ctx, session);
  const state = await tryHydrateInternalSessionState(
    ctx,
    sessionWithActiveRuleSet,
  );
  if (!state) {
    throw new Error(
      "Session data is incomplete. Please start the booking again.",
    );
  }
  return withInternalHydratedState(sessionWithActiveRuleSet, state);
}

async function hasValidStepEntryUserAssociation(
  ctx: QueryCtx,
  session: Doc<"bookingSessions">,
): Promise<boolean> {
  // The persisted step row owner (`booking*Steps.userId`) must match the
  // booking session owner. For data-sharing steps, each contact also carries
  // an owner `userId` which must match the authenticated session user.
  const tableNames = getBookingSessionSnapshotTables(session.state.step);
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

async function persistBookingSessionTransition(
  ctx: MutationCtx,
  session: SessionDoc,
  transition: BookingSessionTransition,
) {
  await setSessionStep(ctx, session._id, transition.nextStep);

  for (const write of transition.writes) {
    await persistTransitionWrite(ctx, session, write);
  }
}

async function persistTransitionWrite(
  ctx: MutationCtx,
  session: SessionDoc,
  write: BookingSessionTransition["writes"][number],
) {
  switch (write.tableName) {
    case "bookingExistingCalendarSelectionSteps":
    case "bookingExistingConfirmationSteps":
    case "bookingExistingDoctorSelectionSteps":
    case "bookingLocationSteps":
    case "bookingNewCalendarSelectionSteps":
    case "bookingNewConfirmationSteps": {
      await upsertStep(ctx, write.tableName, session, write.data);
      return;
    }
    case "bookingExistingDataSharingSteps":
    case "bookingExistingPersonalDataSteps":
    case "bookingNewDataSharingSteps":
    case "bookingNewGkvDetailSteps":
    case "bookingNewInsuranceTypeSteps":
    case "bookingNewPersonalDataSteps":
    case "bookingNewPkvConsentSteps":
    case "bookingNewPkvDetailSteps":
    case "bookingPatientStatusSteps":
    case "bookingPrivacySteps": {
      await upsertStep(ctx, write.tableName, session, write.data);
      return;
    }
  }
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

function hasInternalStep<S extends InternalBookingSessionState["step"]>(
  state: InternalBookingSessionState,
  expected: S,
): state is InternalStateAtStep<S> {
  return state.step === expected;
}

async function loadInternalStepSnapshot(
  ctx: StepReadCtx,
  session: SessionDoc,
  step: InternalBookingSessionState["step"],
): Promise<null | Record<string, unknown>> {
  const tableNames = getBookingSessionSnapshotTables(step);
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
    return snapshot;
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
    await persistBookingSessionTransition(
      ctx,
      session,
      applyBookingSessionTransition({
        base: getStepBase(session),
        kind: "acceptPrivacy",
        state: session.state,
      }),
    );

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

    // Verify location exists and belongs to this practice
    const locationId = await resolveLocationIdForRuleSetByLineage(ctx.db, {
      lineageKey: asLocationLineageKey(args.locationLineageKey),
      ruleSetId: session.activeRuleSetId,
    });
    const location = await ctx.db.get("locations", locationId);
    requireSelectableRuleSetEntity({
      entity: location,
      entityLabel: "Standort",
      expectedPracticeId: session.practiceId,
      expectedRuleSetId: session.activeRuleSetId,
    });

    const locationLineageKey = resolveStoredLocationLineageKey(
      ctx.db,
      asLocationLineageKey(args.locationLineageKey),
    );
    await persistBookingSessionTransition(
      ctx,
      session,
      applyBookingSessionTransition({
        base: getStepBase(session),
        kind: "selectLocation",
        locationLineageKey,
        state: session.state,
      }),
    );

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
    await persistBookingSessionTransition(
      ctx,
      session,
      applyBookingSessionTransition({
        base: getStepBase(session),
        kind: "selectNewPatient",
        state: session.state,
      }),
    );

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
    await persistBookingSessionTransition(
      ctx,
      session,
      applyBookingSessionTransition({
        base: getStepBase(session),
        kind: "selectExistingPatient",
        state: session.state,
      }),
    );

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
    await persistBookingSessionTransition(
      ctx,
      session,
      applyBookingSessionTransition({
        base: getStepBase(session),
        insuranceType: args.insuranceType,
        kind: "selectInsuranceType",
        state: session.state,
      }),
    );

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
    await persistBookingSessionTransition(
      ctx,
      session,
      applyBookingSessionTransition({
        base: getStepBase(session),
        hzvStatus: args.hzvStatus,
        kind: "confirmGkvDetails",
        state: session.state,
      }),
    );

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
    await persistBookingSessionTransition(
      ctx,
      session,
      applyBookingSessionTransition({
        base: getStepBase(session),
        kind: "acceptPvsConsent",
        state: session.state,
      }),
    );

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
    await persistBookingSessionTransition(
      ctx,
      session,
      applyBookingSessionTransition({
        base: getStepBase(session),
        details: {
          ...(args.beihilfeStatus === undefined
            ? {}
            : { beihilfeStatus: args.beihilfeStatus }),
          ...(args.pkvInsuranceType === undefined
            ? {}
            : { pkvInsuranceType: args.pkvInsuranceType }),
          ...(args.pkvTariff === undefined
            ? {}
            : { pkvTariff: args.pkvTariff }),
        },
        kind: "confirmPkvDetails",
        state: session.state,
      }),
    );

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
    const personalData = asPersonalDataInput(args.personalData);

    await persistBookingSessionTransition(
      ctx,
      session,
      applyBookingSessionTransition({
        base: getStepBase(session),
        kind: "submitNewPatientData",
        ...(args.medicalHistory === undefined
          ? {}
          : { medicalHistory: args.medicalHistory }),
        personalData,
        state: session.state,
      }),
    );

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

    await persistBookingSessionTransition(
      ctx,
      session,
      applyBookingSessionTransition({
        base: getStepBase(session),
        dataSharingContacts: ownedContacts,
        kind: "submitNewDataSharing",
        personalData,
        state,
      }),
    );

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
        ruleSetId: session.activeRuleSetId,
      },
    );
    const selectedAppointmentType = requireSelectableRuleSetEntity({
      entity: await ctx.db.get("appointmentTypes", appointmentTypeId),
      entityLabel: "Terminart",
      expectedRuleSetId: session.activeRuleSetId,
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
      ruleSetId: session.activeRuleSetId,
      startTime: selectedSlot.startTime,
    });

    const base = getStepBase(session);
    const appointmentTypeLineageKey = resolveStoredAppointmentTypeLineageKey(
      ctx.db,
      asAppointmentTypeLineageKey(args.appointmentTypeLineageKey),
    );
    const storedSelectedSlot = toStoredSelectedSlot(ctx.db, selectedSlot);

    const locationId = await resolveLocationIdForInternalState(
      ctx.db,
      session.activeRuleSetId,
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
        session.activeRuleSetId,
        asPractitionerLineageKey(selectedSlot.practitionerLineageKey),
      ),
      start: selectedSlot.startTime,
      title: `Online-Termin: ${selectedAppointmentType.name}`,
      userId: session.userId,
    });
    const bookedDurationMinutes = selectedAppointmentType.duration;

    await persistBookingSessionTransition(
      ctx,
      session,
      applyBookingSessionTransition({
        base,
        kind: "selectNewPatientSlot",
        slotAttempt: {
          appointmentId,
          appointmentTypeLineageKey,
          bookedDurationMinutes,
          personalData,
          reasonDescription,
          selectedSlot: storedSelectedSlot,
        },
        state,
      }),
    );
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

    // Verify practitioner exists
    const practitionerId = await resolvePractitionerIdForRuleSetByLineage(
      ctx.db,
      {
        lineageKey: asPractitionerLineageKey(args.practitionerLineageKey),
        ruleSetId: session.activeRuleSetId,
      },
    );
    const practitioner = await ctx.db.get("practitioners", practitionerId);
    requireSelectableRuleSetEntity({
      entity: practitioner,
      entityLabel: "Behandler",
      expectedPracticeId: session.practiceId,
      expectedRuleSetId: session.activeRuleSetId,
    });

    const practitionerLineageKey = resolveStoredPractitionerLineageKey(
      ctx.db,
      asPractitionerLineageKey(args.practitionerLineageKey),
    );
    await persistBookingSessionTransition(
      ctx,
      session,
      applyBookingSessionTransition({
        base: getStepBase(session),
        kind: "selectDoctor",
        practitionerLineageKey,
        state: session.state,
      }),
    );

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
    const personalData = asPersonalDataInput(args.personalData);

    await persistBookingSessionTransition(
      ctx,
      session,
      applyBookingSessionTransition({
        base: getStepBase(session),
        kind: "submitExistingPatientData",
        personalData,
        state: session.state,
      }),
    );

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
    assertValidDataSharingContacts(args.dataSharingContacts);
    const ownedContacts = attachOwnerToDataSharingContacts(
      args.dataSharingContacts,
      session.userId,
    );

    await persistBookingSessionTransition(
      ctx,
      session,
      applyBookingSessionTransition({
        base: getStepBase(session),
        dataSharingContacts: ownedContacts,
        kind: "submitExistingDataSharing",
        state: session.state,
      }),
    );

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
        ruleSetId: session.activeRuleSetId,
      },
    );
    const appointmentType = requireSelectableRuleSetEntity({
      entity: await ctx.db.get("appointmentTypes", appointmentTypeId),
      entityLabel: "Terminart",
      expectedRuleSetId: session.activeRuleSetId,
    });
    await assertSlotAllowedByRules(ctx, {
      appointmentTypeId,
      locationLineageKey: asLocationLineageKey(state.locationLineageKey),
      patientDateOfBirth: personalData.dateOfBirth,
      practiceId: session.practiceId,
      practitionerLineageKey: asPractitionerLineageKey(
        state.practitionerLineageKey,
      ),
      ruleSetId: session.activeRuleSetId,
      startTime: selectedSlot.startTime,
    });

    const [locationId, practitionerId] = await Promise.all([
      resolveLocationIdForInternalState(
        ctx.db,
        session.activeRuleSetId,
        asLocationLineageKey(state.locationLineageKey),
      ),
      resolvePractitionerIdForInternalState(
        ctx.db,
        session.activeRuleSetId,
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

    const base = getStepBase(session);
    const appointmentTypeLineageKey = resolveStoredAppointmentTypeLineageKey(
      ctx.db,
      asAppointmentTypeLineageKey(args.appointmentTypeLineageKey),
    );
    const storedSelectedSlot = toStoredSelectedSlot(ctx.db, selectedSlot);
    await persistBookingSessionTransition(
      ctx,
      session,
      applyBookingSessionTransition({
        base,
        kind: "selectExistingPatientSlot",
        slotAttempt: {
          appointmentId,
          appointmentTypeLineageKey,
          bookedDurationMinutes,
          personalData,
          reasonDescription,
          selectedSlot: storedSelectedSlot,
        },
        state,
      }),
    );

    await refreshSession(ctx, args.sessionId);

    return { appointmentId };
  },
  returns: v.object({
    appointmentId: v.id("appointments"),
  }),
});
