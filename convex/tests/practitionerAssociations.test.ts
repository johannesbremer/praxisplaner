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
        createdAt: now,
        duration: 30,
        followUpPlan: [],
        lastModified: now,
        name: "Checkup",
        practiceId,
        ruleSetId,
      },
    );
    const patientId = await ctx.db.insert("patients", {
      createdAt: now,
      firstName: "Ada",
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

      const result = await t.mutation(
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

      const result = await t.mutation(
        api.migrationRehearsal.importLegacyBookingStepReplay,
        {
          practiceId,
          replayRows: [
            {
              createdAt: Date.now(),
              dataSharingContacts: [],
              locationName: "Dissen a.T.W.",
              personalData: {
                dateOfBirth: "1990-01-01",
                firstName: "Ada",
                lastName: "Lovelace",
                phoneNumber: "0123456789",
              },
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
      expect(result.skippedMissingAppointment).toBe(1);

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

      const result = await t.mutation(
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

  test("replay import preserves confirmation reason descriptions", async () => {
    const previousFlag = process.env["MIGRATION_REHEARSAL_ENABLED"];
    process.env["MIGRATION_REHEARSAL_ENABLED"] = "true";

    try {
      const t = createTestContext();
      const setup = await t.run(async (ctx) => {
        const now = BigInt(Date.now());
        const practiceId = await ctx.db.insert("practices", {
          name: "Reason Import Practice",
        });
        const ruleSetId = await ctx.db.insert("ruleSets", {
          createdAt: Date.now(),
          description: "Reason Import Rule Set",
          draftRevision: 0,
          practiceId,
          saved: true,
          version: 1,
        });
        const locationId = await insertSelfLineageEntity(ctx.db, "locations", {
          name: "Dissen a.T.W.",
          practiceId,
          ruleSetId,
        });
        const practitionerId = await insertSelfLineageEntity(
          ctx.db,
          "practitioners",
          {
            name: "Dr. J. Wedegärtner",
            practiceId,
            ruleSetId,
          },
        );
        const appointmentTypeId = await insertSelfLineageEntity(
          ctx.db,
          "appointmentTypes",
          {
            allowedPractitionerLineageKeys: [practitionerId],
            createdAt: now,
            duration: 20,
            followUpPlan: [],
            lastModified: now,
            name: "Akuttermin",
            practiceId,
            ruleSetId,
          },
        );
        const patientRowId = await ctx.db.insert("patients", {
          createdAt: now,
          firstName: "Ada",
          lastModified: now,
          lastName: "Lovelace",
          patientId: 123,
          practiceId,
          recordType: "pvs",
          searchFirstName: "ada",
          searchLastName: "lovelace",
        });
        const appointmentId = await ctx.db.insert("appointments", {
          appointmentTypeLineageKey: appointmentTypeId,
          appointmentTypeTitle: "Akuttermin",
          createdAt: now,
          end: "2026-01-02T08:20:00.000Z",
          lastModified: now,
          locationLineageKey: locationId,
          occupancyScope: {
            kind: "practitioner",
            practitionerLineageKey: practitionerId,
          },
          patientId: patientRowId,
          practiceId,
          start: "2026-01-02T08:00:00.000Z",
          title: "Akuttermin",
        });

        return {
          appointmentId,
          appointmentTypeId,
          locationId,
          practiceId,
          practitionerId,
          ruleSetId,
        };
      });

      const result = await t.mutation(
        api.migrationRehearsal.importLegacyBookingStepReplay,
        {
          practiceId: setup.practiceId,
          replayRows: [
            {
              bookedDurationMinutes: 20,
              createdAt: Date.now(),
              dataSharingContacts: [],
              locationName: "Dissen a.T.W.",
              personalData: {
                dateOfBirth: "1990-01-01",
                firstName: "Ada",
                lastName: "Lovelace",
                phoneNumber: "0123456789",
              },
              practitionerName: "Dr. J. Wedegärtner",
              pvsAppointmentStart: "2026-01-02T08:00:00.000Z",
              pvsAppointmentTypeTitle: "Akuttermin",
              pvsPatientNumber: 123,
              reasonDescription: "Rueckenschmerzen seit gestern",
              sessionStep: "existing-calendar-selection",
              source: "legacy-online",
              sourceSessionKey: "legacy-pocketbase:snapshot:reason-user",
              userAuthId: "legacy-pocketbase:reason-user",
              userEmail: "reason@example.com",
            },
          ],
          ruleSetId: setup.ruleSetId,
        },
      );

      expect(result.insertedSessions).toBe(1);

      const personalDataSteps = await t.run(async (ctx) =>
        ctx.db.query("bookingPersonalDataSteps").collect(),
      );
      expect(personalDataSteps).toHaveLength(1);
      const appointment = await t.run(async (ctx) =>
        ctx.db.get("appointments", setup.appointmentId),
      );
      expect(appointment?.title).toBe("Akuttermin");
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

      const first = await t.mutation(
        api.migrationRehearsal.importLegacyBookingStepReplay,
        {
          practiceId: setup.practiceA,
          replayRows: [replayRow],
          ruleSetId: setup.ruleSetA,
        },
      );
      const second = await t.mutation(
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
