import { convexTest } from "convex-test";
import { Temporal } from "temporal-polyfill";
import { describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";

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
      const locationId = await ctx.db.insert("locations", {
        name: "Main Location",
        practiceId,
        ruleSetId,
      });
      const practitionerId = await ctx.db.insert("practitioners", {
        name: "Dr. Rules",
        practiceId,
        ruleSetId,
      });
      const now = BigInt(Date.now());
      const appointmentTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerIds: [practitionerId],
        createdAt: now,
        duration: 30,
        lastModified: now,
        name: "Checkup",
        practiceId,
        ruleSetId,
      });

      const day = Temporal.Now.plainDateISO("Europe/Berlin").add({ days: 2 });
      const start = day.toZonedDateTime({
        plainTime: { hour: 10, minute: 0 },
        timeZone: "Europe/Berlin",
      });
      const end = start.add({ minutes: 30 });

      const activeAppointmentId = await ctx.db.insert("appointments", {
        appointmentTypeId,
        appointmentTypeTitle: "Checkup",
        createdAt: now,
        end: end.toString(),
        isSimulation: false,
        lastModified: now,
        locationId,
        practiceId,
        practitionerId,
        start: start.toString(),
        title: "Active appointment",
      });

      await ctx.db.insert("appointments", {
        appointmentTypeId,
        appointmentTypeTitle: "Checkup",
        cancelledAt: now,
        createdAt: now,
        end: end.add({ minutes: 30 }).toString(),
        isSimulation: false,
        lastModified: now,
        locationId,
        practiceId,
        practitionerId,
        start: start.add({ minutes: 30 }).toString(),
        title: "Cancelled appointment",
      });

      return {
        activeAppointmentId,
        appointmentTypeId,
        day: day.toString(),
        practiceId,
        practitionerId,
      };
    });

    const result = await t.run(async (ctx) => {
      const practitioner = await ctx.db.get(
        "practitioners",
        fixture.practitionerId as Id<"practitioners">,
      );
      if (!practitioner) {
        throw new Error("Practitioner missing");
      }

      const preloaded = await buildPreloadedDayData(
        ctx.db,
        fixture.practiceId as Id<"practices">,
        fixture.day,
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
});
