import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import type { Doc, Id } from "../_generated/dataModel";

import { api } from "../_generated/api";
import schema from "../schema";
import { modules } from "./test.setup";

type BookingSessionState = Doc<"bookingSessions">["state"];

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

async function bootstrapToPatientStatus(
  authed: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
  sessionId: Id<"bookingSessions">,
  locationId: Id<"locations">,
) {
  await authed.mutation(api.bookingSessions.acceptPrivacy, { sessionId });
  await authed.mutation(api.bookingSessions.selectLocation, {
    locationId,
    sessionId,
  });
}

async function createBookingEntities(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const practiceId = await ctx.db.insert("practices", {
      name: "Flow Test Practice",
    });

    const ruleSetId = await ctx.db.insert("ruleSets", {
      createdAt: Date.now(),
      description: "Flow Test Rule Set",
      practiceId,
      saved: true,
      version: 1,
    });

    await ctx.db.patch("practices", practiceId, {
      currentActiveRuleSetId: ruleSetId,
    });

    const locationId = await ctx.db.insert("locations", {
      name: "Main Location",
      practiceId,
      ruleSetId,
    });

    const practitionerId = await ctx.db.insert("practitioners", {
      name: "Dr. Test",
      practiceId,
      ruleSetId,
    });

    const now = BigInt(Date.now());
    const appointmentTypeId = await ctx.db.insert("appointmentTypes", {
      allowedPractitionerIds: [practitionerId],
      createdAt: now,
      duration: 30,
      lastModified: now,
      name: "Checkup",
      practiceId,
      ruleSetId,
    });

    return {
      appointmentTypeId,
      locationId,
      practiceId,
      practitionerId,
      ruleSetId,
    };
  });
}

async function createPracticeAndRuleSet(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const practiceId = await ctx.db.insert("practices", {
      name: "Test Practice",
    });

    const ruleSetId = await ctx.db.insert("ruleSets", {
      createdAt: Date.now(),
      description: "Test Rule Set",
      practiceId,
      saved: true,
      version: 1,
    });

    await ctx.db.patch("practices", practiceId, {
      currentActiveRuleSetId: ruleSetId,
    });

    return { practiceId, ruleSetId };
  });
}

function createTestContext() {
  return convexTest(schema, modules);
}

function makeAuthedClient(
  t: ReturnType<typeof convexTest>,
  identitySuffix: string,
) {
  return t.withIdentity({
    email: `${identitySuffix}@example.com`,
    subject: `workos_${identitySuffix}`,
  });
}

describe("bookingSessions user identity handling", () => {
  test("create bootstraps missing authenticated user", async () => {
    const t = createTestContext();
    const { practiceId, ruleSetId } = await createPracticeAndRuleSet(t);

    const authId = "workos_missing_user";
    const authed = t.withIdentity({
      email: "missing@example.com",
      subject: authId,
    });

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
      ruleSetId,
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
    const { practiceId, ruleSetId } = await createPracticeAndRuleSet(t);

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
      ruleSetId,
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
});

describe("bookingSessions atomic pending/completed step states", () => {
  test("GKV details step transitions from pending to completed variant via goBack", async () => {
    const t = createTestContext();
    const { locationId, practiceId, ruleSetId } =
      await createBookingEntities(t);
    const authed = makeAuthedClient(t, "atomic_gkv");

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
      ruleSetId,
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
    const { locationId, practiceId, ruleSetId } =
      await createBookingEntities(t);
    const authed = makeAuthedClient(t, "atomic_pkv");

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
      ruleSetId,
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

  test("new patient data-input step stays pending before submit and calendar step cannot go back", async () => {
    const t = createTestContext();
    const { locationId, practiceId, ruleSetId } =
      await createBookingEntities(t);
    const authed = makeAuthedClient(t, "atomic_new_data");

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
      ruleSetId,
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

    const atCalendar = await authed.query(api.bookingSessions.get, {
      sessionId,
    });
    assertSessionExists(atCalendar, "session should exist at calendar step");
    assertStateStep(atCalendar.state, "new-calendar-selection");
    expect("reasonDescription" in atCalendar.state).toBe(false);
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
    expect("reasonDescription" in completed.state).toBe(false);
    expect(completed.state.personalData.lastName).toBe("Lovelace");
  });

  test("existing patient data-input step remains atomic (pending before submit)", async () => {
    const t = createTestContext();
    const { locationId, practiceId, practitionerId, ruleSetId } =
      await createBookingEntities(t);
    const authed = makeAuthedClient(t, "atomic_existing_data");

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
      ruleSetId,
    });
    await bootstrapToPatientStatus(authed, sessionId, locationId);

    await authed.mutation(api.bookingSessions.selectExistingPatient, {
      sessionId,
    });
    await authed.mutation(api.bookingSessions.selectDoctor, {
      practitionerId,
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
    expect("reasonDescription" in atCalendar.state).toBe(false);
    expect(atCalendar.state.personalData.firstName).toBe("Grace");
  });
});
