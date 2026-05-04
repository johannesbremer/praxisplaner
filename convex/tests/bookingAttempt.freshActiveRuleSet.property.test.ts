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

describe("booking attempt freshness properties", () => {
  test("availability without an explicit Rule Set follows the current Active Rule Set", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(fc.boolean(), async (newActiveHasSchedule) => {
        const t = createPropertyTestContext();
        const fixture = await createPropertySchedulingFixture(t, {
          scheduleEnd: "09:05",
          scheduleStart: "09:00",
        });
        const newActiveRuleSetId = await t.run(async (ctx) => {
          const now = BigInt(Date.now());
          const date = Temporal.PlainDate.from(fixture.date);
          const ruleSetId = await ctx.db.insert("ruleSets", {
            createdAt: Date.now(),
            description: "Fresh Active Rule Set",
            draftRevision: 0,
            parentVersion: fixture.ruleSetId,
            practiceId: fixture.practiceId,
            saved: true,
            version: 2,
          });
          await insertSelfLineageEntity(ctx.db, "locations", {
            lineageKey: fixture.locationId,
            name: "Fresh Location",
            practiceId: fixture.practiceId,
            ruleSetId,
          });
          await insertSelfLineageEntity(ctx.db, "practitioners", {
            lineageKey: fixture.practitionerId,
            name: "Fresh Practitioner",
            practiceId: fixture.practiceId,
            ruleSetId,
          });
          await insertSelfLineageEntity(ctx.db, "appointmentTypes", {
            allowedPractitionerLineageKeys: [fixture.practitionerId],
            createdAt: now,
            duration: 5,
            followUpPlan: [],
            lastModified: now,
            lineageKey: fixture.appointmentTypeId,
            name: "Fresh Checkup",
            practiceId: fixture.practiceId,
            ruleSetId,
          });
          if (newActiveHasSchedule) {
            await insertSelfLineageEntity(ctx.db, "baseSchedules", {
              dayOfWeek: date.dayOfWeek === 7 ? 0 : date.dayOfWeek,
              endTime: "09:05",
              lineageKey: fixture.baseScheduleId,
              locationLineageKey: fixture.locationId,
              practiceId: fixture.practiceId,
              practitionerLineageKey: fixture.practitionerId,
              ruleSetId,
              startTime: "09:00",
            });
          }
          await ctx.db.patch("practices", fixture.practiceId, {
            currentActiveRuleSetId: ruleSetId,
          });
          return ruleSetId;
        });

        const implicitActive = await t.query(api.scheduling.getSlotsForDay, {
          date: fixture.date,
          enforceFutureOnly: false,
          practiceId: fixture.practiceId,
          simulatedContext: {
            appointmentTypeLineageKey: fixture.appointmentTypeId,
            locationLineageKey: fixture.locationId,
            patient: { isNew: true },
          },
        });
        const explicitOld = await t.query(api.scheduling.getSlotsForDay, {
          date: fixture.date,
          enforceFutureOnly: false,
          practiceId: fixture.practiceId,
          ruleSetId: fixture.ruleSetId,
          simulatedContext: {
            appointmentTypeLineageKey: fixture.appointmentTypeId,
            locationLineageKey: fixture.locationId,
            patient: { isNew: true },
          },
        });

        expect(implicitActive.slots).toHaveLength(newActiveHasSchedule ? 1 : 0);
        expect(explicitOld.slots).toHaveLength(1);
        expect(newActiveRuleSetId).not.toBe(fixture.ruleSetId);
      }),
      "booking availability uses current active rule set",
    );
  });
});
