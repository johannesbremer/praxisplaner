import type { FunctionArgs } from "convex/server";

import { convexTest } from "convex-test";
import { Temporal } from "temporal-polyfill";
import { describe, expect, expectTypeOf, test } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { InternalBookingSessionState } from "../bookingSessions.shared";

import { api } from "../_generated/api";
import { assertValidSanitizedBookingSessionState } from "../bookingSessions";
import {
  applyBookingSessionTransition,
  computePreviousInternalState,
  materializeBookingSessionUiState,
  sanitizeState,
} from "../bookingSessions.stateMachine";
import { insertSelfLineageEntity } from "../lineage";
import schema, { type BookingSessionStep } from "../schema";
import { modules } from "./test.setup";

type AuthedTestContext = ReturnType<typeof makeAuthedClient>;
type BookingSessionState = BookingSessionStep;
type DataSharingContactInput =
  NewPatientDataSharingArgs["dataSharingContacts"][number];
type ExistingPatientSlotArgs = FunctionArgs<
  typeof api.bookingSessions.selectExistingPatientSlot
>;
type IsAssignable<From, To> = [From] extends [To] ? true : false;
type NewPatientDataSharingArgs = FunctionArgs<
  typeof api.bookingSessions.submitNewDataSharing
>;
type NewPatientSlotArgs = FunctionArgs<
  typeof api.bookingSessions.selectNewPatientSlot
>;
type SelectedSlotInput = NewPatientSlotArgs["selectedSlot"];
type TestContext = ReturnType<typeof createTestContext>;

async function addHoursAheadBlockingRule(
  t: TestContext,
  args: {
    minimumHours: number;
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
) {
  await t.run(async (ctx) => {
    const now = BigInt(Date.now());
    const rootRuleId = await ctx.db.insert("ruleConditions", {
      childOrder: 0,
      createdAt: now,
      enabled: true,
      isRoot: true,
      lastModified: now,
      practiceId: args.practiceId,
      ruleSetId: args.ruleSetId,
    });

    await ctx.db.insert("ruleConditions", {
      childOrder: 0,
      conditionType: "HOURS_AHEAD",
      createdAt: now,
      isRoot: false,
      lastModified: now,
      nodeType: "CONDITION",
      operator: "LESS_THAN",
      parentConditionId: rootRuleId,
      practiceId: args.practiceId,
      ruleSetId: args.ruleSetId,
      valueNumber: args.minimumHours,
    });
  });
}

function assertSessionExists<T>(
  session: null | T,
  message: string,
): asserts session is T {
  if (session === null) {
    throw new Error(message);
  }
}

function assertStateStep<S extends BookingSessionState["step"]>(
  state: BookingSessionState,
  step: S,
): asserts state is Extract<BookingSessionState, { step: S }> {
  expect(state.step).toBe(step);
}

async function bootstrapToExistingCalendarSelection(
  authed: AuthedTestContext,
  locationId: Id<"locations">,
  practitionerId: Id<"practitioners">,
  sessionId: Id<"bookingSessions">,
) {
  await bootstrapToPatientStatus(authed, sessionId, locationId);
  await authed.mutation(api.bookingSessions.selectExistingPatient, {
    sessionId,
  });
  await authed.mutation(api.bookingSessions.selectDoctor, {
    practitionerLineageKey: practitionerId,
    sessionId,
  });
  await authed.mutation(api.bookingSessions.submitExistingPatientData, {
    personalData: {
      dateOfBirth: "1975-05-20",
      firstName: "Grace",
      lastName: "Hopper",
      phoneNumber: "+491709999999",
    },
    sessionId,
  });
  await authed.mutation(api.bookingSessions.submitExistingDataSharing, {
    dataSharingContacts: makeDataSharingContacts(),
    sessionId,
  });
}

async function bootstrapToExistingDataSharing(
  authed: AuthedTestContext,
  locationId: Id<"locations">,
  practitionerId: Id<"practitioners">,
  sessionId: Id<"bookingSessions">,
) {
  await bootstrapToPatientStatus(authed, sessionId, locationId);
  await authed.mutation(api.bookingSessions.selectExistingPatient, {
    sessionId,
  });
  await authed.mutation(api.bookingSessions.selectDoctor, {
    practitionerLineageKey: practitionerId,
    sessionId,
  });
  await authed.mutation(api.bookingSessions.submitExistingPatientData, {
    personalData: {
      dateOfBirth: "1975-05-20",
      firstName: "Grace",
      lastName: "Hopper",
      phoneNumber: "+491709999999",
    },
    sessionId,
  });
}

async function bootstrapToNewCalendarSelection(
  authed: AuthedTestContext,
  locationId: Id<"locations">,
  sessionId: Id<"bookingSessions">,
) {
  await bootstrapToPatientStatus(authed, sessionId, locationId);
  await authed.mutation(api.bookingSessions.selectNewPatient, { sessionId });
  await authed.mutation(api.bookingSessions.selectInsuranceType, {
    insuranceType: "gkv",
    sessionId,
  });
  await authed.mutation(api.bookingSessions.confirmGkvDetails, {
    hzvStatus: "has-contract",
    sessionId,
  });
  await authed.mutation(api.bookingSessions.submitNewPatientData, {
    personalData: {
      dateOfBirth: "1980-01-01",
      firstName: "Ada",
      lastName: "Lovelace",
      phoneNumber: "+491701234567",
    },
    sessionId,
  });
  await authed.mutation(api.bookingSessions.submitNewDataSharing, {
    dataSharingContacts: makeDataSharingContacts(),
    sessionId,
  });
}

async function bootstrapToNewDataSharing(
  authed: AuthedTestContext,
  locationId: Id<"locations">,
  sessionId: Id<"bookingSessions">,
) {
  await bootstrapToPatientStatus(authed, sessionId, locationId);
  await authed.mutation(api.bookingSessions.selectNewPatient, { sessionId });
  await authed.mutation(api.bookingSessions.selectInsuranceType, {
    insuranceType: "gkv",
    sessionId,
  });
  await authed.mutation(api.bookingSessions.confirmGkvDetails, {
    hzvStatus: "has-contract",
    sessionId,
  });
  await authed.mutation(api.bookingSessions.submitNewPatientData, {
    personalData: {
      dateOfBirth: "1980-01-01",
      firstName: "Ada",
      lastName: "Lovelace",
      phoneNumber: "+491701234567",
    },
    sessionId,
  });
}

async function bootstrapToNewDataSharingPkv(
  authed: AuthedTestContext,
  locationId: Id<"locations">,
  sessionId: Id<"bookingSessions">,
) {
  await bootstrapToPatientStatus(authed, sessionId, locationId);
  await authed.mutation(api.bookingSessions.selectNewPatient, { sessionId });
  await authed.mutation(api.bookingSessions.selectInsuranceType, {
    insuranceType: "pkv",
    sessionId,
  });
  await authed.mutation(api.bookingSessions.acceptPvsConsent, { sessionId });
  await authed.mutation(api.bookingSessions.confirmPkvDetails, {
    pvsConsent: true,
    sessionId,
  });
  await authed.mutation(api.bookingSessions.submitNewPatientData, {
    personalData: {
      dateOfBirth: "1980-01-01",
      firstName: "Ada",
      lastName: "Lovelace",
      phoneNumber: "+491701234567",
    },
    sessionId,
  });
}

async function bootstrapToPatientStatus(
  authed: AuthedTestContext,
  sessionId: Id<"bookingSessions">,
  locationId: Id<"locations">,
) {
  await authed.mutation(api.bookingSessions.acceptPrivacy, { sessionId });
  await authed.mutation(api.bookingSessions.selectLocation, {
    locationLineageKey: locationId,
    sessionId,
  });
}

async function createAppointmentTypeInOtherRuleSet(
  t: TestContext,
  practiceId: Id<"practices">,
  practitionerId: Id<"practitioners">,
) {
  return await t.run(async (ctx) => {
    const otherRuleSetId = await ctx.db.insert("ruleSets", {
      createdAt: Date.now(),
      description: "Other Rule Set",
      draftRevision: 0,
      practiceId,
      saved: true,
      version: 2,
    });

    const now = BigInt(Date.now());
    return await insertSelfLineageEntity(ctx.db, "appointmentTypes", {
      allowedPractitionerLineageKeys: [practitionerId],
      createdAt: now,
      duration: 20,
      lastModified: now,
      name: "Other Checkup",
      practiceId,
      ruleSetId: otherRuleSetId,
    });
  });
}

async function createBookingEntities(t: TestContext) {
  return await t.run(async (ctx) => {
    const practiceId = await ctx.db.insert("practices", {
      name: "Flow Test Practice",
    });

    const ruleSetId = await ctx.db.insert("ruleSets", {
      createdAt: Date.now(),
      description: "Flow Test Rule Set",
      draftRevision: 0,
      practiceId,
      saved: true,
      version: 1,
    });

    await ctx.db.patch("practices", practiceId, {
      currentActiveRuleSetId: ruleSetId,
    });

    const locationId = await insertSelfLineageEntity(ctx.db, "locations", {
      name: "Main Location",
      practiceId,
      ruleSetId,
    });

    const practitionerId = await insertSelfLineageEntity(
      ctx.db,
      "practitioners",
      {
        name: "Dr. Test",
        practiceId,
        ruleSetId,
      },
    );

    const now = BigInt(Date.now());
    const appointmentTypeId = await insertSelfLineageEntity(
      ctx.db,
      "appointmentTypes",
      {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 30,
        lastModified: now,
        name: "Checkup",
        practiceId,
        ruleSetId,
      },
    );

    return {
      appointmentTypeId,
      locationId,
      practiceId,
      practitionerId,
      ruleSetId,
    };
  });
}

async function createPracticeAndRuleSet(t: TestContext) {
  return await t.run(async (ctx) => {
    const practiceId = await ctx.db.insert("practices", {
      name: "Test Practice",
    });

    const ruleSetId = await ctx.db.insert("ruleSets", {
      createdAt: Date.now(),
      description: "Test Rule Set",
      draftRevision: 0,
      practiceId,
      saved: true,
      version: 1,
    });

    await ctx.db.patch("practices", practiceId, {
      currentActiveRuleSetId: ruleSetId,
    });

    return { practiceId };
  });
}

function createTestContext() {
  return convexTest(schema, modules);
}

function makeAuthedClient(t: TestContext, identitySuffix: string) {
  return t.withIdentity({
    email: `${identitySuffix}@example.com`,
    subject: `workos_${identitySuffix}`,
  });
}

function makeDataSharingContacts(): DataSharingContactInput[] {
  return [
    {
      city: "Berlin",
      dateOfBirth: "1970-01-01",
      firstName: "Maria",
      gender: "female" as const,
      lastName: "Muster",
      phoneNumber: "+491701234568",
      postalCode: "10115",
      street: "Musterweg 3",
      title: "Frau",
    },
  ];
}

function makeDataSharingContactsWithOverrides(
  overrides: Partial<DataSharingContactInput>,
): DataSharingContactInput[] {
  const [baseContact] = makeDataSharingContacts();
  const contact: DataSharingContactInput = {
    ...baseContact,
    ...overrides,
  } as DataSharingContactInput;
  return [contact];
}

function makeOwnedDataSharingContacts(
  userId: Id<"users">,
  overrides: Partial<DataSharingContactInput> = {},
) {
  return makeDataSharingContactsWithOverrides(overrides).map((contact) => ({
    ...contact,
    userId,
  }));
}

function makePastSelectedSlot(
  practitionerId: Id<"practitioners">,
): SelectedSlotInput {
  return {
    practitionerLineageKey: practitionerId,
    practitionerName: "Dr. Test",
    startTime: Temporal.Now.instant()
      .subtract({ minutes: 5 })
      .toZonedDateTimeISO("Europe/Berlin")
      .toString(),
  };
}

function makeSelectedSlot(
  practitionerId: Id<"practitioners">,
): SelectedSlotInput {
  return {
    practitionerLineageKey: practitionerId,
    practitionerName: "Dr. Test",
    startTime: Temporal.Now.zonedDateTimeISO("Europe/Berlin")
      .add({ days: 1 })
      .with({
        hour: 9,
        millisecond: 0,
        minute: 0,
        nanosecond: 0,
        second: 0,
      })
      .toString(),
  };
}

function makeSoonSelectedSlot(
  practitionerId: Id<"practitioners">,
): SelectedSlotInput {
  return {
    practitionerLineageKey: practitionerId,
    practitionerName: "Dr. Test",
    startTime: Temporal.Now.instant()
      .add({ minutes: 30 })
      .toZonedDateTimeISO("Europe/Berlin")
      .toString(),
  };
}

function nextWeekdayAt(weekday: number, hour: number, minute: number): string {
  const today = Temporal.Now.plainDateISO("Europe/Berlin");
  const delta = (weekday - today.dayOfWeek + 7) % 7;
  return today
    .add({ days: delta === 0 ? 7 : delta })
    .toZonedDateTime({
      plainTime: { hour, minute },
      timeZone: "Europe/Berlin",
    })
    .toString();
}

describe("bookingSessions user identity handling", () => {
  test("create bootstraps missing authenticated user", async () => {
    const t = createTestContext();
    const { practiceId } = await createPracticeAndRuleSet(t);

    const authId = "workos_missing_user";
    const authed = t.withIdentity({
      email: "missing@example.com",
      subject: authId,
    });

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });

    const state = await t.run(async (ctx) => {
      const session = await ctx.db.get("bookingSessions", sessionId);
      const users = await ctx.db
        .query("users")
        .withIndex("by_authId", (q) => q.eq("authId", authId))
        .collect();
      return { session, users };
    });

    expect(state.users).toHaveLength(1);
    expect(state.users[0]?.email).toBe("missing@example.com");
    expect(state.session?.userId).toBe(state.users[0]?._id);
  });

  test("create and read session succeed with duplicate users for same authId", async () => {
    const t = createTestContext();
    const { practiceId } = await createPracticeAndRuleSet(t);

    const authId = "workos_duplicate_user";

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        authId,
        createdAt: 1n,
        email: "first@example.com",
      });
      await ctx.db.insert("users", {
        authId,
        createdAt: 2n,
        email: "second@example.com",
      });
    });

    const authed = t.withIdentity({
      email: "identity@example.com",
      subject: authId,
    });

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });

    const expectedUserId = await t.run(async (ctx) => {
      const users = await ctx.db
        .query("users")
        .withIndex("by_authId", (q) => q.eq("authId", authId))
        .collect();
      return users
        .toSorted((a, b) => {
          if (a._creationTime !== b._creationTime) {
            return a._creationTime - b._creationTime;
          }
          return a._id.localeCompare(b._id);
        })
        .at(0)?._id;
    });

    const session = await authed.query(api.bookingSessions.get, { sessionId });

    expect(expectedUserId).toBeDefined();
    expect(session?._id).toBe(sessionId);
    expect(session?.userId).toBe(expectedUserId);
  });

  test("get returns null when the session owner user no longer exists", async () => {
    const t = createTestContext();
    const { practiceId } = await createPracticeAndRuleSet(t);
    const authed = makeAuthedClient(t, "missing_owner");

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });

    await t.run(async (ctx) => {
      const session = await ctx.db.get("bookingSessions", sessionId);
      if (!session) {
        throw new Error("Expected booking session to exist");
      }
      await ctx.db.delete("users", session.userId);
    });

    const session = await authed.query(api.bookingSessions.get, { sessionId });
    expect(session).toBeNull();
  });

  test("get returns null when new data-sharing step row is linked to another user", async () => {
    const t = createTestContext();
    const { locationId, practiceId, ruleSetId } =
      await createBookingEntities(t);
    const authed = makeAuthedClient(t, "step_row_owner");

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });

    await bootstrapToPatientStatus(authed, sessionId, locationId);
    await authed.mutation(api.bookingSessions.selectNewPatient, { sessionId });
    await authed.mutation(api.bookingSessions.selectInsuranceType, {
      insuranceType: "gkv",
      sessionId,
    });
    await authed.mutation(api.bookingSessions.confirmGkvDetails, {
      hzvStatus: "has-contract",
      sessionId,
    });
    await authed.mutation(api.bookingSessions.submitNewPatientData, {
      personalData: {
        dateOfBirth: "1980-01-01",
        firstName: "Ada",
        lastName: "Lovelace",
        phoneNumber: "+491701234567",
      },
      sessionId,
    });

    await t.run(async (ctx) => {
      const session = await ctx.db.get("bookingSessions", sessionId);
      if (!session) {
        throw new Error("Expected booking session to exist");
      }
      if (session.state.step !== "new-data-sharing") {
        throw new Error("Expected session to be at new-data-sharing");
      }

      const wrongUserId = await ctx.db.insert("users", {
        authId: "workos_step_row_wrong_user",
        createdAt: BigInt(Date.now()),
        email: "wrong-user@example.com",
      });

      await ctx.db.insert("bookingNewDataSharingSteps", {
        createdAt: BigInt(Date.now()),
        dataSharingContacts: makeOwnedDataSharingContacts(wrongUserId),
        hzvStatus: "has-contract",
        insuranceType: "gkv",
        isNewPatient: true,
        lastModified: BigInt(Date.now()),
        locationLineageKey: locationId,
        personalData: {
          dateOfBirth: "1980-01-01",
          firstName: "Ada",
          lastName: "Lovelace",
          phoneNumber: "+491701234567",
        },
        practiceId: session.practiceId,
        ruleSetId,
        sessionId,
        userId: wrongUserId,
      });
    });

    const session = await authed.query(api.bookingSessions.get, { sessionId });
    expect(session).toBeNull();
  });

  test("get returns null when existing calendar step row is linked to another user", async () => {
    const t = createTestContext();
    const { locationId, practiceId, practitionerId } =
      await createBookingEntities(t);
    const authed = makeAuthedClient(t, "step_row_owner_existing");

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });

    await bootstrapToPatientStatus(authed, sessionId, locationId);
    await authed.mutation(api.bookingSessions.selectExistingPatient, {
      sessionId,
    });
    await authed.mutation(api.bookingSessions.selectDoctor, {
      practitionerLineageKey: practitionerId,
      sessionId,
    });
    await authed.mutation(api.bookingSessions.submitExistingPatientData, {
      personalData: {
        dateOfBirth: "1975-05-20",
        firstName: "Grace",
        lastName: "Hopper",
        phoneNumber: "+491709999999",
      },
      sessionId,
    });

    await t.run(async (ctx) => {
      const session = await ctx.db.get("bookingSessions", sessionId);
      if (!session) {
        throw new Error("Expected booking session to exist");
      }
      if (session.state.step !== "existing-calendar-selection") {
        throw new Error(
          "Expected session to be at existing-calendar-selection",
        );
      }

      const wrongUserId = await ctx.db.insert("users", {
        authId: "workos_step_row_wrong_user_existing",
        createdAt: BigInt(Date.now()),
        email: "wrong-existing-user@example.com",
      });

      const existingRow = await ctx.db
        .query("bookingExistingDataSharingSteps")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
        .first();
      if (!existingRow) {
        throw new Error("Expected existing calendar snapshot row");
      }

      await ctx.db.patch("bookingExistingDataSharingSteps", existingRow._id, {
        dataSharingContacts: makeOwnedDataSharingContacts(wrongUserId),
        userId: wrongUserId,
      });
    });

    const session = await authed.query(api.bookingSessions.get, { sessionId });
    expect(session).toBeNull();
  });

  test("getActiveForUser returns null when current step row is linked to another user", async () => {
    const t = createTestContext();
    const { locationId, practiceId, ruleSetId } =
      await createBookingEntities(t);
    const authed = makeAuthedClient(t, "step_row_owner_active_query");

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });

    await bootstrapToPatientStatus(authed, sessionId, locationId);
    await authed.mutation(api.bookingSessions.selectNewPatient, { sessionId });
    await authed.mutation(api.bookingSessions.selectInsuranceType, {
      insuranceType: "gkv",
      sessionId,
    });
    await authed.mutation(api.bookingSessions.confirmGkvDetails, {
      hzvStatus: "has-contract",
      sessionId,
    });
    await authed.mutation(api.bookingSessions.submitNewPatientData, {
      personalData: {
        dateOfBirth: "1980-01-01",
        firstName: "Ada",
        lastName: "Lovelace",
        phoneNumber: "+491701234567",
      },
      sessionId,
    });

    await t.run(async (ctx) => {
      const session = await ctx.db.get("bookingSessions", sessionId);
      if (!session) {
        throw new Error("Expected booking session to exist");
      }
      if (session.state.step !== "new-data-sharing") {
        throw new Error("Expected session to be at new-data-sharing");
      }

      const wrongUserId = await ctx.db.insert("users", {
        authId: "workos_step_row_wrong_user_active_query",
        createdAt: BigInt(Date.now()),
        email: "wrong-active-query-user@example.com",
      });

      await ctx.db.insert("bookingNewDataSharingSteps", {
        createdAt: BigInt(Date.now()),
        dataSharingContacts: makeOwnedDataSharingContacts(wrongUserId),
        hzvStatus: "has-contract",
        insuranceType: "gkv",
        isNewPatient: true,
        lastModified: BigInt(Date.now()),
        locationLineageKey: locationId,
        personalData: {
          dateOfBirth: "1980-01-01",
          firstName: "Ada",
          lastName: "Lovelace",
          phoneNumber: "+491701234567",
        },
        practiceId: session.practiceId,
        ruleSetId,
        sessionId,
        userId: wrongUserId,
      });
    });

    const activeSession = await authed.query(
      api.bookingSessions.getActiveForUser,
      {
        practiceId,
      },
    );
    expect(activeSession).toBeNull();
  });

  test("get returns null when public session remapping can no longer resolve the selected location", async () => {
    const t = createTestContext();
    const { locationId, practiceId } = await createBookingEntities(t);
    const authed = makeAuthedClient(t, "stale_public_location_get");

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });

    await authed.mutation(api.bookingSessions.acceptPrivacy, { sessionId });
    await authed.mutation(api.bookingSessions.selectLocation, {
      locationLineageKey: locationId,
      sessionId,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch("locations", locationId, { deleted: true });
    });

    const session = await authed.query(api.bookingSessions.get, { sessionId });
    expect(session).toBeNull();
  });

  test("getActiveForUser skips sessions whose public remapping can no longer resolve", async () => {
    const t = createTestContext();
    const { locationId, practiceId } = await createBookingEntities(t);
    const authed = makeAuthedClient(t, "stale_public_location_active");

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });

    await authed.mutation(api.bookingSessions.acceptPrivacy, { sessionId });
    await authed.mutation(api.bookingSessions.selectLocation, {
      locationLineageKey: locationId,
      sessionId,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch("locations", locationId, { deleted: true });
    });

    const activeSession = await authed.query(
      api.bookingSessions.getActiveForUser,
      {
        practiceId,
      },
    );
    expect(activeSession).toBeNull();
  });

  test("create deletes stale sessions whose public remapping can no longer resolve", async () => {
    const t = createTestContext();
    const { locationId, practiceId } = await createBookingEntities(t);
    const authed = makeAuthedClient(t, "stale_public_location_create");

    const staleSessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });

    await authed.mutation(api.bookingSessions.acceptPrivacy, {
      sessionId: staleSessionId,
    });
    await authed.mutation(api.bookingSessions.selectLocation, {
      locationLineageKey: locationId,
      sessionId: staleSessionId,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch("locations", locationId, { deleted: true });
    });

    const replacementSessionId = await authed.mutation(
      api.bookingSessions.create,
      {
        practiceId,
      },
    );

    expect(replacementSessionId).not.toBe(staleSessionId);

    const state = await t.run(async (ctx) => {
      const staleSession = await ctx.db.get("bookingSessions", staleSessionId);
      const replacementSession = await ctx.db.get(
        "bookingSessions",
        replacementSessionId,
      );
      return { replacementSession, staleSession };
    });

    expect(state.staleSession).toBeNull();
    expect(state.replacementSession?._id).toBe(replacementSessionId);
    expect(state.replacementSession?.state.step).toBe("privacy");
  });

  test("submitNewDataSharing stores owner userId on each contact", async () => {
    const t = createTestContext();
    const { locationId, practiceId } = await createBookingEntities(t);
    const authed = makeAuthedClient(t, "data_sharing_contact_owner");

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });

    await bootstrapToNewDataSharing(authed, locationId, sessionId);
    await authed.mutation(api.bookingSessions.submitNewDataSharing, {
      dataSharingContacts: makeDataSharingContacts(),
      sessionId,
    });

    const session = await authed.query(api.bookingSessions.get, { sessionId });
    assertSessionExists(session, "session should exist");
    assertStateStep(session.state, "new-calendar-selection");
    expect(session.state.dataSharingContacts).toHaveLength(1);
    expect(session.state.dataSharingContacts[0]?.userId).toBe(session.userId);
  });

  test("submitNewDataSharing preserves pvsConsent on PKV path", async () => {
    const t = createTestContext();
    const { locationId, practiceId } = await createBookingEntities(t);
    const authed = makeAuthedClient(t, "data_sharing_pkv_pvs_consent");

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });

    await bootstrapToNewDataSharingPkv(authed, locationId, sessionId);
    await authed.mutation(api.bookingSessions.submitNewDataSharing, {
      dataSharingContacts: makeDataSharingContacts(),
      sessionId,
    });

    const session = await authed.query(api.bookingSessions.get, { sessionId });
    assertSessionExists(session, "session should exist");
    assertStateStep(session.state, "new-calendar-selection");
    if (session.state.insuranceType !== "pkv") {
      throw new Error("Expected PKV calendar-selection state");
    }
    expect(session.state.pvsConsent).toBe(true);
  });

  test("submitExistingDataSharing stores owner userId on each contact", async () => {
    const t = createTestContext();
    const { locationId, practiceId, practitionerId } =
      await createBookingEntities(t);
    const authed = makeAuthedClient(t, "existing_data_sharing_contact_owner");

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });

    await bootstrapToExistingDataSharing(
      authed,
      locationId,
      practitionerId,
      sessionId,
    );
    await authed.mutation(api.bookingSessions.submitExistingDataSharing, {
      dataSharingContacts: makeDataSharingContacts(),
      sessionId,
    });

    const session = await authed.query(api.bookingSessions.get, { sessionId });
    assertSessionExists(session, "session should exist");
    assertStateStep(session.state, "existing-calendar-selection");
    expect(session.state.dataSharingContacts).toHaveLength(1);
    expect(session.state.dataSharingContacts[0]?.userId).toBe(session.userId);
  });

  test("get returns null when contact owner userId mismatches session user", async () => {
    const t = createTestContext();
    const { locationId, practiceId, ruleSetId } =
      await createBookingEntities(t);
    const authed = makeAuthedClient(t, "contact_owner_mismatch");

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });

    await bootstrapToNewDataSharing(authed, locationId, sessionId);

    await t.run(async (ctx) => {
      const session = await ctx.db.get("bookingSessions", sessionId);
      if (!session) {
        throw new Error("Expected booking session to exist");
      }
      if (session.state.step !== "new-data-sharing") {
        throw new Error("Expected session to be at new-data-sharing");
      }

      const wrongUserId = await ctx.db.insert("users", {
        authId: "workos_contact_owner_wrong_user",
        createdAt: BigInt(Date.now()),
        email: "wrong-contact-owner@example.com",
      });

      await ctx.db.insert("bookingNewDataSharingSteps", {
        createdAt: BigInt(Date.now()),
        dataSharingContacts: makeOwnedDataSharingContacts(
          wrongUserId,
          makeDataSharingContacts()[0],
        ),
        hzvStatus: "has-contract",
        insuranceType: "gkv",
        isNewPatient: true,
        lastModified: BigInt(Date.now()),
        locationLineageKey: locationId,
        personalData: {
          dateOfBirth: "1980-01-01",
          firstName: "Ada",
          lastName: "Lovelace",
          phoneNumber: "+491701234567",
        },
        practiceId: session.practiceId,
        ruleSetId,
        sessionId,
        userId: session.userId,
      });
    });

    const session = await authed.query(api.bookingSessions.get, { sessionId });
    expect(session).toBeNull();
  });

  test("submitNewDataSharing denies access for non-owner user", async () => {
    const t = createTestContext();
    const { locationId, practiceId } = await createBookingEntities(t);
    const owner = makeAuthedClient(t, "data_sharing_owner");
    const stranger = makeAuthedClient(t, "data_sharing_stranger");

    const sessionId = await owner.mutation(api.bookingSessions.create, {
      practiceId,
    });
    await bootstrapToNewDataSharing(owner, locationId, sessionId);

    await expect(
      stranger.mutation(api.bookingSessions.submitNewDataSharing, {
        dataSharingContacts: makeDataSharingContacts(),
        sessionId,
      }),
    ).rejects.toThrow("Access denied");
  });

  test("submitExistingDataSharing denies access for non-owner user", async () => {
    const t = createTestContext();
    const { locationId, practiceId, practitionerId } =
      await createBookingEntities(t);
    const owner = makeAuthedClient(t, "existing_data_sharing_owner");
    const stranger = makeAuthedClient(t, "existing_data_sharing_stranger");

    const sessionId = await owner.mutation(api.bookingSessions.create, {
      practiceId,
    });
    await bootstrapToExistingDataSharing(
      owner,
      locationId,
      practitionerId,
      sessionId,
    );

    await expect(
      stranger.mutation(api.bookingSessions.submitExistingDataSharing, {
        dataSharingContacts: makeDataSharingContacts(),
        sessionId,
      }),
    ).rejects.toThrow("Access denied");
  });
});

describe("bookingSessions atomic pending/completed step states", () => {
  test("state machine dispatcher emits next step and snapshot writes", async () => {
    const t = createTestContext();
    const { locationId, practiceId, ruleSetId } =
      await createBookingEntities(t);
    const authed = makeAuthedClient(t, "state_machine_dispatch");

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });
    const session = await t.run(async (ctx) => {
      return await ctx.db.get("bookingSessions", sessionId);
    });
    assertSessionExists(session, "session should exist for transition test");

    const state: InternalBookingSessionState = {
      locationLineageKey: locationId,
      step: "patient-status",
    };
    const transition = applyBookingSessionTransition({
      base: {
        practiceId: session.practiceId,
        ruleSetId,
        sessionId: session._id,
        userId: session.userId,
      },
      kind: "selectNewPatient",
      state,
    });

    expect(transition.nextStep).toBe("new-insurance-type");
    expect(transition.writes).toHaveLength(1);
    expect(transition.writes[0]?.tableName).toBe("bookingPatientStatusSteps");
    expect(transition.writes[0]?.data).toMatchObject({
      isNewPatient: true,
      locationLineageKey: locationId,
      sessionId,
    });
  });

  test("state machine computes completed previous state for GKV data input", async () => {
    const t = createTestContext();
    const { locationId } = await createBookingEntities(t);
    const state: InternalBookingSessionState = {
      hzvStatus: "has-contract",
      insuranceType: "gkv",
      isNewPatient: true,
      locationLineageKey: locationId,
      step: "new-data-input",
    };

    const previous = computePreviousInternalState(state);

    expect(previous).toMatchObject({
      hzvStatus: "has-contract",
      insuranceType: "gkv",
      isNewPatient: true,
      locationLineageKey: locationId,
      step: "new-gkv-details-complete",
    });
  });

  test("state machine materializes and sanitizes UI state through one interface", async () => {
    const t = createTestContext();
    const { locationId, practitionerId } = await createBookingEntities(t);
    const state: InternalBookingSessionState = {
      isNewPatient: false,
      locationLineageKey: locationId,
      practitionerLineageKey: practitionerId,
      step: "existing-data-input",
    };

    const materialized = await materializeBookingSessionUiState(state, {
      resolveAppointmentTypeName: () => Promise.resolve("unused"),
      resolveLocationName: () => Promise.resolve("Main Location"),
      resolvePractitionerName: () => Promise.resolve("Dr. Test"),
    });

    expect(materialized).toMatchObject({
      isNewPatient: false,
      locationLineageKey: locationId,
      locationName: "Main Location",
      practitionerLineageKey: practitionerId,
      practitionerName: "Dr. Test",
      step: "existing-data-input",
    });

    const sanitized = sanitizeState("existing-data-input", {
      ...materialized,
      reasonDescription: "should be stripped",
    });
    expect("reasonDescription" in sanitized).toBe(false);
  });

  test("GKV details step transitions from pending to completed variant via goBack", async () => {
    const t = createTestContext();
    const { locationId, practiceId } = await createBookingEntities(t);
    const authed = makeAuthedClient(t, "atomic_gkv");

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });
    await bootstrapToPatientStatus(authed, sessionId, locationId);

    await authed.mutation(api.bookingSessions.selectNewPatient, { sessionId });
    await authed.mutation(api.bookingSessions.selectInsuranceType, {
      insuranceType: "gkv",
      sessionId,
    });

    const pending = await authed.query(api.bookingSessions.get, { sessionId });
    assertSessionExists(pending, "session should exist at pending gkv step");
    assertStateStep(pending.state, "new-gkv-details");
    expect("hzvStatus" in pending.state).toBe(false);

    await authed.mutation(api.bookingSessions.confirmGkvDetails, {
      hzvStatus: "has-contract",
      sessionId,
    });

    const atDataInput = await authed.query(api.bookingSessions.get, {
      sessionId,
    });
    assertSessionExists(atDataInput, "session should exist at data-input step");
    assertStateStep(atDataInput.state, "new-data-input");
    if (atDataInput.state.insuranceType !== "gkv") {
      throw new Error("Expected GKV data-input state");
    }
    expect(atDataInput.state.hzvStatus).toBe("has-contract");

    const backStep = await authed.mutation(api.bookingSessions.goBack, {
      sessionId,
    });
    expect(backStep).toBe("new-gkv-details-complete");

    const completed = await authed.query(api.bookingSessions.get, {
      sessionId,
    });
    assertSessionExists(
      completed,
      "session should exist at completed gkv step",
    );
    assertStateStep(completed.state, "new-gkv-details-complete");
    expect(completed.state.hzvStatus).toBe("has-contract");

    await authed.mutation(api.bookingSessions.confirmGkvDetails, {
      hzvStatus: "interested",
      sessionId,
    });

    const updated = await authed.query(api.bookingSessions.get, { sessionId });
    assertSessionExists(updated, "session should exist after resubmitting gkv");
    assertStateStep(updated.state, "new-data-input");
    if (updated.state.insuranceType !== "gkv") {
      throw new Error("Expected GKV data-input state after resubmit");
    }
    expect(updated.state.hzvStatus).toBe("interested");
  });

  test("PKV details step uses explicit completed variant after goBack", async () => {
    const t = createTestContext();
    const { locationId, practiceId } = await createBookingEntities(t);
    const authed = makeAuthedClient(t, "atomic_pkv");

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });
    await bootstrapToPatientStatus(authed, sessionId, locationId);

    await authed.mutation(api.bookingSessions.selectNewPatient, { sessionId });
    await authed.mutation(api.bookingSessions.selectInsuranceType, {
      insuranceType: "pkv",
      sessionId,
    });
    await authed.mutation(api.bookingSessions.acceptPvsConsent, { sessionId });

    const pending = await authed.query(api.bookingSessions.get, { sessionId });
    assertSessionExists(pending, "session should exist at pending pkv details");
    assertStateStep(pending.state, "new-pkv-details");
    expect(pending.state.pvsConsent).toBe(true);
    expect("pkvTariff" in pending.state).toBe(false);
    expect("pkvInsuranceType" in pending.state).toBe(false);
    expect("beihilfeStatus" in pending.state).toBe(false);

    await authed.mutation(api.bookingSessions.confirmPkvDetails, {
      pvsConsent: true,
      sessionId,
    });

    const atDataInput = await authed.query(api.bookingSessions.get, {
      sessionId,
    });
    assertSessionExists(
      atDataInput,
      "session should exist at data-input for pkv",
    );
    assertStateStep(atDataInput.state, "new-data-input");
    if (atDataInput.state.insuranceType !== "pkv") {
      throw new Error("Expected PKV data-input state");
    }
    expect(atDataInput.state.pvsConsent).toBe(true);

    const backStep = await authed.mutation(api.bookingSessions.goBack, {
      sessionId,
    });
    expect(backStep).toBe("new-pkv-details-complete");

    const completed = await authed.query(api.bookingSessions.get, {
      sessionId,
    });
    assertSessionExists(
      completed,
      "session should exist at completed pkv step",
    );
    assertStateStep(completed.state, "new-pkv-details-complete");
    expect(completed.state.pvsConsent).toBe(true);

    await authed.mutation(api.bookingSessions.confirmPkvDetails, {
      beihilfeStatus: "yes",
      pkvInsuranceType: "postb",
      pkvTariff: "standard",
      pvsConsent: true,
      sessionId,
    });

    const updated = await authed.query(api.bookingSessions.get, { sessionId });
    assertSessionExists(updated, "session should exist after resubmitting pkv");
    assertStateStep(updated.state, "new-data-input");
    if (updated.state.insuranceType !== "pkv") {
      throw new Error("Expected PKV data-input state after resubmit");
    }
    expect(updated.state.beihilfeStatus).toBe("yes");
    expect(updated.state.pkvInsuranceType).toBe("postb");
    expect(updated.state.pkvTariff).toBe("standard");
  });

  test("new patient data-input step stays pending before submit and requires data sharing before calendar", async () => {
    const t = createTestContext();
    const { locationId, practiceId } = await createBookingEntities(t);
    const authed = makeAuthedClient(t, "atomic_new_data");

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });
    await bootstrapToPatientStatus(authed, sessionId, locationId);

    await authed.mutation(api.bookingSessions.selectNewPatient, { sessionId });
    await authed.mutation(api.bookingSessions.selectInsuranceType, {
      insuranceType: "gkv",
      sessionId,
    });
    await authed.mutation(api.bookingSessions.confirmGkvDetails, {
      hzvStatus: "has-contract",
      sessionId,
    });
    const pending = await authed.query(api.bookingSessions.get, { sessionId });
    assertSessionExists(
      pending,
      "session should exist at pending new-patient data-input step",
    );
    assertStateStep(pending.state, "new-data-input");
    expect("personalData" in pending.state).toBe(false);
    expect("reasonDescription" in pending.state).toBe(false);

    await authed.mutation(api.bookingSessions.submitNewPatientData, {
      medicalHistory: {
        hasAllergies: false,
        hasDiabetes: false,
        hasHeartCondition: false,
        hasLungCondition: false,
      },
      personalData: {
        dateOfBirth: "1980-01-01",
        firstName: "Ada",
        lastName: "Lovelace",
        phoneNumber: "+491701234567",
      },
      sessionId,
    });

    const atDataSharing = await authed.query(api.bookingSessions.get, {
      sessionId,
    });
    assertSessionExists(
      atDataSharing,
      "session should exist at data-sharing step",
    );
    assertStateStep(atDataSharing.state, "new-data-sharing");
    expect("reasonDescription" in atDataSharing.state).toBe(false);
    expect(atDataSharing.state.personalData.firstName).toBe("Ada");

    await authed.mutation(api.bookingSessions.submitNewDataSharing, {
      dataSharingContacts: makeDataSharingContacts(),
      sessionId,
    });

    const atCalendar = await authed.query(api.bookingSessions.get, {
      sessionId,
    });
    assertSessionExists(atCalendar, "session should exist at calendar step");
    assertStateStep(atCalendar.state, "new-calendar-selection");
    expect(atCalendar.state.dataSharingContacts).toHaveLength(1);
    expect(atCalendar.state.personalData.firstName).toBe("Ada");

    await expect(
      authed.mutation(api.bookingSessions.goBack, { sessionId }),
    ).rejects.toThrow("Cannot go back from step 'new-calendar-selection'");

    const completed = await authed.query(api.bookingSessions.get, {
      sessionId,
    });
    assertSessionExists(
      completed,
      "session should still exist at calendar step after failed back",
    );
    assertStateStep(completed.state, "new-calendar-selection");
    expect(completed.state.dataSharingContacts).toHaveLength(1);
    expect(completed.state.personalData.lastName).toBe("Lovelace");
  });

  test("existing patient data-input step remains atomic (pending before submit)", async () => {
    const t = createTestContext();
    const { locationId, practiceId, practitionerId } =
      await createBookingEntities(t);
    const authed = makeAuthedClient(t, "atomic_existing_data");

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });
    await bootstrapToPatientStatus(authed, sessionId, locationId);

    await authed.mutation(api.bookingSessions.selectExistingPatient, {
      sessionId,
    });
    await authed.mutation(api.bookingSessions.selectDoctor, {
      practitionerLineageKey: practitionerId,
      sessionId,
    });
    const pending = await authed.query(api.bookingSessions.get, { sessionId });
    assertSessionExists(
      pending,
      "session should exist at pending existing-patient data-input step",
    );
    assertStateStep(pending.state, "existing-data-input");
    expect("personalData" in pending.state).toBe(false);
    expect("reasonDescription" in pending.state).toBe(false);

    await authed.mutation(api.bookingSessions.submitExistingPatientData, {
      personalData: {
        dateOfBirth: "1975-05-20",
        firstName: "Grace",
        lastName: "Hopper",
        phoneNumber: "+491709999999",
      },
      sessionId,
    });

    const atCalendar = await authed.query(api.bookingSessions.get, {
      sessionId,
    });
    assertSessionExists(
      atCalendar,
      "session should exist at existing calendar-selection step",
    );
    assertStateStep(atCalendar.state, "existing-calendar-selection");
    expect(atCalendar.state.dataSharingContacts).toHaveLength(0);
    expect("reasonDescription" in atCalendar.state).toBe(false);
    expect(atCalendar.state.personalData.firstName).toBe("Grace");
  });

  test("new patient can skip data-sharing contacts", async () => {
    const t = createTestContext();
    const { locationId, practiceId } = await createBookingEntities(t);
    const authed = makeAuthedClient(t, "skip_data_sharing_new");

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });
    await bootstrapToPatientStatus(authed, sessionId, locationId);
    await authed.mutation(api.bookingSessions.selectNewPatient, { sessionId });
    await authed.mutation(api.bookingSessions.selectInsuranceType, {
      insuranceType: "gkv",
      sessionId,
    });
    await authed.mutation(api.bookingSessions.confirmGkvDetails, {
      hzvStatus: "has-contract",
      sessionId,
    });
    await authed.mutation(api.bookingSessions.submitNewPatientData, {
      personalData: {
        dateOfBirth: "1980-01-01",
        firstName: "Ada",
        lastName: "Lovelace",
        phoneNumber: "+491701234567",
      },
      sessionId,
    });

    await authed.mutation(api.bookingSessions.submitNewDataSharing, {
      dataSharingContacts: [],
      sessionId,
    });

    const atCalendar = await authed.query(api.bookingSessions.get, {
      sessionId,
    });
    assertSessionExists(atCalendar, "session should exist at calendar step");
    assertStateStep(atCalendar.state, "new-calendar-selection");
    expect(atCalendar.state.dataSharingContacts).toHaveLength(0);
  });

  test("existing patient can skip data-sharing contacts", async () => {
    const t = createTestContext();
    const { locationId, practiceId, practitionerId } =
      await createBookingEntities(t);
    const authed = makeAuthedClient(t, "skip_data_sharing_existing");

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });
    await bootstrapToPatientStatus(authed, sessionId, locationId);

    await authed.mutation(api.bookingSessions.selectExistingPatient, {
      sessionId,
    });
    await authed.mutation(api.bookingSessions.selectDoctor, {
      practitionerLineageKey: practitionerId,
      sessionId,
    });
    await authed.mutation(api.bookingSessions.submitExistingPatientData, {
      personalData: {
        dateOfBirth: "1975-05-20",
        firstName: "Grace",
        lastName: "Hopper",
        phoneNumber: "+491709999999",
      },
      sessionId,
    });

    await authed.mutation(api.bookingSessions.submitExistingDataSharing, {
      dataSharingContacts: [],
      sessionId,
    });

    const atCalendar = await authed.query(api.bookingSessions.get, {
      sessionId,
    });
    assertSessionExists(atCalendar, "session should exist at calendar step");
    assertStateStep(atCalendar.state, "existing-calendar-selection");
    expect(atCalendar.state.dataSharingContacts).toHaveLength(0);
  });
});

describe("bookingSessions slot selection validation", () => {
  test("submitNewDataSharing rejects invalid date format", async () => {
    const t = createTestContext();
    const { locationId, practiceId } = await createBookingEntities(t);
    const authed = makeAuthedClient(t, "data_sharing_invalid_date");
    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });
    await bootstrapToNewDataSharing(authed, locationId, sessionId);

    await expect(
      authed.mutation(api.bookingSessions.submitNewDataSharing, {
        dataSharingContacts: makeDataSharingContactsWithOverrides({
          dateOfBirth: "01-01-1970",
        }),
        sessionId,
      }),
    ).rejects.toThrow("Geburtsdatum format");
  });

  test("submitExistingDataSharing allows empty title", async () => {
    const t = createTestContext();
    const { locationId, practiceId, practitionerId } =
      await createBookingEntities(t);
    const authed = makeAuthedClient(t, "data_sharing_empty_title");
    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });
    await bootstrapToExistingDataSharing(
      authed,
      locationId,
      practitionerId,
      sessionId,
    );
    const contactWithTitle = makeDataSharingContactsWithOverrides({})[0];
    if (!contactWithTitle) {
      throw new Error("Expected data-sharing contact fixture");
    }
    const contactWithoutTitle: DataSharingContactInput = {
      ...contactWithTitle,
    };
    delete contactWithoutTitle.title;

    await authed.mutation(api.bookingSessions.submitExistingDataSharing, {
      dataSharingContacts: [contactWithoutTitle],
      sessionId,
    });

    const atCalendar = await authed.query(api.bookingSessions.get, {
      sessionId,
    });
    assertSessionExists(atCalendar, "session should exist at calendar step");
    assertStateStep(atCalendar.state, "existing-calendar-selection");
    expect(atCalendar.state.dataSharingContacts[0]?.title).toBeUndefined();
  });

  test("returnToCalendarSelectionAfterCancellation resets existing-confirmation to existing-calendar-selection", async () => {
    const t = createTestContext();
    const { appointmentTypeId, locationId, practiceId, practitionerId } =
      await createBookingEntities(t);
    const authed = makeAuthedClient(t, "return_to_calendar_existing");

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });
    await bootstrapToExistingCalendarSelection(
      authed,
      locationId,
      practitionerId,
      sessionId,
    );

    await authed.mutation(api.bookingSessions.selectExistingPatientSlot, {
      appointmentTypeLineageKey: appointmentTypeId,
      reasonDescription: "Kontrolle",
      selectedSlot: makeSelectedSlot(practitionerId),
      sessionId,
    });

    const confirmed = await authed.query(api.bookingSessions.get, {
      sessionId,
    });
    assertSessionExists(
      confirmed,
      "session should exist at existing confirmation step",
    );
    assertStateStep(confirmed.state, "existing-confirmation");

    await authed.mutation(
      api.bookingSessions.returnToCalendarSelectionAfterCancellation,
      { sessionId },
    );

    const atCalendar = await authed.query(api.bookingSessions.get, {
      sessionId,
    });
    assertSessionExists(
      atCalendar,
      "session should exist at existing calendar-selection step",
    );
    assertStateStep(atCalendar.state, "existing-calendar-selection");
    expect("appointmentId" in atCalendar.state).toBe(false);
    expect("reasonDescription" in atCalendar.state).toBe(false);
    expect("selectedSlot" in atCalendar.state).toBe(false);
    expect(atCalendar.state.personalData.firstName).toBe("Grace");
  });

  test("selectNewPatientSlot rejects empty reason descriptions", async () => {
    const t = createTestContext();
    const { appointmentTypeId, locationId, practiceId, practitionerId } =
      await createBookingEntities(t);
    const authed = makeAuthedClient(t, "slot_validation_new_reason");
    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });
    await bootstrapToNewCalendarSelection(authed, locationId, sessionId);

    await expect(
      authed.mutation(api.bookingSessions.selectNewPatientSlot, {
        appointmentTypeLineageKey: appointmentTypeId,
        reasonDescription: "   ",
        selectedSlot: makeSelectedSlot(practitionerId),
        sessionId,
      }),
    ).rejects.toThrow("Reason description is required");
  });

  test("selectNewPatientSlot rejects appointment types from other rule sets", async () => {
    const t = createTestContext();
    const { locationId, practiceId, practitionerId } =
      await createBookingEntities(t);
    const authed = makeAuthedClient(t, "slot_validation_new_ruleset");
    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });
    await bootstrapToNewCalendarSelection(authed, locationId, sessionId);

    const otherRuleSetAppointmentTypeId =
      await createAppointmentTypeInOtherRuleSet(t, practiceId, practitionerId);

    await expect(
      authed.mutation(api.bookingSessions.selectNewPatientSlot, {
        appointmentTypeLineageKey: otherRuleSetAppointmentTypeId,
        reasonDescription: "Kontrolle",
        selectedSlot: makeSelectedSlot(practitionerId),
        sessionId,
      }),
    ).rejects.toThrow("Lineage-Key");
  });

  test("selectNewPatientSlot rejects slots in the past", async () => {
    const t = createTestContext();
    const { appointmentTypeId, locationId, practiceId, practitionerId } =
      await createBookingEntities(t);
    const authed = makeAuthedClient(t, "slot_validation_new_minimum_notice");
    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });
    await bootstrapToNewCalendarSelection(authed, locationId, sessionId);

    await expect(
      authed.mutation(api.bookingSessions.selectNewPatientSlot, {
        appointmentTypeLineageKey: appointmentTypeId,
        reasonDescription: "Kontrolle",
        selectedSlot: makePastSelectedSlot(practitionerId),
        sessionId,
      }),
    ).rejects.toThrow("in the future");
  });

  test("selectNewPatientSlot enforces configurable HOURS_AHEAD minimum notice rules", async () => {
    const t = createTestContext();
    const {
      appointmentTypeId,
      locationId,
      practiceId,
      practitionerId,
      ruleSetId,
    } = await createBookingEntities(t);
    await addHoursAheadBlockingRule(t, {
      minimumHours: 1,
      practiceId,
      ruleSetId,
    });
    const authed = makeAuthedClient(t, "slot_validation_new_minimum_notice");
    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });
    await bootstrapToNewCalendarSelection(authed, locationId, sessionId);

    await expect(
      authed.mutation(api.bookingSessions.selectNewPatientSlot, {
        appointmentTypeLineageKey: appointmentTypeId,
        reasonDescription: "Kontrolle",
        selectedSlot: makeSoonSelectedSlot(practitionerId),
        sessionId,
      }),
    ).rejects.toThrow("Selected slot is no longer available");
  });

  test("selectExistingPatientSlot rejects empty reason descriptions", async () => {
    const t = createTestContext();
    const { appointmentTypeId, locationId, practiceId, practitionerId } =
      await createBookingEntities(t);
    const authed = makeAuthedClient(t, "slot_validation_existing_reason");
    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });
    await bootstrapToExistingCalendarSelection(
      authed,
      locationId,
      practitionerId,
      sessionId,
    );

    await expect(
      authed.mutation(api.bookingSessions.selectExistingPatientSlot, {
        appointmentTypeLineageKey: appointmentTypeId,
        reasonDescription: " ",
        selectedSlot: makeSelectedSlot(practitionerId),
        sessionId,
      }),
    ).rejects.toThrow("Reason description is required");
  });

  test("selectExistingPatientSlot rejects appointment types from other rule sets", async () => {
    const t = createTestContext();
    const { locationId, practiceId, practitionerId } =
      await createBookingEntities(t);
    const authed = makeAuthedClient(t, "slot_validation_existing_ruleset");
    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });
    await bootstrapToExistingCalendarSelection(
      authed,
      locationId,
      practitionerId,
      sessionId,
    );

    const otherRuleSetAppointmentTypeId =
      await createAppointmentTypeInOtherRuleSet(t, practiceId, practitionerId);

    await expect(
      authed.mutation(api.bookingSessions.selectExistingPatientSlot, {
        appointmentTypeLineageKey: otherRuleSetAppointmentTypeId,
        reasonDescription: "Kontrolle",
        selectedSlot: makeSelectedSlot(practitionerId),
        sessionId,
      }),
    ).rejects.toThrow("Lineage-Key");
  });

  test("selectExistingPatientSlot rejects slots in the past", async () => {
    const t = createTestContext();
    const { appointmentTypeId, locationId, practiceId, practitionerId } =
      await createBookingEntities(t);
    const authed = makeAuthedClient(
      t,
      "slot_validation_existing_minimum_notice",
    );
    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });
    await bootstrapToExistingCalendarSelection(
      authed,
      locationId,
      practitionerId,
      sessionId,
    );

    await expect(
      authed.mutation(api.bookingSessions.selectExistingPatientSlot, {
        appointmentTypeLineageKey: appointmentTypeId,
        reasonDescription: "Kontrolle",
        selectedSlot: makePastSelectedSlot(practitionerId),
        sessionId,
      }),
    ).rejects.toThrow("in the future");
  });

  test("selectExistingPatientSlot enforces configurable HOURS_AHEAD minimum notice rules", async () => {
    const t = createTestContext();
    const {
      appointmentTypeId,
      locationId,
      practiceId,
      practitionerId,
      ruleSetId,
    } = await createBookingEntities(t);
    await addHoursAheadBlockingRule(t, {
      minimumHours: 1,
      practiceId,
      ruleSetId,
    });
    const authed = makeAuthedClient(
      t,
      "slot_validation_existing_minimum_notice",
    );
    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });
    await bootstrapToExistingCalendarSelection(
      authed,
      locationId,
      practitionerId,
      sessionId,
    );

    await expect(
      authed.mutation(api.bookingSessions.selectExistingPatientSlot, {
        appointmentTypeLineageKey: appointmentTypeId,
        reasonDescription: "Kontrolle",
        selectedSlot: makeSoonSelectedSlot(practitionerId),
        sessionId,
      }),
    ).rejects.toThrow("Selected slot is no longer available");
  });

  test("selectNewPatientSlot books Kettentermine through the shared appointment path", async () => {
    const t = createTestContext();
    const {
      appointmentTypeId,
      locationId,
      practiceId,
      practitionerId,
      ruleSetId,
    } = await createBookingEntities(t);
    const authed = makeAuthedClient(t, "slot_selection_chain_booking");

    await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      await ctx.db.patch("appointmentTypes", appointmentTypeId, {
        lineageKey: appointmentTypeId,
      });

      const followUpAppointmentTypeId = await insertSelfLineageEntity(
        ctx.db,
        "appointmentTypes",
        {
          allowedPractitionerLineageKeys: [practitionerId],
          createdAt: now,
          duration: 30,
          lastModified: now,
          name: "Kontrolle",
          practiceId,
          ruleSetId,
        },
      );

      await ctx.db.patch("appointmentTypes", appointmentTypeId, {
        followUpPlan: [
          {
            appointmentTypeLineageKey: followUpAppointmentTypeId,
            locationMode: "inherit",
            offsetUnit: "days",
            offsetValue: 2,
            practitionerMode: "inherit",
            required: true,
            searchMode: "first_available_on_or_after",
            stepId: "step-1",
          },
        ],
      });

      for (const dayOfWeek of [1, 2, 3, 4, 5]) {
        await insertSelfLineageEntity(ctx.db, "baseSchedules", {
          dayOfWeek,
          endTime: "17:00",
          locationLineageKey: locationId,
          practiceId,
          practitionerLineageKey: practitionerId,
          ruleSetId,
          startTime: "08:00",
        });
      }
    });

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
    });
    await bootstrapToNewCalendarSelection(authed, locationId, sessionId);

    const selectedSlot: SelectedSlotInput = {
      practitionerLineageKey: practitionerId,
      practitionerName: "Dr. Test",
      startTime: nextWeekdayAt(1, 9, 0),
    };

    await authed.mutation(api.bookingSessions.selectNewPatientSlot, {
      appointmentTypeLineageKey: appointmentTypeId,
      reasonDescription: "Kontrolle",
      selectedSlot,
      sessionId,
    });

    const session = await authed.query(api.bookingSessions.get, { sessionId });
    assertSessionExists(session, "Session should exist after booking");
    assertStateStep(session.state, "new-confirmation");

    const bookedAppointments = await authed.query(
      api.appointments.getBookedAppointmentsForCurrentUser,
      {},
    );
    const seriesRecords = await t.run(async (ctx) => {
      return await ctx.db.query("appointmentSeries").collect();
    });

    expect(bookedAppointments).toHaveLength(2);
    expect(seriesRecords).toHaveLength(1);
    expect(
      new Set(bookedAppointments.map((appointment) => appointment.seriesId))
        .size,
    ).toBe(1);
  });
});

describe("bookingSessions slot selection argument contracts", () => {
  test("new patient slot args require appointmentTypeLineageKey", () => {
    type MissingAppointmentType = Omit<
      NewPatientSlotArgs,
      "appointmentTypeLineageKey"
    >;
    type IsMissingTypeAccepted = IsAssignable<
      MissingAppointmentType,
      NewPatientSlotArgs
    >;
    expectTypeOf<IsMissingTypeAccepted>().toEqualTypeOf<false>();
  });

  test("new patient slot args require reasonDescription", () => {
    type MissingReasonDescription = Omit<
      NewPatientSlotArgs,
      "reasonDescription"
    >;
    type IsMissingReasonAccepted = IsAssignable<
      MissingReasonDescription,
      NewPatientSlotArgs
    >;
    expectTypeOf<IsMissingReasonAccepted>().toEqualTypeOf<false>();
  });

  test("existing patient slot args require appointmentTypeLineageKey", () => {
    type MissingAppointmentType = Omit<
      ExistingPatientSlotArgs,
      "appointmentTypeLineageKey"
    >;
    type IsMissingTypeAccepted = IsAssignable<
      MissingAppointmentType,
      ExistingPatientSlotArgs
    >;
    expectTypeOf<IsMissingTypeAccepted>().toEqualTypeOf<false>();
  });

  test("existing patient slot args require reasonDescription", () => {
    type MissingReasonDescription = Omit<
      ExistingPatientSlotArgs,
      "reasonDescription"
    >;
    type IsMissingReasonAccepted = IsAssignable<
      MissingReasonDescription,
      ExistingPatientSlotArgs
    >;
    expectTypeOf<IsMissingReasonAccepted>().toEqualTypeOf<false>();
  });
});

describe("booking session snapshot sanitization", () => {
  test("accepts representative valid sanitized state", () => {
    expect(() => {
      assertValidSanitizedBookingSessionState("new-calendar-selection", {
        dataSharingContacts: [
          {
            city: "Berlin",
            dateOfBirth: "1980-01-01",
            firstName: "Ada",
            gender: "female",
            lastName: "Lovelace",
            phoneNumber: "+491701234567",
            postalCode: "10115",
            street: "Example Street 1",
            userId: "user_1",
          },
        ],
        hzvStatus: "has-contract",
        insuranceType: "gkv",
        isNewPatient: true,
        locationLineageKey: "location_1",
        locationName: "Praxis Mitte",
        personalData: {
          dateOfBirth: "1980-01-01",
          firstName: "Ada",
          lastName: "Lovelace",
          phoneNumber: "+491701234567",
        },
        step: "new-calendar-selection",
      });
    }).not.toThrow();
  });

  test("rejects missing required fields for representative steps", () => {
    expect(() => {
      assertValidSanitizedBookingSessionState("new-calendar-selection", {
        dataSharingContacts: [],
        hzvStatus: "has-contract",
        insuranceType: "gkv",
        isNewPatient: true,
        locationLineageKey: "location_1",
        locationName: "Praxis Mitte",
        step: "new-calendar-selection",
      });
    }).toThrow("Invalid booking session snapshot");

    expect(() => {
      assertValidSanitizedBookingSessionState("existing-confirmation", {
        appointmentId: "appointment_1",
        appointmentTypeLineageKey: "appointment_type_1",
        bookedDurationMinutes: 30,
        dataSharingContacts: [],
        isNewPatient: false,
        locationLineageKey: "location_1",
        personalData: {
          dateOfBirth: "1980-01-01",
          firstName: "Grace",
          lastName: "Hopper",
          phoneNumber: "+491709999999",
        },
        practitionerLineageKey: "practitioner_1",
        reasonDescription: "Follow-up",
        selectedSlot: {
          practitionerLineageKey: "practitioner_1",
          practitionerName: "Dr. Grace Hopper",
          startTime: "not-a-zoned-date-time",
        },
        step: "existing-confirmation",
      });
    }).toThrow("Invalid booking session snapshot");
  });

  test("rejects data sharing contacts without the schema-required userId", () => {
    expect(() => {
      assertValidSanitizedBookingSessionState("new-calendar-selection", {
        dataSharingContacts: [
          {
            city: "Berlin",
            dateOfBirth: "1980-01-01",
            firstName: "Ada",
            gender: "female",
            lastName: "Lovelace",
            phoneNumber: "+491701234567",
            postalCode: "10115",
            street: "Example Street 1",
          },
        ],
        hzvStatus: "has-contract",
        insuranceType: "gkv",
        isNewPatient: true,
        locationLineageKey: "location_1",
        locationName: "Praxis Mitte",
        personalData: {
          dateOfBirth: "1980-01-01",
          firstName: "Ada",
          lastName: "Lovelace",
          phoneNumber: "+491701234567",
        },
        step: "new-calendar-selection",
      });
    }).toThrow("Invalid booking session snapshot");
  });
});
