import { convexTest } from "convex-test";
import { Temporal } from "temporal-polyfill";
import { describe, expect, test } from "vitest";

import { insertSelfLineageEntity } from "../lineage";
import { buildPreloadedDayData } from "../ruleEngine";
import schema from "../schema";
import { modules } from "./test.setup";

function createTestContext() {
  return convexTest(schema, modules);
}

describe("ruleEngine preloaded day data", () => {
  test("buildPreloadedDayData excludes cancelled appointments", async () => {
    const t = createTestContext();

    const fixture = await t.run(async (ctx) => {
      const practiceId = await ctx.db.insert("practices", {
        name: "Rule Engine Preload Test Practice",
      });
      const ruleSetId = await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Rule Engine Preload Test Rule Set",
        draftRevision: 0,
        practiceId,
        saved: true,
        version: 1,
      });
      const locationId = await insertSelfLineageEntity(ctx.db, "locations", {
        name: "Main Location",
        practiceId,
        ruleSetId,
      });
      const practitionerId = await insertSelfLineageEntity(
        ctx.db,
        "practitioners",
        {
          name: "Dr. Rules",
          practiceId,
          ruleSetId,
        },
      );
      const now = BigInt(Date.now());
      const appointmentTypeId = await insertSelfLineageEntity(
        ctx.db,
        "appointmentTypes",
        {
          allowedPractitionerLineageKeys: [practitionerId],
          createdAt: now,
          duration: 30,
          lastModified: now,
          name: "Checkup",
          practiceId,
          ruleSetId,
        },
      );

      const day = Temporal.Now.plainDateISO("Europe/Berlin").add({ days: 2 });
      const start = day.toZonedDateTime({
        plainTime: { hour: 10, minute: 0 },
        timeZone: "Europe/Berlin",
      });
      const end = start.add({ minutes: 30 });

      const activeAppointmentId = await ctx.db.insert("appointments", {
        appointmentTypeLineageKey: appointmentTypeId,
        appointmentTypeTitle: "Checkup",
        createdAt: now,
        end: end.toString(),
        isSimulation: false,
        lastModified: now,
        locationLineageKey: locationId,
        practiceId,
        practitionerLineageKey: practitionerId,
        start: start.toString(),
        title: "Active appointment",
      });

      await ctx.db.insert("appointments", {
        appointmentTypeLineageKey: appointmentTypeId,
        appointmentTypeTitle: "Checkup",
        cancelledAt: now,
        createdAt: now,
        end: end.add({ minutes: 30 }).toString(),
        isSimulation: false,
        lastModified: now,
        locationLineageKey: locationId,
        practiceId,
        practitionerLineageKey: practitionerId,
        start: start.add({ minutes: 30 }).toString(),
        title: "Cancelled appointment",
      });

      return {
        activeAppointmentId,
        appointmentTypeId,
        day: day.toString(),
        practiceId,
        practitionerId,
        ruleSetId,
      };
    });

    const result = await t.run(async (ctx) => {
      const practitioner = await ctx.db.get(
        "practitioners",
        fixture.practitionerId,
      );
      if (!practitioner) {
        throw new Error("Practitioner missing");
      }

      const preloaded = await buildPreloadedDayData(
        ctx.db,
        fixture.practiceId,
        fixture.day,
        fixture.ruleSetId,
        [practitioner],
      );

      const practiceTypeKey = `practice:${fixture.appointmentTypeId}`;
      return {
        appointmentCount: preloaded.appointments.length,
        appointmentsByStartTimeSize: preloaded.appointmentsByStartTime.size,
        dailyCount: preloaded.dailyCapacityCounts.get(practiceTypeKey) ?? 0,
        firstAppointmentId: preloaded.appointments[0]?._id,
      };
    });

    expect(result.appointmentCount).toBe(1);
    expect(result.dailyCount).toBe(1);
    expect(result.appointmentsByStartTimeSize).toBe(1);
    expect(result.firstAppointmentId).toBe(fixture.activeAppointmentId);
  });

  test("buildPreloadedDayData keys counts by stable appointment type lineage", async () => {
    const t = createTestContext();

    const fixture = await t.run(async (ctx) => {
      const practiceId = await ctx.db.insert("practices", {
        name: "Rule Engine Preload Mapping Practice",
      });
      const baseRuleSetId = await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Base Rule Set",
        draftRevision: 0,
        practiceId,
        saved: true,
        version: 1,
      });
      const copiedRuleSetId = await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Copied Rule Set",
        draftRevision: 0,
        parentVersion: baseRuleSetId,
        practiceId,
        saved: true,
        version: 2,
      });

      const baseLocationId = await insertSelfLineageEntity(
        ctx.db,
        "locations",
        {
          name: "Base Location",
          practiceId,
          ruleSetId: baseRuleSetId,
        },
      );
      await insertSelfLineageEntity(ctx.db, "locations", {
        lineageKey: baseLocationId,
        name: "Copied Location",
        practiceId,
        ruleSetId: copiedRuleSetId,
      });
      const basePractitionerId = await insertSelfLineageEntity(
        ctx.db,
        "practitioners",
        {
          name: "Dr. Base",
          practiceId,
          ruleSetId: baseRuleSetId,
        },
      );
      const copiedPractitionerId = await insertSelfLineageEntity(
        ctx.db,
        "practitioners",
        {
          lineageKey: basePractitionerId,
          name: "Dr. Copied",
          practiceId,
          ruleSetId: copiedRuleSetId,
        },
      );
      const now = BigInt(Date.now());
      const baseAppointmentTypeId = await insertSelfLineageEntity(
        ctx.db,
        "appointmentTypes",
        {
          allowedPractitionerLineageKeys: [basePractitionerId],
          createdAt: now,
          duration: 30,
          lastModified: now,
          name: "Checkup",
          practiceId,
          ruleSetId: baseRuleSetId,
        },
      );
      const copiedAppointmentTypeId = await insertSelfLineageEntity(
        ctx.db,
        "appointmentTypes",
        {
          allowedPractitionerLineageKeys: [basePractitionerId],
          createdAt: now,
          duration: 30,
          lastModified: now,
          lineageKey: baseAppointmentTypeId,
          name: "Checkup Copy",
          practiceId,
          ruleSetId: copiedRuleSetId,
        },
      );

      const day = Temporal.Now.plainDateISO("Europe/Berlin").add({ days: 2 });
      const start = day.toZonedDateTime({
        plainTime: { hour: 10, minute: 0 },
        timeZone: "Europe/Berlin",
      });
      const end = start.add({ minutes: 30 });

      await ctx.db.insert("appointments", {
        appointmentTypeLineageKey: baseAppointmentTypeId,
        appointmentTypeTitle: "Checkup",
        createdAt: now,
        end: end.toString(),
        isSimulation: false,
        lastModified: now,
        locationLineageKey: baseLocationId,
        practiceId,
        practitionerLineageKey: basePractitionerId,
        start: start.toString(),
        title: "Mapped appointment",
      });

      return {
        baseAppointmentTypeId,
        copiedAppointmentTypeId,
        copiedPractitionerId,
        copiedRuleSetId,
        day: day.toString(),
        practiceId,
      };
    });

    const result = await t.run(async (ctx) => {
      const copiedPractitioner = await ctx.db.get(
        "practitioners",
        fixture.copiedPractitionerId,
      );
      if (!copiedPractitioner) {
        throw new Error("Copied practitioner missing");
      }

      const preloaded = await buildPreloadedDayData(
        ctx.db,
        fixture.practiceId,
        fixture.day,
        fixture.copiedRuleSetId,
        [copiedPractitioner],
      );

      return {
        copiedPracticeTypeCount:
          preloaded.dailyCapacityCounts.get(
            `practice:${fixture.baseAppointmentTypeId}`,
          ) ?? 0,
        copiedPractitionerScopeCount:
          preloaded.parsedAppointmentsByScope.get(
            `practitioner:${fixture.copiedPractitionerId}`,
          )?.length ?? 0,
      };
    });

    expect(result.copiedPracticeTypeCount).toBe(1);
    expect(result.copiedPractitionerScopeCount).toBe(1);
  });
});
