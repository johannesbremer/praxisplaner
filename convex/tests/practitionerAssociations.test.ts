import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";

import { api } from "../_generated/api";
import { getAppointmentPractitionerLineageKey } from "../appointmentOccupancy";
import { insertSelfLineageEntity } from "../lineage";
import {
  canonicalizeBookingIdentityPractitionerAssociations,
  derivePractitionerAssociationFromAppointmentHistory,
  resolvePreferredPractitionerAssociation,
  setPractitionerAssociation,
} from "../practitionerAssociations";
import schema from "../schema";
import { modules } from "./test.setup";

type TestContext = ReturnType<typeof createTestContext>;

function completePersonalData() {
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
  };
}

async function createAssociationFixture(t: TestContext) {
  return await t.run(async (ctx) => {
    const now = BigInt(Date.now());
    const practiceId = await ctx.db.insert("practices", {
      name: "Association Practice",
    });
    const ruleSetId = await ctx.db.insert("ruleSets", {
      createdAt: Date.now(),
      description: "Association Rule Set",
      draftRevision: 0,
      practiceId,
      saved: true,
      version: 1,
    });
    const locationId = await insertSelfLineageEntity(ctx.db, "locations", {
      name: "Main",
      practiceId,
      ruleSetId,
    });
    const firstPractitionerId = await insertSelfLineageEntity(
      ctx.db,
      "practitioners",
      {
        name: "Dr. First",
        practiceId,
        ruleSetId,
      },
    );
    const secondPractitionerId = await insertSelfLineageEntity(
      ctx.db,
      "practitioners",
      {
        name: "Dr. Second",
        practiceId,
        ruleSetId,
      },
    );
    const appointmentTypeId = await insertSelfLineageEntity(
      ctx.db,
      "appointmentTypes",
      {
        allowedPractitionerLineageKeys: [
          firstPractitionerId,
          secondPractitionerId,
        ],
        appointmentPlan: { steps: [] },
        createdAt: now,
        defaultOccupancy: { kind: "selectedPractitioner" },
        duration: 30,
        lastModified: now,
        name: "Checkup",
        practiceId,
        ruleSetId,
      },
    );
    const patientId = await ctx.db.insert("patients", {
      createdAt: now,
      firstName: "Ada",
      insuranceStatus: "unknown",
      lastModified: now,
      lastName: "Lovelace",
      patientId: 123,
      practiceId,
      recordType: "pvs",
      searchFirstName: "ada",
      searchLastName: "lovelace",
    });
    const bookingIdentityId = await ctx.db.insert("bookingIdentities", {
      createdAt: now,
      kind: "online",
      lastModified: now,
      practiceId,
      sourceIdentityId: "legacy-user-1",
      sourceSystem: "legacy-online",
    });

    return {
      appointmentTypeId,
      bookingIdentityId,
      firstPractitionerId,
      locationId,
      patientId,
      practiceId,
      ruleSetId,
      secondPractitionerId,
    };
  });
}

async function createMigrationManager(
  t: TestContext,
  practiceId: Id<"practices">,
  suffix: string,
) {
  const now = BigInt(Date.now());
  const subject = `migration-manager:${suffix}`;
  const email = `migration-manager-${suffix}@example.com`;

  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      authId: subject,
      createdAt: now,
      email,
    });
    await ctx.db.insert("organizationMembers", {
      createdAt: now,
      practiceId,
      role: "admin",
      userId,
    });
  });

  return t.withIdentity({ email, subject });
}

function createTestContext() {
  return convexTest(schema, modules);
}

async function insertAppointment(
  t: TestContext,
  args: {
    appointmentTypeLineageKey: Id<"appointmentTypes">;
    appointmentTypeTitle: string;
    index: number;
    locationLineageKey: Id<"locations">;
    patientId: Id<"patients">;
    practiceId: Id<"practices">;
    practitionerLineageKey?: Id<"practitioners">;
  },
) {
  await t.run(async (ctx) => {
    const now = BigInt(Date.now());
    const startHour = String(8 + args.index).padStart(2, "0");
    await ctx.db.insert("appointments", {
      appointmentTypeLineageKey: args.appointmentTypeLineageKey,
      appointmentTypeTitle: args.appointmentTypeTitle,
      createdAt: now,
      end: `2026-01-01T${startHour}:30:00.000Z`,
      lastModified: now,
      locationLineageKey: args.locationLineageKey,
      occupancyScope:
        args.practitionerLineageKey === undefined
          ? { calendarResourceColumn: "ekg", kind: "resource" }
          : {
              kind: "practitioner",
              practitionerLineageKey: args.practitionerLineageKey,
            },
      patientId: args.patientId,
      practiceId: args.practiceId,
      start: `2026-01-01T${startHour}:00:00.000Z`,
      title: args.appointmentTypeTitle,
    });
  });
}

describe("practitioner associations", () => {
  test("validates association subject and accepts patient, booking identity, or both", async () => {
    const t = createTestContext();
    const fixture = await createAssociationFixture(t);

    await expect(
      t.run(async (ctx) => {
        await setPractitionerAssociation(ctx.db, {
          now: BigInt(Date.now()),
          practiceId: fixture.practiceId,
          practitionerLineageKey: fixture.firstPractitionerId,
          precedencePolicy: "runtime",
          source: "manual",
        });
      }),
    ).rejects.toThrow(
      "Practitioner association requires a patient or booking identity.",
    );

    await t.run(async (ctx) => {
      await setPractitionerAssociation(ctx.db, {
        now: BigInt(Date.now()),
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
        practitionerLineageKey: fixture.firstPractitionerId,
        precedencePolicy: "runtime",
        source: "manual",
      });
      await setPractitionerAssociation(ctx.db, {
        bookingIdentityId: fixture.bookingIdentityId,
        now: BigInt(Date.now()),
        practiceId: fixture.practiceId,
        practitionerLineageKey: fixture.secondPractitionerId,
        precedencePolicy: "runtime",
        source: "legacy-baumdiagramm",
      });
      await setPractitionerAssociation(ctx.db, {
        bookingIdentityId: fixture.bookingIdentityId,
        now: BigInt(Date.now()),
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
        practitionerLineageKey: fixture.secondPractitionerId,
        precedencePolicy: "runtime",
        source: "manual",
      });
    });

    const rows = await t.run(async (ctx) =>
      ctx.db.query("practitionerAssociations").collect(),
    );
    expect(rows).toHaveLength(3);
  });

  test("identity linking supersedes booking-only rows and inserts canonical patient rows", async () => {
    const t = createTestContext();
    const fixture = await createAssociationFixture(t);

    await t.run(async (ctx) => {
      await setPractitionerAssociation(ctx.db, {
        bookingIdentityId: fixture.bookingIdentityId,
        now: BigInt(Date.now()),
        practiceId: fixture.practiceId,
        practitionerLineageKey: fixture.firstPractitionerId,
        precedencePolicy: "runtime",
        source: "legacy-baumdiagramm",
      });
      await canonicalizeBookingIdentityPractitionerAssociations(ctx.db, {
        bookingIdentityId: fixture.bookingIdentityId,
        now: BigInt(Date.now()),
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
        precedencePolicy: "runtime",
      });
    });

    const rows = await t.run(async (ctx) =>
      ctx.db.query("practitionerAssociations").collect(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.status === "active")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "superseded")).toHaveLength(1);

    const activeRow = rows.find((row) => row.status === "active");
    expect(activeRow?.patientId).toBe(fixture.patientId);
    expect(activeRow?.bookingIdentityId).toBe(fixture.bookingIdentityId);
  });

  test("read helper prefers patient association over booking-identity association", async () => {
    const t = createTestContext();
    const fixture = await createAssociationFixture(t);

    await t.run(async (ctx) => {
      await setPractitionerAssociation(ctx.db, {
        bookingIdentityId: fixture.bookingIdentityId,
        now: BigInt(Date.now()),
        practiceId: fixture.practiceId,
        practitionerLineageKey: fixture.secondPractitionerId,
        precedencePolicy: "runtime",
        source: "legacy-baumdiagramm",
      });
      await setPractitionerAssociation(ctx.db, {
        now: BigInt(Date.now()),
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
        practitionerLineageKey: fixture.firstPractitionerId,
        precedencePolicy: "runtime",
        source: "manual",
      });
    });

    const preferred = await t.run(async (ctx) =>
      resolvePreferredPractitionerAssociation(ctx.db, {
        bookingIdentityId: fixture.bookingIdentityId,
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
      }),
    );
    expect(preferred?.practitionerLineageKey).toBe(fixture.firstPractitionerId);
  });

  test("runtime online disagreement is recorded as rejected and does not replace manual truth", async () => {
    const t = createTestContext();
    const fixture = await createAssociationFixture(t);

    await t.run(async (ctx) => {
      await setPractitionerAssociation(ctx.db, {
        now: BigInt(Date.now()),
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
        practitionerLineageKey: fixture.firstPractitionerId,
        precedencePolicy: "runtime",
        source: "manual",
      });
      await setPractitionerAssociation(ctx.db, {
        bookingIdentityId: fixture.bookingIdentityId,
        now: BigInt(Date.now()),
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
        practitionerLineageKey: fixture.secondPractitionerId,
        precedencePolicy: "runtime",
        source: "legacy-baumdiagramm",
      });
    });

    const rows = await t.run(async (ctx) =>
      ctx.db.query("practitionerAssociations").collect(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.status === "active")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "rejected")).toHaveLength(1);

    const preferred = await t.run(async (ctx) =>
      resolvePreferredPractitionerAssociation(ctx.db, {
        bookingIdentityId: fixture.bookingIdentityId,
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
      }),
    );
    expect(preferred?.practitionerLineageKey).toBe(fixture.firstPractitionerId);
    expect(preferred?.source).toBe("manual");
  });

  test("import-time Baum-Diagramm supersedes appointment-history", async () => {
    const t = createTestContext();
    const fixture = await createAssociationFixture(t);

    await t.run(async (ctx) => {
      await setPractitionerAssociation(ctx.db, {
        now: BigInt(Date.now()),
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
        practitionerLineageKey: fixture.firstPractitionerId,
        precedencePolicy: "import",
        source: "appointment-history",
      });
      await setPractitionerAssociation(ctx.db, {
        bookingIdentityId: fixture.bookingIdentityId,
        now: BigInt(Date.now()),
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
        practitionerLineageKey: fixture.secondPractitionerId,
        precedencePolicy: "import",
        source: "legacy-baumdiagramm",
      });
    });

    const rows = await t.run(async (ctx) =>
      ctx.db.query("practitionerAssociations").collect(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.status === "active")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "superseded")).toHaveLength(1);

    const preferred = await t.run(async (ctx) =>
      resolvePreferredPractitionerAssociation(ctx.db, {
        bookingIdentityId: fixture.bookingIdentityId,
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
      }),
    );
    expect(preferred?.practitionerLineageKey).toBe(
      fixture.secondPractitionerId,
    );
    expect(preferred?.source).toBe("legacy-baumdiagramm");
  });

  test("replay import attaches practitioner associations through legacy user-linked booking identities", async () => {
    const previousFlag = process.env["MIGRATION_REHEARSAL_ENABLED"];
    process.env["MIGRATION_REHEARSAL_ENABLED"] = "true";

    try {
      const t = createTestContext();
      const { practiceId, ruleSetId, userAuthId } = await t.run(async (ctx) => {
        const now = BigInt(Date.now());
        const userId = await ctx.db.insert("users", {
          authId: "legacy-pocketbase:user-123",
          createdAt: now,
          email: "legacy@example.com",
          firstName: "Ada",
          lastName: "Lovelace",
        });
        const practiceId = await ctx.db.insert("practices", {
          name: "Replay Practice",
        });
        const ruleSetId = await ctx.db.insert("ruleSets", {
          createdAt: Date.now(),
          description: "Replay Rule Set",
          draftRevision: 0,
          practiceId,
          saved: true,
          version: 1,
        });
        await insertSelfLineageEntity(ctx.db, "locations", {
          name: "Dissen a.T.W.",
          practiceId,
          ruleSetId,
        });
        await insertSelfLineageEntity(ctx.db, "practitioners", {
          name: "Dr. J. Wedegärtner",
          practiceId,
          ruleSetId,
        });
        await ctx.db.insert("bookingIdentities", {
          createdAt: now,
          kind: "online",
          lastModified: now,
          practiceId,
          sourceIdentityId: "profile-456",
          sourceSystem: "legacy-online",
          userId,
        });

        return {
          practiceId,
          ruleSetId,
          userAuthId: "legacy-pocketbase:user-123",
        };
      });

      const manager = await createMigrationManager(
        t,
        practiceId,
        "linked-identity",
      );

      const result = await manager.mutation(
        api.migrationRehearsal.importLegacyBookingStepReplay,
        {
          practiceId,
          replayRows: [
            {
              createdAt: Date.now(),
              dataSharingContacts: [],
              locationName: "Dissen a.T.W.",
              practitionerName: "Dr. J. Wedegärtner",
              sessionStep: "existing-doctor-selection",
              source: "legacy-online",
              sourceSessionKey: "legacy-pocketbase:snapshot:user-123",
              userAuthId,
              userEmail: "legacy@example.com",
            },
          ],
          ruleSetId,
        },
      );

      expect(result.associatedPractitioners).toBe(1);

      const rows = await t.run(async (ctx) =>
        ctx.db.query("practitionerAssociations").collect(),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.bookingIdentityId).toBeDefined();
      expect(rows[0]?.source).toBe("legacy-baumdiagramm");
      expect(rows[0]?.status).toBe("active");
      expect(rows[0]?.practitionerLineageKey).toBeDefined();
    } finally {
      if (previousFlag === undefined) {
        delete process.env["MIGRATION_REHEARSAL_ENABLED"];
      } else {
        process.env["MIGRATION_REHEARSAL_ENABLED"] = previousFlag;
      }
    }
  });

  test("replay import skips existing-data-input rows with unresolved practitioners before inserting sessions", async () => {
    const previousFlag = process.env["MIGRATION_REHEARSAL_ENABLED"];
    process.env["MIGRATION_REHEARSAL_ENABLED"] = "true";

    try {
      const t = createTestContext();
      const { practiceId, ruleSetId, userAuthId } = await t.run(async (ctx) => {
        const practiceId = await ctx.db.insert("practices", {
          name: "Skip Practice",
        });
        const ruleSetId = await ctx.db.insert("ruleSets", {
          createdAt: Date.now(),
          description: "Skip Rule Set",
          draftRevision: 0,
          practiceId,
          saved: true,
          version: 1,
        });
        await insertSelfLineageEntity(ctx.db, "locations", {
          name: "Dissen a.T.W.",
          practiceId,
          ruleSetId,
        });

        return {
          practiceId,
          ruleSetId,
          userAuthId: "legacy-pocketbase:user-skip",
        };
      });

      const manager = await createMigrationManager(
        t,
        practiceId,
        "skip-unresolved",
      );

      const result = await manager.mutation(
        api.migrationRehearsal.importLegacyBookingStepReplay,
        {
          practiceId,
          replayRows: [
            {
              createdAt: Date.now(),
              dataSharingContacts: [],
              locationName: "Dissen a.T.W.",
              personalData: completePersonalData(),
              practitionerName: "Missing Practitioner",
              sessionStep: "existing-data-input",
              source: "legacy-online",
              sourceSessionKey: "legacy-pocketbase:snapshot:skip-user",
              userAuthId,
              userEmail: "skip@example.com",
            },
          ],
          ruleSetId,
        },
      );

      expect(result.insertedSessions).toBe(0);
      expect(result.skippedRows).toMatchObject([
        { reason: "missing_practitioner" },
      ]);

      const privacySteps = await t.run(async (ctx) =>
        ctx.db.query("bookingPrivacySteps").collect(),
      );
      expect(privacySteps).toHaveLength(0);
    } finally {
      if (previousFlag === undefined) {
        delete process.env["MIGRATION_REHEARSAL_ENABLED"];
      } else {
        process.env["MIGRATION_REHEARSAL_ENABLED"] = previousFlag;
      }
    }
  });

  test("replay import preserves missing privacy consent as false", async () => {
    const previousFlag = process.env["MIGRATION_REHEARSAL_ENABLED"];
    process.env["MIGRATION_REHEARSAL_ENABLED"] = "true";

    try {
      const t = createTestContext();
      const setup = await t.run(async (ctx) => {
        const practiceId = await ctx.db.insert("practices", {
          name: "Privacy Import Practice",
        });
        const ruleSetId = await ctx.db.insert("ruleSets", {
          createdAt: Date.now(),
          description: "Privacy Import Rule Set",
          draftRevision: 0,
          practiceId,
          saved: true,
          version: 1,
        });

        return { practiceId, ruleSetId };
      });

      const manager = await createMigrationManager(
        t,
        setup.practiceId,
        "privacy",
      );

      const result = await manager.mutation(
        api.migrationRehearsal.importLegacyBookingStepReplay,
        {
          practiceId: setup.practiceId,
          replayRows: [
            {
              createdAt: Date.now(),
              dataSharingContacts: [],
              sessionStep: "privacy",
              source: "legacy-online",
              sourceSessionKey: "legacy-pocketbase:snapshot:no-consent",
              userAuthId: "legacy-pocketbase:no-consent",
              userEmail: "no-consent@example.com",
            },
          ],
          ruleSetId: setup.ruleSetId,
        },
      );

      expect(result.insertedSessions).toBe(1);

      const privacySteps = await t.run(async (ctx) =>
        ctx.db.query("bookingPrivacySteps").collect(),
      );
      expect(privacySteps).toHaveLength(1);
      expect(privacySteps[0]?.consent).toBe(false);
    } finally {
      if (previousFlag === undefined) {
        delete process.env["MIGRATION_REHEARSAL_ENABLED"];
      } else {
        process.env["MIGRATION_REHEARSAL_ENABLED"] = previousFlag;
      }
    }
  });

  test("replay import stores existing personal data without advancing data-input rows", async () => {
    const previousFlag = process.env["MIGRATION_REHEARSAL_ENABLED"];
    process.env["MIGRATION_REHEARSAL_ENABLED"] = "true";

    try {
      const t = createTestContext();
      const { practiceId, ruleSetId, userAuthId } = await t.run(async (ctx) => {
        const practiceId = await ctx.db.insert("practices", {
          name: "Data Input Practice",
        });
        const ruleSetId = await ctx.db.insert("ruleSets", {
          createdAt: Date.now(),
          description: "Data Input Rule Set",
          draftRevision: 0,
          practiceId,
          saved: true,
          version: 1,
        });
        await insertSelfLineageEntity(ctx.db, "locations", {
          name: "Dissen a.T.W.",
          practiceId,
          ruleSetId,
        });
        await insertSelfLineageEntity(ctx.db, "practitioners", {
          name: "Dr. J. Wedegärtner",
          practiceId,
          ruleSetId,
        });

        return {
          practiceId,
          ruleSetId,
          userAuthId: "legacy-pocketbase:user-data-input",
        };
      });

      const manager = await createMigrationManager(
        t,
        practiceId,
        "personal-data",
      );

      const result = await manager.mutation(
        api.migrationRehearsal.importLegacyBookingStepReplay,
        {
          practiceId,
          replayRows: [
            {
              createdAt: Date.now(),
              dataSharingContacts: [],
              locationName: "Dissen a.T.W.",
              personalData: completePersonalData(),
              practitionerName: "Dr. J. Wedegärtner",
              sessionStep: "existing-data-input",
              source: "legacy-online",
              sourceSessionKey: "legacy-pocketbase:snapshot:data-input-user",
              userAuthId,
              userEmail: "data-input@example.com",
            },
          ],
          ruleSetId,
        },
      );

      expect(result.insertedSessions).toBe(1);

      const persisted = await t.run(async (ctx) => ({
        doctorSelections: await ctx.db
          .query("bookingExistingDoctorSelectionSteps")
          .collect(),
        personalData: await ctx.db.query("bookingPersonalDataSteps").collect(),
      }));
      expect(persisted.doctorSelections).toHaveLength(1);
      expect(persisted.personalData).toHaveLength(1);
    } finally {
      if (previousFlag === undefined) {
        delete process.env["MIGRATION_REHEARSAL_ENABLED"];
      } else {
        process.env["MIGRATION_REHEARSAL_ENABLED"] = previousFlag;
      }
    }
  });

  test("replay deduplication is scoped by practice", async () => {
    const previousFlag = process.env["MIGRATION_REHEARSAL_ENABLED"];
    process.env["MIGRATION_REHEARSAL_ENABLED"] = "true";

    try {
      const t = createTestContext();
      const setup = await t.run(async (ctx) => {
        const practiceA = await ctx.db.insert("practices", { name: "A" });
        const practiceB = await ctx.db.insert("practices", { name: "B" });
        const ruleSetA = await ctx.db.insert("ruleSets", {
          createdAt: Date.now(),
          description: "A",
          draftRevision: 0,
          practiceId: practiceA,
          saved: true,
          version: 1,
        });
        const ruleSetB = await ctx.db.insert("ruleSets", {
          createdAt: Date.now(),
          description: "B",
          draftRevision: 0,
          practiceId: practiceB,
          saved: true,
          version: 1,
        });
        await insertSelfLineageEntity(ctx.db, "locations", {
          name: "Dissen a.T.W.",
          practiceId: practiceA,
          ruleSetId: ruleSetA,
        });
        await insertSelfLineageEntity(ctx.db, "locations", {
          name: "Dissen a.T.W.",
          practiceId: practiceB,
          ruleSetId: ruleSetB,
        });

        return { practiceA, practiceB, ruleSetA, ruleSetB };
      });

      const replayRow = {
        createdAt: Date.now(),
        dataSharingContacts: [],
        locationName: "Dissen a.T.W.",
        sessionStep: "existing-doctor-selection" as const,
        source: "legacy-online" as const,
        sourceSessionKey: "legacy-pocketbase:snapshot:shared",
        userAuthId: "legacy-pocketbase:shared-user",
        userEmail: "shared@example.com",
      };

      const managerA = await createMigrationManager(
        t,
        setup.practiceA,
        "dedupe-a",
      );
      const managerB = await createMigrationManager(
        t,
        setup.practiceB,
        "dedupe-b",
      );

      const first = await managerA.mutation(
        api.migrationRehearsal.importLegacyBookingStepReplay,
        {
          practiceId: setup.practiceA,
          replayRows: [replayRow],
          ruleSetId: setup.ruleSetA,
        },
      );
      const second = await managerB.mutation(
        api.migrationRehearsal.importLegacyBookingStepReplay,
        {
          practiceId: setup.practiceB,
          replayRows: [replayRow],
          ruleSetId: setup.ruleSetB,
        },
      );

      expect(first.insertedSessions).toBe(1);
      expect(first.reusedSessions).toBe(0);
      expect(second.insertedSessions).toBe(1);
      expect(second.reusedSessions).toBe(0);

      const privacySteps = await t.run(async (ctx) =>
        ctx.db.query("bookingPrivacySteps").collect(),
      );
      expect(privacySteps).toHaveLength(2);
      expect(new Set(privacySteps.map((step) => step.practiceId))).toEqual(
        new Set([setup.practiceA, setup.practiceB]),
      );
    } finally {
      if (previousFlag === undefined) {
        delete process.env["MIGRATION_REHEARSAL_ENABLED"];
      } else {
        process.env["MIGRATION_REHEARSAL_ENABLED"] = previousFlag;
      }
    }
  });

  test("appointment-history derivation excludes low-signal and resource rows and skips ties", async () => {
    const t = createTestContext();
    const fixture = await createAssociationFixture(t);

    await insertAppointment(t, {
      appointmentTypeLineageKey: fixture.appointmentTypeId,
      appointmentTypeTitle: "Checkup",
      index: 0,
      locationLineageKey: fixture.locationId,
      patientId: fixture.patientId,
      practiceId: fixture.practiceId,
      practitionerLineageKey: fixture.firstPractitionerId,
    });
    await insertAppointment(t, {
      appointmentTypeLineageKey: fixture.appointmentTypeId,
      appointmentTypeTitle: "Magen-Darm",
      index: 1,
      locationLineageKey: fixture.locationId,
      patientId: fixture.patientId,
      practiceId: fixture.practiceId,
      practitionerLineageKey: fixture.secondPractitionerId,
    });
    await insertAppointment(t, {
      appointmentTypeLineageKey: fixture.appointmentTypeId,
      appointmentTypeTitle: "Erkältung",
      index: 2,
      locationLineageKey: fixture.locationId,
      patientId: fixture.patientId,
      practiceId: fixture.practiceId,
      practitionerLineageKey: fixture.secondPractitionerId,
    });
    await insertAppointment(t, {
      appointmentTypeLineageKey: fixture.appointmentTypeId,
      appointmentTypeTitle: "Checkup",
      index: 3,
      locationLineageKey: fixture.locationId,
      patientId: fixture.patientId,
      practiceId: fixture.practiceId,
    });

    const guess = await t.run(async (ctx) =>
      derivePractitionerAssociationFromAppointmentHistory(ctx.db, {
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
      }),
    );
    expect(guess).toEqual({
      appointmentCount: 1,
      practitionerLineageKey: fixture.firstPractitionerId,
    });

    await insertAppointment(t, {
      appointmentTypeLineageKey: fixture.appointmentTypeId,
      appointmentTypeTitle: "Checkup",
      index: 4,
      locationLineageKey: fixture.locationId,
      patientId: fixture.patientId,
      practiceId: fixture.practiceId,
      practitionerLineageKey: fixture.secondPractitionerId,
    });

    const tiedGuess = await t.run(async (ctx) =>
      derivePractitionerAssociationFromAppointmentHistory(ctx.db, {
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
      }),
    );
    expect(tiedGuess).toBeNull();
  });

  test("appointment-history derivation ignores resource occupancy", async () => {
    const t = createTestContext();
    const fixture = await createAssociationFixture(t);

    await insertAppointment(t, {
      appointmentTypeLineageKey: fixture.appointmentTypeId,
      appointmentTypeTitle: "Checkup",
      index: 0,
      locationLineageKey: fixture.locationId,
      patientId: fixture.patientId,
      practiceId: fixture.practiceId,
    });

    const appointment = await t.run(async (ctx) =>
      ctx.db.query("appointments").first(),
    );
    expect(
      getAppointmentPractitionerLineageKey(appointment?.occupancyScope),
    ).toBeUndefined();

    const guess = await t.run(async (ctx) =>
      derivePractitionerAssociationFromAppointmentHistory(ctx.db, {
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
      }),
    );
    expect(guess).toBeNull();
  });
});
