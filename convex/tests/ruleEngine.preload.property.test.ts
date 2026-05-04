import { convexTest } from "convex-test";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { describe, expect, test } from "vitest";

import { propertyTestParameters } from "../../src/tests/property-test-utils";
import { insertSelfLineageEntity } from "../lineage";
import { buildPreloadedDayData } from "../ruleEngine";
import schema from "../schema";
import { modules } from "./test.setup";

const appointmentFlagsArbitrary = fc.array(fc.boolean(), {
  maxLength: 8,
  minLength: 1,
});

function createTestContext() {
  return convexTest(schema, modules);
}

describe("ruleEngine preloaded day data properties", () => {
  test("cancelled appointments are excluded from preloaded day data", async () => {
    await fc.assert(
      fc.asyncProperty(appointmentFlagsArbitrary, async (cancelledFlags) => {
        const t = createTestContext();
        const fixture = await t.run(async (ctx) => {
          const practiceId = await ctx.db.insert("practices", {
            name: "Property Preload Practice",
          });
          const ruleSetId = await ctx.db.insert("ruleSets", {
            createdAt: Date.now(),
            description: "Property Preload Rule Set",
            draftRevision: 0,
            practiceId,
            saved: true,
            version: 1,
          });
          const locationId = await insertSelfLineageEntity(
            ctx.db,
            "locations",
            {
              name: "Property Location",
              practiceId,
              ruleSetId,
            },
          );
          const practitionerId = await insertSelfLineageEntity(
            ctx.db,
            "practitioners",
            {
              name: "Dr. Property",
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
              name: "Property Checkup",
              practiceId,
              ruleSetId,
            },
          );
          const day = Temporal.PlainDate.from("2026-06-15");

          for (const [index, cancelled] of cancelledFlags.entries()) {
            const startOffsetMinutes = index * 10;
            const start = day.toZonedDateTime({
              plainTime: {
                hour: 8 + Math.floor(startOffsetMinutes / 60),
                minute: startOffsetMinutes % 60,
              },
              timeZone: "Europe/Berlin",
            });
            const end = start.add({ minutes: 5 });
            await ctx.db.insert("appointments", {
              appointmentTypeLineageKey: appointmentTypeId,
              appointmentTypeTitle: "Property Checkup",
              ...(cancelled ? { cancelledAt: now } : {}),
              createdAt: now,
              end: end.toString(),
              isSimulation: false,
              lastModified: now,
              locationLineageKey: locationId,
              practiceId,
              practitionerLineageKey: practitionerId,
              start: start.toString(),
              title: `Property appointment ${index}`,
            });
          }

          return {
            activeCount: cancelledFlags.filter((cancelled) => !cancelled)
              .length,
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
            throw new Error("Practitioner missing.");
          }

          const preloaded = await buildPreloadedDayData(
            ctx.db,
            fixture.practiceId,
            fixture.day,
            fixture.ruleSetId,
            [practitioner],
          );

          return {
            appointmentCount: preloaded.appointments.length,
            dailyCount:
              preloaded.dailyCapacityCounts.get(
                `practice:${fixture.appointmentTypeId}`,
              ) ?? 0,
          };
        });

        expect(result.appointmentCount).toBe(fixture.activeCount);
        expect(result.dailyCount).toBe(fixture.activeCount);
      }),
      propertyTestParameters(),
    );
  });
});
