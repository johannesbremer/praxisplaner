import fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  createPropertySchedulingFixture,
  createPropertyTestContext,
} from "../../src/tests/convex-property-fixtures";
import { assertAsyncProperty } from "../../src/tests/property-test-utils";
import { api } from "../_generated/api";
import { insertSelfLineageEntity } from "../lineage";

describe("available slot absence properties", () => {
  test("practitioner absence blocks a candidate slot before scheduling rules", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        fc.boolean(),
        fc.boolean(),
        async (withVacation, enableRule) => {
          const t = createPropertyTestContext();
          const fixture = await createPropertySchedulingFixture(t, {
            scheduleEnd: "09:05",
            scheduleStart: "09:00",
          });

          await t.run(async (ctx) => {
            const now = BigInt(Date.now());
            if (withVacation) {
              await insertSelfLineageEntity(ctx.db, "vacations", {
                createdAt: now,
                date: fixture.date,
                portion: "full",
                practiceId: fixture.practiceId,
                practitionerLineageKey: fixture.practitionerId,
                ruleSetId: fixture.ruleSetId,
                staffType: "practitioner",
              });
            }

            const rootId = await ctx.db.insert("ruleConditions", {
              childOrder: 0,
              createdAt: now,
              enabled: enableRule,
              isRoot: true,
              lastModified: now,
              practiceId: fixture.practiceId,
              ruleSetId: fixture.ruleSetId,
            });
            await ctx.db.insert("ruleConditions", {
              childOrder: 0,
              conditionType: "APPOINTMENT_TYPE",
              createdAt: now,
              isRoot: false,
              lastModified: now,
              nodeType: "CONDITION",
              operator: "IS",
              parentConditionId: rootId,
              practiceId: fixture.practiceId,
              ruleSetId: fixture.ruleSetId,
              valueIds: [fixture.appointmentTypeId],
            });
          });

          const result = await t.query(api.scheduling.getSlotsForDay, {
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

          expect(result.slots).toHaveLength(1);
          const slot = result.slots[0];
          expect(slot).toBeDefined();
          expect(slot?.status).toBe(
            withVacation || enableRule ? "BLOCKED" : "AVAILABLE",
          );
          expect(Boolean(slot?.blockedByRuleId)).toBe(
            withVacation ? false : enableRule,
          );
        },
      ),
      "available slots respect practitioner absence before rules",
    );
  });
});
