import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api, internal } from "../_generated/api";
import schema from "../schema";
import { INVALID_TEMPORARY_PATIENT_MESSAGE } from "../temporaryPatients";
import { modules } from "./test.setup";

function createAuthedTestContext() {
  return convexTest(schema, modules).withIdentity({
    email: "patients@example.com",
    subject: "workos_patients",
  });
}

async function createPractice(t: ReturnType<typeof createAuthedTestContext>) {
  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", "workos_patients"))
      .first();
    if (existing) {
      return;
    }
    await ctx.db.insert("users", {
      authId: "workos_patients",
      createdAt: BigInt(Date.now()),
      email: "patients@example.com",
    });
  });
  return await t.mutation(
    internal.workosOrganizations.createPracticeForWorkOSOrganization,
    {
      name: "Patients Test Practice",
      organizationId: "org_test_patients",
      role: "owner",
      workOSUserId: "workos_patients",
    },
  );
}

describe("patients", () => {
  test("createOrUpdatePatient persists ISO birth dates unchanged", async () => {
    const t = createAuthedTestContext();
    const practiceId = await createPractice(t);

    const result = await t.mutation(api.patients.createOrUpdatePatient, {
      dateOfBirth: "1945-10-01",
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

  test("createOrUpdatePatient rejects legacy GDT birth date strings", async () => {
    const t = createAuthedTestContext();
    const practiceId = await createPractice(t);

    await expect(
      t.mutation(api.patients.createOrUpdatePatient, {
        dateOfBirth: "01101945",
        firstName: "Max",
        lastName: "Mustermann",
        patientId: 12345,
        practiceId,
      }),
    ).rejects.toThrow(
      'Patient dateOfBirth must be a valid YYYY-MM-DD string, got "01101945".',
    );
  });

  test("createTemporaryPatient trims persisted values", async () => {
    const t = createAuthedTestContext();
    const practiceId = await createPractice(t);

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
    const practiceId = await createPractice(t);

    await expect(
      t.mutation(api.patients.createTemporaryPatient, {
        name: " ".repeat(3),
        phoneNumber: "  +491701234567  ",
        practiceId,
      }),
    ).rejects.toThrow(INVALID_TEMPORARY_PATIENT_MESSAGE);

    await expect(
      t.mutation(api.patients.createTemporaryPatient, {
        name: "Alex Beispiel",
        phoneNumber: " ".repeat(3),
        practiceId,
      }),
    ).rejects.toThrow(INVALID_TEMPORARY_PATIENT_MESSAGE);
  });
});
