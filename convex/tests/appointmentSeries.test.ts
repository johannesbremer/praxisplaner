import { convexTest } from "convex-test";
import { Temporal } from "temporal-polyfill";
import { describe, expect, test } from "vitest";

import type { Doc, Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import { api } from "../_generated/api";
import { insertSelfLineageEntity } from "../lineage";
import schema from "../schema";
import { modules } from "./test.setup";
import { assertDefined } from "./test_utils";

const TIMEZONE = "Europe/Berlin";

type LineageTable = Extract<
  TableNames,
  "appointmentTypes" | "baseSchedules" | "locations" | "practitioners"
>;

function createAuthedTestContext() {
  return convexTest(schema, modules).withIdentity({
    email: "appointment-series@example.com",
    subject: "workos_appointment_series",
  });
}

async function createBasePractice(
  t: ReturnType<typeof createAuthedTestContext>,
) {
  await ensureProvisionedUser(t);
  const practiceId = await t.mutation(api.practices.createPractice, {
    name: "Appointment Series Test Practice",
  });

  return await t.run(async (ctx) => {
    const practice = await ctx.db.get("practices", practiceId);
    assertDefined(practice, "Practice should exist");
    assertDefined(
      practice.currentActiveRuleSetId,
      "Practice should have an active rule set",
    );

    const ruleSetId = practice.currentActiveRuleSetId;
    const locationId = await insertWithLineage(ctx, "locations", {
      name: "Main Location",
      practiceId,
      ruleSetId,
    });
    const practitionerId = await insertWithLineage(ctx, "practitioners", {
      name: "Dr. Chain",
      practiceId,
      ruleSetId,
    });

    for (const dayOfWeek of [1, 2, 3, 4, 5]) {
      await insertWithLineage(ctx, "baseSchedules", {
        dayOfWeek,
        endTime: "17:00",
        locationLineageKey: locationId,
        practiceId,
        practitionerLineageKey: practitionerId,
        ruleSetId,
        startTime: "08:00",
      });
    }

    return {
      locationId,
      practiceId,
      practitionerId,
      ruleSetId,
    };
  });
}

async function createPatient(
  t: ReturnType<typeof createAuthedTestContext>,
  args: {
    dateOfBirth?: string;
    patientId: number;
    practiceId: Id<"practices">;
  },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("patients", {
      createdAt: BigInt(Date.now()),
      ...(args.dateOfBirth && { dateOfBirth: args.dateOfBirth }),
      lastModified: BigInt(Date.now()),
      patientId: args.patientId,
      practiceId: args.practiceId,
      recordType: "pvs",
      searchFirstName: "",
      searchLastName: "",
    });
  });
}

async function createUser(
  t: ReturnType<typeof createAuthedTestContext>,
  authId: string,
  email: string,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      authId,
      createdAt: BigInt(Date.now()),
      email,
    });
  });
}

async function ensureProvisionedUser(
  t: ReturnType<typeof createAuthedTestContext>,
) {
  await t.run(async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const existingUser = users.find(
      (user) => user.authId === "workos_appointment_series",
    );

    if (existingUser) {
      return;
    }

    await ctx.db.insert("users", {
      authId: "workos_appointment_series",
      createdAt: BigInt(Date.now()),
      email: "appointment-series@example.com",
    });
  });
}

async function insertWithLineage<TableName extends LineageTable>(
  ctx: MutationCtx,
  table: TableName,
  value: Omit<Doc<TableName>, "_creationTime" | "_id" | "lineageKey">,
): Promise<Id<TableName>> {
  return (await insertSelfLineageEntity(
    ctx.db,
    table as never,
    value as never,
  )) as Id<TableName>;
}

function nextWeekday(weekday: number): Temporal.PlainDate {
  const today = Temporal.Now.plainDateISO(TIMEZONE);
  const delta = (weekday - today.dayOfWeek + 7) % 7;
  return today.add({ days: delta === 0 ? 7 : delta });
}

describe("appointment series", () => {
  test("createAppointmentType rejects follow-up plans with missing target lineage keys", async () => {
    const t = createAuthedTestContext();
    const { practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);
    const missingLineageKey = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const missingTargetId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 15,
        lastModified: now,
        name: "Gelöschter Folgetermin",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", missingTargetId, {
        lineageKey: missingTargetId,
      });
      await ctx.db.delete("appointmentTypes", missingTargetId);
      return missingTargetId;
    });

    await expect(
      t.mutation(api.entities.createAppointmentType, {
        duration: 30,
        expectedDraftRevision: null,
        followUpPlan: [
          {
            appointmentTypeLineageKey: missingLineageKey,
            locationMode: "inherit",
            offsetUnit: "days",
            offsetValue: 5,
            practitionerMode: "inherit",
            required: true,
            searchMode: "first_available_on_or_after",
            stepId: "step-1",
          },
        ],
        name: "Root",
        practiceId,
        practitionerIds: [practitionerId],
        selectedRuleSetId: ruleSetId,
      }),
    ).rejects.toThrow("FOLLOW_UP_PLAN:APPOINTMENT_TYPE_NOT_FOUND");
  });

  test("createAppointmentType applies offset validation per unit", async () => {
    const t = createAuthedTestContext();
    const { practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);

    const targetAppointmentTypeId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const targetId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 20,
        lastModified: now,
        name: "Kontrolle",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", targetId, {
        lineageKey: targetId,
      });
      return targetId;
    });

    await expect(
      t.mutation(api.entities.createAppointmentType, {
        duration: 30,
        expectedDraftRevision: null,
        followUpPlan: [
          {
            appointmentTypeLineageKey: targetAppointmentTypeId,
            locationMode: "inherit",
            offsetUnit: "minutes",
            offsetValue: 7,
            practitionerMode: "inherit",
            required: true,
            searchMode: "same_day",
            stepId: "step-1",
          },
        ],
        name: "Ungueltig Minuten",
        practiceId,
        practitionerIds: [practitionerId],
        selectedRuleSetId: ruleSetId,
      }),
    ).rejects.toThrow("FOLLOW_UP_PLAN:INVALID_OFFSET_STEP");

    await expect(
      t.mutation(api.entities.createAppointmentType, {
        duration: 30,
        expectedDraftRevision: null,
        followUpPlan: [
          {
            appointmentTypeLineageKey: targetAppointmentTypeId,
            locationMode: "inherit",
            offsetUnit: "days",
            offsetValue: 0,
            practitionerMode: "inherit",
            required: true,
            searchMode: "first_available_on_or_after",
            stepId: "step-1",
          },
        ],
        name: "Ungueltig Tage",
        practiceId,
        practitionerIds: [practitionerId],
        selectedRuleSetId: ruleSetId,
      }),
    ).rejects.toThrow("FOLLOW_UP_PLAN:INVALID_OFFSET");

    await expect(
      t.mutation(api.entities.createAppointmentType, {
        duration: 30,
        expectedDraftRevision: null,
        followUpPlan: [
          {
            appointmentTypeLineageKey: targetAppointmentTypeId,
            locationMode: "inherit",
            offsetUnit: "days",
            offsetValue: 1.5,
            practitionerMode: "inherit",
            required: true,
            searchMode: "first_available_on_or_after",
            stepId: "step-1",
          },
        ],
        name: "Ungueltig Kommazahl",
        practiceId,
        practitionerIds: [practitionerId],
        selectedRuleSetId: ruleSetId,
      }),
    ).rejects.toThrow("FOLLOW_UP_PLAN:INVALID_OFFSET");

    const validResult = await t.mutation(api.entities.createAppointmentType, {
      duration: 30,
      expectedDraftRevision: null,
      followUpPlan: [
        {
          appointmentTypeLineageKey: targetAppointmentTypeId,
          locationMode: "inherit",
          offsetUnit: "days",
          offsetValue: 3,
          practitionerMode: "inherit",
          required: true,
          searchMode: "first_available_on_or_after",
          stepId: "step-1",
        },
      ],
      name: "Gueltig Tage",
      practiceId,
      practitionerIds: [practitionerId],
      selectedRuleSetId: ruleSetId,
    });

    expect(validResult.entityId).toBeDefined();
  });

  test("previewAppointmentSeries scans period-based follow-ups top to bottom within the day", async () => {
    const t = createAuthedTestContext();
    const { locationId, practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);

    const { rootAppointmentTypeId, targetAppointmentTypeId } = await t.run(
      async (ctx) => {
        const now = BigInt(Date.now());
        const targetAppointmentTypeId = await ctx.db.insert(
          "appointmentTypes",
          {
            allowedPractitionerLineageKeys: [practitionerId],
            createdAt: now,
            duration: 20,
            lastModified: now,
            name: "Verbandwechsel",
            practiceId,
            ruleSetId,
          },
        );
        await ctx.db.patch("appointmentTypes", targetAppointmentTypeId, {
          lineageKey: targetAppointmentTypeId,
        });

        const rootAppointmentTypeId = await ctx.db.insert("appointmentTypes", {
          allowedPractitionerLineageKeys: [practitionerId],
          createdAt: now,
          duration: 30,
          followUpPlan: [
            {
              appointmentTypeLineageKey: targetAppointmentTypeId,
              locationMode: "inherit",
              offsetUnit: "days",
              offsetValue: 2,
              practitionerMode: "inherit",
              required: true,
              searchMode: "first_available_on_or_after",
              stepId: "step-1",
            },
          ],
          lastModified: now,
          name: "Ersttermin",
          practiceId,
          ruleSetId,
        });
        await ctx.db.patch("appointmentTypes", rootAppointmentTypeId, {
          lineageKey: rootAppointmentTypeId,
        });

        return {
          rootAppointmentTypeId,
          targetAppointmentTypeId,
        };
      },
    );

    const monday = nextWeekday(1);
    const rootStart = monday
      .toZonedDateTime({
        plainTime: { hour: 9, minute: 0 },
        timeZone: TIMEZONE,
      })
      .toString();

    const blockedFollowUpStart = monday
      .add({ days: 2 })
      .toZonedDateTime({
        plainTime: { hour: 9, minute: 30 },
        timeZone: TIMEZONE,
      })
      .toString();
    const blockedFollowUpEnd = Temporal.ZonedDateTime.from(blockedFollowUpStart)
      .add({ minutes: 30 })
      .toString();

    await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      await ctx.db.insert("appointments", {
        appointmentTypeLineageKey: targetAppointmentTypeId,
        appointmentTypeTitle: "Blocker",
        createdAt: now,
        end: blockedFollowUpEnd,
        lastModified: now,
        locationLineageKey: locationId,
        practiceId,
        practitionerLineageKey: practitionerId,
        start: blockedFollowUpStart,
        title: "Blockiert",
      });
    });

    const preview = await t.query(api.appointments.previewAppointmentSeries, {
      locationId,
      practiceId,
      practitionerId,
      rootAppointmentTypeId,
      ruleSetId,
      start: rootStart,
    });

    expect(preview.status).toBe("ready");
    expect(preview.steps).toHaveLength(2);
    expect(preview.steps[0]?.appointmentTypeId).toBe(rootAppointmentTypeId);
    expect(preview.steps[1]?.appointmentTypeId).toBe(targetAppointmentTypeId);
    const followUpStart = Temporal.ZonedDateTime.from(
      preview.steps[1]?.start ?? rootStart,
    );
    expect(followUpStart.toPlainDate().toString()).toBe(
      monday.add({ days: 2 }).toString(),
    );
    expect(followUpStart.toPlainTime().toString()).toBe("08:00:00");
  });

  test("previewAppointmentSeries searches month-based follow-ups from the target date onward", async () => {
    const t = createAuthedTestContext();
    const { locationId, practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);

    const rootAppointmentTypeId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const targetAppointmentTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 20,
        lastModified: now,
        name: "Kontrolle",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", targetAppointmentTypeId, {
        lineageKey: targetAppointmentTypeId,
      });

      const rootId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 30,
        followUpPlan: [
          {
            appointmentTypeLineageKey: targetAppointmentTypeId,
            locationMode: "inherit",
            offsetUnit: "months",
            offsetValue: 1,
            practitionerMode: "inherit",
            required: true,
            searchMode: "first_available_on_or_after",
            stepId: "step-1",
          },
        ],
        lastModified: now,
        name: "Ersttermin",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", rootId, {
        lineageKey: rootId,
      });

      return rootId;
    });

    const monday = nextWeekday(1);
    const rootStart = monday
      .toZonedDateTime({
        plainTime: { hour: 9, minute: 0 },
        timeZone: TIMEZONE,
      })
      .toString();

    const preview = await t.query(api.appointments.previewAppointmentSeries, {
      locationId,
      practiceId,
      practitionerId,
      rootAppointmentTypeId,
      ruleSetId,
      start: rootStart,
    });

    expect(preview.status).toBe("ready");
    const targetDate = Temporal.ZonedDateTime.from(rootStart)
      .add({
        months: 1,
      })
      .toPlainDate();
    const followUpDate = Temporal.ZonedDateTime.from(
      preview.steps[1]?.start ?? rootStart,
    ).toPlainDate();

    expect(
      Temporal.PlainDate.compare(followUpDate, targetDate),
    ).toBeGreaterThanOrEqual(0);
  });

  test("previewAppointmentSeries skips weekends for day-based follow-ups and uses the next working day", async () => {
    const t = createAuthedTestContext();
    const { locationId, practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);

    const rootAppointmentTypeId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const targetAppointmentTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 20,
        lastModified: now,
        name: "Kontrolle",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", targetAppointmentTypeId, {
        lineageKey: targetAppointmentTypeId,
      });

      const rootId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 30,
        followUpPlan: [
          {
            appointmentTypeLineageKey: targetAppointmentTypeId,
            locationMode: "inherit",
            offsetUnit: "days",
            offsetValue: 1,
            practitionerMode: "inherit",
            required: true,
            searchMode: "first_available_on_or_after",
            stepId: "step-1",
          },
        ],
        lastModified: now,
        name: "Ersttermin",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", rootId, {
        lineageKey: rootId,
      });

      return rootId;
    });

    const fridayRootStart = Temporal.PlainDate.from("2026-03-06")
      .toZonedDateTime({
        plainTime: { hour: 9, minute: 0 },
        timeZone: TIMEZONE,
      })
      .toString();

    const preview = await t.query(api.appointments.previewAppointmentSeries, {
      locationId,
      practiceId,
      practitionerId,
      rootAppointmentTypeId,
      ruleSetId,
      start: fridayRootStart,
    });

    expect(preview.status).toBe("ready");
    expect(
      Temporal.ZonedDateTime.from(preview.steps[1]?.start ?? fridayRootStart)
        .toPlainDate()
        .toString(),
    ).toBe("2026-03-09");
  });

  test("previewAppointmentSeries skips public holidays for day-based follow-ups and uses the next working day", async () => {
    const t = createAuthedTestContext();
    const { locationId, practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);

    const rootAppointmentTypeId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const targetAppointmentTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 20,
        lastModified: now,
        name: "Kontrolle",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", targetAppointmentTypeId, {
        lineageKey: targetAppointmentTypeId,
      });

      const rootId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 30,
        followUpPlan: [
          {
            appointmentTypeLineageKey: targetAppointmentTypeId,
            locationMode: "inherit",
            offsetUnit: "days",
            offsetValue: 1,
            practitionerMode: "inherit",
            required: true,
            searchMode: "first_available_on_or_after",
            stepId: "step-1",
          },
        ],
        lastModified: now,
        name: "Ersttermin",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", rootId, {
        lineageKey: rootId,
      });

      return rootId;
    });

    const rootStart = Temporal.PlainDate.from("2026-05-13")
      .toZonedDateTime({
        plainTime: { hour: 9, minute: 0 },
        timeZone: TIMEZONE,
      })
      .toString();

    const preview = await t.query(api.appointments.previewAppointmentSeries, {
      locationId,
      practiceId,
      practitionerId,
      rootAppointmentTypeId,
      ruleSetId,
      start: rootStart,
    });

    expect(preview.status).toBe("ready");
    expect(
      Temporal.ZonedDateTime.from(preview.steps[1]?.start ?? rootStart)
        .toPlainDate()
        .toString(),
    ).toBe("2026-05-15");
  });

  test("createAppointmentSeries fails atomically when a required follow-up slot cannot be found", async () => {
    const t = createAuthedTestContext();
    const { locationId, practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);
    const userId = await createUser(
      t,
      "workos_series_user",
      "series-user@example.com",
    );

    const rootAppointmentTypeId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const targetAppointmentTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 30,
        lastModified: now,
        name: "Kontrolle",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", targetAppointmentTypeId, {
        lineageKey: targetAppointmentTypeId,
      });

      const rootAppointmentTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 30,
        followUpPlan: [
          {
            appointmentTypeLineageKey: targetAppointmentTypeId,
            locationMode: "inherit",
            offsetUnit: "minutes",
            offsetValue: 0,
            practitionerMode: "inherit",
            required: true,
            searchMode: "exact_after_previous",
            stepId: "step-1",
          },
        ],
        lastModified: now,
        name: "Spättermin",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", rootAppointmentTypeId, {
        lineageKey: rootAppointmentTypeId,
      });

      return rootAppointmentTypeId;
    });

    const monday = nextWeekday(1);
    const rootStart = monday
      .toZonedDateTime({
        plainTime: { hour: 16, minute: 45 },
        timeZone: TIMEZONE,
      })
      .toString();

    const preview = await t.query(api.appointments.previewAppointmentSeries, {
      locationId,
      practiceId,
      practitionerId,
      rootAppointmentTypeId,
      ruleSetId,
      start: rootStart,
      userId,
    });

    expect(preview.status).toBe("blocked");
    expect(preview.blockedStepId).toBe("step-1");

    await expect(
      t.mutation(api.appointments.createAppointmentSeries, {
        locationId,
        practiceId,
        practitionerId,
        rootAppointmentTypeId,
        rootTitle: "Spättermin",
        ruleSetId,
        start: rootStart,
        userId,
      }),
    ).rejects.toThrow("Kein verfügbarer Kettentermin");

    const appointments = await t.run(async (ctx) => {
      return await ctx.db
        .query("appointments")
        .withIndex("by_practiceId", (q) => q.eq("practiceId", practiceId))
        .collect();
    });

    expect(appointments).toHaveLength(0);
  });

  test("previewAppointmentSeries blocks immediately when an inherited practitioner is not allowed for the follow-up type", async () => {
    const t = createAuthedTestContext();
    const { locationId, practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);

    const rootAppointmentTypeId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const otherPractitionerId = await insertWithLineage(
        ctx,
        "practitioners",
        {
          name: "Dr. Follow Up Only",
          practiceId,
          ruleSetId,
        },
      );

      for (const dayOfWeek of [1, 2, 3, 4, 5]) {
        await insertWithLineage(ctx, "baseSchedules", {
          dayOfWeek,
          endTime: "17:00",
          locationLineageKey: locationId,
          practiceId,
          practitionerLineageKey: otherPractitionerId,
          ruleSetId,
          startTime: "08:00",
        });
      }

      const targetAppointmentTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [otherPractitionerId],
        createdAt: now,
        duration: 30,
        lastModified: now,
        name: "Nur anderer Behandler",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", targetAppointmentTypeId, {
        lineageKey: targetAppointmentTypeId,
      });

      const rootId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 30,
        followUpPlan: [
          {
            appointmentTypeLineageKey: targetAppointmentTypeId,
            locationMode: "inherit",
            offsetUnit: "days",
            offsetValue: 1,
            practitionerMode: "inherit",
            required: true,
            searchMode: "first_available_on_or_after",
            stepId: "step-1",
          },
        ],
        lastModified: now,
        name: "Root",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", rootId, {
        lineageKey: rootId,
      });

      return rootId;
    });

    const monday = nextWeekday(1);
    const rootStart = monday
      .toZonedDateTime({
        plainTime: { hour: 9, minute: 0 },
        timeZone: TIMEZONE,
      })
      .toString();

    const preview = await t.query(api.appointments.previewAppointmentSeries, {
      locationId,
      practiceId,
      practitionerId,
      rootAppointmentTypeId,
      ruleSetId,
      start: rootStart,
    });

    expect(preview.status).toBe("blocked");
    expect(preview.blockedStepId).toBe("step-1");
    expect(preview.steps).toHaveLength(1);
    expect(preview.failureMessage).toContain("Kein verfügbarer Kettentermin");
  });

  test("copied draft series booking still blocks occupied root slots by lineage", async () => {
    const t = createAuthedTestContext();
    const {
      locationId: activeLocationId,
      practiceId,
      practitionerId: activePractitionerId,
      ruleSetId: activeRuleSetId,
    } = await createBasePractice(t);
    const userId = await createUser(
      t,
      "workos_copied_draft_series_user",
      "copied-draft-series@example.com",
    );

    const {
      draftLocationId,
      draftPractitionerId,
      draftRootAppointmentTypeId,
      draftRuleSetId,
      rootAppointmentTypeLineageKey,
    } = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const targetAppointmentTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [activePractitionerId],
        createdAt: now,
        duration: 30,
        lastModified: now,
        name: "Kontrolle",
        practiceId,
        ruleSetId: activeRuleSetId,
      });
      await ctx.db.patch("appointmentTypes", targetAppointmentTypeId, {
        lineageKey: targetAppointmentTypeId,
      });

      const rootAppointmentTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [activePractitionerId],
        createdAt: now,
        duration: 30,
        followUpPlan: [
          {
            appointmentTypeLineageKey: targetAppointmentTypeId,
            locationMode: "inherit",
            offsetUnit: "days",
            offsetValue: 2,
            practitionerMode: "inherit",
            required: true,
            searchMode: "first_available_on_or_after",
            stepId: "step-1",
          },
        ],
        lastModified: now,
        name: "Ersttermin",
        practiceId,
        ruleSetId: activeRuleSetId,
      });
      await ctx.db.patch("appointmentTypes", rootAppointmentTypeId, {
        lineageKey: rootAppointmentTypeId,
      });

      const draftRuleSetId = await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Copied Draft",
        draftRevision: 0,
        parentVersion: activeRuleSetId,
        practiceId,
        saved: false,
        version: 2,
      });

      const draftLocationId = await ctx.db.insert("locations", {
        lineageKey: activeLocationId,
        name: "Main Location Copy",
        practiceId,
        ruleSetId: draftRuleSetId,
      });
      const draftPractitionerId = await ctx.db.insert("practitioners", {
        lineageKey: activePractitionerId,
        name: "Dr. Chain Copy",
        practiceId,
        ruleSetId: draftRuleSetId,
      });

      for (const dayOfWeek of [1, 2, 3, 4, 5]) {
        await insertWithLineage(ctx, "baseSchedules", {
          dayOfWeek,
          endTime: "17:00",
          locationLineageKey: draftLocationId,
          practiceId,
          practitionerLineageKey: draftPractitionerId,
          ruleSetId: draftRuleSetId,
          startTime: "08:00",
        });
      }

      await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [activePractitionerId],
        createdAt: now,
        duration: 30,
        lastModified: now,
        lineageKey: targetAppointmentTypeId,
        name: "Kontrolle Copy",
        practiceId,
        ruleSetId: draftRuleSetId,
      });

      const draftRootAppointmentTypeId = await ctx.db.insert(
        "appointmentTypes",
        {
          allowedPractitionerLineageKeys: [activePractitionerId],
          createdAt: now,
          duration: 30,
          followUpPlan: [
            {
              appointmentTypeLineageKey: targetAppointmentTypeId,
              locationMode: "inherit",
              offsetUnit: "days",
              offsetValue: 2,
              practitionerMode: "inherit",
              required: true,
              searchMode: "first_available_on_or_after",
              stepId: "step-1",
            },
          ],
          lastModified: now,
          lineageKey: rootAppointmentTypeId,
          name: "Ersttermin Copy",
          practiceId,
          ruleSetId: draftRuleSetId,
        },
      );

      return {
        draftLocationId,
        draftPractitionerId,
        draftRootAppointmentTypeId,
        draftRuleSetId,
        rootAppointmentTypeLineageKey: rootAppointmentTypeId,
      };
    });

    const monday = nextWeekday(1);
    const rootStart = monday
      .toZonedDateTime({
        plainTime: { hour: 9, minute: 0 },
        timeZone: TIMEZONE,
      })
      .toString();
    const rootEnd = Temporal.ZonedDateTime.from(rootStart)
      .add({ minutes: 30 })
      .toString();

    await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      await ctx.db.insert("appointments", {
        appointmentTypeLineageKey: rootAppointmentTypeLineageKey,
        appointmentTypeTitle: "Bestehender Termin",
        createdAt: now,
        end: rootEnd,
        lastModified: now,
        locationLineageKey: activeLocationId,
        practiceId,
        practitionerLineageKey: activePractitionerId,
        start: rootStart,
        title: "Bereits gebucht",
        userId,
      });
    });

    const preview = await t.query(api.appointments.previewAppointmentSeries, {
      locationId: draftLocationId,
      practiceId,
      practitionerId: draftPractitionerId,
      rootAppointmentTypeId: draftRootAppointmentTypeId,
      ruleSetId: draftRuleSetId,
      scope: "simulation",
      simulationRuleSetId: draftRuleSetId,
      start: rootStart,
      userId,
    });

    expect(preview.status).toBe("blocked");
    expect(preview.blockedStepId).toBe("root");

    await expect(
      t.mutation(api.appointments.createAppointmentSeries, {
        locationId: draftLocationId,
        practiceId,
        practitionerId: draftPractitionerId,
        rootAppointmentTypeId: draftRootAppointmentTypeId,
        rootTitle: "Draft chain",
        ruleSetId: draftRuleSetId,
        scope: "simulation",
        simulationRuleSetId: draftRuleSetId,
        start: rootStart,
        userId,
      }),
    ).rejects.toThrow("Der ausgewählte Starttermin ist nicht mehr verfügbar");
  });

  test("createAppointment routes simulation bookings with follow-up plans through the same series path", async () => {
    const t = createAuthedTestContext();
    const { locationId, practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);

    const rootAppointmentTypeId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const targetAppointmentTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 30,
        lastModified: now,
        name: "Kontrolle",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", targetAppointmentTypeId, {
        lineageKey: targetAppointmentTypeId,
      });

      const rootAppointmentTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 30,
        followUpPlan: [
          {
            appointmentTypeLineageKey: targetAppointmentTypeId,
            locationMode: "inherit",
            offsetUnit: "minutes",
            offsetValue: 0,
            practitionerMode: "inherit",
            required: true,
            searchMode: "exact_after_previous",
            stepId: "step-1",
          },
        ],
        lastModified: now,
        name: "Ersttermin",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", rootAppointmentTypeId, {
        lineageKey: rootAppointmentTypeId,
      });

      return rootAppointmentTypeId;
    });

    const monday = nextWeekday(1);
    const rootStart = monday
      .toZonedDateTime({
        plainTime: { hour: 9, minute: 0 },
        timeZone: TIMEZONE,
      })
      .toString();
    const patientId = await createPatient(t, {
      patientId: 9001,
      practiceId,
    });

    await t.mutation(api.appointments.createAppointment, {
      appointmentTypeId: rootAppointmentTypeId,
      isSimulation: true,
      locationId,
      patientId,
      practiceId,
      practitionerId,
      start: rootStart,
      title: "Simulierter Kettentermin",
    });

    const appointments = await t.run(async (ctx) => {
      return await ctx.db
        .query("appointments")
        .withIndex("by_practiceId", (q) => q.eq("practiceId", practiceId))
        .collect();
    });

    expect(appointments).toHaveLength(2);
    expect(appointments.every((appointment) => appointment.isSimulation)).toBe(
      true,
    );
    expect(
      appointments.every(
        (appointment) => appointment.simulationKind === "draft",
      ),
    ).toBe(true);
    expect(
      appointments.every(
        (appointment) => appointment.simulationRuleSetId === ruleSetId,
      ),
    ).toBe(true);
    expect(
      appointments.every(
        (appointment) => appointment.simulationValidatedAt !== undefined,
      ),
    ).toBe(true);
    expect(
      new Set(appointments.map((appointment) => appointment.seriesId)).size,
    ).toBe(1);
    expect(
      appointments
        .map((appointment) => appointment.seriesStepIndex)
        .toSorted((left, right) => Number(left ?? 0n) - Number(right ?? 0n)),
    ).toEqual([0n, 1n]);
  });

  test("createAppointment routes real bookings with follow-up plans through the same series path", async () => {
    const t = createAuthedTestContext();
    const { locationId, practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);
    const userId = await createUser(
      t,
      "workos_real_series_user",
      "real-series-user@example.com",
    );

    const rootAppointmentTypeId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const targetAppointmentTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 30,
        lastModified: now,
        name: "Kontrolle",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", targetAppointmentTypeId, {
        lineageKey: targetAppointmentTypeId,
      });

      const rootId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 30,
        followUpPlan: [
          {
            appointmentTypeLineageKey: targetAppointmentTypeId,
            locationMode: "inherit",
            offsetUnit: "days",
            offsetValue: 2,
            practitionerMode: "inherit",
            required: true,
            searchMode: "first_available_on_or_after",
            stepId: "step-1",
          },
        ],
        lastModified: now,
        name: "Ersttermin",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", rootId, {
        lineageKey: rootId,
      });

      return rootId;
    });

    const monday = nextWeekday(1);
    const rootStart = monday
      .toZonedDateTime({
        plainTime: { hour: 9, minute: 0 },
        timeZone: TIMEZONE,
      })
      .toString();

    await t.mutation(api.appointments.createAppointment, {
      appointmentTypeId: rootAppointmentTypeId,
      locationId,
      practiceId,
      practitionerId,
      start: rootStart,
      title: "Realer Kettentermin",
      userId,
    });

    const appointments = await t.run(async (ctx) => {
      return await ctx.db
        .query("appointments")
        .withIndex("by_practiceId", (q) => q.eq("practiceId", practiceId))
        .collect();
    });
    const seriesRecord = await t.run(async (ctx) => {
      return await ctx.db.query("appointmentSeries").first();
    });

    expect(appointments).toHaveLength(2);
    expect(
      new Set(appointments.map((appointment) => appointment.seriesId)).size,
    ).toBe(1);
    expect(seriesRecord?.rootAppointmentId).toBeDefined();
  });

  test("updateAppointmentType clears follow-up plans without patching undefined", async () => {
    const t = createAuthedTestContext();
    const { practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);

    const targetAppointmentTypeId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const targetId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 20,
        lastModified: now,
        name: "Kontrolle",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", targetId, {
        lineageKey: targetId,
      });
      return targetId;
    });

    const created = await t.mutation(api.entities.createAppointmentType, {
      duration: 30,
      expectedDraftRevision: null,
      followUpPlan: [
        {
          appointmentTypeLineageKey: targetAppointmentTypeId,
          locationMode: "inherit",
          offsetUnit: "days",
          offsetValue: 5,
          practitionerMode: "inherit",
          required: true,
          searchMode: "first_available_on_or_after",
          stepId: "step-1",
        },
      ],
      name: "Root",
      practiceId,
      practitionerIds: [practitionerId],
      selectedRuleSetId: ruleSetId,
    });

    await t.mutation(api.entities.updateAppointmentType, {
      appointmentTypeId: created.entityId,
      expectedDraftRevision: created.draftRevision,
      followUpPlan: [],
      practiceId,
      selectedRuleSetId: created.ruleSetId,
    });

    const updatedAppointmentType = await t.run(async (ctx) => {
      return await ctx.db.get("appointmentTypes", created.entityId);
    });

    expect(updatedAppointmentType?.followUpPlan).toEqual([]);
  });

  test("createAppointmentType allows an empty practitioner allowlist", async () => {
    const t = createAuthedTestContext();
    const { practiceId, ruleSetId } = await createBasePractice(t);

    const created = await t.mutation(api.entities.createAppointmentType, {
      duration: 30,
      expectedDraftRevision: null,
      name: "Ohne Behandler",
      practiceId,
      practitionerIds: [],
      selectedRuleSetId: ruleSetId,
    });

    const createdAppointmentType = await t.run(async (ctx) => {
      return await ctx.db.get("appointmentTypes", created.entityId);
    });

    expect(createdAppointmentType?.allowedPractitionerLineageKeys).toEqual([]);
  });

  test("updateAppointmentType allows clearing the practitioner allowlist", async () => {
    const t = createAuthedTestContext();
    const { practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);

    const created = await t.mutation(api.entities.createAppointmentType, {
      duration: 30,
      expectedDraftRevision: null,
      name: "Mit Behandler",
      practiceId,
      practitionerIds: [practitionerId],
      selectedRuleSetId: ruleSetId,
    });

    await t.mutation(api.entities.updateAppointmentType, {
      appointmentTypeId: created.entityId,
      expectedDraftRevision: created.draftRevision,
      practiceId,
      practitionerIds: [],
      selectedRuleSetId: created.ruleSetId,
    });

    const updatedAppointmentType = await t.run(async (ctx) => {
      return await ctx.db.get("appointmentTypes", created.entityId);
    });

    expect(updatedAppointmentType?.allowedPractitionerLineageKeys).toEqual([]);
  });

  test("updating or deleting the root appointment applies to the whole series", async () => {
    const t = createAuthedTestContext();
    const { locationId, practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);
    const userId = await createUser(
      t,
      "workos_series_root_user",
      "series-root@example.com",
    );

    const rootAppointmentTypeId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const targetAppointmentTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 30,
        lastModified: now,
        name: "Kontrolle",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", targetAppointmentTypeId, {
        lineageKey: targetAppointmentTypeId,
      });

      const rootId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 30,
        followUpPlan: [
          {
            appointmentTypeLineageKey: targetAppointmentTypeId,
            locationMode: "inherit",
            offsetUnit: "days",
            offsetValue: 2,
            practitionerMode: "inherit",
            required: true,
            searchMode: "first_available_on_or_after",
            stepId: "step-1",
          },
        ],
        lastModified: now,
        name: "Ersttermin",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", rootId, {
        lineageKey: rootId,
      });

      return rootId;
    });

    const monday = nextWeekday(1);
    const rootStart = monday
      .toZonedDateTime({
        plainTime: { hour: 9, minute: 0 },
        timeZone: TIMEZONE,
      })
      .toString();

    const createdSeries = await t.mutation(
      api.appointments.createAppointmentSeries,
      {
        locationId,
        practiceId,
        practitionerId,
        rootAppointmentTypeId,
        rootTitle: "Ersttermin",
        ruleSetId,
        start: rootStart,
        userId,
      },
    );

    const storedSeries = await t.run(async (ctx) => {
      return await ctx.db
        .query("appointmentSeries")
        .withIndex("by_seriesId", (q) =>
          q.eq("seriesId", createdSeries.seriesId),
        )
        .first();
    });

    expect(storedSeries?.rootAppointmentId).toBe(
      createdSeries.rootAppointmentId,
    );
    expect(storedSeries?.followUpPlanSnapshot).toHaveLength(1);

    const shiftedRootStart = Temporal.ZonedDateTime.from(rootStart)
      .add({ days: 1 })
      .toString();
    const shiftedRootEnd = Temporal.ZonedDateTime.from(rootStart)
      .add({ days: 1, minutes: 45 })
      .toString();

    await t.mutation(api.appointments.updateAppointment, {
      end: shiftedRootEnd,
      id: createdSeries.rootAppointmentId,
      start: shiftedRootStart,
    });

    const updatedAppointments = await t.run(async (ctx) => {
      return await ctx.db
        .query("appointments")
        .withIndex("by_seriesId", (q) =>
          q.eq("seriesId", createdSeries.seriesId),
        )
        .collect();
    });
    const sortedUpdatedAppointments = updatedAppointments.toSorted(
      (left, right) =>
        Number(left.seriesStepIndex ?? 0n) -
        Number(right.seriesStepIndex ?? 0n),
    );

    expect(sortedUpdatedAppointments).toHaveLength(2);
    expect(sortedUpdatedAppointments[0]?.start).toBe(shiftedRootStart);
    expect(
      calculateDurationMinutes(
        sortedUpdatedAppointments[0]?.end ?? shiftedRootEnd,
        sortedUpdatedAppointments[0]?.start ?? shiftedRootStart,
      ),
    ).toBe(45);
    expect(
      calculateDurationMinutes(
        sortedUpdatedAppointments[1]?.end ?? shiftedRootStart,
        sortedUpdatedAppointments[1]?.start ?? shiftedRootStart,
      ),
    ).toBe(30);
    expect(
      Temporal.ZonedDateTime.from(
        sortedUpdatedAppointments[1]?.start ?? shiftedRootStart,
      )
        .toPlainDate()
        .toString(),
    ).toBe(monday.add({ days: 3 }).toString());

    await t.mutation(api.appointments.deleteAppointment, {
      id: createdSeries.rootAppointmentId,
    });

    const remainingAppointments = await t.run(async (ctx) => {
      return await ctx.db
        .query("appointments")
        .withIndex("by_seriesId", (q) =>
          q.eq("seriesId", createdSeries.seriesId),
        )
        .collect();
    });
    expect(remainingAppointments).toHaveLength(0);
  });

  test("updating a non-root series appointment is rejected", async () => {
    const t = createAuthedTestContext();
    const { locationId, practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);
    const userId = await createUser(
      t,
      "workos_series_update_user",
      "series-update@example.com",
    );

    const rootAppointmentTypeId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const followUpTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 30,
        lastModified: now,
        name: "Kontrolle",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", followUpTypeId, {
        lineageKey: followUpTypeId,
      });

      const rootId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 30,
        followUpPlan: [
          {
            appointmentTypeLineageKey: followUpTypeId,
            locationMode: "inherit",
            offsetUnit: "days",
            offsetValue: 2,
            practitionerMode: "inherit",
            required: true,
            searchMode: "first_available_on_or_after",
            stepId: "step-1",
          },
        ],
        lastModified: now,
        name: "Ersttermin",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", rootId, {
        lineageKey: rootId,
      });

      return rootId;
    });

    const monday = nextWeekday(1);
    const rootStart = monday
      .toZonedDateTime({
        plainTime: { hour: 9, minute: 0 },
        timeZone: TIMEZONE,
      })
      .toString();
    const createdSeries = await t.mutation(
      api.appointments.createAppointmentSeries,
      {
        locationId,
        practiceId,
        practitionerId,
        rootAppointmentTypeId,
        rootTitle: "Ersttermin",
        ruleSetId,
        start: rootStart,
        userId,
      },
    );

    const followUpAppointmentId = createdSeries.steps[1]?.appointmentId;
    expect(followUpAppointmentId).toBeDefined();
    if (!followUpAppointmentId) {
      throw new Error("Follow-up appointment should exist");
    }

    await expect(
      t.mutation(api.appointments.updateAppointment, {
        id: followUpAppointmentId,
        start: Temporal.ZonedDateTime.from(
          createdSeries.steps[1]?.start ?? rootStart,
        )
          .add({ hours: 1 })
          .toString(),
      }),
    ).rejects.toThrow("CHAIN_NON_ROOT_UPDATE_FORBIDDEN");
  });

  test("updating a root series appointment with a different patient refreshes the stored patient DOB", async () => {
    const t = createAuthedTestContext();
    const { locationId, practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);
    const userId = await createUser(
      t,
      "workos_series_patient_user",
      "series-patient@example.com",
    );
    const originalPatientId = await createPatient(t, {
      dateOfBirth: "1980-01-01",
      patientId: 1001,
      practiceId,
    });
    const replacementPatientId = await createPatient(t, {
      dateOfBirth: "2015-05-05",
      patientId: 1002,
      practiceId,
    });

    const rootAppointmentTypeId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const followUpTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 30,
        lastModified: now,
        name: "Kontrolle",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", followUpTypeId, {
        lineageKey: followUpTypeId,
      });

      const rootId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 30,
        followUpPlan: [
          {
            appointmentTypeLineageKey: followUpTypeId,
            locationMode: "inherit",
            offsetUnit: "days",
            offsetValue: 2,
            practitionerMode: "inherit",
            required: true,
            searchMode: "first_available_on_or_after",
            stepId: "step-1",
          },
        ],
        lastModified: now,
        name: "Ersttermin",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", rootId, {
        lineageKey: rootId,
      });

      return rootId;
    });

    const monday = nextWeekday(1);
    const rootStart = monday
      .toZonedDateTime({
        plainTime: { hour: 9, minute: 0 },
        timeZone: TIMEZONE,
      })
      .toString();
    const createdSeries = await t.mutation(
      api.appointments.createAppointmentSeries,
      {
        locationId,
        patientId: originalPatientId,
        practiceId,
        practitionerId,
        rootAppointmentTypeId,
        rootTitle: "Ersttermin",
        ruleSetId,
        start: rootStart,
        userId,
      },
    );

    await t.mutation(api.appointments.updateAppointment, {
      id: createdSeries.rootAppointmentId,
      patientId: replacementPatientId,
    });

    const seriesRecord = await t.run(async (ctx) => {
      return await ctx.db
        .query("appointmentSeries")
        .withIndex("by_seriesId", (q) =>
          q.eq("seriesId", createdSeries.seriesId),
        )
        .first();
    });

    expect(seriesRecord?.patientId).toBe(replacementPatientId);
    expect(seriesRecord?.patientDateOfBirth).toBe("2015-05-05");
  });

  test("deleting a non-root series appointment removes the whole chain", async () => {
    const t = createAuthedTestContext();
    const { locationId, practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);
    const userId = await createUser(
      t,
      "workos_series_delete_user",
      "series-delete@example.com",
    );

    const rootAppointmentTypeId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const followUpTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 30,
        lastModified: now,
        name: "Kontrolle",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", followUpTypeId, {
        lineageKey: followUpTypeId,
      });

      const rootId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 30,
        followUpPlan: [
          {
            appointmentTypeLineageKey: followUpTypeId,
            locationMode: "inherit",
            offsetUnit: "days",
            offsetValue: 2,
            practitionerMode: "inherit",
            required: true,
            searchMode: "first_available_on_or_after",
            stepId: "step-1",
          },
        ],
        lastModified: now,
        name: "Ersttermin",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", rootId, {
        lineageKey: rootId,
      });

      return rootId;
    });

    const monday = nextWeekday(1);
    const rootStart = monday
      .toZonedDateTime({
        plainTime: { hour: 9, minute: 0 },
        timeZone: TIMEZONE,
      })
      .toString();
    const createdSeries = await t.mutation(
      api.appointments.createAppointmentSeries,
      {
        locationId,
        practiceId,
        practitionerId,
        rootAppointmentTypeId,
        rootTitle: "Ersttermin",
        ruleSetId,
        start: rootStart,
        userId,
      },
    );

    const followUpAppointmentId = createdSeries.steps[1]?.appointmentId;
    expect(followUpAppointmentId).toBeDefined();
    if (!followUpAppointmentId) {
      throw new Error("Follow-up appointment should exist");
    }

    await t.mutation(api.appointments.deleteAppointment, {
      id: followUpAppointmentId,
    });

    const remainingAppointments = await t.run(async (ctx) => {
      return await ctx.db
        .query("appointments")
        .withIndex("by_seriesId", (q) =>
          q.eq("seriesId", createdSeries.seriesId),
        )
        .collect();
    });
    const remainingSeriesRecord = await t.run(async (ctx) => {
      return await ctx.db
        .query("appointmentSeries")
        .withIndex("by_seriesId", (q) =>
          q.eq("seriesId", createdSeries.seriesId),
        )
        .first();
    });

    expect(remainingAppointments).toHaveLength(0);
    expect(remainingSeriesRecord).toBeNull();
  });
});

function calculateDurationMinutes(end: string, start: string) {
  return (
    (Temporal.ZonedDateTime.from(end).epochMilliseconds -
      Temporal.ZonedDateTime.from(start).epochMilliseconds) /
    60_000
  );
}
