import { convexTest } from "convex-test";
import { Temporal } from "temporal-polyfill";
import { describe, expect, test } from "vitest";

import type { Doc, Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import { api } from "../_generated/api";
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
        locationId,
        practiceId,
        practitionerId,
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
  const id = await ctx.db.insert(table, value as never);
  await ctx.db.patch(table, id, { lineageKey: id } as never);
  return id;
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
        allowedPractitionerIds: [practitionerId],
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

  test("previewAppointmentSeries resolves a follow-up slot on or after the computed anchor date", async () => {
    const t = createAuthedTestContext();
    const { locationId, practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);

    const { rootAppointmentTypeId, targetAppointmentTypeId } = await t.run(
      async (ctx) => {
        const now = BigInt(Date.now());
        const targetAppointmentTypeId = await ctx.db.insert(
          "appointmentTypes",
          {
            allowedPractitionerIds: [practitionerId],
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
          allowedPractitionerIds: [practitionerId],
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
    expect(
      Temporal.ZonedDateTime.from(preview.steps[1]?.start ?? rootStart)
        .toPlainDate()
        .toString(),
    ).toBe(monday.add({ days: 2 }).toString());
    expect(
      Temporal.ZonedDateTime.from(preview.steps[1]?.start ?? rootStart)
        .toPlainTime()
        .toString(),
    ).toBe("09:30:00");
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
        allowedPractitionerIds: [practitionerId],
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
        allowedPractitionerIds: [practitionerId],
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

  test("createAppointment routes simulation bookings with follow-up plans through the same series path", async () => {
    const t = createAuthedTestContext();
    const { locationId, practiceId, practitionerId, ruleSetId } =
      await createBasePractice(t);

    const rootAppointmentTypeId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const targetAppointmentTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerIds: [practitionerId],
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
        allowedPractitionerIds: [practitionerId],
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
    const rootEnd = Temporal.ZonedDateTime.from(rootStart)
      .add({ minutes: 30 })
      .toString();

    await t.mutation(api.appointments.createAppointment, {
      appointmentTypeId: rootAppointmentTypeId,
      end: rootEnd,
      isSimulation: true,
      locationId,
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
      new Set(appointments.map((appointment) => appointment.seriesId)).size,
    ).toBe(1);
  });
});
