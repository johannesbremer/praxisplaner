import { convexTest } from "convex-test";
import { Temporal } from "temporal-polyfill";
import { describe, expect, test } from "vitest";

import type { Doc, Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import { api } from "../_generated/api";
import schema from "../schema";
import { modules } from "./test.setup";
import { assertDefined } from "./test_utils";

type LineageTable = Extract<
  TableNames,
  "appointmentTypes" | "baseSchedules" | "locations" | "practitioners"
>;

function createAuthedTestContext() {
  return convexTest(schema, modules).withIdentity({
    email: "vacations@example.com",
    subject: "workos_vacations",
  });
}

async function createSchedulingFixture(
  t: ReturnType<typeof createAuthedTestContext>,
) {
  await ensureProvisionedUser(t);
  const practiceId = await t.mutation(api.practices.createPractice, {
    name: "Vacation Test Practice",
  });

  return await t.run(async (ctx) => {
    const practice = await ctx.db.get("practices", practiceId);
    assertDefined(practice);
    assertDefined(practice.currentActiveRuleSetId);

    const ruleSetId = practice.currentActiveRuleSetId;
    const locationId = await insertWithLineage(ctx, "locations", {
      name: "Hauptstandort",
      practiceId,
      ruleSetId,
    });
    const practitionerId = await insertWithLineage(ctx, "practitioners", {
      name: "Dr. Urlaub",
      practiceId,
      ruleSetId,
    });

    await insertWithLineage(ctx, "baseSchedules", {
      dayOfWeek: 1,
      endTime: "16:00",
      locationId,
      practiceId,
      practitionerId,
      ruleSetId,
      startTime: "08:00",
    });

    const appointmentTypeId = await insertWithLineage(ctx, "appointmentTypes", {
      allowedPractitionerIds: [practitionerId],
      createdAt: BigInt(Date.now()),
      duration: 30,
      followUpPlan: [],
      lastModified: BigInt(Date.now()),
      name: "Kontrolle",
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

async function ensureProvisionedUser(
  t: ReturnType<typeof createAuthedTestContext>,
) {
  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", "workos_vacations"))
      .first();

    if (existing) {
      return;
    }

    await ctx.db.insert("users", {
      authId: "workos_vacations",
      createdAt: BigInt(Date.now()),
      email: "vacations@example.com",
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
  const today = Temporal.Now.plainDateISO("Europe/Berlin");
  const delta = (weekday - today.dayOfWeek + 7) % 7;
  return today.add({ days: delta === 0 ? 7 : delta });
}

describe("vacations", () => {
  test("deleting an MFA cascades that MFA's vacations", async () => {
    const t = createAuthedTestContext();
    await ensureProvisionedUser(t);
    const practiceId = await t.mutation(api.practices.createPractice, {
      name: "MFA Vacation Practice",
    });

    const mfaId = await t.mutation(api.mfas.create, {
      name: "Anna Assistenz",
      practiceId,
    });

    await t.mutation(api.vacations.createVacation, {
      date: "2026-07-01",
      mfaId,
      portion: "full",
      practiceId,
      staffType: "mfa",
    });

    const beforeDelete = await t.query(api.vacations.getVacationsInRange, {
      endDateExclusive: "2026-08-01",
      practiceId,
      startDate: "2026-07-01",
    });
    expect(beforeDelete).toHaveLength(1);

    await t.mutation(api.mfas.remove, { mfaId, practiceId });

    const remainingMfas = await t.query(api.mfas.list, { practiceId });
    const afterDelete = await t.query(api.vacations.getVacationsInRange, {
      endDateExclusive: "2026-08-01",
      practiceId,
      startDate: "2026-07-01",
    });

    expect(remainingMfas).toHaveLength(0);
    expect(afterDelete).toHaveLength(0);
  });

  test("practitioner vacations block morning slots and both halves block the full day", async () => {
    const t = createAuthedTestContext();
    const fixture = await createSchedulingFixture(t);
    const monday = nextWeekday(1).toString();

    await t.mutation(api.vacations.createVacation, {
      date: monday,
      portion: "morning",
      practiceId: fixture.practiceId,
      practitionerId: fixture.practitionerId,
      staffType: "practitioner",
    });

    const morningResult = await t.query(api.scheduling.getSlotsForDay, {
      date: monday,
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
      simulatedContext: {
        appointmentTypeId: fixture.appointmentTypeId,
        locationId: fixture.locationId,
        patient: { isNew: true },
      },
    });

    const blockedMorningSlot = morningResult.slots.find((slot) =>
      slot.startTime.includes("T09:00:00"),
    );
    const availableAfternoonSlot = morningResult.slots.find((slot) =>
      slot.startTime.includes("T13:00:00"),
    );

    expect(blockedMorningSlot?.status).toBe("BLOCKED");
    expect(blockedMorningSlot?.reason).toBe("Urlaub");
    expect(availableAfternoonSlot?.status).toBe("AVAILABLE");

    await t.mutation(api.vacations.createVacation, {
      date: monday,
      portion: "afternoon",
      practiceId: fixture.practiceId,
      practitionerId: fixture.practitionerId,
      staffType: "practitioner",
    });

    const fullDayResult = await t.query(api.scheduling.getSlotsForDay, {
      date: monday,
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
      simulatedContext: {
        appointmentTypeId: fixture.appointmentTypeId,
        locationId: fixture.locationId,
        patient: { isNew: true },
      },
    });

    expect(fullDayResult.slots.every((slot) => slot.status === "BLOCKED")).toBe(
      true,
    );
  });
});
