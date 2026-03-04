import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";

import { v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import type { DataModel, Doc, Id } from "./_generated/dataModel";

import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { createAppointmentFromTrustedSource } from "./appointments";
import {
  beihilfeStatusValidator,
  type BookingSessionStep,
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
  ensureAuthenticatedUserId,
  getAuthenticatedUserIdForQuery,
} from "./userIdentity";

// Context types for helper functions
type MutationCtx = GenericMutationCtx<DataModel>;
type QueryCtx = GenericQueryCtx<DataModel>;
type SessionDoc = Doc<"bookingSessions">;
type SessionWithState = SessionDoc & { state: BookingSessionState };
interface StepReadCtx {
  db: MutationCtx["db"] | QueryCtx["db"];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const APPOINTMENT_TIMEZONE = "Europe/Berlin";

// ============================================================================
// TYPE HELPERS
// ============================================================================

type BookingSessionState = BookingSessionStep;
type DataSharingContact =
  Doc<"bookingNewDataSharingSteps">["dataSharingContacts"][number];
type DataSharingContactInput = Omit<DataSharingContact, "userId">;

// Helper to narrow state to a specific step
type StateAtStep<S extends BookingSessionState["step"]> = Extract<
  BookingSessionState,
  { step: S }
>;

type StepInsertMap = {
  [K in StepTableName]: (
    ctx: MutationCtx,
    data: StepTableInsert<K>,
  ) => Promise<Id<K>>;
};

type StepPatchMap = {
  [K in StepTableName]: (
    ctx: MutationCtx,
    id: Id<K>,
    data: Partial<StepTableInsert<K>>,
  ) => Promise<void>;
};

type StepQueryMap = {
  [K in StepTableName]: (
    ctx: StepReadCtx,
    sessionId: Id<"bookingSessions">,
  ) => Promise<StepTableDocMap[K][]>;
};

type StepSnapshotMetaKeys =
  | "_creationTime"
  | "_id"
  | "createdAt"
  | "lastModified"
  | "practiceId"
  | "ruleSetId"
  | "sessionId"
  | "userId";

interface StepTableDocMap {
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

type StepTableInput<T extends StepTableName> = Omit<
  StepTableInsert<T>,
  "createdAt" | "lastModified"
>;

type StepTableInsert<T extends StepTableName> = Omit<
  StepTableDocMap[T],
  "_creationTime" | "_id"
>;

type StepTableName = keyof Pick<
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
    BookingSessionState,
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

async function hydrateSessionState(
  ctx: MutationCtx | QueryCtx,
  session: SessionDoc,
): Promise<BookingSessionState> {
  const step = session.state.step;
  const snapshot = await loadStepSnapshot(ctx, session._id, step);
  if (STEP_SNAPSHOT_TABLES_BY_STEP[step].length > 0 && snapshot === null) {
    throw new Error(`Missing snapshot for booking session step '${step}'`);
  }

  const mergedState =
    snapshot === null
      ? ({ step } as BookingSessionState)
      : ({ step, ...snapshot } as BookingSessionState);
  const sanitizedState = sanitizeState(step, mergedState);
  assertHydratedStateConsistency(step, sanitizedState);
  return sanitizedState;
}

function isConfirmationState(
  state: BookingSessionState,
): state is Extract<
  BookingSessionState,
  { step: "existing-confirmation" | "new-confirmation" }
> {
  return (
    state.step === "existing-confirmation" || state.step === "new-confirmation"
  );
}

async function tryHydrateSessionState(
  ctx: MutationCtx | QueryCtx,
  session: SessionDoc,
): Promise<BookingSessionState | null> {
  try {
    return await hydrateSessionState(ctx, session);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Missing snapshot for booking session step")
    ) {
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
async function getVerifiedSession(
  ctx: MutationCtx,
  sessionId: Id<"bookingSessions">,
): Promise<SessionWithState> {
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

  const state = await tryHydrateSessionState(ctx, session);
  if (!state) {
    throw new Error(
      "Session data is incomplete. Please start the booking again.",
    );
  }
  return withHydratedState(session, state);
}

/**
 * Refresh session expiry on any update.
 */
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
    const patchData = {
      ...data,
      lastModified: now,
    } as unknown as Partial<StepTableInsert<T>>;
    await STEP_PATCH_MAP[tableName](ctx, existingRow._id as Id<T>, patchData);
    return;
  }

  const insertData = {
    ...data,
    createdAt: now,
    lastModified: now,
  } as StepTableInsert<T>;
  await STEP_INSERT_MAP[tableName](ctx, insertData);
}

/**
 * Assert that the session is at the expected step.
 * Returns the narrowed state type.
 */
function assertStep<S extends BookingSessionState["step"]>(
  state: BookingSessionState,
  expected: S,
): StateAtStep<S> {
  if (state.step !== expected) {
    throw new Error(
      `Invalid step: expected '${expected}', got '${state.step}'`,
    );
  }
  return state as StateAtStep<S>;
}

/**
 * Validates data-sharing contact payload semantics.
 */
function assertValidDataSharingContacts(
  contacts: DataSharingContactInput[],
): void {
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
    ...contact,
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
    locationId: Id<"locations">;
    patientDateOfBirth: string;
    practiceId: Id<"practices">;
    practitionerId: Id<"practitioners">;
    ruleSetId: Id<"ruleSets">;
    startTime: string;
  },
): Promise<void> {
  const ruleCheckResult = await ctx.runQuery(
    internal.ruleEngine.checkRulesForAppointment,
    {
      context: {
        appointmentTypeId: args.appointmentTypeId,
        dateTime: args.startTime,
        locationId: args.locationId,
        patientDateOfBirth: args.patientDateOfBirth,
        practiceId: args.practiceId,
        practitionerId: args.practitionerId,
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

function calculateEndTime(startTime: string, durationMinutes: number): string {
  const start = Temporal.ZonedDateTime.from(startTime);
  return start.add({ minutes: durationMinutes }).toString();
}

async function loadStepSnapshot(
  ctx: StepReadCtx,
  sessionId: Id<"bookingSessions">,
  step: BookingSessionState["step"],
): Promise<null | Record<string, unknown>> {
  const tableNames = STEP_SNAPSHOT_TABLES_BY_STEP[step];
  if (tableNames.length === 0) {
    return null;
  }

  for (const tableName of tableNames) {
    const row = await getStepRow(ctx, tableName, sessionId);
    if (!row) {
      continue;
    }

    const snapshot = stripStepSnapshotFields(row) as Record<string, unknown>;
    return filterStepSnapshot(step, snapshot);
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
    "locationId",
    "practitionerId",
    "personalData",
    "dataSharingContacts",
  ],
  "existing-confirmation": [
    "appointmentId",
    "appointmentTypeId",
    "isNewPatient",
    "locationId",
    "practitionerId",
    "personalData",
    "dataSharingContacts",
    "reasonDescription",
    "selectedSlot",
    "patientId",
  ],
  "existing-data-input": ["isNewPatient", "locationId", "practitionerId"],
  "existing-data-input-complete": [
    "isNewPatient",
    "locationId",
    "practitionerId",
    "personalData",
  ],
  "existing-doctor-selection": ["isNewPatient", "locationId"],
  location: [],
  "new-calendar-selection": [
    "insuranceType",
    "isNewPatient",
    "locationId",
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
    "appointmentTypeId",
    "insuranceType",
    "isNewPatient",
    "locationId",
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
    "locationId",
    "hzvStatus",
    "pvsConsent",
    "pkvInsuranceType",
    "pkvTariff",
    "beihilfeStatus",
  ],
  "new-data-input-complete": [
    "insuranceType",
    "isNewPatient",
    "locationId",
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
    "locationId",
    "hzvStatus",
    "pvsConsent",
    "pkvInsuranceType",
    "pkvTariff",
    "beihilfeStatus",
    "personalData",
    "medicalHistory",
  ],
  "new-gkv-details": ["insuranceType", "isNewPatient", "locationId"],
  "new-gkv-details-complete": [
    "insuranceType",
    "isNewPatient",
    "locationId",
    "hzvStatus",
  ],
  "new-insurance-type": ["isNewPatient", "locationId"],
  "new-pkv-details": [
    "insuranceType",
    "isNewPatient",
    "locationId",
    "pvsConsent",
  ],
  "new-pkv-details-complete": [
    "insuranceType",
    "isNewPatient",
    "locationId",
    "pvsConsent",
    "pkvInsuranceType",
    "pkvTariff",
    "beihilfeStatus",
  ],
  "new-pvs-consent": ["insuranceType", "isNewPatient", "locationId"],
  "patient-status": ["locationId"],
  privacy: [],
};

function filterStepSnapshot(
  step: BookingSessionState["step"],
  snapshot: Record<string, unknown>,
): Record<string, unknown> {
  const allow = new Set(STEP_SNAPSHOT_ALLOWED_FIELDS[step]);
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (allow.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

function sanitizeState(
  step: BookingSessionState["step"],
  state: BookingSessionState,
): BookingSessionState {
  const allow = new Set(["step", ...STEP_SNAPSHOT_ALLOWED_FIELDS[step]]);
  const sanitized: Record<string, unknown> = { step };
  for (const [key, value] of Object.entries(state)) {
    if (allow.has(key)) {
      sanitized[key] = value;
    }
  }
  return sanitized as BookingSessionState;
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
  computePrev?: (state: BookingSessionState) => null | StepName;
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
function computePreviousState(
  state: BookingSessionState,
): BookingSessionState | null {
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
      const currentState = assertStep(state, "new-data-sharing");

      if (currentState.insuranceType === "gkv") {
        type GkvDataInputComplete = Extract<
          StateAtStep<"new-data-input-complete">,
          { insuranceType: "gkv" }
        >;
        const previousState: GkvDataInputComplete = {
          hzvStatus: currentState.hzvStatus,
          insuranceType: "gkv",
          isNewPatient: true,
          locationId: currentState.locationId,
          personalData: currentState.personalData,
          step: "new-data-input-complete",
        };

        if (currentState.medicalHistory !== undefined) {
          previousState.medicalHistory = currentState.medicalHistory;
        }

        return previousState;
      }

      type PkvDataInputComplete = Extract<
        StateAtStep<"new-data-input-complete">,
        { insuranceType: "pkv" }
      >;
      const previousState: PkvDataInputComplete = {
        insuranceType: "pkv",
        isNewPatient: true,
        locationId: currentState.locationId,
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
      if (!("locationId" in state)) {
        throw new Error("Cannot go back: missing required fields");
      }
      return {
        insuranceType: "gkv",
        isNewPatient: true,
        locationId: state.locationId,
        step: "new-gkv-details",
      };
    }

    case "new-gkv-details-complete": {
      if (!("locationId" in state) || !("hzvStatus" in state)) {
        throw new Error("Cannot go back: missing required fields");
      }
      return {
        hzvStatus: state.hzvStatus,
        insuranceType: "gkv",
        isNewPatient: true,
        locationId: state.locationId,
        step: "new-gkv-details-complete",
      };
    }

    case "new-insurance-type": {
      if (!("locationId" in state)) {
        throw new Error("Cannot go back: missing required fields");
      }
      return {
        isNewPatient: true,
        locationId: state.locationId,
        step: "new-insurance-type",
      };
    }

    case "new-pkv-details": {
      if (!("locationId" in state)) {
        throw new Error("Cannot go back: missing required fields");
      }
      return {
        insuranceType: "pkv",
        isNewPatient: true,
        locationId: state.locationId,
        pvsConsent: true,
        step: "new-pkv-details",
      };
    }

    case "new-pkv-details-complete": {
      if (!("locationId" in state)) {
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
        locationId: state.locationId,
        pvsConsent: true,
        step: "new-pkv-details-complete",
      };
    }

    case "new-pvs-consent": {
      if (!("locationId" in state)) {
        throw new Error("Cannot go back: missing required fields");
      }
      return {
        insuranceType: "pkv",
        isNewPatient: true,
        locationId: state.locationId,
        step: "new-pvs-consent",
      };
    }

    case "patient-status": {
      if (!("locationId" in state)) {
        throw new Error("Cannot go back: missing locationId");
      }
      return { locationId: state.locationId, step: "patient-status" };
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

    const previousState = computePreviousState(session.state);
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
    assertStep(session.state, "privacy");

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
    locationId: v.id("locations"),
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);
    assertStep(session.state, "location");

    // Verify location exists and belongs to this practice
    const location = await ctx.db.get("locations", args.locationId);
    if (location?.practiceId !== session.practiceId) {
      throw new Error("Invalid location");
    }

    await setSessionStep(ctx, args.sessionId, "patient-status");

    const base = getStepBase(session);
    await upsertStep(ctx, "bookingLocationSteps", session, {
      ...base,
      locationId: args.locationId,
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
    const state = assertStep(session.state, "patient-status");

    await setSessionStep(ctx, args.sessionId, "new-insurance-type");

    const base = getStepBase(session);
    await upsertStep(ctx, "bookingPatientStatusSteps", session, {
      ...base,
      isNewPatient: true as const,
      locationId: state.locationId,
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
    const state = assertStep(session.state, "patient-status");

    await setSessionStep(ctx, args.sessionId, "existing-doctor-selection");

    const base = getStepBase(session);
    await upsertStep(ctx, "bookingPatientStatusSteps", session, {
      ...base,
      isNewPatient: false as const,
      locationId: state.locationId,
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
    const state = assertStep(session.state, "new-insurance-type");

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
      locationId: state.locationId,
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
      locationId: state.locationId,
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
    const state = assertStep(session.state, "new-pvs-consent");

    await setSessionStep(ctx, args.sessionId, "new-pkv-details");

    const base = getStepBase(session);
    await upsertStep(ctx, "bookingNewPkvConsentSteps", session, {
      ...base,
      insuranceType: "pkv" as const,
      isNewPatient: true as const,
      locationId: state.locationId,
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
      locationId: state.locationId,
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

    await setSessionStep(ctx, args.sessionId, "new-data-sharing");

    const base = getStepBase(session);
    const stepData: StepTableInput<"bookingNewPersonalDataSteps"> = {
      ...base,
      insuranceType: state.insuranceType,
      isNewPatient: true,
      locationId: state.locationId,
      personalData: args.personalData,
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
    const state = assertStep(session.state, "new-data-sharing");
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
      locationId: state.locationId,
      personalData: state.personalData,
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
    appointmentTypeId: v.id("appointmentTypes"),
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
    const reasonDescription = args.reasonDescription.trim();

    if (reasonDescription.length === 0) {
      throw new Error("Reason description is required");
    }
    assertSlotStartIsInFuture(args.selectedSlot.startTime);

    const selectedAppointmentType = await ctx.db.get(
      "appointmentTypes",
      args.appointmentTypeId,
    );
    if (selectedAppointmentType?.ruleSetId !== session.ruleSetId) {
      throw new Error("Invalid appointment type");
    }
    await assertSlotAllowedByRules(ctx, {
      appointmentTypeId: args.appointmentTypeId,
      locationId: state.locationId,
      patientDateOfBirth: state.personalData.dateOfBirth,
      practiceId: session.practiceId,
      practitionerId: args.selectedSlot.practitionerId,
      ruleSetId: session.ruleSetId,
      startTime: args.selectedSlot.startTime,
    });

    const base = getStepBase(session);
    const calendarStep: StepTableInput<"bookingNewCalendarSelectionSteps"> = {
      ...base,
      appointmentTypeId: args.appointmentTypeId,
      dataSharingContacts: state.dataSharingContacts,
      insuranceType: state.insuranceType,
      isNewPatient: true,
      locationId: state.locationId,
      personalData: state.personalData,
      reasonDescription,
      selectedSlot: args.selectedSlot,
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

    const appointmentId = await createAppointmentFromTrustedSource(ctx, {
      appointmentTypeId: args.appointmentTypeId,
      end: calculateEndTime(
        args.selectedSlot.startTime,
        args.selectedSlot.duration,
      ),
      locationId: state.locationId,
      practiceId: session.practiceId,
      practitionerId: args.selectedSlot.practitionerId,
      start: args.selectedSlot.startTime,
      title: `Online-Termin: ${selectedAppointmentType.name}`,
      userId: session.userId,
    });

    // Build confirmation state based on insurance type
    if (state.insuranceType === "gkv") {
      await upsertStep(ctx, "bookingNewConfirmationSteps", session, {
        ...base,
        appointmentId,
        appointmentTypeId: args.appointmentTypeId,
        dataSharingContacts: state.dataSharingContacts,
        hzvStatus: state.hzvStatus,
        insuranceType: "gkv" as const,
        isNewPatient: true as const,
        locationId: state.locationId,
        personalData: state.personalData,
        reasonDescription,
        selectedSlot: args.selectedSlot,
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
        appointmentTypeId: args.appointmentTypeId,
        dataSharingContacts: state.dataSharingContacts,
        insuranceType: "pkv",
        isNewPatient: true,
        locationId: state.locationId,
        personalData: state.personalData,
        reasonDescription,
        selectedSlot: args.selectedSlot,
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
    practitionerId: v.id("practitioners"),
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);
    const state = assertStep(session.state, "existing-doctor-selection");

    // Verify practitioner exists
    const practitioner = await ctx.db.get("practitioners", args.practitionerId);
    if (!practitioner) {
      throw new Error("Practitioner not found");
    }

    await setSessionStep(ctx, args.sessionId, "existing-data-input");

    const base = getStepBase(session);
    await upsertStep(ctx, "bookingExistingDoctorSelectionSteps", session, {
      ...base,
      isNewPatient: false as const,
      locationId: state.locationId,
      practitionerId: args.practitionerId,
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

    await setSessionStep(ctx, args.sessionId, "existing-calendar-selection");

    const base = getStepBase(session);
    await upsertStep(ctx, "bookingExistingPersonalDataSteps", session, {
      ...base,
      isNewPatient: false as const,
      locationId: state.locationId,
      personalData: args.personalData,
      practitionerId: state.practitionerId,
    });
    await upsertStep(ctx, "bookingExistingDataSharingSteps", session, {
      ...base,
      dataSharingContacts: [],
      isNewPatient: false as const,
      locationId: state.locationId,
      personalData: args.personalData,
      practitionerId: state.practitionerId,
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
      locationId: state.locationId,
      personalData: state.personalData,
      practitionerId: state.practitionerId,
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
    appointmentTypeId: v.id("appointmentTypes"),
    reasonDescription: v.string(),
    selectedSlot: selectedSlotValidator,
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);
    const state = assertStep(session.state, "existing-calendar-selection");
    const reasonDescription = args.reasonDescription.trim();

    if (reasonDescription.length === 0) {
      throw new Error("Reason description is required");
    }
    assertSlotStartIsInFuture(args.selectedSlot.startTime);

    const appointmentType = await ctx.db.get(
      "appointmentTypes",
      args.appointmentTypeId,
    );
    if (appointmentType?.ruleSetId !== session.ruleSetId) {
      throw new Error("Invalid appointment type");
    }
    await assertSlotAllowedByRules(ctx, {
      appointmentTypeId: args.appointmentTypeId,
      locationId: state.locationId,
      patientDateOfBirth: state.personalData.dateOfBirth,
      practiceId: session.practiceId,
      practitionerId: state.practitionerId,
      ruleSetId: session.ruleSetId,
      startTime: args.selectedSlot.startTime,
    });

    const appointmentId = await createAppointmentFromTrustedSource(ctx, {
      appointmentTypeId: args.appointmentTypeId,
      end: calculateEndTime(
        args.selectedSlot.startTime,
        args.selectedSlot.duration,
      ),
      locationId: state.locationId,
      practiceId: session.practiceId,
      practitionerId: state.practitionerId,
      start: args.selectedSlot.startTime,
      title: `Online-Termin: ${appointmentType.name}`,
      userId: session.userId,
    });

    await setSessionStep(ctx, args.sessionId, "existing-confirmation");

    const base = getStepBase(session);
    await upsertStep(ctx, "bookingExistingCalendarSelectionSteps", session, {
      ...base,
      appointmentTypeId: args.appointmentTypeId,
      dataSharingContacts: state.dataSharingContacts,
      isNewPatient: false as const,
      locationId: state.locationId,
      personalData: state.personalData,
      practitionerId: state.practitionerId,
      reasonDescription,
      selectedSlot: args.selectedSlot,
    });

    await upsertStep(ctx, "bookingExistingConfirmationSteps", session, {
      ...base,
      appointmentId,
      appointmentTypeId: args.appointmentTypeId,
      dataSharingContacts: state.dataSharingContacts,
      isNewPatient: false as const,
      locationId: state.locationId,
      personalData: state.personalData,
      practitionerId: state.practitionerId,
      reasonDescription,
      selectedSlot: args.selectedSlot,
    });

    await refreshSession(ctx, args.sessionId);

    return { appointmentId };
  },
  returns: v.object({
    appointmentId: v.id("appointments"),
  }),
});
