import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { describe, expect, test } from "vitest";

import {
  createPropertySchedulingFixture,
  createPropertyTestContext,
} from "../../src/tests/convex-property-fixtures";
import { assertAsyncProperty } from "../../src/tests/property-test-utils";
import { api } from "../_generated/api";
import { insertSelfLineageEntity } from "../lineage";

describe("scheduling lineage resolution properties", () => {
  test("copied Rule Set rows resolve operational appointment occupancy by lineage", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(fc.boolean(), async (deleteSourceRows) => {
        const t = createPropertyTestContext();
        const fixture = await createPropertySchedulingFixture(t, {
          scheduleEnd: "09:05",
          scheduleStart: "09:00",
        });
        const copiedRuleSetId = await t.run(async (ctx) => {
          const now = BigInt(Date.now());
          const date = Temporal.PlainDate.from(fixture.date);
          const copiedRuleSetId = await ctx.db.insert("ruleSets", {
            createdAt: Date.now(),
            description: "Copied Property Rule Set",
            draftRevision: 0,
            parentVersion: fixture.ruleSetId,
            practiceId: fixture.practiceId,
            saved: true,
            version: 2,
          });
          await insertSelfLineageEntity(ctx.db, "locations", {
            lineageKey: fixture.locationId,
            name: "Copied Location",
            practiceId: fixture.practiceId,
            ruleSetId: copiedRuleSetId,
          });
          await insertSelfLineageEntity(ctx.db, "practitioners", {
            lineageKey: fixture.practitionerId,
            name: "Copied Practitioner",
            practiceId: fixture.practiceId,
            ruleSetId: copiedRuleSetId,
          });
          await insertSelfLineageEntity(ctx.db, "appointmentTypes", {
            allowedPractitionerLineageKeys: [fixture.practitionerId],
            createdAt: now,
            duration: 5,
            followUpPlan: [],
            lastModified: now,
            lineageKey: fixture.appointmentTypeId,
            name: "Copied Checkup",
            practiceId: fixture.practiceId,
            ruleSetId: copiedRuleSetId,
          });
          await insertSelfLineageEntity(ctx.db, "baseSchedules", {
            dayOfWeek: date.dayOfWeek === 7 ? 0 : date.dayOfWeek,
            endTime: "09:05",
            lineageKey: fixture.baseScheduleId,
            locationLineageKey: fixture.locationId,
            practiceId: fixture.practiceId,
            practitionerLineageKey: fixture.practitionerId,
            ruleSetId: copiedRuleSetId,
            startTime: "09:00",
          });
          await ctx.db.insert("appointments", {
            appointmentTypeLineageKey: fixture.appointmentTypeId,
            appointmentTypeTitle: "Property Checkup",
            createdAt: now,
            end: date
              .toZonedDateTime({
                plainTime: { hour: 9, minute: 5 },
                timeZone: "Europe/Berlin",
              })
              .toString(),
            lastModified: now,
            locationLineageKey: fixture.locationId,
            practiceId: fixture.practiceId,
            practitionerLineageKey: fixture.practitionerId,
            start: date
              .toZonedDateTime({
                plainTime: { hour: 9, minute: 0 },
                timeZone: "Europe/Berlin",
              })
              .toString(),
            title: "Lineage appointment",
            userId: fixture.userId,
          });
          if (deleteSourceRows) {
            await ctx.db.patch("locations", fixture.locationId, {
              deleted: true,
            });
            await ctx.db.patch("practitioners", fixture.practitionerId, {
              deleted: true,
            });
          }
          return copiedRuleSetId;
        });

        const result = await t.query(api.scheduling.getSlotsForDay, {
          date: fixture.date,
          enforceFutureOnly: false,
          practiceId: fixture.practiceId,
          ruleSetId: copiedRuleSetId,
          simulatedContext: {
            appointmentTypeLineageKey: fixture.appointmentTypeId,
            locationLineageKey: fixture.locationId,
            patient: { isNew: true },
          },
        });

        expect(result.slots).toHaveLength(1);
        expect(result.slots[0]?.status).toBe("BLOCKED");
      }),
      "scheduling resolves copied rule set occupancy by lineage",
    );
  });
});
