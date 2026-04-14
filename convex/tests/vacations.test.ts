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

async function createCoverageFixture(
  t: ReturnType<typeof createAuthedTestContext>,
) {
  await ensureProvisionedUser(t);
  return await t.run(async (ctx) => {
    const practiceId = await ctx.db.insert("practices", {
      name: "Coverage Test Practice",
    });

    const ruleSetId = await ctx.db.insert("ruleSets", {
      createdAt: Date.now(),
      description: "Coverage Rule Set",
      draftRevision: 0,
      practiceId,
      saved: true,
      version: 1,
    });

    await ctx.db.patch("practices", practiceId, {
      currentActiveRuleSetId: ruleSetId,
    });

    const user = await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", "workos_vacations"))
      .first();
    assertDefined(user);
    await ctx.db.insert("practiceMembers", {
      createdAt: BigInt(Date.now()),
      practiceId,
      role: "owner",
      userId: user._id,
    });

    const locationId = await insertWithLineage(ctx, "locations", {
      name: "Praxis",
      practiceId,
      ruleSetId,
    });
    const absentPractitionerId = await insertWithLineage(ctx, "practitioners", {
      name: "Dr. Urlaub",
      practiceId,
      ruleSetId,
    });
    const preferredPractitionerId = await insertWithLineage(
      ctx,
      "practitioners",
      {
        name: "Dr. Zuletzt Gesehen",
        practiceId,
        ruleSetId,
      },
    );
    const fallbackPractitionerId = await insertWithLineage(
      ctx,
      "practitioners",
      {
        name: "Dr. Frei",
        practiceId,
        ruleSetId,
      },
    );

    for (const practitionerId of [
      absentPractitionerId,
      preferredPractitionerId,
      fallbackPractitionerId,
    ]) {
      await insertWithLineage(ctx, "baseSchedules", {
        dayOfWeek: 1,
        endTime: "16:00",
        locationId,
        practiceId,
        practitionerId,
        ruleSetId,
        startTime: "08:00",
      });
    }

    const appointmentTypeId = await insertWithLineage(ctx, "appointmentTypes", {
      allowedPractitionerIds: [
        absentPractitionerId,
        preferredPractitionerId,
        fallbackPractitionerId,
      ],
      createdAt: BigInt(Date.now()),
      duration: 30,
      followUpPlan: [],
      lastModified: BigInt(Date.now()),
      name: "Kontrolle",
      practiceId,
      ruleSetId,
    });

    const patientId = await ctx.db.insert("patients", {
      createdAt: BigInt(Date.now()),
      dateOfBirth: "1980-01-01",
      firstName: "Paula",
      lastModified: BigInt(Date.now()),
      lastName: "Patientin",
      patientId: 1001,
      practiceId,
    });

    return {
      absentPractitionerId,
      appointmentTypeId,
      fallbackPractitionerId,
      locationId,
      patientId,
      practiceId,
      preferredPractitionerId,
      ruleSetId,
    };
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
  test("coverage preview prefers the practitioner the patient saw last and reports leftovers", async () => {
    const t = createAuthedTestContext();
    const fixture = await createCoverageFixture(t);
    const monday = nextWeekday(1);
    const now = BigInt(Date.now());

    await t.run(async (ctx) => {
      const olderStart = monday
        .subtract({ days: 21 })
        .toZonedDateTime({
          plainTime: Temporal.PlainTime.from("09:00"),
          timeZone: "Europe/Berlin",
        })
        .toString();
      const recentStart = monday
        .subtract({ days: 7 })
        .toZonedDateTime({
          plainTime: Temporal.PlainTime.from("09:00"),
          timeZone: "Europe/Berlin",
        })
        .toString();

      await ctx.db.insert("appointments", {
        appointmentTypeId: fixture.appointmentTypeId,
        appointmentTypeTitle: "Kontrolle",
        createdAt: now,
        end: Temporal.ZonedDateTime.from(olderStart)
          .add({ minutes: 30 })
          .toString(),
        lastModified: now,
        locationId: fixture.locationId,
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
        practitionerId: fixture.fallbackPractitionerId,
        start: olderStart,
        title: "Alter Termin",
      });

      await ctx.db.insert("appointments", {
        appointmentTypeId: fixture.appointmentTypeId,
        appointmentTypeTitle: "Kontrolle",
        createdAt: now,
        end: Temporal.ZonedDateTime.from(recentStart)
          .add({ minutes: 30 })
          .toString(),
        lastModified: now,
        locationId: fixture.locationId,
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
        practitionerId: fixture.preferredPractitionerId,
        start: recentStart,
        title: "Letzter Termin",
      });

      const movableStart = monday
        .toZonedDateTime({
          plainTime: Temporal.PlainTime.from("09:00"),
          timeZone: "Europe/Berlin",
        })
        .toString();
      const blockedStart = monday
        .toZonedDateTime({
          plainTime: Temporal.PlainTime.from("09:30"),
          timeZone: "Europe/Berlin",
        })
        .toString();

      for (const practitionerId of [
        fixture.preferredPractitionerId,
        fixture.fallbackPractitionerId,
      ]) {
        await ctx.db.insert("appointments", {
          appointmentTypeId: fixture.appointmentTypeId,
          appointmentTypeTitle: "Kontrolle",
          createdAt: now,
          end: Temporal.ZonedDateTime.from(blockedStart)
            .add({ minutes: 30 })
            .toString(),
          lastModified: now,
          locationId: fixture.locationId,
          practiceId: fixture.practiceId,
          practitionerId,
          start: blockedStart,
          title: "Blockiert",
        });
      }

      await ctx.db.insert("appointments", {
        appointmentTypeId: fixture.appointmentTypeId,
        appointmentTypeTitle: "Kontrolle",
        createdAt: now,
        end: Temporal.ZonedDateTime.from(movableStart)
          .add({ minutes: 30 })
          .toString(),
        lastModified: now,
        locationId: fixture.locationId,
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        start: movableStart,
        title: "Soll verschoben werden",
      });

      await ctx.db.insert("appointments", {
        appointmentTypeId: fixture.appointmentTypeId,
        appointmentTypeTitle: "Kontrolle",
        createdAt: now,
        end: Temporal.ZonedDateTime.from(blockedStart)
          .add({ minutes: 30 })
          .toString(),
        lastModified: now,
        locationId: fixture.locationId,
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        start: blockedStart,
        title: "Bleibt in Restliste",
      });
    });

    const preview = await t.query(
      api.appointmentCoverage.previewPractitionerAbsenceCoverage,
      {
        date: monday.toString(),
        portion: "morning",
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        ruleSetId: fixture.ruleSetId,
      },
    );

    expect(preview.affectedCount).toBe(2);
    expect(preview.movableCount).toBe(1);
    expect(preview.unmovedCount).toBe(1);
    expect(
      preview.suggestions.find(
        (suggestion: (typeof preview.suggestions)[number]) =>
          suggestion.targetPractitionerId !== undefined,
      )?.targetPractitionerId,
    ).toBe(fixture.preferredPractitionerId);
    expect(
      preview.suggestions.find(
        (suggestion: (typeof preview.suggestions)[number]) =>
          suggestion.targetPractitionerId === undefined,
      ),
    ).toBeDefined();
  });

  test("coverage preview skips draft-only practitioners without active lineage matches", async () => {
    const t = createAuthedTestContext();
    const fixture = await createCoverageFixture(t);
    const monday = nextWeekday(1);
    const now = BigInt(Date.now());

    const draftPractitioner = await t.mutation(
      api.entities.createPractitioner,
      {
        expectedDraftRevision: null,
        name: "Dr. Nur Im Draft",
        practiceId: fixture.practiceId,
        selectedRuleSetId: fixture.ruleSetId,
      },
    );

    await t.run(async (ctx) => {
      const draftAppointmentType = await ctx.db
        .query("appointmentTypes")
        .withIndex("by_ruleSetId_lineageKey", (q) =>
          q
            .eq("ruleSetId", draftPractitioner.ruleSetId)
            .eq("lineageKey", fixture.appointmentTypeId),
        )
        .first();
      assertDefined(draftAppointmentType);

      const draftLocation = await ctx.db
        .query("locations")
        .withIndex("by_ruleSetId_lineageKey", (q) =>
          q
            .eq("ruleSetId", draftPractitioner.ruleSetId)
            .eq("lineageKey", fixture.locationId),
        )
        .first();
      assertDefined(draftLocation);

      await ctx.db.patch("appointmentTypes", draftAppointmentType._id, {
        allowedPractitionerIds: [
          ...draftAppointmentType.allowedPractitionerIds,
          draftPractitioner.entityId,
        ],
      });

      await insertWithLineage(ctx, "baseSchedules", {
        dayOfWeek: 1,
        endTime: "12:00",
        locationId: draftLocation._id,
        practiceId: fixture.practiceId,
        practitionerId: draftPractitioner.entityId,
        ruleSetId: draftPractitioner.ruleSetId,
        startTime: "08:00",
      });

      const start = monday
        .toZonedDateTime({
          plainTime: Temporal.PlainTime.from("09:00"),
          timeZone: "Europe/Berlin",
        })
        .toString();
      await ctx.db.insert("appointments", {
        appointmentTypeId: fixture.appointmentTypeId,
        appointmentTypeTitle: "Kontrolle",
        createdAt: now,
        end: Temporal.ZonedDateTime.from(start).add({ minutes: 30 }).toString(),
        lastModified: now,
        locationId: fixture.locationId,
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        start,
        title: "Termin",
      });
    });

    const preview = await t.query(
      api.appointmentCoverage.previewPractitionerAbsenceCoverage,
      {
        date: monday.toString(),
        portion: "morning",
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        ruleSetId: draftPractitioner.ruleSetId,
      },
    );

    expect(preview.affectedCount).toBe(1);
    expect(preview.movableCount).toBe(1);
    expect(preview.unmovedCount).toBe(0);
    expect(preview.suggestions[0]?.targetPractitionerId).not.toBe(
      draftPractitioner.entityId,
    );
    expect([
      fixture.preferredPractitionerId,
      fixture.fallbackPractitionerId,
    ]).toContain(preview.suggestions[0]?.targetPractitionerId);
  });

  test("coverage preview does not mark practitioners as movable when only the draft appointment type allows them", async () => {
    const t = createAuthedTestContext();
    const fixture = await createCoverageFixture(t);
    const monday = nextWeekday(1);
    const now = BigInt(Date.now());

    await t.run(async (ctx) => {
      await ctx.db.patch("appointmentTypes", fixture.appointmentTypeId, {
        allowedPractitionerIds: [fixture.absentPractitionerId],
      });
    });

    const draftVacation = await t.mutation(api.vacations.createVacation, {
      date: monday.toString(),
      expectedDraftRevision: null,
      portion: "morning",
      practiceId: fixture.practiceId,
      practitionerId: fixture.absentPractitionerId,
      selectedRuleSetId: fixture.ruleSetId,
      staffType: "practitioner",
    });

    await t.run(async (ctx) => {
      const draftAppointmentType = await ctx.db
        .query("appointmentTypes")
        .withIndex("by_ruleSetId_lineageKey", (q) =>
          q
            .eq("ruleSetId", draftVacation.ruleSetId)
            .eq("lineageKey", fixture.appointmentTypeId),
        )
        .first();
      assertDefined(draftAppointmentType);

      await ctx.db.patch("appointmentTypes", draftAppointmentType._id, {
        allowedPractitionerIds: [
          fixture.absentPractitionerId,
          fixture.preferredPractitionerId,
          fixture.fallbackPractitionerId,
        ],
      });

      const start = monday
        .toZonedDateTime({
          plainTime: Temporal.PlainTime.from("09:00"),
          timeZone: "Europe/Berlin",
        })
        .toString();
      await ctx.db.insert("appointments", {
        appointmentTypeId: fixture.appointmentTypeId,
        appointmentTypeTitle: "Kontrolle",
        createdAt: now,
        end: Temporal.ZonedDateTime.from(start).add({ minutes: 30 }).toString(),
        lastModified: now,
        locationId: fixture.locationId,
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        start,
        title: "Termin",
      });
    });

    const preview = await t.query(
      api.appointmentCoverage.previewPractitionerAbsenceCoverage,
      {
        date: monday.toString(),
        portion: "morning",
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        ruleSetId: draftVacation.ruleSetId,
      },
    );

    expect(preview.affectedCount).toBe(1);
    expect(preview.movableCount).toBe(0);
    expect(preview.unmovedCount).toBe(1);
    expect(preview.suggestions[0]?.targetPractitionerId).toBeUndefined();
  });

  test("creating a vacation with coverage adjustments stages simulation changes until activation", async () => {
    const t = createAuthedTestContext();
    const fixture = await createCoverageFixture(t);
    const monday = nextWeekday(1);
    const now = BigInt(Date.now());

    const appointmentId = await t.run(async (ctx) => {
      const start = monday
        .toZonedDateTime({
          plainTime: Temporal.PlainTime.from("09:00"),
          timeZone: "Europe/Berlin",
        })
        .toString();
      return await ctx.db.insert("appointments", {
        appointmentTypeId: fixture.appointmentTypeId,
        appointmentTypeTitle: "Kontrolle",
        createdAt: now,
        end: Temporal.ZonedDateTime.from(start).add({ minutes: 30 }).toString(),
        lastModified: now,
        locationId: fixture.locationId,
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        start,
        title: "Termin",
      });
    });

    const result = await t.mutation(
      api.vacations.createVacationWithCoverageAdjustments,
      {
        date: monday.toString(),
        expectedDraftRevision: null,
        portion: "morning",
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        reassignments: [
          {
            appointmentId,
            targetPractitionerId: fixture.preferredPractitionerId,
          },
        ],
        selectedRuleSetId: fixture.ruleSetId,
      },
    );

    const unchangedAppointment = await t.run(async (ctx) =>
      ctx.db.get("appointments", appointmentId),
    );
    const simulatedAppointments = await t.query(
      api.appointments.getAppointments,
      {
        activeRuleSetId: fixture.ruleSetId,
        scope: "simulation",
        selectedRuleSetId: result.ruleSetId,
      },
    );
    const draftPractitioners = await t.query(api.entities.getPractitioners, {
      ruleSetId: result.ruleSetId,
    });
    const draftPreferredPractitionerId = draftPractitioners.find(
      (practitioner) =>
        practitioner.lineageKey === fixture.preferredPractitionerId,
    )?._id;
    assertDefined(draftPreferredPractitionerId);
    const vacations = await t.query(api.vacations.getVacationsInRange, {
      endDateExclusive: monday.add({ days: 1 }).toString(),
      ruleSetId: result.ruleSetId,
      startDate: monday.toString(),
    });

    expect(unchangedAppointment?.practitionerId).toBe(
      fixture.absentPractitionerId,
    );
    expect(
      simulatedAppointments.find(
        (candidate) => candidate.replacesAppointmentId === appointmentId,
      )?.practitionerId,
    ).toBe(draftPreferredPractitionerId);
    expect(vacations).toHaveLength(1);
    expect(vacations[0]?.portion).toBe("morning");

    await t.mutation(api.ruleSets.saveUnsavedRuleSet, {
      description: "Urlaubsplanung",
      practiceId: fixture.practiceId,
      setAsActive: true,
    });

    const activatedAppointment = await t.run(async (ctx) =>
      ctx.db.get("appointments", appointmentId),
    );
    const remainingSimulations = await t.run(async (ctx) =>
      ctx.db
        .query("appointments")
        .withIndex("by_simulationRuleSetId", (q) =>
          q.eq("simulationRuleSetId", result.ruleSetId),
        )
        .collect(),
    );

    expect(activatedAppointment?.practitionerId).toBe(
      draftPreferredPractitionerId,
    );
    expect(remainingSimulations).toHaveLength(0);
  });

  test("coverage preview ignores appointments already replaced in the same draft", async () => {
    const t = createAuthedTestContext();
    const fixture = await createCoverageFixture(t);
    const monday = nextWeekday(1);
    const now = BigInt(Date.now());

    const appointmentId = await t.run(async (ctx) => {
      const start = monday
        .toZonedDateTime({
          plainTime: Temporal.PlainTime.from("09:00"),
          timeZone: "Europe/Berlin",
        })
        .toString();
      return await ctx.db.insert("appointments", {
        appointmentTypeId: fixture.appointmentTypeId,
        appointmentTypeTitle: "Kontrolle",
        createdAt: now,
        end: Temporal.ZonedDateTime.from(start).add({ minutes: 30 }).toString(),
        lastModified: now,
        locationId: fixture.locationId,
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        start,
        title: "Termin",
      });
    });

    const draftResult = await t.mutation(
      api.vacations.createVacationWithCoverageAdjustments,
      {
        date: monday.toString(),
        expectedDraftRevision: null,
        portion: "morning",
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        reassignments: [
          {
            appointmentId,
            targetPractitionerId: fixture.preferredPractitionerId,
          },
        ],
        selectedRuleSetId: fixture.ruleSetId,
      },
    );

    const preview = await t.query(
      api.appointmentCoverage.previewPractitionerAbsenceCoverage,
      {
        date: monday.toString(),
        portion: "morning",
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        ruleSetId: draftResult.ruleSetId,
      },
    );

    expect(preview.affectedCount).toBe(0);
    expect(preview.movableCount).toBe(0);
    expect(preview.suggestions).toHaveLength(0);
  });

  test("coverage adjustments reject appointments outside the requested vacation date and portion", async () => {
    const t = createAuthedTestContext();
    const fixture = await createCoverageFixture(t);
    const monday = nextWeekday(1);
    const tuesday = monday.add({ days: 1 });
    const now = BigInt(Date.now());

    const staleAppointmentId = await t.run(async (ctx) => {
      const start = tuesday
        .toZonedDateTime({
          plainTime: Temporal.PlainTime.from("09:00"),
          timeZone: "Europe/Berlin",
        })
        .toString();
      return await ctx.db.insert("appointments", {
        appointmentTypeId: fixture.appointmentTypeId,
        appointmentTypeTitle: "Kontrolle",
        createdAt: now,
        end: Temporal.ZonedDateTime.from(start).add({ minutes: 30 }).toString(),
        lastModified: now,
        locationId: fixture.locationId,
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        start,
        title: "Nicht betroffen",
      });
    });

    await expect(
      t.mutation(api.vacations.createVacationWithCoverageAdjustments, {
        date: monday.toString(),
        expectedDraftRevision: null,
        portion: "morning",
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        reassignments: [
          {
            appointmentId: staleAppointmentId,
            targetPractitionerId: fixture.preferredPractitionerId,
          },
        ],
        selectedRuleSetId: fixture.ruleSetId,
      }),
    ).rejects.toThrow("nicht vom angefragten Urlaub betroffen");
  });

  test("coverage adjustments reject targets that became unavailable in the draft", async () => {
    const t = createAuthedTestContext();
    const fixture = await createCoverageFixture(t);
    const monday = nextWeekday(1);
    const now = BigInt(Date.now());

    const appointmentId = await t.run(async (ctx) => {
      const start = monday
        .toZonedDateTime({
          plainTime: Temporal.PlainTime.from("09:00"),
          timeZone: "Europe/Berlin",
        })
        .toString();
      return await ctx.db.insert("appointments", {
        appointmentTypeId: fixture.appointmentTypeId,
        appointmentTypeTitle: "Kontrolle",
        createdAt: now,
        end: Temporal.ZonedDateTime.from(start).add({ minutes: 30 }).toString(),
        lastModified: now,
        locationId: fixture.locationId,
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        start,
        title: "Termin",
      });
    });

    const draftVacation = await t.mutation(api.vacations.createVacation, {
      date: monday.toString(),
      expectedDraftRevision: null,
      portion: "morning",
      practiceId: fixture.practiceId,
      practitionerId: fixture.absentPractitionerId,
      selectedRuleSetId: fixture.ruleSetId,
      staffType: "practitioner",
    });

    await t.run(async (ctx) => {
      const draftPreferredPractitioner = await ctx.db
        .query("practitioners")
        .withIndex("by_ruleSetId_lineageKey", (q) =>
          q
            .eq("ruleSetId", draftVacation.ruleSetId)
            .eq("lineageKey", fixture.preferredPractitionerId),
        )
        .first();
      assertDefined(draftPreferredPractitioner);

      const draftAppointmentType = await ctx.db
        .query("appointmentTypes")
        .withIndex("by_ruleSetId_lineageKey", (q) =>
          q
            .eq("ruleSetId", draftVacation.ruleSetId)
            .eq("lineageKey", fixture.appointmentTypeId),
        )
        .first();
      assertDefined(draftAppointmentType);

      const draftLocation = await ctx.db
        .query("locations")
        .withIndex("by_ruleSetId_lineageKey", (q) =>
          q
            .eq("ruleSetId", draftVacation.ruleSetId)
            .eq("lineageKey", fixture.locationId),
        )
        .first();
      assertDefined(draftLocation);

      const draftBaseSchedules = await ctx.db
        .query("baseSchedules")
        .withIndex("by_ruleSetId", (q) =>
          q.eq("ruleSetId", draftVacation.ruleSetId),
        )
        .collect();

      const draftBaseSchedule = draftBaseSchedules.find(
        (schedule) =>
          schedule.practitionerId === draftPreferredPractitioner._id &&
          schedule.locationId === draftLocation._id,
      );
      assertDefined(draftBaseSchedule);

      await ctx.db.delete("baseSchedules", draftBaseSchedule._id);
    });

    await expect(
      t.mutation(api.vacations.createVacationWithCoverageAdjustments, {
        date: monday.toString(),
        expectedDraftRevision: draftVacation.draftRevision,
        portion: "morning",
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        reassignments: [
          {
            appointmentId,
            targetPractitionerId: fixture.preferredPractitionerId,
          },
        ],
        selectedRuleSetId: draftVacation.ruleSetId,
      }),
    ).rejects.toThrow("nicht mehr gueltig");
  });

  test("unsaved diff lists staged practitioner changes by patient surname", async () => {
    const t = createAuthedTestContext();
    const fixture = await createCoverageFixture(t);
    const monday = nextWeekday(1);
    const now = BigInt(Date.now());

    const appointmentId = await t.run(async (ctx) => {
      const start = monday
        .toZonedDateTime({
          plainTime: Temporal.PlainTime.from("09:00"),
          timeZone: "Europe/Berlin",
        })
        .toString();
      return await ctx.db.insert("appointments", {
        appointmentTypeId: fixture.appointmentTypeId,
        appointmentTypeTitle: "Kontrolle",
        createdAt: now,
        end: Temporal.ZonedDateTime.from(start).add({ minutes: 30 }).toString(),
        lastModified: now,
        locationId: fixture.locationId,
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        start,
        title: "Termin",
      });
    });

    const draftResult = await t.mutation(
      api.vacations.createVacationWithCoverageAdjustments,
      {
        date: monday.toString(),
        expectedDraftRevision: null,
        portion: "morning",
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        reassignments: [
          {
            appointmentId,
            targetPractitionerId: fixture.preferredPractitionerId,
          },
        ],
        selectedRuleSetId: fixture.ruleSetId,
      },
    );

    const diff = await t.query(api.ruleSets.getUnsavedRuleSetDiff, {
      practiceId: fixture.practiceId,
      ruleSetId: draftResult.ruleSetId,
    });

    const coverageSection = diff?.sections.find(
      (section) => section.key === "appointmentCoverage",
    );

    expect(coverageSection?.added).toHaveLength(1);
    expect(coverageSection?.removed).toHaveLength(1);
    expect(coverageSection?.added[0]).toContain("Dr. Zuletzt Gesehen");
    expect(coverageSection?.removed[0]).toContain("Dr. Urlaub");
    expect(coverageSection?.added[0]).toContain("Patientin");
  });

  test("drafts with only staged coverage changes are not discarded as equivalent", async () => {
    const t = createAuthedTestContext();
    const fixture = await createCoverageFixture(t);
    const monday = nextWeekday(1);
    const now = BigInt(Date.now());

    const appointmentId = await t.run(async (ctx) => {
      const start = monday
        .toZonedDateTime({
          plainTime: Temporal.PlainTime.from("09:00"),
          timeZone: "Europe/Berlin",
        })
        .toString();
      return await ctx.db.insert("appointments", {
        appointmentTypeId: fixture.appointmentTypeId,
        appointmentTypeTitle: "Kontrolle",
        createdAt: now,
        end: Temporal.ZonedDateTime.from(start).add({ minutes: 30 }).toString(),
        lastModified: now,
        locationId: fixture.locationId,
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        start,
        title: "Termin",
      });
    });

    const draftResult = await t.mutation(
      api.vacations.createVacationWithCoverageAdjustments,
      {
        date: monday.toString(),
        expectedDraftRevision: null,
        portion: "morning",
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        reassignments: [
          {
            appointmentId,
            targetPractitionerId: fixture.preferredPractitionerId,
          },
        ],
        selectedRuleSetId: fixture.ruleSetId,
      },
    );

    const discardResult = await t.mutation(
      api.ruleSets.discardUnsavedRuleSetIfEquivalentToParent,
      {
        practiceId: fixture.practiceId,
        ruleSetId: draftResult.ruleSetId,
      },
    );

    expect(discardResult.deleted).toBe(false);
    expect(discardResult.reason).toBe("has_changes");
  });

  test("deleting a vacation removes its staged coverage simulations", async () => {
    const t = createAuthedTestContext();
    const fixture = await createCoverageFixture(t);
    const monday = nextWeekday(1);
    const now = BigInt(Date.now());

    const appointmentId = await t.run(async (ctx) => {
      const start = monday
        .toZonedDateTime({
          plainTime: Temporal.PlainTime.from("09:00"),
          timeZone: "Europe/Berlin",
        })
        .toString();
      return await ctx.db.insert("appointments", {
        appointmentTypeId: fixture.appointmentTypeId,
        appointmentTypeTitle: "Kontrolle",
        createdAt: now,
        end: Temporal.ZonedDateTime.from(start).add({ minutes: 30 }).toString(),
        lastModified: now,
        locationId: fixture.locationId,
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        start,
        title: "Termin",
      });
    });

    const draftResult = await t.mutation(
      api.vacations.createVacationWithCoverageAdjustments,
      {
        date: monday.toString(),
        expectedDraftRevision: null,
        portion: "morning",
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        reassignments: [
          {
            appointmentId,
            targetPractitionerId: fixture.preferredPractitionerId,
          },
        ],
        selectedRuleSetId: fixture.ruleSetId,
      },
    );
    assertDefined(draftResult.entityId);

    await t.mutation(api.vacations.deleteVacation, {
      date: monday.toString(),
      expectedDraftRevision: draftResult.draftRevision,
      lineageKey: draftResult.entityId,
      portion: "morning",
      practiceId: fixture.practiceId,
      practitionerId: fixture.absentPractitionerId,
      selectedRuleSetId: draftResult.ruleSetId,
      staffType: "practitioner",
    });

    const simulatedAppointmentsAfterDelete = await t.query(
      api.appointments.getAppointments,
      {
        activeRuleSetId: fixture.ruleSetId,
        scope: "simulation",
        selectedRuleSetId: draftResult.ruleSetId,
      },
    );

    expect(
      simulatedAppointmentsAfterDelete.find(
        (candidate) => candidate.replacesAppointmentId === appointmentId,
      ),
    ).toBeUndefined();
  });

  test("replacing a practitioner vacation in draft recalculates staged coverage", async () => {
    const t = createAuthedTestContext();
    const fixture = await createCoverageFixture(t);
    const monday = nextWeekday(1);
    const now = BigInt(Date.now());

    const morningAppointmentId = await t.run(async (ctx) => {
      const start = monday
        .toZonedDateTime({
          plainTime: Temporal.PlainTime.from("09:00"),
          timeZone: "Europe/Berlin",
        })
        .toString();
      return await ctx.db.insert("appointments", {
        appointmentTypeId: fixture.appointmentTypeId,
        appointmentTypeTitle: "Kontrolle",
        createdAt: now,
        end: Temporal.ZonedDateTime.from(start).add({ minutes: 30 }).toString(),
        lastModified: now,
        locationId: fixture.locationId,
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        start,
        title: "Morgentermin",
      });
    });
    const afternoonAppointmentId = await t.run(async (ctx) => {
      const start = monday
        .toZonedDateTime({
          plainTime: Temporal.PlainTime.from("13:00"),
          timeZone: "Europe/Berlin",
        })
        .toString();
      return await ctx.db.insert("appointments", {
        appointmentTypeId: fixture.appointmentTypeId,
        appointmentTypeTitle: "Kontrolle",
        createdAt: now,
        end: Temporal.ZonedDateTime.from(start).add({ minutes: 30 }).toString(),
        lastModified: now,
        locationId: fixture.locationId,
        patientId: fixture.patientId,
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        start,
        title: "Nachmittagstermin",
      });
    });

    const firstDraft = await t.mutation(
      api.vacations.createVacationWithCoverageAdjustments,
      {
        date: monday.toString(),
        expectedDraftRevision: null,
        portion: "morning",
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        reassignments: [
          {
            appointmentId: morningAppointmentId,
            targetPractitionerId: fixture.preferredPractitionerId,
          },
        ],
        selectedRuleSetId: fixture.ruleSetId,
      },
    );
    assertDefined(firstDraft.entityId);

    const fullPreview = await t.query(
      api.appointmentCoverage.previewPractitionerAbsenceCoverage,
      {
        date: monday.toString(),
        portion: "full",
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        replacingVacationLineageKeys: [firstDraft.entityId],
        ruleSetId: firstDraft.ruleSetId,
      },
    );

    expect(fullPreview.affectedCount).toBe(2);
    expect(
      new Set(
        fullPreview.suggestions.map((suggestion) => suggestion.appointmentId),
      ),
    ).toEqual(new Set([afternoonAppointmentId, morningAppointmentId]));

    const updatedDraft = await t.mutation(
      api.vacations.createVacationWithCoverageAdjustments,
      {
        date: monday.toString(),
        expectedDraftRevision: firstDraft.draftRevision,
        portion: "full",
        practiceId: fixture.practiceId,
        practitionerId: fixture.absentPractitionerId,
        reassignments: fullPreview.suggestions.flatMap((suggestion) =>
          suggestion.targetPractitionerId
            ? [
                {
                  appointmentId: suggestion.appointmentId,
                  targetPractitionerId: suggestion.targetPractitionerId,
                },
              ]
            : [],
        ),
        replacingVacationLineageKeys: [firstDraft.entityId],
        selectedRuleSetId: firstDraft.ruleSetId,
      },
    );

    const draftVacations = await t.query(api.vacations.getVacationsInRange, {
      endDateExclusive: monday.add({ days: 1 }).toString(),
      ruleSetId: updatedDraft.ruleSetId,
      startDate: monday.toString(),
    });
    const simulatedAppointments = await t.query(
      api.appointments.getAppointments,
      {
        activeRuleSetId: fixture.ruleSetId,
        scope: "simulation",
        selectedRuleSetId: updatedDraft.ruleSetId,
      },
    );
    const replacementsForDay = simulatedAppointments.filter(
      (appointment) =>
        appointment.replacesAppointmentId === morningAppointmentId ||
        appointment.replacesAppointmentId === afternoonAppointmentId,
    );

    expect(draftVacations).toHaveLength(1);
    expect(draftVacations[0]?.lineageKey).toBe(firstDraft.entityId);
    expect(draftVacations[0]?.portion).toBe("full");
    expect(replacementsForDay).toHaveLength(2);
  });

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
