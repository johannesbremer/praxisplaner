import type { GenericMutationCtx } from "convex/server";

import { v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import type { DataModel, Doc, Id } from "./_generated/dataModel";

import { internalMutation, mutation, query } from "./_generated/server";

// Context types for helper functions
type MutationCtx = GenericMutationCtx<DataModel>;
import {
  beihilfeStatusValidator,
  bookingSessionStepValidator,
  emergencyContactValidator,
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

// ============================================================================
// CONSTANTS
// ============================================================================

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ============================================================================
// TYPE HELPERS
// ============================================================================

type BookingSessionState = Doc<"bookingSessions">["state"];

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
    ctx: MutationCtx,
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
  bookingExistingAppointmentChoiceSteps: Doc<"bookingExistingAppointmentChoiceSteps">;
  bookingExistingCalendarSelectionSteps: Doc<"bookingExistingCalendarSelectionSteps">;
  bookingExistingConfirmationSteps: Doc<"bookingExistingConfirmationSteps">;
  bookingExistingDoctorSelectionSteps: Doc<"bookingExistingDoctorSelectionSteps">;
  bookingExistingPersonalDataSteps: Doc<"bookingExistingPersonalDataSteps">;
  bookingLocationSteps: Doc<"bookingLocationSteps">;
  bookingNewAgeCheckSteps: Doc<"bookingNewAgeCheckSteps">;
  bookingNewAppointmentChoiceSteps: Doc<"bookingNewAppointmentChoiceSteps">;
  bookingNewCalendarSelectionSteps: Doc<"bookingNewCalendarSelectionSteps">;
  bookingNewConfirmationSteps: Doc<"bookingNewConfirmationSteps">;
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
  | "bookingExistingAppointmentChoiceSteps"
  | "bookingExistingCalendarSelectionSteps"
  | "bookingExistingConfirmationSteps"
  | "bookingExistingDoctorSelectionSteps"
  | "bookingExistingPersonalDataSteps"
  | "bookingLocationSteps"
  | "bookingNewAgeCheckSteps"
  | "bookingNewAppointmentChoiceSteps"
  | "bookingNewCalendarSelectionSteps"
  | "bookingNewConfirmationSteps"
  | "bookingNewGkvDetailSteps"
  | "bookingNewInsuranceTypeSteps"
  | "bookingNewPersonalDataSteps"
  | "bookingNewPkvConsentSteps"
  | "bookingNewPkvDetailSteps"
  | "bookingPatientStatusSteps"
  | "bookingPrivacySteps"
>;

const STEP_QUERY_MAP: StepQueryMap = {
  bookingExistingAppointmentChoiceSteps: (ctx, sessionId) =>
    ctx.db
      .query("bookingExistingAppointmentChoiceSteps")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(1),
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
  bookingNewAgeCheckSteps: (ctx, sessionId) =>
    ctx.db
      .query("bookingNewAgeCheckSteps")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(1),
  bookingNewAppointmentChoiceSteps: (ctx, sessionId) =>
    ctx.db
      .query("bookingNewAppointmentChoiceSteps")
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
  bookingExistingAppointmentChoiceSteps: (ctx, data) =>
    ctx.db.insert("bookingExistingAppointmentChoiceSteps", data),
  bookingExistingCalendarSelectionSteps: (ctx, data) =>
    ctx.db.insert("bookingExistingCalendarSelectionSteps", data),
  bookingExistingConfirmationSteps: (ctx, data) =>
    ctx.db.insert("bookingExistingConfirmationSteps", data),
  bookingExistingDoctorSelectionSteps: (ctx, data) =>
    ctx.db.insert("bookingExistingDoctorSelectionSteps", data),
  bookingExistingPersonalDataSteps: (ctx, data) =>
    ctx.db.insert("bookingExistingPersonalDataSteps", data),
  bookingLocationSteps: (ctx, data) =>
    ctx.db.insert("bookingLocationSteps", data),
  bookingNewAgeCheckSteps: (ctx, data) =>
    ctx.db.insert("bookingNewAgeCheckSteps", data),
  bookingNewAppointmentChoiceSteps: (ctx, data) =>
    ctx.db.insert("bookingNewAppointmentChoiceSteps", data),
  bookingNewCalendarSelectionSteps: (ctx, data) =>
    ctx.db.insert("bookingNewCalendarSelectionSteps", data),
  bookingNewConfirmationSteps: (ctx, data) =>
    ctx.db.insert("bookingNewConfirmationSteps", data),
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
  bookingExistingAppointmentChoiceSteps: (ctx, id, data) =>
    ctx.db.patch("bookingExistingAppointmentChoiceSteps", id, data),
  bookingExistingCalendarSelectionSteps: (ctx, id, data) =>
    ctx.db.patch("bookingExistingCalendarSelectionSteps", id, data),
  bookingExistingConfirmationSteps: (ctx, id, data) =>
    ctx.db.patch("bookingExistingConfirmationSteps", id, data),
  bookingExistingDoctorSelectionSteps: (ctx, id, data) =>
    ctx.db.patch("bookingExistingDoctorSelectionSteps", id, data),
  bookingExistingPersonalDataSteps: (ctx, id, data) =>
    ctx.db.patch("bookingExistingPersonalDataSteps", id, data),
  bookingLocationSteps: (ctx, id, data) =>
    ctx.db.patch("bookingLocationSteps", id, data),
  bookingNewAgeCheckSteps: (ctx, id, data) =>
    ctx.db.patch("bookingNewAgeCheckSteps", id, data),
  bookingNewAppointmentChoiceSteps: (ctx, id, data) =>
    ctx.db.patch("bookingNewAppointmentChoiceSteps", id, data),
  bookingNewCalendarSelectionSteps: (ctx, id, data) =>
    ctx.db.patch("bookingNewCalendarSelectionSteps", id, data),
  bookingNewConfirmationSteps: (ctx, id, data) =>
    ctx.db.patch("bookingNewConfirmationSteps", id, data),
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

    // Check if session has expired
    const now = BigInt(Date.now());
    if (session.expiresAt < now) {
      return null;
    }

    return session;
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
      .take(1);

    const session = sessions[0];
    if (!session) {
      return null;
    }

    const now = BigInt(Date.now());
    if (session.expiresAt < now) {
      return null;
    }

    return session;
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
        await ctx.db.patch("bookingSessions", session._id, {
          expiresAt: now + BigInt(SESSION_TTL_MS),
          lastModified: now,
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
): Promise<Doc<"bookingSessions">> {
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

  return session;
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
  ctx: MutationCtx,
  tableName: T,
  sessionId: Id<"bookingSessions">,
): Promise<null | StepTableDocMap[T]> {
  const rows = await STEP_QUERY_MAP[tableName](ctx, sessionId);
  return rows[0] ?? null;
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
 * Calculate end time from start time and duration.
 * Handles ZonedDateTime format strings.
 */
function calculateEndTime(startTime: string, durationMinutes: number): string {
  const start = Temporal.ZonedDateTime.from(startTime);
  return start.add({ minutes: durationMinutes }).toString();
}

async function loadStepSnapshot(
  ctx: MutationCtx,
  sessionId: Id<"bookingSessions">,
  step: BookingSessionState["step"],
): Promise<null | Record<string, unknown>> {
  const tableMap: Record<BookingSessionState["step"], null | StepTableName> = {
    "existing-appointment-type": "bookingExistingAppointmentChoiceSteps",
    "existing-calendar-selection": "bookingExistingCalendarSelectionSteps",
    "existing-confirmation": "bookingExistingConfirmationSteps",
    "existing-data-input": "bookingExistingPersonalDataSteps",
    "existing-data-input-complete": "bookingExistingPersonalDataSteps",
    "existing-doctor-selection": "bookingExistingDoctorSelectionSteps",
    location: "bookingLocationSteps",
    "new-age-check": "bookingNewAgeCheckSteps",
    "new-appointment-type": "bookingNewAppointmentChoiceSteps",
    "new-calendar-selection": "bookingNewCalendarSelectionSteps",
    "new-confirmation": "bookingNewConfirmationSteps",
    "new-data-input": "bookingNewPersonalDataSteps",
    "new-data-input-complete": "bookingNewPersonalDataSteps",
    "new-gkv-details": "bookingNewGkvDetailSteps",
    "new-gkv-details-complete": "bookingNewGkvDetailSteps",
    "new-insurance-type": "bookingNewInsuranceTypeSteps",
    "new-pkv-details": "bookingNewPkvDetailSteps",
    "new-pkv-details-complete": "bookingNewPkvDetailSteps",
    "new-pvs-consent": "bookingNewPkvConsentSteps",
    "patient-status": "bookingPatientStatusSteps",
    privacy: "bookingPrivacySteps",
  };

  const tableName = tableMap[step];
  if (!tableName) {
    return null;
  }

  const row = await getStepRow(ctx, tableName, sessionId);
  if (!row) {
    return null;
  }

  const snapshot = stripStepSnapshotFields(row) as Record<string, unknown>;
  return filterStepSnapshot(step, snapshot);
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

const STEP_SNAPSHOT_ALLOWED_FIELDS: Record<
  BookingSessionState["step"],
  string[]
> = {
  "existing-appointment-type": ["isNewPatient", "locationId", "practitionerId"],
  "existing-calendar-selection": [
    "appointmentTypeId",
    "isNewPatient",
    "locationId",
    "practitionerId",
    "personalData",
    "reasonDescription",
  ],
  "existing-confirmation": [
    "appointmentId",
    "appointmentTypeId",
    "isNewPatient",
    "locationId",
    "practitionerId",
    "personalData",
    "reasonDescription",
    "selectedSlot",
    "patientId",
  ],
  "existing-data-input": [
    "appointmentTypeId",
    "isNewPatient",
    "locationId",
    "practitionerId",
  ],
  "existing-data-input-complete": [
    "appointmentTypeId",
    "isNewPatient",
    "locationId",
    "practitionerId",
    "personalData",
    "reasonDescription",
  ],
  "existing-doctor-selection": ["isNewPatient", "locationId"],
  location: [],
  "new-age-check": ["isNewPatient", "locationId"],
  "new-appointment-type": [
    "insuranceType",
    "isNewPatient",
    "isOver40",
    "locationId",
    "hzvStatus",
    "pvsConsent",
    "pkvInsuranceType",
    "pkvTariff",
    "beihilfeStatus",
  ],
  "new-calendar-selection": [
    "appointmentTypeId",
    "insuranceType",
    "isNewPatient",
    "isOver40",
    "locationId",
    "hzvStatus",
    "pvsConsent",
    "pkvInsuranceType",
    "pkvTariff",
    "beihilfeStatus",
    "personalData",
    "medicalHistory",
    "reasonDescription",
    "emergencyContacts",
  ],
  "new-confirmation": [
    "appointmentId",
    "appointmentTypeId",
    "insuranceType",
    "isNewPatient",
    "isOver40",
    "locationId",
    "hzvStatus",
    "pvsConsent",
    "pkvInsuranceType",
    "pkvTariff",
    "beihilfeStatus",
    "personalData",
    "medicalHistory",
    "reasonDescription",
    "emergencyContacts",
    "selectedSlot",
    "patientId",
  ],
  "new-data-input": [
    "appointmentTypeId",
    "insuranceType",
    "isNewPatient",
    "isOver40",
    "locationId",
    "hzvStatus",
    "pvsConsent",
    "pkvInsuranceType",
    "pkvTariff",
    "beihilfeStatus",
  ],
  "new-data-input-complete": [
    "appointmentTypeId",
    "insuranceType",
    "isNewPatient",
    "isOver40",
    "locationId",
    "hzvStatus",
    "pvsConsent",
    "pkvInsuranceType",
    "pkvTariff",
    "beihilfeStatus",
    "personalData",
    "medicalHistory",
    "reasonDescription",
  ],
  "new-gkv-details": [
    "insuranceType",
    "isNewPatient",
    "isOver40",
    "locationId",
  ],
  "new-gkv-details-complete": [
    "insuranceType",
    "isNewPatient",
    "isOver40",
    "locationId",
    "hzvStatus",
  ],
  "new-insurance-type": ["isNewPatient", "isOver40", "locationId"],
  "new-pkv-details": [
    "insuranceType",
    "isNewPatient",
    "isOver40",
    "locationId",
    "pvsConsent",
  ],
  "new-pkv-details-complete": [
    "insuranceType",
    "isNewPatient",
    "isOver40",
    "locationId",
    "pvsConsent",
    "pkvInsuranceType",
    "pkvTariff",
    "beihilfeStatus",
  ],
  "new-pvs-consent": [
    "insuranceType",
    "isNewPatient",
    "isOver40",
    "locationId",
  ],
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
  "new-age-check": { canGoBack: true, prev: "patient-status" },
  "new-appointment-type": {
    canGoBack: true,
    computePrev: (state) => {
      if ("insuranceType" in state) {
        return state.insuranceType === "gkv"
          ? "new-gkv-details-complete"
          : "new-pkv-details-complete";
      }
      return "new-gkv-details";
    },
    prev: "new-gkv-details", // Default, but computed dynamically
  },
  "new-calendar-selection": { canGoBack: false, prev: null },
  "new-confirmation": { canGoBack: false, prev: null }, // Final step - no back
  "new-data-input": { canGoBack: true, prev: "new-appointment-type" },
  "new-data-input-complete": { canGoBack: true, prev: "new-appointment-type" },
  "new-gkv-details": { canGoBack: true, prev: "new-insurance-type" },
  "new-gkv-details-complete": { canGoBack: true, prev: "new-insurance-type" },
  "new-insurance-type": { canGoBack: true, prev: "new-age-check" },
  "new-pkv-details": { canGoBack: true, prev: "new-pvs-consent" },
  "new-pkv-details-complete": { canGoBack: true, prev: "new-pvs-consent" },
  "new-pvs-consent": { canGoBack: true, prev: "new-insurance-type" },

  // PATH B: Existing patient (no back after doctor selection)
  "existing-appointment-type": { canGoBack: false, prev: null },
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

    case "new-age-check": {
      if (!("locationId" in state)) {
        throw new Error("Cannot go back: missing locationId");
      }
      return {
        isNewPatient: true,
        locationId: state.locationId,
        step: "new-age-check",
      };
    }

    case "new-gkv-details": {
      if (!("locationId" in state) || !("isOver40" in state)) {
        throw new Error("Cannot go back: missing required fields");
      }
      return {
        insuranceType: "gkv",
        isNewPatient: true,
        isOver40: state.isOver40,
        locationId: state.locationId,
        step: "new-gkv-details",
      };
    }

    case "new-gkv-details-complete": {
      if (
        !("locationId" in state) ||
        !("isOver40" in state) ||
        !("hzvStatus" in state)
      ) {
        throw new Error("Cannot go back: missing required fields");
      }
      return {
        hzvStatus: state.hzvStatus,
        insuranceType: "gkv",
        isNewPatient: true,
        isOver40: state.isOver40,
        locationId: state.locationId,
        step: "new-gkv-details-complete",
      };
    }

    case "new-insurance-type": {
      if (!("locationId" in state) || !("isOver40" in state)) {
        throw new Error("Cannot go back: missing required fields");
      }
      return {
        isNewPatient: true,
        isOver40: state.isOver40,
        locationId: state.locationId,
        step: "new-insurance-type",
      };
    }

    case "new-pkv-details": {
      if (!("locationId" in state) || !("isOver40" in state)) {
        throw new Error("Cannot go back: missing required fields");
      }
      return {
        insuranceType: "pkv",
        isNewPatient: true,
        isOver40: state.isOver40,
        locationId: state.locationId,
        pvsConsent: true,
        step: "new-pkv-details",
      };
    }

    case "new-pkv-details-complete": {
      if (!("locationId" in state) || !("isOver40" in state)) {
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
        isOver40: state.isOver40,
        locationId: state.locationId,
        pvsConsent: true,
        step: "new-pkv-details-complete",
      };
    }

    case "new-pvs-consent": {
      if (!("locationId" in state) || !("isOver40" in state)) {
        throw new Error("Cannot go back: missing required fields");
      }
      return {
        insuranceType: "pkv",
        isNewPatient: true,
        isOver40: state.isOver40,
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

    case "new-appointment-type": {
      if (
        !("locationId" in state) ||
        !("isOver40" in state) ||
        !("insuranceType" in state)
      ) {
        throw new Error("Cannot go back: missing required fields");
      }

      if (state.insuranceType === "gkv") {
        if (!("hzvStatus" in state)) {
          throw new Error("Cannot go back: missing hzvStatus");
        }
        return {
          hzvStatus: state.hzvStatus,
          insuranceType: "gkv",
          isNewPatient: true,
          isOver40: state.isOver40,
          locationId: state.locationId,
          step: "new-appointment-type",
        };
      } else {
        // PKV path - preserve optional fields
        // At this point, state has been narrowed to a PKV type that may have these optional fields
        // Use spread to only include defined optional properties
        return {
          ...("beihilfeStatus" in state
            ? { beihilfeStatus: state.beihilfeStatus }
            : {}),
          ...("pkvInsuranceType" in state
            ? { pkvInsuranceType: state.pkvInsuranceType }
            : {}),
          ...("pkvTariff" in state ? { pkvTariff: state.pkvTariff } : {}),
          insuranceType: "pkv" as const,
          isNewPatient: true as const,
          isOver40: state.isOver40,
          locationId: state.locationId,
          pvsConsent: true as const,
          step: "new-appointment-type" as const,
        };
      }
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

    const snapshot = await loadStepSnapshot(
      ctx,
      session._id,
      previousState.step,
    );
    const mergedState: BookingSessionState = snapshot
      ? ({ ...previousState, ...snapshot } as BookingSessionState)
      : previousState;
    const sanitizedState = sanitizeState(previousState.step, mergedState);

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: sanitizedState,
    });

    await refreshSession(ctx, args.sessionId);
    return previousState.step;
  },
  returns: v.string(),
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

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: { step: "location" as const },
    });

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

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        locationId: args.locationId,
        step: "patient-status" as const,
      },
    });

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
 * Step 3 → A1: Select "new patient" path - proceed to age check.
 */
export const selectNewPatient = mutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);
    const state = assertStep(session.state, "patient-status");

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        isNewPatient: true as const,
        locationId: state.locationId,
        step: "new-age-check" as const,
      },
    });

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

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        isNewPatient: false as const,
        locationId: state.locationId,
        step: "existing-doctor-selection" as const,
      },
    });

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
 * A1 → A2: Confirm age check and proceed to insurance type.
 * Requires authentication.
 */
export const confirmAgeCheck = mutation({
  args: {
    isOver40: v.boolean(),
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);
    const state = assertStep(session.state, "new-age-check");

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        isNewPatient: true as const,
        isOver40: args.isOver40,
        locationId: state.locationId,
        step: "new-insurance-type" as const,
      },
    });

    const base = getStepBase(session);
    await upsertStep(ctx, "bookingNewAgeCheckSteps", session, {
      ...base,
      isNewPatient: true as const,
      isOver40: args.isOver40,
      locationId: state.locationId,
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

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
      await ctx.db.patch("bookingSessions", args.sessionId, {
        state: {
          insuranceType: "gkv" as const,
          isNewPatient: true as const,
          isOver40: state.isOver40,
          locationId: state.locationId,
          step: "new-gkv-details" as const,
        },
      });
    } else {
      await ctx.db.patch("bookingSessions", args.sessionId, {
        state: {
          insuranceType: "pkv" as const,
          isNewPatient: true as const,
          isOver40: state.isOver40,
          locationId: state.locationId,
          step: "new-pvs-consent" as const,
        },
      });
    }

    const base = getStepBase(session);
    await upsertStep(ctx, "bookingNewInsuranceTypeSteps", session, {
      ...base,
      insuranceType: args.insuranceType,
      isNewPatient: true as const,
      isOver40: state.isOver40,
      locationId: state.locationId,
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * A3a → A4: Confirm HZV status (GKV) and proceed to appointment type selection.
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

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        hzvStatus: args.hzvStatus,
        insuranceType: "gkv" as const,
        isNewPatient: true as const,
        isOver40: state.isOver40,
        locationId: state.locationId,
        step: "new-appointment-type" as const,
      },
    });

    const base = getStepBase(session);
    await upsertStep(ctx, "bookingNewGkvDetailSteps", session, {
      ...base,
      hzvStatus: args.hzvStatus,
      insuranceType: "gkv" as const,
      isNewPatient: true as const,
      isOver40: state.isOver40,
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

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        insuranceType: "pkv" as const,
        isNewPatient: true as const,
        isOver40: state.isOver40,
        locationId: state.locationId,
        pvsConsent: true as const,
        step: "new-pkv-details" as const,
      },
    });

    const base = getStepBase(session);
    await upsertStep(ctx, "bookingNewPkvConsentSteps", session, {
      ...base,
      insuranceType: "pkv" as const,
      isNewPatient: true as const,
      isOver40: state.isOver40,
      locationId: state.locationId,
      pvsConsent: true as const,
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * A3b → A4: Confirm PKV details and proceed to appointment type selection.
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

    // Build state object - include optional fields only if defined
    type PkvAppointmentType = StateAtStep<"new-appointment-type"> & {
      insuranceType: "pkv";
    };
    const newState: PkvAppointmentType = {
      insuranceType: "pkv" as const,
      isNewPatient: true as const,
      isOver40: state.isOver40,
      locationId: state.locationId,
      pvsConsent: true as const,
      step: "new-appointment-type" as const,
    };

    if (args.pkvTariff !== undefined) {
      newState.pkvTariff = args.pkvTariff;
    }
    if (args.pkvInsuranceType !== undefined) {
      newState.pkvInsuranceType = args.pkvInsuranceType;
    }
    if (args.beihilfeStatus !== undefined) {
      newState.beihilfeStatus = args.beihilfeStatus;
    }

    await ctx.db.patch("bookingSessions", args.sessionId, { state: newState });

    const base = getStepBase(session);
    const stepData: StepTableInput<"bookingNewPkvDetailSteps"> = {
      ...base,
      insuranceType: "pkv",
      isNewPatient: true,
      isOver40: state.isOver40,
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
 * A4 → A5: Select appointment type and proceed to data input.
 * Requires authentication.
 */
export const selectNewPatientAppointmentType = mutation({
  args: {
    appointmentTypeId: v.id("appointmentTypes"),
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);

    // new-appointment-type has two variants: GKV (with hzvStatus) and PKV (with pvsConsent)
    if (session.state.step !== "new-appointment-type") {
      throw new Error(
        `Invalid step: expected 'new-appointment-type', got '${session.state.step}'`,
      );
    }

    // Verify appointment type exists and belongs to this rule set
    const appointmentType = await ctx.db.get(
      "appointmentTypes",
      args.appointmentTypeId,
    );
    if (appointmentType?.ruleSetId !== session.ruleSetId) {
      throw new Error("Invalid appointment type");
    }

    const state = session.state;

    // Discriminate by checking for hzvStatus (GKV) vs pvsConsent (PKV)
    if (state.insuranceType === "gkv") {
      // GKV path
      await ctx.db.patch("bookingSessions", args.sessionId, {
        state: {
          appointmentTypeId: args.appointmentTypeId,
          hzvStatus: state.hzvStatus,
          insuranceType: "gkv" as const,
          isNewPatient: true as const,
          isOver40: state.isOver40,
          locationId: state.locationId,
          step: "new-data-input" as const,
        },
      });
    } else {
      // PKV path - build state including optional fields only if defined
      type PkvDataInput = StateAtStep<"new-data-input"> & {
        insuranceType: "pkv";
      };
      const newState: PkvDataInput = {
        appointmentTypeId: args.appointmentTypeId,
        insuranceType: "pkv" as const,
        isNewPatient: true as const,
        isOver40: state.isOver40,
        locationId: state.locationId,
        pvsConsent: true as const,
        step: "new-data-input" as const,
      };

      if (state.pkvTariff !== undefined) {
        newState.pkvTariff = state.pkvTariff;
      }
      if (state.pkvInsuranceType !== undefined) {
        newState.pkvInsuranceType = state.pkvInsuranceType;
      }
      if (state.beihilfeStatus !== undefined) {
        newState.beihilfeStatus = state.beihilfeStatus;
      }

      await ctx.db.patch("bookingSessions", args.sessionId, {
        state: newState,
      });
    }

    const base = getStepBase(session);
    await upsertStep(ctx, "bookingNewAppointmentChoiceSteps", session, {
      ...base,
      appointmentTypeId: args.appointmentTypeId,
      isNewPatient: true as const,
      isOver40: state.isOver40,
      locationId: state.locationId,
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * A5 → A6: Submit personal data and proceed to calendar selection.
 */
export const submitNewPatientData = mutation({
  args: {
    emergencyContacts: v.optional(v.array(emergencyContactValidator)),
    medicalHistory: v.optional(medicalHistoryValidator),
    personalData: personalDataValidator,
    reasonDescription: v.string(),
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

    // Build calendar state based on insurance type
    if (state.insuranceType === "gkv") {
      type GkvCalendar = StateAtStep<"new-calendar-selection"> & {
        insuranceType: "gkv";
      };
      const newState: GkvCalendar = {
        appointmentTypeId: state.appointmentTypeId,
        hzvStatus: state.hzvStatus,
        insuranceType: "gkv" as const,
        isNewPatient: true as const,
        isOver40: state.isOver40,
        locationId: state.locationId,
        personalData: args.personalData,
        reasonDescription: args.reasonDescription,
        step: "new-calendar-selection" as const,
      };

      if (args.medicalHistory !== undefined) {
        newState.medicalHistory = args.medicalHistory;
      }
      if (args.emergencyContacts !== undefined) {
        newState.emergencyContacts = args.emergencyContacts;
      }

      await ctx.db.patch("bookingSessions", args.sessionId, {
        state: newState,
      });
    } else {
      // PKV path
      type PkvCalendar = StateAtStep<"new-calendar-selection"> & {
        insuranceType: "pkv";
      };
      const newState: PkvCalendar = {
        appointmentTypeId: state.appointmentTypeId,
        insuranceType: "pkv" as const,
        isNewPatient: true as const,
        isOver40: state.isOver40,
        locationId: state.locationId,
        personalData: args.personalData,
        pvsConsent: true as const,
        reasonDescription: args.reasonDescription,
        step: "new-calendar-selection" as const,
      };

      if (args.medicalHistory !== undefined) {
        newState.medicalHistory = args.medicalHistory;
      }
      if (args.emergencyContacts !== undefined) {
        newState.emergencyContacts = args.emergencyContacts;
      }
      if (state.pkvTariff !== undefined) {
        newState.pkvTariff = state.pkvTariff;
      }
      if (state.pkvInsuranceType !== undefined) {
        newState.pkvInsuranceType = state.pkvInsuranceType;
      }
      if (state.beihilfeStatus !== undefined) {
        newState.beihilfeStatus = state.beihilfeStatus;
      }

      await ctx.db.patch("bookingSessions", args.sessionId, {
        state: newState,
      });
    }

    const base = getStepBase(session);
    const stepData: StepTableInput<"bookingNewPersonalDataSteps"> = {
      ...base,
      appointmentTypeId: state.appointmentTypeId,
      insuranceType: state.insuranceType,
      isNewPatient: true,
      isOver40: state.isOver40,
      locationId: state.locationId,
      personalData: args.personalData,
      reasonDescription: args.reasonDescription,
      ...(args.medicalHistory === undefined
        ? {}
        : { medicalHistory: args.medicalHistory }),
      ...(args.emergencyContacts === undefined
        ? {}
        : { emergencyContacts: args.emergencyContacts }),
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
    };

    await upsertStep(ctx, "bookingNewPersonalDataSteps", session, stepData);

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * A6 → A7: Select slot and create appointment (new patient).
 * Requires authentication.
 */
export const selectNewPatientSlot = mutation({
  args: {
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
    const now = BigInt(Date.now());

    const base = getStepBase(session);
    const calendarStep: StepTableInput<"bookingNewCalendarSelectionSteps"> = {
      ...base,
      appointmentTypeId: state.appointmentTypeId,
      insuranceType: state.insuranceType,
      isNewPatient: true,
      isOver40: state.isOver40,
      locationId: state.locationId,
      personalData: state.personalData,
      reasonDescription: state.reasonDescription,
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
    };

    await upsertStep(
      ctx,
      "bookingNewCalendarSelectionSteps",
      session,
      calendarStep,
    );

    // Get the appointment type for the title
    const appointmentType = await ctx.db.get(
      "appointmentTypes",
      state.appointmentTypeId,
    );
    if (!appointmentType) {
      throw new Error("Appointment type not found");
    }

    // Create the appointment
    const appointmentId = await ctx.db.insert("appointments", {
      appointmentTypeId: state.appointmentTypeId,
      appointmentTypeTitle: appointmentType.name,
      createdAt: now,
      end: calculateEndTime(
        args.selectedSlot.startTime,
        args.selectedSlot.duration,
      ),
      lastModified: now,
      locationId: state.locationId,
      practiceId: session.practiceId,
      practitionerId: args.selectedSlot.practitionerId,
      start: args.selectedSlot.startTime,
      title: `Online-Termin: ${appointmentType.name}`,
      userId: session.userId,
    });

    // Build confirmation state based on insurance type
    if (state.insuranceType === "gkv") {
      type GkvConfirm = StateAtStep<"new-confirmation"> & {
        insuranceType: "gkv";
      };
      const confirmState: GkvConfirm = {
        appointmentId,
        appointmentTypeId: state.appointmentTypeId,
        hzvStatus: state.hzvStatus,
        insuranceType: "gkv" as const,
        isNewPatient: true as const,
        isOver40: state.isOver40,
        locationId: state.locationId,
        personalData: state.personalData,
        reasonDescription: state.reasonDescription,
        selectedSlot: args.selectedSlot,
        step: "new-confirmation" as const,
      };

      if (state.medicalHistory !== undefined) {
        confirmState.medicalHistory = state.medicalHistory;
      }
      if (state.emergencyContacts !== undefined) {
        confirmState.emergencyContacts = state.emergencyContacts;
      }

      await ctx.db.patch("bookingSessions", args.sessionId, {
        state: confirmState,
      });

      await upsertStep(ctx, "bookingNewConfirmationSteps", session, {
        ...base,
        appointmentId,
        appointmentTypeId: state.appointmentTypeId,
        hzvStatus: state.hzvStatus,
        insuranceType: "gkv" as const,
        isNewPatient: true as const,
        isOver40: state.isOver40,
        locationId: state.locationId,
        personalData: state.personalData,
        reasonDescription: state.reasonDescription,
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
      type PkvConfirm = StateAtStep<"new-confirmation"> & {
        insuranceType: "pkv";
      };
      const confirmState: PkvConfirm = {
        appointmentId,
        appointmentTypeId: state.appointmentTypeId,
        insuranceType: "pkv" as const,
        isNewPatient: true as const,
        isOver40: state.isOver40,
        locationId: state.locationId,
        personalData: state.personalData,
        pvsConsent: true as const,
        reasonDescription: state.reasonDescription,
        selectedSlot: args.selectedSlot,
        step: "new-confirmation" as const,
      };

      if (state.medicalHistory !== undefined) {
        confirmState.medicalHistory = state.medicalHistory;
      }
      if (state.emergencyContacts !== undefined) {
        confirmState.emergencyContacts = state.emergencyContacts;
      }
      if (state.pkvTariff !== undefined) {
        confirmState.pkvTariff = state.pkvTariff;
      }
      if (state.pkvInsuranceType !== undefined) {
        confirmState.pkvInsuranceType = state.pkvInsuranceType;
      }
      if (state.beihilfeStatus !== undefined) {
        confirmState.beihilfeStatus = state.beihilfeStatus;
      }

      await ctx.db.patch("bookingSessions", args.sessionId, {
        state: confirmState,
      });

      const confirmStep: StepTableInput<"bookingNewConfirmationSteps"> = {
        ...base,
        appointmentId,
        appointmentTypeId: state.appointmentTypeId,
        insuranceType: "pkv",
        isNewPatient: true,
        isOver40: state.isOver40,
        locationId: state.locationId,
        personalData: state.personalData,
        reasonDescription: state.reasonDescription,
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
      };

      await upsertStep(
        ctx,
        "bookingNewConfirmationSteps",
        session,
        confirmStep,
      );
    }

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
 * B1 → B2: Select doctor.
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

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        isNewPatient: false as const,
        locationId: state.locationId,
        practitionerId: args.practitionerId,
        step: "existing-appointment-type" as const,
      },
    });

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
 * B2 → B3: Select appointment type and proceed to data input.
 * Requires authentication.
 */
export const selectExistingPatientAppointmentType = mutation({
  args: {
    appointmentTypeId: v.id("appointmentTypes"),
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);
    const state = assertStep(session.state, "existing-appointment-type");

    // Verify appointment type exists and belongs to this rule set
    const appointmentType = await ctx.db.get(
      "appointmentTypes",
      args.appointmentTypeId,
    );
    if (appointmentType?.ruleSetId !== session.ruleSetId) {
      throw new Error("Invalid appointment type");
    }

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        appointmentTypeId: args.appointmentTypeId,
        isNewPatient: false as const,
        locationId: state.locationId,
        practitionerId: state.practitionerId,
        step: "existing-data-input" as const,
      },
    });

    const base = getStepBase(session);
    await upsertStep(ctx, "bookingExistingAppointmentChoiceSteps", session, {
      ...base,
      appointmentTypeId: args.appointmentTypeId,
      isNewPatient: false as const,
      locationId: state.locationId,
      practitionerId: state.practitionerId,
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * B3 → B4: Submit personal data and proceed to calendar selection.
 * Requires authentication.
 */
export const submitExistingPatientData = mutation({
  args: {
    personalData: personalDataValidator,
    reasonDescription: v.string(),
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

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        appointmentTypeId: state.appointmentTypeId,
        isNewPatient: false as const,
        locationId: state.locationId,
        personalData: args.personalData,
        practitionerId: state.practitionerId,
        reasonDescription: args.reasonDescription,
        step: "existing-calendar-selection" as const,
      },
    });

    const base = getStepBase(session);
    await upsertStep(ctx, "bookingExistingPersonalDataSteps", session, {
      ...base,
      appointmentTypeId: state.appointmentTypeId,
      isNewPatient: false as const,
      locationId: state.locationId,
      personalData: args.personalData,
      practitionerId: state.practitionerId,
      reasonDescription: args.reasonDescription,
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * B4 → B5: Select slot and create appointment (existing patient).
 * Requires authentication.
 */
export const selectExistingPatientSlot = mutation({
  args: {
    selectedSlot: selectedSlotValidator,
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await getVerifiedSession(ctx, args.sessionId);
    const state = assertStep(session.state, "existing-calendar-selection");

    const now = BigInt(Date.now());

    // Get the appointment type for the title
    const appointmentType = await ctx.db.get(
      "appointmentTypes",
      state.appointmentTypeId,
    );
    if (!appointmentType) {
      throw new Error("Appointment type not found");
    }

    // Create the appointment
    const appointmentId = await ctx.db.insert("appointments", {
      appointmentTypeId: state.appointmentTypeId,
      appointmentTypeTitle: appointmentType.name,
      createdAt: now,
      end: calculateEndTime(
        args.selectedSlot.startTime,
        args.selectedSlot.duration,
      ),
      lastModified: now,
      locationId: state.locationId,
      practiceId: session.practiceId,
      practitionerId: state.practitionerId,
      start: args.selectedSlot.startTime,
      title: `Online-Termin: ${appointmentType.name}`,
      userId: session.userId,
    });

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        appointmentId,
        appointmentTypeId: state.appointmentTypeId,
        isNewPatient: false as const,
        locationId: state.locationId,
        personalData: state.personalData,
        practitionerId: state.practitionerId,
        reasonDescription: state.reasonDescription,
        selectedSlot: args.selectedSlot,
        step: "existing-confirmation" as const,
      },
    });

    const base = getStepBase(session);
    await upsertStep(ctx, "bookingExistingCalendarSelectionSteps", session, {
      ...base,
      appointmentTypeId: state.appointmentTypeId,
      isNewPatient: false as const,
      locationId: state.locationId,
      personalData: state.personalData,
      practitionerId: state.practitionerId,
      reasonDescription: state.reasonDescription,
      selectedSlot: args.selectedSlot,
    });

    await upsertStep(ctx, "bookingExistingConfirmationSteps", session, {
      ...base,
      appointmentId,
      appointmentTypeId: state.appointmentTypeId,
      isNewPatient: false as const,
      locationId: state.locationId,
      personalData: state.personalData,
      practitionerId: state.practitionerId,
      reasonDescription: state.reasonDescription,
      selectedSlot: args.selectedSlot,
    });

    await refreshSession(ctx, args.sessionId);

    return { appointmentId };
  },
  returns: v.object({
    appointmentId: v.id("appointments"),
  }),
});
