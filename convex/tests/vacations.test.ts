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
    const activeRuleSet = await t.query(api.ruleSets.getActiveRuleSet, {
      practiceId,
    });
    assertDefined(activeRuleSet);

    await t.mutation(api.mfas.create, {
      expectedDraftRevision: null,
      name: "Anna Assistenz",
      practiceId,
      selectedRuleSetId: activeRuleSet._id,
    });

    const unsavedRuleSet = await t.query(api.ruleSets.getUnsavedRuleSet, {
      practiceId,
    });
    assertDefined(unsavedRuleSet);
    const createdMfas = await t.query(api.mfas.list, {
      ruleSetId: unsavedRuleSet._id,
    });
    const createdMfa = createdMfas[0];
    assertDefined(createdMfa);

    await t.mutation(api.vacations.createVacation, {
      date: "2026-07-01",
      expectedDraftRevision: unsavedRuleSet.draftRevision,
      mfaId: createdMfa._id,
      portion: "full",
      practiceId,
      selectedRuleSetId: unsavedRuleSet._id,
      staffType: "mfa",
    });

    const beforeDelete = await t.query(api.vacations.getVacationsInRange, {
      endDateExclusive: "2026-08-01",
      ruleSetId: unsavedRuleSet._id,
      startDate: "2026-07-01",
    });
    expect(beforeDelete).toHaveLength(1);

    const updatedUnsavedRuleSet = await t.query(
      api.ruleSets.getUnsavedRuleSet,
      {
        practiceId,
      },
    );
    assertDefined(updatedUnsavedRuleSet);

    await t.mutation(api.mfas.remove, {
      expectedDraftRevision: updatedUnsavedRuleSet.draftRevision,
      mfaId: createdMfa._id,
      practiceId,
      selectedRuleSetId: updatedUnsavedRuleSet._id,
    });

    const refreshedUnsavedRuleSet = await t.query(
      api.ruleSets.getUnsavedRuleSet,
      {
        practiceId,
      },
    );
    assertDefined(refreshedUnsavedRuleSet);

    const remainingMfas = await t.query(api.mfas.list, {
      ruleSetId: refreshedUnsavedRuleSet._id,
    });
    const afterDelete = await t.query(api.vacations.getVacationsInRange, {
      endDateExclusive: "2026-08-01",
      ruleSetId: refreshedUnsavedRuleSet._id,
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
      expectedDraftRevision: null,
      portion: "morning",
      practiceId: fixture.practiceId,
      practitionerId: fixture.practitionerId,
      selectedRuleSetId: fixture.ruleSetId,
      staffType: "practitioner",
    });

    const unsavedRuleSet = await t.query(api.ruleSets.getUnsavedRuleSet, {
      practiceId: fixture.practiceId,
    });
    assertDefined(unsavedRuleSet);
    const unsavedLocations = await t.query(api.entities.getLocations, {
      ruleSetId: unsavedRuleSet._id,
    });
    const unsavedAppointmentTypes = await t.query(
      api.entities.getAppointmentTypes,
      {
        ruleSetId: unsavedRuleSet._id,
      },
    );
    const unsavedLocation = unsavedLocations[0];
    const unsavedAppointmentType = unsavedAppointmentTypes[0];
    assertDefined(unsavedLocation);
    assertDefined(unsavedAppointmentType);

    const morningResult = await t.query(api.scheduling.getSlotsForDay, {
      date: monday,
      practiceId: fixture.practiceId,
      ruleSetId: unsavedRuleSet._id,
      simulatedContext: {
        appointmentTypeId: unsavedAppointmentType._id,
        locationId: unsavedLocation._id,
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
      expectedDraftRevision: unsavedRuleSet.draftRevision,
      portion: "afternoon",
      practiceId: fixture.practiceId,
      practitionerId: fixture.practitionerId,
      selectedRuleSetId: unsavedRuleSet._id,
      staffType: "practitioner",
    });

    const refreshedUnsavedRuleSet = await t.query(
      api.ruleSets.getUnsavedRuleSet,
      {
        practiceId: fixture.practiceId,
      },
    );
    assertDefined(refreshedUnsavedRuleSet);
    const refreshedLocations = await t.query(api.entities.getLocations, {
      ruleSetId: refreshedUnsavedRuleSet._id,
    });
    const refreshedAppointmentTypes = await t.query(
      api.entities.getAppointmentTypes,
      {
        ruleSetId: refreshedUnsavedRuleSet._id,
      },
    );
    const refreshedLocation = refreshedLocations[0];
    const refreshedAppointmentType = refreshedAppointmentTypes[0];
    assertDefined(refreshedLocation);
    assertDefined(refreshedAppointmentType);

    const fullDayResult = await t.query(api.scheduling.getSlotsForDay, {
      date: monday,
      practiceId: fixture.practiceId,
      ruleSetId: refreshedUnsavedRuleSet._id,
      simulatedContext: {
        appointmentTypeId: refreshedAppointmentType._id,
        locationId: refreshedLocation._id,
        patient: { isNew: true },
      },
    });

    expect(fullDayResult.slots.every((slot) => slot.status === "BLOCKED")).toBe(
      true,
    );
  });

  test("vacation redo reuses vacation lineage after equivalent draft discard", async () => {
    const t = createAuthedTestContext();
    const fixture = await createSchedulingFixture(t);
    const firstDate = "2026-07-06";
    const secondDate = "2026-07-07";

    const firstCreate = await t.mutation(api.vacations.createVacation, {
      date: firstDate,
      expectedDraftRevision: null,
      portion: "full",
      practiceId: fixture.practiceId,
      practitionerId: fixture.practitionerId,
      selectedRuleSetId: fixture.ruleSetId,
      staffType: "practitioner",
    });
    assertDefined(firstCreate.entityId);

    const secondCreate = await t.mutation(api.vacations.createVacation, {
      date: secondDate,
      expectedDraftRevision: firstCreate.draftRevision,
      portion: "full",
      practiceId: fixture.practiceId,
      practitionerId: fixture.practitionerId,
      selectedRuleSetId: firstCreate.ruleSetId,
      staffType: "practitioner",
    });
    assertDefined(secondCreate.entityId);

    const secondUndo = await t.mutation(api.vacations.deleteVacation, {
      date: secondDate,
      expectedDraftRevision: secondCreate.draftRevision,
      lineageKey: secondCreate.entityId,
      portion: "full",
      practiceId: fixture.practiceId,
      practitionerId: fixture.practitionerId,
      selectedRuleSetId: secondCreate.ruleSetId,
      staffType: "practitioner",
    });

    const firstUndo = await t.mutation(api.vacations.deleteVacation, {
      date: firstDate,
      expectedDraftRevision: secondUndo.draftRevision,
      lineageKey: firstCreate.entityId,
      portion: "full",
      practiceId: fixture.practiceId,
      practitionerId: fixture.practitionerId,
      selectedRuleSetId: secondUndo.ruleSetId,
      staffType: "practitioner",
    });

    const discardResult = await t.mutation(
      api.ruleSets.discardUnsavedRuleSetIfEquivalentToParent,
      {
        practiceId: fixture.practiceId,
        ruleSetId: firstUndo.ruleSetId,
      },
    );
    expect(discardResult.deleted).toBe(true);

    const firstRedo = await t.mutation(api.vacations.createVacation, {
      date: firstDate,
      expectedDraftRevision: null,
      lineageKey: firstCreate.entityId,
      portion: "full",
      practiceId: fixture.practiceId,
      practitionerId: fixture.practitionerId,
      selectedRuleSetId: fixture.ruleSetId,
      staffType: "practitioner",
    });

    const secondRedo = await t.mutation(api.vacations.createVacation, {
      date: secondDate,
      expectedDraftRevision: firstRedo.draftRevision,
      lineageKey: secondCreate.entityId,
      portion: "full",
      practiceId: fixture.practiceId,
      practitionerId: fixture.practitionerId,
      selectedRuleSetId: firstRedo.ruleSetId,
      staffType: "practitioner",
    });

    const vacations = await t.query(api.vacations.getVacationsInRange, {
      endDateExclusive: "2026-07-08",
      ruleSetId: secondRedo.ruleSetId,
      startDate: firstDate,
    });

    expect(vacations).toHaveLength(2);
    expect(vacations.map((vacation) => vacation.lineageKey).toSorted()).toEqual(
      [firstCreate.entityId, secondCreate.entityId].toSorted(),
    );
  });
});
