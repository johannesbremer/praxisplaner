import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "../_generated/api";
import schema from "../schema";
import { INVALID_TEMPORARY_PATIENT_MESSAGE } from "../temporaryPatients";
import { modules } from "./test.setup";

function createAuthedTestContext() {
  return convexTest(schema, modules).withIdentity({
    email: "patients@example.com",
    subject: "workos_patients",
  });
}

describe("patients", () => {
  test("createOrUpdatePatient normalizes GDT birth dates to ISO on ingestion", async () => {
    const t = createAuthedTestContext();
    const practiceId = await t.mutation(api.practices.createPractice, {
      name: "Patients Test Practice",
    });

    const result = await t.mutation(api.patients.createOrUpdatePatient, {
      dateOfBirth: "01101945",
      firstName: "Max",
      lastName: "Mustermann",
      patientId: 12345,
      practiceId,
    });

    const patient = await t.run(
      async (ctx) => await ctx.db.get("patients", result.convexPatientId),
    );

    expect(patient?.dateOfBirth).toBe("1945-10-01");
  });

  test("createTemporaryPatient trims persisted values", async () => {
    const t = createAuthedTestContext();
    const practiceId = await t.mutation(api.practices.createPractice, {
      name: "Patients Test Practice",
    });

    const patientId = await t.mutation(api.patients.createTemporaryPatient, {
      name: "  Alex Beispiel  ",
      phoneNumber: "  +491701234567  ",
      practiceId,
    });

    const patient = await t.run(
      async (ctx) => await ctx.db.get("patients", patientId),
    );

    expect(patient?.name).toBe("Alex Beispiel");
    expect(patient?.phoneNumber).toBe("+491701234567");
    expect(patient?.recordType).toBe("temporary");
  });

  test("createTemporaryPatient rejects blank values after trimming", async () => {
    const t = createAuthedTestContext();
    const practiceId = await t.mutation(api.practices.createPractice, {
      name: "Patients Test Practice",
    });

    await expect(
      t.mutation(api.patients.createTemporaryPatient, {
        name: "   ",
        phoneNumber: "  +491701234567  ",
        practiceId,
      }),
    ).rejects.toThrow(INVALID_TEMPORARY_PATIENT_MESSAGE);

    await expect(
      t.mutation(api.patients.createTemporaryPatient, {
        name: "Alex Beispiel",
        phoneNumber: "   ",
        practiceId,
      }),
    ).rejects.toThrow(INVALID_TEMPORARY_PATIENT_MESSAGE);
  });
});
