import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";

import { api } from "../_generated/api";
import { insertSelfLineageEntity } from "../lineage";
import schema from "../schema";
import { modules } from "./test.setup";

function completePersonalData(
  overrides: Partial<{
    city: string;
    dateOfBirth: string;
    email: string;
    firstName: string;
    gender: "diverse" | "female" | "male";
    lastName: string;
    phoneNumber: string;
    postalCode: string;
    street: string;
    title: string;
  }> = {},
) {
  return {
    city: "Berlin",
    dateOfBirth: "1990-01-01",
    email: "ada@example.com",
    firstName: "Ada",
    gender: "female" as const,
    lastName: "Lovelace",
    phoneNumber: "+491701234567",
    postalCode: "10115",
    street: "Unter den Linden 1",
    title: "Dr.",
    ...overrides,
  };
}

function createAuthedTestContext(identitySuffix = "default") {
  return convexTest(schema, modules).withIdentity({
    email: `${identitySuffix}@example.com`,
    subject: `workos_${identitySuffix}`,
  });
}

async function createFlowFixture(
  t: ReturnType<typeof createAuthedTestContext>,
) {
  return await t.run(async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    let fixtureUserId: Id<"users"> | null = null;
    if (identity) {
      const existing = await ctx.db
        .query("users")
        .withIndex("by_authId", (q) => q.eq("authId", identity.subject))
        .first();
      fixtureUserId =
        existing?._id ??
        (await ctx.db.insert("users", {
          authId: identity.subject,
          createdAt: BigInt(Date.now()),
          email: identity.email ?? `${identity.subject}@users.invalid`,
        }));
    }

    const now = BigInt(Date.now());
    const practiceId = await ctx.db.insert("practices", {
      name: "Booking Flow Practice",
    });
    const ruleSetId = await ctx.db.insert("ruleSets", {
      createdAt: Date.now(),
      description: "Booking Flow Rule Set",
      draftRevision: 0,
      practiceId,
      saved: true,
      version: 1,
    });
    await ctx.db.patch("practices", practiceId, {
      currentActiveRuleSetId: ruleSetId,
    });
    if (fixtureUserId !== null) {
      await ctx.db.insert("organizationMembers", {
        createdAt: now,
        practiceId,
        role: "patient",
        userId: fixtureUserId,
      });
    }
    const locationLineageKey = await insertSelfLineageEntity(
      ctx.db,
      "locations",
      {
        name: "Dissen a.T.W.",
        practiceId,
        ruleSetId,
      },
    );
    const practitionerLineageKey = await insertSelfLineageEntity(
      ctx.db,
      "practitioners",
      {
        name: "Dr. Test",
        practiceId,
        ruleSetId,
      },
    );
    const appointmentTypeLineageKey = await insertSelfLineageEntity(
      ctx.db,
      "appointmentTypes",
      {
        allowedPractitionerLineageKeys: [practitionerLineageKey],
        appointmentPlan: { steps: [] },
        createdAt: now,
        duration: 20,
        lastModified: now,
        name: "Akuttermin",
        practiceId,
        ruleSetId,
      },
    );
    await insertSelfLineageEntity(ctx.db, "baseSchedules", {
      breakTimes: [],
      dayOfWeek: 6,
      endTime: "11:00",
      locationLineageKey,
      practiceId,
      practitionerLineageKey,
      ruleSetId,
      startTime: "10:00",
    });

    return {
      appointmentTypeLineageKey,
      locationLineageKey,
      practiceId,
      practitionerLineageKey,
      ruleSetId,
    };
  });
}

async function createFlowToPatientStatus(
  t: ReturnType<typeof createAuthedTestContext>,
  fixture: Awaited<ReturnType<typeof createFlowFixture>>,
) {
  await t.mutation(api.bookingSessions.create, {
    practiceId: fixture.practiceId,
    ruleSetId: fixture.ruleSetId,
  });
  await t.mutation(api.bookingSessions.acceptPrivacy, {
    practiceId: fixture.practiceId,
    ruleSetId: fixture.ruleSetId,
  });
  await t.mutation(api.bookingSessions.selectLocation, {
    locationLineageKey: fixture.locationLineageKey,
    practiceId: fixture.practiceId,
    ruleSetId: fixture.ruleSetId,
  });
}

async function createNewPatientFlowToDataInput(
  t: ReturnType<typeof createAuthedTestContext>,
  fixture: Awaited<ReturnType<typeof createFlowFixture>>,
) {
  await createFlowToPatientStatus(t, fixture);
  await t.mutation(api.bookingSessions.selectNewPatient, {
    practiceId: fixture.practiceId,
    ruleSetId: fixture.ruleSetId,
  });
  await t.mutation(api.bookingSessions.selectInsuranceType, {
    insuranceType: "gkv",
    practiceId: fixture.practiceId,
    ruleSetId: fixture.ruleSetId,
  });
  await t.mutation(api.bookingSessions.confirmGkvDetails, {
    hzvStatus: "has-contract",
    practiceId: fixture.practiceId,
    ruleSetId: fixture.ruleSetId,
  });
}

async function ensureCurrentUserOrganizationMembership(
  t: ReturnType<typeof createAuthedTestContext>,
  fixture: Awaited<ReturnType<typeof createFlowFixture>>,
  role: "admin" | "owner" | "patient" | "staff" = "patient",
) {
  await t.run(async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Expected authenticated test identity.");
    }
    const user = await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", identity.subject))
      .first();
    if (!user) {
      throw new Error("Expected booking fixture user.");
    }
    const existing = await ctx.db
      .query("organizationMembers")
      .withIndex("by_practiceId_userId", (q) =>
        q.eq("practiceId", fixture.practiceId).eq("userId", user._id),
      )
      .first();
    if (existing) {
      await ctx.db.patch("organizationMembers", existing._id, { role });
      return;
    }
    await ctx.db.insert("organizationMembers", {
      createdAt: BigInt(Date.now()),
      practiceId: fixture.practiceId,
      role,
      userId: user._id,
    });
  });
}

async function ensureSyncedUser(
  t: ReturnType<typeof createAuthedTestContext>,
  identitySuffix = "default",
) {
  await t.run(async (ctx) => {
    const authId = `workos_${identitySuffix}`;
    const existing = await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", authId))
      .first();
    if (existing) {
      return;
    }
    await ctx.db.insert("users", {
      authId,
      createdAt: BigInt(Date.now()),
      email: `${identitySuffix}@example.com`,
    });
  });
}

describe("booking flow without bookingSessions table", () => {
  test("getActiveForUser throws for missing auth identity", async () => {
    const t = convexTest(schema, modules);
    const fixture = await createFlowFixture(
      t.withIdentity({
        email: "active-missing-auth-fixture@example.com",
        subject: "workos_active_missing_auth_fixture",
      }),
    );

    await expect(
      t.query(api.bookingSessions.getActiveForUser, {
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
      }),
    ).rejects.toThrow("Authentication required");
  });

  test("getActiveForUser throws for unprovisioned auth identity", async () => {
    const t = convexTest(schema, modules);
    const fixture = await createFlowFixture(
      t.withIdentity({
        email: "active-unprovisioned-fixture@example.com",
        subject: "workos_active_unprovisioned_fixture",
      }),
    );
    const authed = t.withIdentity({
      email: "active-unprovisioned@example.com",
      subject: "workos_active_unprovisioned",
    });

    await expect(
      authed.query(api.bookingSessions.getActiveForUser, {
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
      }),
    ).rejects.toThrow("Authenticated user is not provisioned in Convex");
  });

  test("getActiveForUser returns null for provisioned users without an active flow", async () => {
    const t = convexTest(schema, modules);
    const fixture = await createFlowFixture(
      t.withIdentity({
        email: "active-no-flow-fixture@example.com",
        subject: "workos_active_no_flow_fixture",
      }),
    );
    const authId = "workos_active_no_flow";
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        authId,
        createdAt: BigInt(Date.now()),
        email: "active-no-flow@example.com",
      });
      await ctx.db.insert("organizationMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: fixture.practiceId,
        role: "patient",
        userId,
      });
    });
    const authed = t.withIdentity({
      email: "active-no-flow@example.com",
      subject: authId,
    });

    await expect(
      authed.query(api.bookingSessions.getActiveForUser, {
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
      }),
    ).resolves.toBeNull();
  });

  test("create, resume, and remove use flow-keyed step rows", async () => {
    const t = createAuthedTestContext("flow_resume");
    const fixture = await createFlowFixture(t);
    await ensureSyncedUser(t, "flow_resume");

    await t.mutation(api.bookingSessions.create, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    const atPrivacy = await t.query(api.bookingSessions.getActiveForUser, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    expect(atPrivacy?.state.step).toBe("privacy");

    await t.mutation(api.bookingSessions.acceptPrivacy, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.selectLocation, {
      locationLineageKey: fixture.locationLineageKey,
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    const atPatientStatus = await t.query(
      api.bookingSessions.getActiveForUser,
      {
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
      },
    );
    expect(atPatientStatus?.state.step).toBe("patient-status");

    await t.mutation(api.bookingSessions.remove, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    const afterRemove = await t.query(api.bookingSessions.getActiveForUser, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    expect(afterRemove).toBeNull();

    const rows = await t.run(async (ctx) => ({
      location: await ctx.db.query("bookingLocationSteps").collect(),
      patientStatus: await ctx.db.query("bookingPatientStatusSteps").collect(),
      privacy: await ctx.db.query("bookingPrivacySteps").collect(),
    }));
    expect(rows.privacy).toHaveLength(0);
    expect(rows.location).toHaveLength(0);
    expect(rows.patientStatus).toHaveLength(0);
  });

  test("location selection requires accepted privacy consent", async () => {
    const t = createAuthedTestContext("location_requires_privacy");
    const fixture = await createFlowFixture(t);
    await ensureSyncedUser(t, "location_requires_privacy");

    await t.mutation(api.bookingSessions.create, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    await expect(
      t.mutation(api.bookingSessions.selectLocation, {
        locationLineageKey: fixture.locationLineageKey,
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
      }),
    ).rejects.toThrow("Location selection is not available");

    const rows = await t.run(async (ctx) => ({
      location: await ctx.db.query("bookingLocationSteps").collect(),
      privacy: await ctx.db.query("bookingPrivacySteps").collect(),
    }));
    expect(rows.location).toHaveLength(0);
    expect(rows.privacy).toHaveLength(1);
    expect(rows.privacy[0]?.consent).toBe(false);
  });

  test("patient status selection requires completed location selection", async () => {
    const t = createAuthedTestContext("patient_status_requires_location");
    const fixture = await createFlowFixture(t);
    await ensureSyncedUser(t, "patient_status_requires_location");

    await t.mutation(api.bookingSessions.create, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.acceptPrivacy, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    await expect(
      t.mutation(api.bookingSessions.selectNewPatient, {
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
      }),
    ).rejects.toThrow("Patient status is not available");
    await expect(
      t.mutation(api.bookingSessions.selectExistingPatient, {
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
      }),
    ).rejects.toThrow("Patient status is not available");

    const rows = await t.run(async (ctx) => ({
      location: await ctx.db.query("bookingLocationSteps").collect(),
      patientStatus: await ctx.db.query("bookingPatientStatusSteps").collect(),
    }));
    expect(rows.location).toHaveLength(0);
    expect(rows.patientStatus).toHaveLength(0);
  });

  test("doctor selection requires existing-patient branch selection", async () => {
    const t = createAuthedTestContext("doctor_requires_existing_branch");
    const fixture = await createFlowFixture(t);

    await createFlowToPatientStatus(t, fixture);

    await expect(
      t.mutation(api.bookingSessions.selectDoctor, {
        practiceId: fixture.practiceId,
        practitionerLineageKey: fixture.practitionerLineageKey,
        ruleSetId: fixture.ruleSetId,
      }),
    ).rejects.toThrow("Doctor selection is not available");

    const rows = await t.run(async (ctx) => ({
      existingDoctor: await ctx.db
        .query("bookingExistingDoctorSelectionSteps")
        .collect(),
      patientStatus: await ctx.db.query("bookingPatientStatusSteps").collect(),
    }));
    expect(rows.existingDoctor).toHaveLength(0);
    expect(rows.patientStatus).toHaveLength(0);
  });

  test("new-patient branch mutations require the current new-patient step", async () => {
    const t = createAuthedTestContext("new_branch_requires_current_step");
    const fixture = await createFlowFixture(t);

    await createFlowToPatientStatus(t, fixture);

    await expect(
      t.mutation(api.bookingSessions.selectInsuranceType, {
        insuranceType: "gkv",
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
      }),
    ).rejects.toThrow("Insurance type is not available");
    await expect(
      t.mutation(api.bookingSessions.confirmGkvDetails, {
        hzvStatus: "has-contract",
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
      }),
    ).rejects.toThrow("GKV details are not available");

    const rows = await t.run(async (ctx) => ({
      gkvDetails: await ctx.db.query("bookingNewGkvDetailSteps").collect(),
      insuranceType: await ctx.db
        .query("bookingNewInsuranceTypeSteps")
        .collect(),
    }));
    expect(rows.gkvDetails).toHaveLength(0);
    expect(rows.insuranceType).toHaveLength(0);
  });

  test("new patient flow persists normalized medical history and data sharing rows", async () => {
    const t = createAuthedTestContext("new_patient_flow");
    const fixture = await createFlowFixture(t);

    await createFlowToPatientStatus(t, fixture);
    await t.mutation(api.bookingSessions.selectNewPatient, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.selectInsuranceType, {
      insuranceType: "gkv",
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.confirmGkvDetails, {
      hzvStatus: "has-contract",
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    const atDataInput = await t.query(api.bookingSessions.getActiveForUser, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    expect(atDataInput?.state.step).toBe("new-data-input");

    await t.mutation(api.bookingSessions.submitNewPatientData, {
      medicalHistory: {
        allergiesDescription: "Pollen",
        currentMedications: "Ibuprofen",
        hasAllergies: true,
        hasDiabetes: false,
        hasHeartCondition: false,
        hasLungCondition: true,
        otherConditions: "Asthma",
      },
      personalData: completePersonalData({
        city: "Osnabrück",
        email: "ada@example.com",
        phoneNumber: "+491701234567",
        postalCode: "49074",
        street: "Teststr. 1",
      }),
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    const atDataSharing = await t.query(api.bookingSessions.getActiveForUser, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    expect(atDataSharing?.state.step).toBe("new-data-sharing");

    await t.mutation(api.bookingSessions.submitNewDataSharing, {
      dataSharingContacts: [
        {
          city: "Osnabrück",
          dateOfBirth: "1988-02-03",
          firstName: "Grace",
          gender: "female",
          lastName: "Hopper",
          phoneNumber: "+491709876543",
          postalCode: "49074",
          street: "Nebenweg 2",
        },
      ],
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    const atCalendar = await t.query(api.bookingSessions.getActiveForUser, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    expect(atCalendar?.state.step).toBe("new-calendar-selection");

    const persisted = await t.run(async (ctx) => ({
      contacts: await ctx.db
        .query("bookingNewDataSharingContactRows")
        .collect(),
      medicalHistory: await ctx.db
        .query("bookingMedicalHistoryEntries")
        .collect(),
      personalData: await ctx.db.query("bookingPersonalDataSteps").collect(),
    }));
    expect(persisted.personalData).toHaveLength(1);
    expect(persisted.contacts).toHaveLength(1);
    expect(persisted.medicalHistory).toHaveLength(1);
  });

  test("new patient data rejects oversized personal fields before writing rows", async () => {
    const t = createAuthedTestContext("new_patient_oversized_personal");
    const fixture = await createFlowFixture(t);
    await createNewPatientFlowToDataInput(t, fixture);

    await expect(
      t.mutation(api.bookingSessions.submitNewPatientData, {
        personalData: completePersonalData({
          firstName: "A".repeat(121),
        }),
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
      }),
    ).rejects.toThrow("Vorname must be at most 120 characters");

    const persisted = await t.run(async (ctx) => ({
      medicalHistory: await ctx.db
        .query("bookingMedicalHistoryEntries")
        .collect(),
      personalData: await ctx.db.query("bookingPersonalDataSteps").collect(),
    }));
    expect(persisted.personalData).toHaveLength(0);
    expect(persisted.medicalHistory).toHaveLength(0);
  });

  test("new patient data rejects oversized medical history before writing rows", async () => {
    const t = createAuthedTestContext("new_patient_oversized_medical");
    const fixture = await createFlowFixture(t);
    await createNewPatientFlowToDataInput(t, fixture);

    await expect(
      t.mutation(api.bookingSessions.submitNewPatientData, {
        medicalHistory: {
          currentMedications: "M".repeat(2_001),
          hasAllergies: false,
          hasDiabetes: false,
          hasHeartCondition: false,
          hasLungCondition: false,
        },
        personalData: completePersonalData(),
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
      }),
    ).rejects.toThrow("Medikamentenhinweise must be at most 2000 characters");

    const persisted = await t.run(async (ctx) => ({
      medicalHistory: await ctx.db
        .query("bookingMedicalHistoryEntries")
        .collect(),
      personalData: await ctx.db.query("bookingPersonalDataSteps").collect(),
    }));
    expect(persisted.personalData).toHaveLength(0);
    expect(persisted.medicalHistory).toHaveLength(0);
  });

  test("new data sharing rejects too many contacts before writing rows", async () => {
    const t = createAuthedTestContext("new_patient_too_many_contacts");
    const fixture = await createFlowFixture(t);
    await createNewPatientFlowToDataInput(t, fixture);
    await t.mutation(api.bookingSessions.submitNewPatientData, {
      personalData: completePersonalData(),
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    await expect(
      t.mutation(api.bookingSessions.submitNewDataSharing, {
        dataSharingContacts: Array.from({ length: 11 }, () => ({
          city: "Osnabrück",
          dateOfBirth: "1988-02-03",
          firstName: "Grace",
          gender: "female" as const,
          lastName: "Hopper",
          phoneNumber: "+491701234567",
          postalCode: "49074",
          street: "Nebenweg 2",
        })),
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
      }),
    ).rejects.toThrow("at most 10 contacts");

    const persisted = await t.run(async (ctx) => ({
      contacts: await ctx.db
        .query("bookingNewDataSharingContactRows")
        .collect(),
      dataSharing: await ctx.db.query("bookingNewDataSharingSteps").collect(),
    }));
    expect(persisted.contacts).toHaveLength(0);
    expect(persisted.dataSharing).toHaveLength(0);
  });

  test("new data sharing rejects oversized contact fields before writing rows", async () => {
    const t = createAuthedTestContext("new_patient_oversized_contact");
    const fixture = await createFlowFixture(t);
    await createNewPatientFlowToDataInput(t, fixture);
    await t.mutation(api.bookingSessions.submitNewPatientData, {
      personalData: completePersonalData(),
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    await expect(
      t.mutation(api.bookingSessions.submitNewDataSharing, {
        dataSharingContacts: [
          {
            city: "Osnabrück",
            dateOfBirth: "1988-02-03",
            firstName: "G".repeat(121),
            gender: "female",
            lastName: "Hopper",
            phoneNumber: "+491701234567",
            postalCode: "49074",
            street: "Nebenweg 2",
          },
        ],
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
      }),
    ).rejects.toThrow(
      "Data-sharing contact #1: Vorname must be at most 120 characters",
    );

    const persisted = await t.run(async (ctx) => ({
      contacts: await ctx.db
        .query("bookingNewDataSharingContactRows")
        .collect(),
      dataSharing: await ctx.db.query("bookingNewDataSharingSteps").collect(),
    }));
    expect(persisted.contacts).toHaveLength(0);
    expect(persisted.dataSharing).toHaveLength(0);
  });

  test("existing patient flow stays at personal-data until required data exists", async () => {
    const t = createAuthedTestContext("existing_patient_flow");
    const fixture = await createFlowFixture(t);

    await createFlowToPatientStatus(t, fixture);
    await t.mutation(api.bookingSessions.selectExistingPatient, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.selectDoctor, {
      practiceId: fixture.practiceId,
      practitionerLineageKey: fixture.practitionerLineageKey,
      ruleSetId: fixture.ruleSetId,
    });

    const beforePersonalData = await t.query(
      api.bookingSessions.getActiveForUser,
      {
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
      },
    );
    expect(beforePersonalData?.state.step).toBe("existing-data-input");

    await t.mutation(api.bookingSessions.submitExistingPatientData, {
      personalData: completePersonalData({
        dateOfBirth: "1975-05-20",
        email: "grace@example.com",
        firstName: "Grace",
        lastName: "Hopper",
        phoneNumber: "+491709999999",
      }),
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    const atCalendar = await t.query(api.bookingSessions.getActiveForUser, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    expect(atCalendar?.state.step).toBe("existing-calendar-selection");
  });

  test("back navigation rejects rewinds after new-patient flow reaches calendar", async () => {
    const t = createAuthedTestContext("new_patient_back_forward");
    const fixture = await createFlowFixture(t);

    await createFlowToPatientStatus(t, fixture);
    await t.mutation(api.bookingSessions.selectNewPatient, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.selectInsuranceType, {
      insuranceType: "gkv",
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.confirmGkvDetails, {
      hzvStatus: "has-contract",
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.submitNewPatientData, {
      personalData: completePersonalData(),
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.submitNewDataSharing, {
      dataSharingContacts: [],
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    const atCalendar = await t.query(api.bookingSessions.getActiveForUser, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    expect(atCalendar?.state.step).toBe("new-calendar-selection");

    await expect(
      t.mutation(api.bookingSessions.goBackToStep, {
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
        targetStep: "new-data-sharing",
      }),
    ).rejects.toThrow("cannot go back to the requested step");

    const afterRejectedBack = await t.query(
      api.bookingSessions.getActiveForUser,
      {
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
      },
    );
    expect(afterRejectedBack?.state.step).toBe("new-calendar-selection");

    await expect(
      t.mutation(api.bookingSessions.goBackToStep, {
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
        targetStep: "new-data-input",
      }),
    ).rejects.toThrow("cannot go back to the requested step");
  });

  test("back navigation returns PKV data input to PKV details", async () => {
    const t = createAuthedTestContext("pkv_back_from_data_input");
    const fixture = await createFlowFixture(t);

    await createFlowToPatientStatus(t, fixture);
    await t.mutation(api.bookingSessions.selectNewPatient, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.selectInsuranceType, {
      insuranceType: "pkv",
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.acceptPvsConsent, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.confirmPkvDetails, {
      beihilfeStatus: "yes",
      pkvInsuranceType: "other",
      pkvTariff: "premium",
      practiceId: fixture.practiceId,
      pvsConsent: true,
      ruleSetId: fixture.ruleSetId,
    });

    const atDataInput = await t.query(api.bookingSessions.getActiveForUser, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    expect(atDataInput?.state.step).toBe("new-data-input");

    await t.mutation(api.bookingSessions.goBackToStep, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
      targetStep: "new-pkv-details",
    });

    const afterBack = await t.query(api.bookingSessions.getActiveForUser, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    expect(afterBack?.state.step).toBe("new-pkv-details");
  });

  test("back navigation rejects skipping across protected branch decisions", async () => {
    const t = createAuthedTestContext("new_patient_back_reject_skip");
    const fixture = await createFlowFixture(t);

    await createFlowToPatientStatus(t, fixture);
    await t.mutation(api.bookingSessions.selectNewPatient, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.selectInsuranceType, {
      insuranceType: "gkv",
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.confirmGkvDetails, {
      hzvStatus: "has-contract",
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.submitNewPatientData, {
      personalData: completePersonalData(),
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.submitNewDataSharing, {
      dataSharingContacts: [],
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    await expect(
      t.mutation(api.bookingSessions.goBackToStep, {
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
        targetStep: "patient-status",
      }),
    ).rejects.toThrow("cannot go back to the requested step");

    const afterRejectedBack = await t.query(
      api.bookingSessions.getActiveForUser,
      {
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
      },
    );
    expect(afterRejectedBack?.state.step).toBe("new-calendar-selection");

    await expect(
      t.mutation(api.bookingSessions.selectExistingPatient, {
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
      }),
    ).rejects.toThrow("can no longer be changed");
  });

  test("back navigation rejects rewinds after existing-patient flow reaches calendar", async () => {
    const t = createAuthedTestContext("existing_patient_back_forward");
    const fixture = await createFlowFixture(t);

    await createFlowToPatientStatus(t, fixture);
    await t.mutation(api.bookingSessions.selectExistingPatient, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.selectDoctor, {
      practiceId: fixture.practiceId,
      practitionerLineageKey: fixture.practitionerLineageKey,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.submitExistingPatientData, {
      personalData: completePersonalData({
        dateOfBirth: "1975-05-20",
        email: "grace@example.com",
        firstName: "Grace",
        lastName: "Hopper",
        phoneNumber: "+491709999999",
      }),
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    const atCalendar = await t.query(api.bookingSessions.getActiveForUser, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    expect(atCalendar?.state.step).toBe("existing-calendar-selection");

    await expect(
      t.mutation(api.bookingSessions.goBackToStep, {
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
        targetStep: "existing-data-input",
      }),
    ).rejects.toThrow("cannot go back to the requested step");

    const afterRejectedBack = await t.query(
      api.bookingSessions.getActiveForUser,
      {
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
      },
    );
    expect(afterRejectedBack?.state.step).toBe("existing-calendar-selection");

    await expect(
      t.mutation(api.bookingSessions.goBackToStep, {
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
        targetStep: "existing-doctor-selection",
      }),
    ).rejects.toThrow("cannot go back to the requested step");
  });

  test("back navigation rejects changing practitioner from appointment selection", async () => {
    const t = createAuthedTestContext("existing_patient_back_reject_doctor");
    const fixture = await createFlowFixture(t);

    await createFlowToPatientStatus(t, fixture);
    await t.mutation(api.bookingSessions.selectExistingPatient, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.selectDoctor, {
      practiceId: fixture.practiceId,
      practitionerLineageKey: fixture.practitionerLineageKey,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.submitExistingPatientData, {
      personalData: completePersonalData({
        dateOfBirth: "1975-05-20",
        email: "grace@example.com",
        firstName: "Grace",
        lastName: "Hopper",
        phoneNumber: "+491709999999",
      }),
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    await expect(
      t.mutation(api.bookingSessions.goBackToStep, {
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
        targetStep: "existing-doctor-selection",
      }),
    ).rejects.toThrow("cannot go back to the requested step");

    const afterRejectedBack = await t.query(
      api.bookingSessions.getActiveForUser,
      {
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
      },
    );
    expect(afterRejectedBack?.state.step).toBe("existing-calendar-selection");

    await expect(
      t.mutation(api.bookingSessions.selectDoctor, {
        practiceId: fixture.practiceId,
        practitionerLineageKey: fixture.practitionerLineageKey,
        ruleSetId: fixture.ruleSetId,
      }),
    ).rejects.toThrow("can no longer be changed");
  });

  test("future appointments and unmatched imported holds block create", async () => {
    const t = createAuthedTestContext("flow_blocking");
    const fixture = await createFlowFixture(t);
    const userId = await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_authId", (q) => q.eq("authId", "workos_flow_blocking"))
        .first();
      if (user) {
        return user._id;
      }
      return await ctx.db.insert("users", {
        authId: "workos_flow_blocking",
        createdAt: BigInt(Date.now()),
        email: "flow_blocking@example.com",
      });
    });

    await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      await ctx.db.insert("legacyUnmatchedFutureBookingHolds", {
        createdAt: now,
        end: "2027-01-02T10:20:00+01:00[Europe/Berlin]",
        lastModified: now,
        legacyAppointmentId: "legacy-1",
        practiceId: fixture.practiceId,
        start: "2027-01-02T10:00:00+01:00[Europe/Berlin]",
        userId,
      });
    });

    await expect(
      t.mutation(api.bookingSessions.create, {
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
      }),
    ).rejects.toThrow("unresolved imported future booking");
  });

  test("simulation appointments do not block starting a booking flow", async () => {
    const t = createAuthedTestContext("simulation_does_not_block");
    const fixture = await createFlowFixture(t);
    const userId = await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_authId", (q) =>
          q.eq("authId", "workos_simulation_does_not_block"),
        )
        .first();
      if (user) {
        return user._id;
      }
      return await ctx.db.insert("users", {
        authId: "workos_simulation_does_not_block",
        createdAt: BigInt(Date.now()),
        email: "simulation_does_not_block@example.com",
      });
    });

    await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      await ctx.db.insert("appointments", {
        appointmentTypeLineageKey: fixture.appointmentTypeLineageKey,
        appointmentTypeTitle: "Akuttermin",
        createdAt: now,
        end: "2027-01-02T10:20:00+01:00[Europe/Berlin]",
        isSimulation: true,
        lastModified: now,
        locationLineageKey: fixture.locationLineageKey,
        occupancyScope: {
          kind: "practitioner",
          practitionerLineageKey: fixture.practitionerLineageKey,
        },
        practiceId: fixture.practiceId,
        start: "2027-01-02T10:00:00+01:00[Europe/Berlin]",
        title: "Simulierter Termin",
        userId,
      });
    });

    await t.mutation(api.bookingSessions.create, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    const session = await t.query(api.bookingSessions.getActiveForUser, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    expect(session?.state.step).toBe("privacy");
  });

  test("successful slot selection creates appointment and keeps calendar state for later rebooking", async () => {
    const t = createAuthedTestContext("flow_booking_success");
    const fixture = await createFlowFixture(t);
    await ensureCurrentUserOrganizationMembership(t, fixture);

    await createFlowToPatientStatus(t, fixture);
    await t.mutation(api.bookingSessions.selectExistingPatient, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.selectDoctor, {
      practiceId: fixture.practiceId,
      practitionerLineageKey: fixture.practitionerLineageKey,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.submitExistingPatientData, {
      personalData: completePersonalData({
        dateOfBirth: "1975-05-20",
        email: "grace@example.com",
        firstName: "Grace",
        lastName: "Hopper",
        phoneNumber: "+491709999999",
      }),
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    const result = await t.mutation(
      api.bookingSessions.selectExistingPatientSlot,
      {
        appointmentTypeLineageKey: fixture.appointmentTypeLineageKey,
        practiceId: fixture.practiceId,
        reasonDescription: "Rueckenschmerzen",
        ruleSetId: fixture.ruleSetId,
        selectedSlot: {
          practitionerLineageKey: fixture.practitionerLineageKey,
          practitionerName: "Dr. Test",
          startTime: "2027-01-02T10:00:00+01:00[Europe/Berlin]",
        },
      },
    );

    expect(result.appointmentId).toBeDefined();

    const afterBooking = await t.query(api.bookingSessions.getActiveForUser, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    expect(afterBooking?.state.step).toBe("existing-calendar-selection");

    const persisted = await t.run(async (ctx) => ({
      appointment: await ctx.db.get("appointments", result.appointmentId),
      calendarReached: await ctx.db
        .query("bookingCalendarReachedSteps")
        .collect(),
      personalData: await ctx.db.query("bookingPersonalDataSteps").collect(),
      privacy: await ctx.db.query("bookingPrivacySteps").collect(),
    }));
    expect(persisted.appointment?.userId).toBeDefined();
    expect(persisted.calendarReached).toHaveLength(1);
    expect(persisted.personalData).toHaveLength(1);
    expect(persisted.privacy).toHaveLength(1);

    await expect(
      t.mutation(api.bookingSessions.selectExistingPatientSlot, {
        appointmentTypeLineageKey: fixture.appointmentTypeLineageKey,
        practiceId: fixture.practiceId,
        reasonDescription: "Zweiter Termin",
        ruleSetId: fixture.ruleSetId,
        selectedSlot: {
          practitionerLineageKey: fixture.practitionerLineageKey,
          practitionerName: "Dr. Test",
          startTime: "2027-01-03T10:00:00+01:00[Europe/Berlin]",
        },
      }),
    ).rejects.toThrow("already has a future appointment");

    await t.mutation(api.appointments.cancelOwnAppointment, {
      appointmentId: result.appointmentId,
    });

    const bookedAppointments = await t.query(
      api.appointments.getBookedAppointmentsForCurrentUser,
      { activeRuleSetId: fixture.ruleSetId },
    );
    expect(bookedAppointments).toHaveLength(0);

    const afterCancellation = await t.query(
      api.bookingSessions.getActiveForUser,
      {
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
      },
    );
    expect(afterCancellation?.state.step).toBe("existing-calendar-selection");
  });

  test("rejects a selected slot that does not cover the full appointment duration", async () => {
    const t = createAuthedTestContext("flow_booking_duration_coverage");
    const fixture = await createFlowFixture(t);
    await ensureCurrentUserOrganizationMembership(t, fixture);

    await t.run(async (ctx) => {
      const schedule = await ctx.db.query("baseSchedules").first();
      if (!schedule) {
        throw new Error("Expected booking fixture schedule.");
      }
      await ctx.db.patch("baseSchedules", schedule._id, {
        breakTimes: [{ end: "10:15", start: "10:10" }],
      });
    });

    await createFlowToPatientStatus(t, fixture);
    await t.mutation(api.bookingSessions.selectExistingPatient, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.selectDoctor, {
      practiceId: fixture.practiceId,
      practitionerLineageKey: fixture.practitionerLineageKey,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.submitExistingPatientData, {
      personalData: completePersonalData({
        dateOfBirth: "1975-05-20",
        email: "grace@example.com",
        firstName: "Grace",
        lastName: "Hopper",
        phoneNumber: "+491709999999",
      }),
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    const slotsResult = await t.query(api.scheduling.getSlotsForDay, {
      date: "2027-01-02",
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
      scope: "real",
      simulatedContext: {
        appointmentTypeLineageKey: fixture.appointmentTypeLineageKey,
        clientType: "Online",
        locationLineageKey: fixture.locationLineageKey,
        patient: {
          dateOfBirth: "1975-05-20",
          isNew: false,
        },
      },
    });
    const availableStartTimes = slotsResult.slots
      .filter((slot) => slot.status === "AVAILABLE")
      .map((slot) => slot.startTime)
      .toSorted();
    expect(availableStartTimes).not.toContain(
      "2027-01-02T10:00:00+01:00[Europe/Berlin]",
    );
    expect(availableStartTimes[0]).toBe(
      "2027-01-02T10:15:00+01:00[Europe/Berlin]",
    );

    await expect(
      t.mutation(api.bookingSessions.selectExistingPatientSlot, {
        appointmentTypeLineageKey: fixture.appointmentTypeLineageKey,
        practiceId: fixture.practiceId,
        reasonDescription: "Rueckenschmerzen",
        ruleSetId: fixture.ruleSetId,
        selectedSlot: {
          practitionerLineageKey: fixture.practitionerLineageKey,
          practitionerName: "Dr. Test",
          startTime: "2027-01-02T10:00:00+01:00[Europe/Berlin]",
        },
      }),
    ).rejects.toThrow("Selected slot is no longer available");

    const appointments = await t.run((ctx) =>
      ctx.db.query("appointments").collect(),
    );
    expect(appointments).toHaveLength(0);
  });

  test("does not advertise dates without a slot covering the appointment duration", async () => {
    const t = createAuthedTestContext("flow_booking_date_duration_coverage");
    const fixture = await createFlowFixture(t);
    await ensureCurrentUserOrganizationMembership(t, fixture, "staff");

    await t.run(async (ctx) => {
      const appointmentType = await ctx.db.get(
        "appointmentTypes",
        fixture.appointmentTypeLineageKey,
      );
      if (!appointmentType) {
        throw new Error("Expected booking fixture appointment type.");
      }
      await ctx.db.patch("appointmentTypes", appointmentType._id, {
        duration: 30,
      });

      const schedule = await ctx.db.query("baseSchedules").first();
      if (!schedule) {
        throw new Error("Expected booking fixture schedule.");
      }
      await ctx.db.patch("baseSchedules", schedule._id, {
        breakTimes: [
          { end: "10:30", start: "10:15" },
          { end: "11:00", start: "10:45" },
        ],
      });
    });

    const simulatedContext = {
      appointmentTypeLineageKey: fixture.appointmentTypeLineageKey,
      clientType: "Online",
      locationLineageKey: fixture.locationLineageKey,
      patient: {
        dateOfBirth: "1975-05-20",
        isNew: false,
      },
    };

    const datesResult = await t.query(api.scheduling.getAvailableDates, {
      dateRange: {
        end: "2027-01-02T00:00:00.000Z",
        start: "2027-01-02T00:00:00.000Z",
      },
      practiceId: fixture.practiceId,
      simulatedContext,
    });
    expect(datesResult.dates).toEqual([]);

    const slotsResult = await t.query(api.scheduling.getSlotsForDay, {
      date: "2027-01-02",
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
      scope: "real",
      simulatedContext,
    });
    expect(slotsResult.slots.some((slot) => slot.status === "AVAILABLE")).toBe(
      false,
    );
  });

  test("duration coverage invalidation does not depend on slot order", async () => {
    const t = createAuthedTestContext("flow_booking_unordered_coverage");
    const fixture = await createFlowFixture(t);
    await ensureCurrentUserOrganizationMembership(t, fixture, "staff");

    await t.run(async (ctx) => {
      const appointmentType = await ctx.db.get(
        "appointmentTypes",
        fixture.appointmentTypeLineageKey,
      );
      if (!appointmentType) {
        throw new Error("Expected booking fixture appointment type.");
      }
      await ctx.db.patch("appointmentTypes", appointmentType._id, {
        duration: 10,
      });

      const schedule = await ctx.db.query("baseSchedules").first();
      if (!schedule) {
        throw new Error("Expected booking fixture schedule.");
      }
      await ctx.db.patch("baseSchedules", schedule._id, {
        endTime: "10:10",
        startTime: "10:05",
      });
      await insertSelfLineageEntity(ctx.db, "baseSchedules", {
        breakTimes: [],
        dayOfWeek: 6,
        endTime: "10:05",
        locationLineageKey: fixture.locationLineageKey,
        practiceId: fixture.practiceId,
        practitionerLineageKey: fixture.practitionerLineageKey,
        ruleSetId: fixture.ruleSetId,
        startTime: "10:00",
      });
    });

    const slotsResult = await t.query(api.scheduling.getSlotsForDay, {
      date: "2027-01-02",
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
      scope: "real",
      simulatedContext: {
        appointmentTypeLineageKey: fixture.appointmentTypeLineageKey,
        clientType: "Online",
        locationLineageKey: fixture.locationLineageKey,
        patient: {
          dateOfBirth: "1975-05-20",
          isNew: false,
        },
      },
    });

    const slotStatusByStartTime = new Map(
      slotsResult.slots.map((slot) => [slot.startTime, slot.status]),
    );
    expect(
      slotStatusByStartTime.get("2027-01-02T10:00:00+01:00[Europe/Berlin]"),
    ).toBe("AVAILABLE");
    expect(
      slotStatusByStartTime.get("2027-01-02T10:05:00+01:00[Europe/Berlin]"),
    ).toBe("BLOCKED");
  });

  test("available dates resolve appointment types against the viewed rule set", async () => {
    const t = createAuthedTestContext("flow_booking_draft_dates");
    const fixture = await createFlowFixture(t);
    await ensureCurrentUserOrganizationMembership(t, fixture, "staff");

    const draftFixture = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const draftRuleSetId = await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Draft Booking Flow Rule Set",
        draftRevision: 1,
        parentVersion: fixture.ruleSetId,
        practiceId: fixture.practiceId,
        saved: false,
        version: 2,
      });
      const locationLineageKey = await insertSelfLineageEntity(
        ctx.db,
        "locations",
        {
          name: "Draft Dissen a.T.W.",
          practiceId: fixture.practiceId,
          ruleSetId: draftRuleSetId,
        },
      );
      const practitionerLineageKey = await insertSelfLineageEntity(
        ctx.db,
        "practitioners",
        {
          name: "Dr. Draft",
          practiceId: fixture.practiceId,
          ruleSetId: draftRuleSetId,
        },
      );
      const appointmentTypeLineageKey = await insertSelfLineageEntity(
        ctx.db,
        "appointmentTypes",
        {
          allowedPractitionerLineageKeys: [practitionerLineageKey],
          createdAt: now,
          duration: 30,
          followUpPlan: [],
          lastModified: now,
          name: "Draft-only appointment type",
          practiceId: fixture.practiceId,
          ruleSetId: draftRuleSetId,
        },
      );
      await insertSelfLineageEntity(ctx.db, "baseSchedules", {
        breakTimes: [],
        dayOfWeek: 6,
        endTime: "11:00",
        locationLineageKey,
        practiceId: fixture.practiceId,
        practitionerLineageKey,
        ruleSetId: draftRuleSetId,
        startTime: "10:00",
      });

      return {
        appointmentTypeLineageKey,
        draftRuleSetId,
        locationLineageKey,
      };
    });

    const simulatedContext = {
      appointmentTypeLineageKey: draftFixture.appointmentTypeLineageKey,
      clientType: "Online",
      locationLineageKey: draftFixture.locationLineageKey,
      patient: {
        dateOfBirth: "1975-05-20",
        isNew: false,
      },
    };

    const datesResult = await t.query(api.scheduling.getAvailableDates, {
      dateRange: {
        end: "2027-01-02T00:00:00.000Z",
        start: "2027-01-02T00:00:00.000Z",
      },
      practiceId: fixture.practiceId,
      ruleSetId: draftFixture.draftRuleSetId,
      simulatedContext,
    });
    expect(datesResult.dates).toEqual(["2027-01-02"]);

    const slotsResult = await t.query(api.scheduling.getSlotsForDay, {
      date: "2027-01-02",
      practiceId: fixture.practiceId,
      ruleSetId: draftFixture.draftRuleSetId,
      scope: "simulation",
      simulatedContext,
    });
    expect(slotsResult.slots.some((slot) => slot.status === "AVAILABLE")).toBe(
      true,
    );
  });

  test("public booking excludes appointment types with appointment plans", async () => {
    const t = createAuthedTestContext("flow_booking_series_excluded");
    const fixture = await createFlowFixture(t);

    await t.run(async (ctx) => {
      await ctx.db.patch(
        "appointmentTypes",
        fixture.appointmentTypeLineageKey,
        {
          appointmentPlan: {
            steps: [
              {
                appointmentTypeLineageKey: fixture.appointmentTypeLineageKey,
                occupancy: { kind: "inheritRootPractitioner" },
                required: true,
                stepId: "follow-up",
                timing: {
                  kind: "afterPreviousEnd",
                  offsetUnit: "minutes",
                  offsetValue: 0,
                },
              },
            ],
          },
        },
      );
    });

    await createFlowToPatientStatus(t, fixture);

    const bookingAppointmentTypes = await t.query(
      api.entities.getBookingAppointmentTypes,
      {
        ruleSetId: fixture.ruleSetId,
      },
    );
    expect(bookingAppointmentTypes).toHaveLength(0);

    await t.mutation(api.bookingSessions.selectExistingPatient, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.selectDoctor, {
      practiceId: fixture.practiceId,
      practitionerLineageKey: fixture.practitionerLineageKey,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.submitExistingPatientData, {
      personalData: completePersonalData({
        email: "series-public@example.com",
      }),
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    await expect(
      t.mutation(api.bookingSessions.selectExistingPatientSlot, {
        appointmentTypeLineageKey: fixture.appointmentTypeLineageKey,
        practiceId: fixture.practiceId,
        reasonDescription: "Kette",
        ruleSetId: fixture.ruleSetId,
        selectedSlot: {
          practitionerLineageKey: fixture.practitionerLineageKey,
          practitionerName: "Dr. Test",
          startTime: "2027-01-02T10:00:00+01:00[Europe/Berlin]",
        },
      }),
    ).rejects.toThrow("online nicht buchbar");
  });

  test("public booking excludes resource-default appointment types", async () => {
    const t = createAuthedTestContext("flow_booking_resource_default_excluded");
    const fixture = await createFlowFixture(t);

    await t.run(async (ctx) => {
      await ctx.db.patch(
        "appointmentTypes",
        fixture.appointmentTypeLineageKey,
        {
          defaultOccupancy: {
            calendarResourceColumn: "ekg",
            kind: "resourceColumn",
          },
        },
      );
    });

    await createFlowToPatientStatus(t, fixture);

    const bookingAppointmentTypes = await t.query(
      api.entities.getBookingAppointmentTypes,
      {
        ruleSetId: fixture.ruleSetId,
      },
    );
    expect(bookingAppointmentTypes).toHaveLength(0);

    await t.mutation(api.bookingSessions.selectExistingPatient, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.selectDoctor, {
      practiceId: fixture.practiceId,
      practitionerLineageKey: fixture.practitionerLineageKey,
      ruleSetId: fixture.ruleSetId,
    });
    await t.mutation(api.bookingSessions.submitExistingPatientData, {
      personalData: completePersonalData({
        email: "resource-public@example.com",
      }),
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    await expect(
      t.mutation(api.bookingSessions.selectExistingPatientSlot, {
        appointmentTypeLineageKey: fixture.appointmentTypeLineageKey,
        practiceId: fixture.practiceId,
        reasonDescription: "EKG",
        ruleSetId: fixture.ruleSetId,
        selectedSlot: {
          practitionerLineageKey: fixture.practitionerLineageKey,
          practitionerName: "Dr. Test",
          startTime: "2027-01-02T10:00:00+01:00[Europe/Berlin]",
        },
      }),
    ).rejects.toThrow("online nicht buchbar");
  });
});
