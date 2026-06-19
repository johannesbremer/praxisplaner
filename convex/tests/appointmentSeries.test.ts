import { convexTest } from "convex-test";
import { Temporal } from "temporal-polyfill";
import { describe, expect, test } from "vitest";

import type { Doc, Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import { api, internal } from "../_generated/api";
import { insertSelfLineageEntity } from "../lineage";
import { isPublicHoliday } from "../publicHolidays";
import schema from "../schema";
import { modules } from "./test.setup";
import { assertDefined } from "./test_utils";

const TIMEZONE = "Europe/Berlin";

type LineageTable = Extract<
  TableNames,
  "appointmentTypes" | "baseSchedules" | "locations" | "practitioners"
>;

let basePracticeSequence = 0;

function createAuthedTestContext() {
  return convexTest(schema, modules).withIdentity({
    email: "appointment-series@example.com",
    subject: "workos_appointment_series",
  });
}

async function createBasePractice(
  t: ReturnType<typeof createAuthedTestContext>,
) {
  const sequence = basePracticeSequence;
  basePracticeSequence += 1;
  const ownerAuthId = `workos_appointment_series_owner_${sequence}`;
  await ensurePracticeOwnerUser(t, {
    authId: ownerAuthId,
    email: `appointment-series-owner-${sequence}@example.com`,
  });
  const practiceId = await t.mutation(
    internal.workosOrganizations.createPracticeForWorkOSOrganization,
    {
      name: `Appointment Series Test Practice ${sequence}`,
      organizationId: `org_test_appointment_series_${sequence}`,
      role: "owner",
      workOSUserId: ownerAuthId,
    },
  );
  await ensureProvisionedUserMembership(t, practiceId);

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
    const userId = await ctx.db.insert("users", {
      authId,
      createdAt: BigInt(Date.now()),
      email,
    });
    const practices = await ctx.db.query("practices").collect();
    for (const practice of practices) {
      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: practice._id,
        role: "staff",
        userId,
      });
    }
    return userId;
  });
}

async function ensurePracticeOwnerUser(
  t: ReturnType<typeof createAuthedTestContext>,
  args: { authId: string; email: string },
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const existingUser = users.find((user) => user.authId === args.authId);

    if (existingUser) {
      return existingUser._id;
    }

    return await ctx.db.insert("users", {
      authId: args.authId,
      createdAt: BigInt(Date.now()),
      email: args.email,
    });
  });
}

async function ensureProvisionedUserMembership(
  t: ReturnType<typeof createAuthedTestContext>,
  practiceId: Id<"practices">,
) {
  const userId = await ensurePracticeOwnerUser(t, {
    authId: "workos_appointment_series",
    email: "appointment-series@example.com",
  });
  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query("practiceMembers")
      .withIndex("by_practiceId_userId", (q) =>
        q.eq("practiceId", practiceId).eq("userId", userId),
      )
      .first();
    if (existing) {
      return;
    }
    await ctx.db.insert("practiceMembers", {
      createdAt: BigInt(Date.now()),
      practiceId,
      role: "owner",
      userId,
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
  const nextMatchingWeekday = today.add({ days: delta === 0 ? 7 : delta });

  for (let weekOffset = 0; weekOffset < 52; weekOffset++) {
    const candidate = nextMatchingWeekday.add({ weeks: weekOffset });
    const hasHolidayInWorkingWeek = [0, 1, 2, 3, 4].some((dayOffset) =>
      isPublicHoliday(candidate.add({ days: dayOffset })),
    );

    if (!hasHolidayInWorkingWeek) {
      return candidate;
    }
  }

  throw new Error("No holiday-free weekday found for appointment series test.");
}

describe("appointment series", () => {
  test("createAppointmentType rejects appointment plans with missing target lineage keys", async () => {
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
        appointmentPlan: {
          steps: [
            {
              appointmentTypeLineageKey: missingLineageKey,
              occupancy: { kind: "inheritRootPractitioner" },
              required: true,
              stepId: "step-1",
              timing: {
                kind: "afterPreviousEnd",
                offsetUnit: "days",
                offsetValue: 5,
              },
            },
          ],
        },
        duration: 30,
        expectedDraftRevision: null,
        name: "Root",
        practiceId,
        practitionerIds: [practitionerId],
        selectedRuleSetId: ruleSetId,
      }),
    ).rejects.toThrow("APPOINTMENT_PLAN:APPOINTMENT_TYPE_NOT_FOUND");
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
        appointmentPlan: {
          steps: [
            {
              appointmentTypeLineageKey: targetAppointmentTypeId,
              occupancy: { kind: "inheritRootPractitioner" },
              required: true,
              stepId: "step-1",
              timing: {
                kind: "afterPreviousEnd",
                offsetUnit: "minutes",
                offsetValue: 7,
              },
            },
          ],
        },
        duration: 30,
        expectedDraftRevision: null,
        name: "Ungueltig Minuten",
        practiceId,
        practitionerIds: [practitionerId],
        selectedRuleSetId: ruleSetId,
      }),
    ).rejects.toThrow("APPOINTMENT_PLAN:INVALID_OFFSET_STEP");

    await expect(
      t.mutation(api.entities.createAppointmentType, {
        appointmentPlan: {
          steps: [
            {
              appointmentTypeLineageKey: targetAppointmentTypeId,
              occupancy: { kind: "inheritRootPractitioner" },
              required: true,
              stepId: "step-1",
              timing: {
                kind: "afterPreviousEnd",
                offsetUnit: "days",
                offsetValue: 0,
              },
            },
          ],
        },
        duration: 30,
        expectedDraftRevision: null,
        name: "Ungueltig Tage",
        practiceId,
        practitionerIds: [practitionerId],
        selectedRuleSetId: ruleSetId,
      }),
    ).rejects.toThrow("APPOINTMENT_PLAN:INVALID_OFFSET");

    await expect(
      t.mutation(api.entities.createAppointmentType, {
        appointmentPlan: {
          steps: [
            {
              appointmentTypeLineageKey: targetAppointmentTypeId,
              occupancy: { kind: "inheritRootPractitioner" },
              required: true,
              stepId: "step-1",
              timing: {
                kind: "afterPreviousEnd",
                offsetUnit: "days",
                offsetValue: 1.5,
              },
            },
          ],
        },
        duration: 30,
        expectedDraftRevision: null,
        name: "Ungueltig Kommazahl",
        practiceId,
        practitionerIds: [practitionerId],
        selectedRuleSetId: ruleSetId,
      }),
    ).rejects.toThrow("APPOINTMENT_PLAN:INVALID_OFFSET");

    const validResult = await t.mutation(api.entities.createAppointmentType, {
      appointmentPlan: {
        steps: [
          {
            appointmentTypeLineageKey: targetAppointmentTypeId,
            occupancy: { kind: "inheritRootPractitioner" },
            required: true,
            stepId: "step-1",
            timing: {
              kind: "afterPreviousEnd",
              offsetUnit: "days",
              offsetValue: 3,
            },
          },
        ],
      },
      duration: 30,
      expectedDraftRevision: null,
      name: "Gueltig Tage",
      practiceId,
      practitionerIds: [practitionerId],
      selectedRuleSetId: ruleSetId,
    });

    expect(validResult.entityId).toBeDefined();
  });

  test("previewAppointmentSeries scans period-based appointment-plan steps top to bottom within the day", async () => {
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
          appointmentPlan: {
            steps: [
              {
                appointmentTypeLineageKey: targetAppointmentTypeId,
                occupancy: { kind: "inheritRootPractitioner" },
                required: true,
                stepId: "step-1",
                timing: {
                  kind: "afterPreviousEnd",
                  offsetUnit: "days",
                  offsetValue: 2,
                },
              },
            ],
          },
          createdAt: now,
          duration: 30,
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
        occupancyScope: {
          kind: "practitioner",
          practitionerLineageKey: practitionerId,
        },
        practiceId,
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
    const planStepStart = Temporal.ZonedDateTime.from(
      preview.steps[1]?.start ?? rootStart,
    );
    expect(planStepStart.toPlainDate().toString()).toBe(
      monday.add({ days: 2 }).toString(),
    );
    expect(planStepStart.toPlainTime().toString()).toBe("08:00:00");
  });

  test("previewAppointmentSeries searches month-based appointment-plan steps from the target date onward", async () => {
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
        appointmentPlan: {
          steps: [
            {
              appointmentTypeLineageKey: targetAppointmentTypeId,
              occupancy: { kind: "inheritRootPractitioner" },
              required: true,
              stepId: "step-1",
              timing: {
                kind: "afterPreviousEnd",
                offsetUnit: "months",
                offsetValue: 1,
              },
            },
          ],
        },
        createdAt: now,
        duration: 30,
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
    const planStepDate = Temporal.ZonedDateTime.from(
      preview.steps[1]?.start ?? rootStart,
    ).toPlainDate();

    expect(
      Temporal.PlainDate.compare(planStepDate, targetDate),
    ).toBeGreaterThanOrEqual(0);
  });

  test("previewAppointmentSeries skips weekends for day-based appointment-plan steps and uses the next working day", async () => {
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
        appointmentPlan: {
          steps: [
            {
              appointmentTypeLineageKey: targetAppointmentTypeId,
              occupancy: { kind: "inheritRootPractitioner" },
              required: true,
              stepId: "step-1",
              timing: {
                kind: "afterPreviousEnd",
                offsetUnit: "days",
                offsetValue: 1,
              },
            },
          ],
        },
        createdAt: now,
        duration: 30,
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

  test("previewAppointmentSeries skips public holidays for day-based appointment-plan steps and uses the next working day", async () => {
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
        appointmentPlan: {
          steps: [
            {
              appointmentTypeLineageKey: targetAppointmentTypeId,
              occupancy: { kind: "inheritRootPractitioner" },
              required: true,
              stepId: "step-1",
              timing: {
                kind: "afterPreviousEnd",
                offsetUnit: "days",
                offsetValue: 1,
              },
            },
          ],
        },
        createdAt: now,
        duration: 30,
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

  test("createAppointmentSeries fails atomically when a required appointment-plan slot cannot be found", async () => {
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
        appointmentPlan: {
          steps: [
            {
              appointmentTypeLineageKey: targetAppointmentTypeId,
              occupancy: { kind: "inheritRootPractitioner" },
              required: true,
              stepId: "step-1",
              timing: {
                kind: "afterPreviousEnd",
                offsetUnit: "minutes",
                offsetValue: 0,
              },
            },
          ],
        },
        createdAt: now,
        duration: 30,
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

    const blockedRootSlots = await t.query(
      api.appointments.getBlockedAppointmentSeriesRootSlotsForCandidates,
      {
        candidates: [
          {
            duration: 30,
            locationLineageKey: locationId,
            practitionerLineageKey: practitionerId,
            practitionerName: "Dr. Chain",
            startTime: rootStart,
          },
        ],
        locationId,
        practiceId,
        rootAppointmentTypeId,
        ruleSetId,
        userId,
      },
    );

    expect(blockedRootSlots).toEqual([
      expect.objectContaining({
        locationLineageKey: locationId,
        practitionerLineageKey: practitionerId,
        startTime: rootStart,
        status: "BLOCKED",
      }),
    ]);

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

  test("previewAppointmentSeries blocks immediately when an inherited practitioner is not allowed for the plan-step type", async () => {
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
        appointmentPlan: {
          steps: [
            {
              appointmentTypeLineageKey: targetAppointmentTypeId,
              occupancy: { kind: "inheritRootPractitioner" },
              required: true,
              stepId: "step-1",
              timing: {
                kind: "afterPreviousEnd",
                offsetUnit: "days",
                offsetValue: 1,
              },
            },
          ],
        },
        createdAt: now,
        duration: 30,
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
        appointmentPlan: {
          steps: [
            {
              appointmentTypeLineageKey: targetAppointmentTypeId,
              occupancy: { kind: "inheritRootPractitioner" },
              required: true,
              stepId: "step-1",
              timing: {
                kind: "afterPreviousEnd",
                offsetUnit: "days",
                offsetValue: 2,
              },
            },
          ],
        },
        createdAt: now,
        duration: 30,
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
          appointmentPlan: {
            steps: [
              {
                appointmentTypeLineageKey: targetAppointmentTypeId,
                occupancy: { kind: "inheritRootPractitioner" },
                required: true,
                stepId: "step-1",
                timing: {
                  kind: "afterPreviousEnd",
                  offsetUnit: "days",
                  offsetValue: 2,
                },
              },
            ],
          },
          createdAt: now,
          duration: 30,
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
        occupancyScope: {
          kind: "practitioner",
          practitionerLineageKey: activePractitionerId,
        },
        practiceId,
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

  test("createAppointment routes simulation bookings with appointment plans through the same series path", async () => {
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
        appointmentPlan: {
          steps: [
            {
              appointmentTypeLineageKey: targetAppointmentTypeId,
              occupancy: { kind: "inheritRootPractitioner" },
              required: true,
              stepId: "step-1",
              timing: {
                kind: "afterPreviousEnd",
                offsetUnit: "minutes",
                offsetValue: 0,
              },
            },
          ],
        },
        createdAt: now,
        duration: 30,
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

  test("createAppointment routes real bookings with appointment plans through the same series path", async () => {
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

      const rootId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        appointmentPlan: {
          steps: [
            {
              appointmentTypeLineageKey: targetAppointmentTypeId,
              occupancy: { kind: "inheritRootPractitioner" },
              required: true,
              stepId: "step-1",
              timing: {
                kind: "afterPreviousEnd",
                offsetUnit: "days",
                offsetValue: 2,
              },
            },
          ],
        },
        createdAt: now,
        duration: 30,
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
    const bookingIdentityId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      return await ctx.db.insert("bookingIdentities", {
        createdAt: now,
        kind: "online",
        lastModified: now,
        practiceId,
        sourceIdentityId: "legacy-user-1",
        sourceSystem: "legacy-online",
      });
    });

    await t.mutation(api.appointments.createAppointment, {
      appointmentTypeId: rootAppointmentTypeId,
      bookingIdentityId,
      locationId,
      practiceId,
      practitionerId,
      start: rootStart,
      title: "Realer Kettentermin",
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
    expect(
      appointments.every(
        (appointment) => appointment.bookingIdentityId === bookingIdentityId,
      ),
    ).toBe(true);
    expect(seriesRecord?.bookingIdentityId).toBe(bookingIdentityId);
    expect(seriesRecord?.rootAppointmentId).toBeDefined();
  });

  test("createAppointmentSeries rejects booking identities from another practice", async () => {
    const t = createAuthedTestContext();
    const { locationId, practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);
    const { practiceId: otherPracticeId } = await createBasePractice(t);
    const userId = await createUser(
      t,
      "workos_cross_practice_series_user",
      "cross-practice-series@example.com",
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
        appointmentPlan: {
          steps: [
            {
              appointmentTypeLineageKey: targetAppointmentTypeId,
              occupancy: { kind: "inheritRootPractitioner" },
              required: true,
              stepId: "step-1",
              timing: {
                kind: "afterPreviousEnd",
                offsetUnit: "days",
                offsetValue: 2,
              },
            },
          ],
        },
        createdAt: now,
        duration: 30,
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

    const bookingIdentityId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      return await ctx.db.insert("bookingIdentities", {
        createdAt: now,
        kind: "online",
        lastModified: now,
        practiceId: otherPracticeId,
        sourceIdentityId: "other-practice-identity",
        sourceSystem: "legacy-online",
      });
    });

    const rootStart = nextWeekday(1)
      .toZonedDateTime({
        plainTime: { hour: 9, minute: 0 },
        timeZone: TIMEZONE,
      })
      .toString();

    await expect(
      t.mutation(api.appointments.createAppointmentSeries, {
        bookingIdentityId,
        locationId,
        practiceId,
        practitionerId,
        rootAppointmentTypeId,
        rootTitle: "Ersttermin",
        ruleSetId,
        start: rootStart,
        userId,
      }),
    ).rejects.toThrow(
      "Booking identity does not belong to the appointment practice.",
    );
  });

  test("createAppointmentSeries rejects patients from another practice", async () => {
    const t = createAuthedTestContext();
    const { locationId, practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);
    const { practiceId: otherPracticeId } = await createBasePractice(t);
    const userId = await createUser(
      t,
      "workos_cross_practice_series_patient_user",
      "cross-practice-series-patient@example.com",
    );
    const foreignPatientId = await createPatient(t, {
      dateOfBirth: "1970-01-01",
      patientId: 19_700_101,
      practiceId: otherPracticeId,
    });

    const rootAppointmentTypeId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const rootId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        appointmentPlan: { steps: [] },
        createdAt: now,
        duration: 30,
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

    const rootStart = nextWeekday(1)
      .toZonedDateTime({
        plainTime: { hour: 9, minute: 0 },
        timeZone: TIMEZONE,
      })
      .toString();

    await expect(
      t.mutation(api.appointments.createAppointmentSeries, {
        locationId,
        patientId: foreignPatientId,
        practiceId,
        practitionerId,
        rootAppointmentTypeId,
        rootTitle: "Ersttermin",
        ruleSetId,
        start: rootStart,
        userId,
      }),
    ).rejects.toThrow("Patient does not belong to this practice.");
  });

  test("previewAppointmentSeries rejects unrelated users", async () => {
    const t = createAuthedTestContext();
    const { locationId, practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);
    const unrelatedUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        authId: "workos_unrelated_series_preview_user",
        createdAt: BigInt(Date.now()),
        email: "unrelated-series-preview@example.com",
      });
    });

    const rootAppointmentTypeId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const rootId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        appointmentPlan: { steps: [] },
        createdAt: now,
        duration: 30,
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

    const rootStart = nextWeekday(1)
      .toZonedDateTime({
        plainTime: { hour: 9, minute: 0 },
        timeZone: TIMEZONE,
      })
      .toString();

    await expect(
      t.query(api.appointments.previewAppointmentSeries, {
        locationId,
        practiceId,
        practitionerId,
        rootAppointmentTypeId,
        ruleSetId,
        start: rootStart,
        userId: unrelatedUserId,
      }),
    ).rejects.toThrow("User does not belong to this practice.");
  });

  test("replanned optional appointment-plan appointments inherit the stored booking identity", async () => {
    const t = createAuthedTestContext();
    const { locationId, practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);
    const userId = await createUser(
      t,
      "workos_series_optional_identity_user",
      "series-optional-identity@example.com",
    );
    const alternatePractitionerId = await t.run(async (ctx) => {
      const createdPractitionerId = await insertWithLineage(
        ctx,
        "practitioners",
        {
          name: "Dr. Followup",
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
          practitionerLineageKey: createdPractitionerId,
          ruleSetId,
          startTime: "08:00",
        });
      }

      return createdPractitionerId;
    });

    const rootAppointmentTypeId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const optionalFollowUpTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [alternatePractitionerId],
        createdAt: now,
        duration: 30,
        lastModified: now,
        name: "Optionale Kontrolle",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", optionalFollowUpTypeId, {
        lineageKey: optionalFollowUpTypeId,
      });

      const rootId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [
          practitionerId,
          alternatePractitionerId,
        ],
        appointmentPlan: {
          steps: [
            {
              appointmentTypeLineageKey: optionalFollowUpTypeId,
              occupancy: { kind: "inheritRootPractitioner" },
              required: false,
              stepId: "optional-step-1",
              timing: {
                kind: "afterPreviousEnd",
                offsetUnit: "days",
                offsetValue: 2,
              },
            },
          ],
        },
        createdAt: now,
        duration: 30,
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

    const bookingIdentityId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      return await ctx.db.insert("bookingIdentities", {
        createdAt: now,
        kind: "online",
        lastModified: now,
        practiceId,
        sourceIdentityId: "legacy-user-optional-1",
        sourceSystem: "legacy-online",
      });
    });

    const mondayStart = nextWeekday(1)
      .toZonedDateTime({
        plainTime: { hour: 9, minute: 0 },
        timeZone: TIMEZONE,
      })
      .toString();

    const createdSeries = await t.mutation(
      api.appointments.createAppointmentSeries,
      {
        bookingIdentityId,
        locationId,
        practiceId,
        practitionerId,
        rootAppointmentTypeId,
        rootTitle: "Ersttermin",
        ruleSetId,
        start: mondayStart,
        userId,
      },
    );

    expect(createdSeries.steps).toHaveLength(1);

    await t.mutation(api.appointments.updateAppointment, {
      end: Temporal.ZonedDateTime.from(mondayStart)
        .add({ minutes: 30 })
        .toString(),
      id: createdSeries.rootAppointmentId,
      practitionerId: alternatePractitionerId,
      start: mondayStart,
    });

    const replannedAppointments = await t.run(async (ctx) => {
      return await ctx.db
        .query("appointments")
        .withIndex("by_seriesId", (q) =>
          q.eq("seriesId", createdSeries.seriesId),
        )
        .collect();
    });
    const storedSeries = await t.run(async (ctx) => {
      return await ctx.db
        .query("appointmentSeries")
        .withIndex("by_seriesId", (q) =>
          q.eq("seriesId", createdSeries.seriesId),
        )
        .first();
    });

    expect(storedSeries?.bookingIdentityId).toBe(bookingIdentityId);
    expect(replannedAppointments).toHaveLength(2);
    expect(
      replannedAppointments.every(
        (appointment) => appointment.bookingIdentityId === bookingIdentityId,
      ),
    ).toBe(true);
    expect(
      replannedAppointments.some(
        (appointment) => appointment.seriesStepIndex === 1n,
      ),
    ).toBe(true);
  });

  test("updateAppointmentType clears appointment plans without patching undefined", async () => {
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
      appointmentPlan: {
        steps: [
          {
            appointmentTypeLineageKey: targetAppointmentTypeId,
            occupancy: { kind: "inheritRootPractitioner" },
            required: true,
            stepId: "step-1",
            timing: {
              kind: "afterPreviousEnd",
              offsetUnit: "days",
              offsetValue: 5,
            },
          },
        ],
      },
      duration: 30,
      expectedDraftRevision: null,
      name: "Root",
      practiceId,
      practitionerIds: [practitionerId],
      selectedRuleSetId: ruleSetId,
    });

    await t.mutation(api.entities.updateAppointmentType, {
      appointmentPlan: { steps: [] },
      appointmentTypeId: created.entityId,
      expectedDraftRevision: created.draftRevision,
      practiceId,
      selectedRuleSetId: created.ruleSetId,
    });

    const updatedAppointmentType = await t.run(async (ctx) => {
      return await ctx.db.get("appointmentTypes", created.entityId);
    });

    expect(updatedAppointmentType?.appointmentPlan).toEqual({ steps: [] });
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
        appointmentPlan: {
          steps: [
            {
              appointmentTypeLineageKey: targetAppointmentTypeId,
              occupancy: { kind: "inheritRootPractitioner" },
              required: true,
              stepId: "step-1",
              timing: {
                kind: "afterPreviousEnd",
                offsetUnit: "days",
                offsetValue: 2,
              },
            },
          ],
        },
        createdAt: now,
        duration: 30,
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

    await t.run(async (ctx) => {
      await ctx.db.patch("practices", practiceId, {
        appointmentSmileyOptions: [
          {
            emoji: "👍",
            id: "thumbs-up",
            name: "Patient ist angekommen",
          },
        ],
      });
    });

    const initialAppointments = await t.run(async (ctx) => {
      return await ctx.db
        .query("appointments")
        .withIndex("by_seriesId", (q) =>
          q.eq("seriesId", createdSeries.seriesId),
        )
        .collect();
    });
    const initialFollowUpAppointment = initialAppointments.find(
      (appointment) => appointment.seriesStepIndex === 1n,
    );
    assertDefined(initialFollowUpAppointment);

    await t.mutation(api.appointments.updateAppointment, {
      id: initialFollowUpAppointment._id,
      smiley: "👍",
    });

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
    expect(storedSeries?.appointmentPlanSnapshot).toHaveLength(1);

    const shiftedRootStart = Temporal.ZonedDateTime.from(rootStart)
      .add({ days: 1 })
      .toString();
    const shiftedRootEnd = Temporal.ZonedDateTime.from(rootStart)
      .add({ days: 1, minutes: 45 })
      .toString();

    const ekgBlockingAppointmentId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      await ctx.db.patch("appointmentTypes", rootAppointmentTypeId, {
        defaultOccupancy: {
          calendarResourceColumn: "ekg",
          kind: "resourceColumn",
        },
      });
      return await ctx.db.insert("appointments", {
        appointmentTypeLineageKey: rootAppointmentTypeId,
        appointmentTypeTitle: "EKG blockiert",
        createdAt: now,
        end: shiftedRootEnd,
        lastModified: now,
        locationLineageKey: locationId,
        occupancyScope: { calendarResourceColumn: "ekg", kind: "resource" },
        practiceId,
        start: shiftedRootStart,
        title: "EKG gesperrt",
        userId,
      });
    });

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
    expect(sortedUpdatedAppointments[0]?.occupancyScope).toEqual({
      kind: "practitioner",
      practitionerLineageKey: practitionerId,
    });
    await t.run(async (ctx) => {
      await ctx.db.delete("appointments", ekgBlockingAppointmentId);
    });
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
    expect(sortedUpdatedAppointments[1]?.smiley).toBe("👍");
    expect(
      Temporal.ZonedDateTime.from(
        sortedUpdatedAppointments[1]?.start ?? shiftedRootStart,
      )
        .toPlainDate()
        .toString(),
    ).toBe(monday.add({ days: 3 }).toString());

    await expect(
      t.mutation(api.appointments.updateAppointment, {
        calendarResourceColumn: "ekg",
        id: createdSeries.rootAppointmentId,
      }),
    ).rejects.toThrow(
      "Kettentermine können nicht in EKG- oder Labor-Spalten verschoben werden.",
    );

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

  test("appointment plans support before steps and same-time EKG resource steps", async () => {
    const t = createAuthedTestContext();
    const { locationId, practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);
    const userId = await createUser(
      t,
      "workos_series_plan_resource_user",
      "series-plan-resource@example.com",
    );

    const rootAppointmentTypeId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const beTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 5,
        lastModified: now,
        name: "BE",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", beTypeId, {
        lineageKey: beTypeId,
      });
      const ekgTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 10,
        lastModified: now,
        name: "EKG",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", ekgTypeId, {
        lineageKey: ekgTypeId,
      });
      const rootTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        appointmentPlan: {
          steps: [
            {
              appointmentTypeLineageKey: beTypeId,
              occupancy: { kind: "inheritRootPractitioner" },
              required: true,
              stepId: "be-before",
              timing: { kind: "beforeRootStart", offsetMinutes: 0 },
            },
            {
              appointmentTypeLineageKey: ekgTypeId,
              occupancy: {
                calendarResourceColumn: "ekg",
                kind: "resourceColumn",
              },
              required: true,
              stepId: "ekg-same-time",
              timing: { anchorStepId: "root", kind: "sameStartAs" },
            },
          ],
        },
        createdAt: now,
        duration: 30,
        lastModified: now,
        name: "DMP KHK + EKG",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", rootTypeId, {
        lineageKey: rootTypeId,
      });
      return rootTypeId;
    });

    const monday = nextWeekday(1);
    const rootStart = monday
      .toZonedDateTime({
        plainTime: { hour: 9, minute: 0 },
        timeZone: TIMEZONE,
      })
      .toString();
    const series = await t.mutation(api.appointments.createAppointmentSeries, {
      locationId,
      practiceId,
      practitionerId,
      rootAppointmentTypeId,
      rootTitle: "DMP KHK + EKG",
      ruleSetId,
      start: rootStart,
      userId,
    });

    expect(series.steps).toHaveLength(3);
    expect(series.steps[1]?.start).toBe(
      Temporal.ZonedDateTime.from(rootStart)
        .subtract({ minutes: 5 })
        .toString(),
    );
    expect(series.steps[2]?.start).toBe(rootStart);
    expect(series.steps[2]?.occupancyScope).toEqual({
      calendarResourceColumn: "ekg",
      kind: "resource",
    });
  });

  test("resource-root appointment series can move within the same resource column", async () => {
    const t = createAuthedTestContext();
    const { locationId, practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);
    const userId = await createUser(
      t,
      "workos_series_resource_root_move_user",
      "series-resource-root-move@example.com",
    );

    const rootAppointmentTypeId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const ekgTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 10,
        lastModified: now,
        name: "EKG Kontrolle",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", ekgTypeId, {
        lineageKey: ekgTypeId,
      });
      const rootTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        appointmentPlan: {
          steps: [
            {
              appointmentTypeLineageKey: ekgTypeId,
              occupancy: {
                calendarResourceColumn: "ekg",
                kind: "resourceColumn",
              },
              required: true,
              stepId: "ekg-follow-up",
              timing: {
                kind: "afterPreviousEnd",
                offsetUnit: "minutes",
                offsetValue: 0,
              },
            },
          ],
        },
        createdAt: now,
        defaultOccupancy: {
          calendarResourceColumn: "ekg",
          kind: "resourceColumn",
        },
        duration: 20,
        lastModified: now,
        name: "EKG Serie",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", rootTypeId, {
        lineageKey: rootTypeId,
      });
      return rootTypeId;
    });

    const monday = nextWeekday(1);
    const rootStart = monday
      .toZonedDateTime({
        plainTime: { hour: 9, minute: 0 },
        timeZone: TIMEZONE,
      })
      .toString();
    const series = await t.mutation(api.appointments.createAppointmentSeries, {
      calendarResourceColumn: "ekg",
      locationId,
      practiceId,
      rootAppointmentTypeId,
      rootTitle: "EKG Serie",
      ruleSetId,
      start: rootStart,
      userId,
    });

    const shiftedRootStart = Temporal.ZonedDateTime.from(rootStart)
      .add({ days: 1 })
      .toString();

    await t.mutation(api.appointments.updateAppointment, {
      calendarResourceColumn: "ekg",
      id: series.rootAppointmentId,
      start: shiftedRootStart,
    });

    const movedAppointments = await t.run(async (ctx) => {
      return await ctx.db
        .query("appointments")
        .withIndex("by_seriesId", (q) => q.eq("seriesId", series.seriesId))
        .collect();
    });
    const movedRootAppointment = movedAppointments.find(
      (appointment) => appointment.seriesStepIndex === 0n,
    );
    assertDefined(movedRootAppointment);
    expect(movedRootAppointment.start).toBe(shiftedRootStart);
    expect(movedRootAppointment.occupancyScope).toEqual({
      calendarResourceColumn: "ekg",
      kind: "resource",
    });

    await expect(
      t.mutation(api.appointments.updateAppointment, {
        calendarResourceColumn: "labor",
        id: series.rootAppointmentId,
      }),
    ).rejects.toThrow(
      "Kettentermine können nicht in EKG- oder Labor-Spalten verschoben werden.",
    );
  });

  test("appointment plans reject date-offset resource steps inside blocked ranges", async () => {
    const t = createAuthedTestContext();
    const { locationId, practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);
    const userId = await createUser(
      t,
      "workos_series_resource_block_user",
      "series-resource-block@example.com",
    );

    const rootAppointmentTypeId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const ekgTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 10,
        lastModified: now,
        name: "EKG",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", ekgTypeId, {
        lineageKey: ekgTypeId,
      });
      const rootTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        appointmentPlan: {
          steps: [
            {
              appointmentTypeLineageKey: ekgTypeId,
              occupancy: {
                calendarResourceColumn: "ekg",
                kind: "resourceColumn",
              },
              required: true,
              stepId: "ekg-next-day",
              timing: {
                kind: "afterPreviousEnd",
                offsetUnit: "days",
                offsetValue: 1,
              },
            },
          ],
        },
        createdAt: now,
        duration: 30,
        lastModified: now,
        name: "Checkup + EKG",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", rootTypeId, {
        lineageKey: rootTypeId,
      });
      return rootTypeId;
    });

    const monday = nextWeekday(1);
    const rootStart = monday
      .toZonedDateTime({
        plainTime: { hour: 9, minute: 0 },
        timeZone: TIMEZONE,
      })
      .toString();
    const blockedStart = Temporal.ZonedDateTime.from(rootStart)
      .add({ days: 1, minutes: 25 })
      .toString();
    const blockedEnd = Temporal.ZonedDateTime.from(rootStart)
      .add({ days: 1, minutes: 45 })
      .toString();

    await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      await ctx.db.insert("blockedSlots", {
        createdAt: now,
        end: blockedEnd,
        lastModified: now,
        locationLineageKey: locationId,
        occupancyScope: { kind: "location-wide" },
        practiceId,
        start: blockedStart,
        title: "Standort gesperrt",
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

    expect(preview.status).toBe("blocked");
    expect(preview.blockedStepId).toBe("ekg-next-day");

    await expect(
      t.mutation(api.appointments.createAppointmentSeries, {
        locationId,
        practiceId,
        practitionerId,
        rootAppointmentTypeId,
        rootTitle: "Checkup + EKG",
        ruleSetId,
        start: rootStart,
        userId,
      }),
    ).rejects.toThrow("Kein verfügbarer Kettentermin");
  });

  test("appointment plans block same-time steps on the inherited root practitioner", async () => {
    const t = createAuthedTestContext();
    const { locationId, practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);

    const rootAppointmentTypeId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const diagnostikTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 10,
        lastModified: now,
        name: "Diagnostik",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", diagnostikTypeId, {
        lineageKey: diagnostikTypeId,
      });
      const rootTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        appointmentPlan: {
          steps: [
            {
              appointmentTypeLineageKey: diagnostikTypeId,
              occupancy: { kind: "inheritRootPractitioner" },
              required: true,
              stepId: "diagnostik-same-time",
              timing: { anchorStepId: "root", kind: "sameStartAs" },
            },
          ],
        },
        createdAt: now,
        duration: 30,
        lastModified: now,
        name: "Ergometrie",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", rootTypeId, {
        lineageKey: rootTypeId,
      });
      return rootTypeId;
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
    expect(preview.blockedStepId).toBe("diagnostik-same-time");
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
      const planStepTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 30,
        lastModified: now,
        name: "Kontrolle",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", planStepTypeId, {
        lineageKey: planStepTypeId,
      });

      const rootId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        appointmentPlan: {
          steps: [
            {
              appointmentTypeLineageKey: planStepTypeId,
              occupancy: { kind: "inheritRootPractitioner" },
              required: true,
              stepId: "step-1",
              timing: {
                kind: "afterPreviousEnd",
                offsetUnit: "days",
                offsetValue: 2,
              },
            },
          ],
        },
        createdAt: now,
        duration: 30,
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

    const planStepAppointmentId = createdSeries.steps[1]?.appointmentId;
    expect(planStepAppointmentId).toBeDefined();
    if (!planStepAppointmentId) {
      throw new Error("Follow-up appointment should exist");
    }

    await expect(
      t.mutation(api.appointments.updateAppointment, {
        id: planStepAppointmentId,
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
      const planStepTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 30,
        lastModified: now,
        name: "Kontrolle",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", planStepTypeId, {
        lineageKey: planStepTypeId,
      });

      const rootId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        appointmentPlan: {
          steps: [
            {
              appointmentTypeLineageKey: planStepTypeId,
              occupancy: { kind: "inheritRootPractitioner" },
              required: true,
              stepId: "step-1",
              timing: {
                kind: "afterPreviousEnd",
                offsetUnit: "days",
                offsetValue: 2,
              },
            },
          ],
        },
        createdAt: now,
        duration: 30,
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
      const planStepTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 30,
        lastModified: now,
        name: "Kontrolle",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", planStepTypeId, {
        lineageKey: planStepTypeId,
      });

      const rootId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerLineageKeys: [practitionerId],
        appointmentPlan: {
          steps: [
            {
              appointmentTypeLineageKey: planStepTypeId,
              occupancy: { kind: "inheritRootPractitioner" },
              required: true,
              stepId: "step-1",
              timing: {
                kind: "afterPreviousEnd",
                offsetUnit: "days",
                offsetValue: 2,
              },
            },
          ],
        },
        createdAt: now,
        duration: 30,
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

    const planStepAppointmentId = createdSeries.steps[1]?.appointmentId;
    expect(planStepAppointmentId).toBeDefined();
    if (!planStepAppointmentId) {
      throw new Error("Follow-up appointment should exist");
    }

    await t.mutation(api.appointments.deleteAppointment, {
      id: planStepAppointmentId,
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
