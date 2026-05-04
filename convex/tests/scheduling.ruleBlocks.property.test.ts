import fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  createPropertySchedulingFixture,
  createPropertyTestContext,
} from "../../src/tests/convex-property-fixtures";
import { assertAsyncProperty } from "../../src/tests/property-test-utils";
import { api } from "../_generated/api";

describe("available slot rule block properties", () => {
  test("a matching Scheduling Rule blocks otherwise available Candidate Slots", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(fc.boolean(), async (enableRule) => {
        const t = createPropertyTestContext();
        const fixture = await createPropertySchedulingFixture(t, {
          scheduleEnd: "09:05",
          scheduleStart: "09:00",
        });
        await t.run(async (ctx) => {
          const now = BigInt(Date.now());
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
        expect(result.slots[0]?.status).toBe(
          enableRule ? "BLOCKED" : "AVAILABLE",
        );
        expect(Boolean(result.slots[0]?.blockedByRuleId)).toBe(enableRule);
      }),
      "available slots respect rule blocks",
    );
  });
});
