import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "../_generated/api";
import { insertSelfLineageEntity } from "../lineage";
import schema from "../schema";
import { modules } from "./test.setup";

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
        createdAt: now,
        duration: 20,
        followUpPlan: [],
        lastModified: now,
        name: "Akuttermin",
        practiceId,
        ruleSetId,
      },
    );

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

describe("booking flow without bookingSessions table", () => {
  test("create, resume, and remove use flow-keyed step rows", async () => {
    const t = createAuthedTestContext("flow_resume");
    const fixture = await createFlowFixture(t);

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
      personalData: {
        city: "Osnabrück",
        dateOfBirth: "1990-01-01",
        firstName: "Ada",
        lastName: "Lovelace",
        phoneNumber: "0123456789",
        postalCode: "49074",
        street: "Teststr. 1",
      },
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
          phoneNumber: "0987654321",
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
      personalData: {
        dateOfBirth: "1975-05-20",
        firstName: "Grace",
        lastName: "Hopper",
        phoneNumber: "+491709999999",
      },
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    const atCalendar = await t.query(api.bookingSessions.getActiveForUser, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    expect(atCalendar?.state.step).toBe("existing-calendar-selection");
  });

  test("back navigation truncates new-patient flow so forward submission can advance again", async () => {
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
      personalData: {
        dateOfBirth: "1990-01-01",
        firstName: "Ada",
        lastName: "Lovelace",
        phoneNumber: "+491701234567",
      },
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

    await t.mutation(api.bookingSessions.goBackToStep, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
      targetStep: "new-data-sharing",
    });

    const afterBack = await t.query(api.bookingSessions.getActiveForUser, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    expect(afterBack?.state.step).toBe("new-data-sharing");

    await expect(
      t.mutation(api.bookingSessions.goBackToStep, {
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
        targetStep: "new-data-input",
      }),
    ).rejects.toThrow("cannot go back to the requested step");

    await t.mutation(api.bookingSessions.submitNewDataSharing, {
      dataSharingContacts: [],
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    const afterForward = await t.query(api.bookingSessions.getActiveForUser, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    expect(afterForward?.state.step).toBe("new-calendar-selection");
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
      personalData: {
        dateOfBirth: "1990-01-01",
        firstName: "Ada",
        lastName: "Lovelace",
        phoneNumber: "+491701234567",
      },
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

  test("back navigation truncates existing-patient flow so forward submission can advance again", async () => {
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
      personalData: {
        dateOfBirth: "1975-05-20",
        firstName: "Grace",
        lastName: "Hopper",
        phoneNumber: "+491709999999",
      },
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    const atCalendar = await t.query(api.bookingSessions.getActiveForUser, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    expect(atCalendar?.state.step).toBe("existing-calendar-selection");

    await t.mutation(api.bookingSessions.goBackToStep, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
      targetStep: "existing-data-input",
    });

    const afterBack = await t.query(api.bookingSessions.getActiveForUser, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    expect(afterBack?.state.step).toBe("existing-data-input");

    await expect(
      t.mutation(api.bookingSessions.goBackToStep, {
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
        targetStep: "existing-doctor-selection",
      }),
    ).rejects.toThrow("cannot go back to the requested step");

    await t.mutation(api.bookingSessions.submitExistingPatientData, {
      personalData: {
        dateOfBirth: "1975-05-20",
        firstName: "Grace",
        lastName: "Hopper",
        phoneNumber: "+491709999999",
      },
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    const afterForward = await t.query(api.bookingSessions.getActiveForUser, {
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });
    expect(afterForward?.state.step).toBe("existing-calendar-selection");
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
      personalData: {
        dateOfBirth: "1975-05-20",
        firstName: "Grace",
        lastName: "Hopper",
        phoneNumber: "+491709999999",
      },
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

  test("successful slot selection creates appointment and clears in-progress rows", async () => {
    const t = createAuthedTestContext("flow_booking_success");
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
      personalData: {
        dateOfBirth: "1975-05-20",
        firstName: "Grace",
        lastName: "Hopper",
        phoneNumber: "+491709999999",
      },
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
    expect(afterBooking).toBeNull();

    const persisted = await t.run(async (ctx) => ({
      appointment: await ctx.db.get("appointments", result.appointmentId),
      personalData: await ctx.db.query("bookingPersonalDataSteps").collect(),
      privacy: await ctx.db.query("bookingPrivacySteps").collect(),
    }));
    expect(persisted.appointment?.userId).toBeDefined();
    expect(persisted.personalData).toHaveLength(0);
    expect(persisted.privacy).toHaveLength(0);
  });
});
