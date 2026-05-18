import fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  createPropertySchedulingFixture,
  createPropertyTestContext,
  zonedWindow,
} from "../../src/tests/convex-property-fixtures";
import { assertAsyncProperty } from "../../src/tests/property-test-utils";
import { api } from "../_generated/api";
import { insertSelfLineageEntity } from "../lineage";

const BLOCKER_KINDS = [
  "appointment",
  "blockedSlot",
  "rule",
  "vacation",
] as const;

type BlockerKind = (typeof BLOCKER_KINDS)[number];
const ALL_BLOCKER_KINDS: BlockerKind[] = [...BLOCKER_KINDS];

describe("scheduling availability monotonicity properties", () => {
  test("adding occupancy, blocked slots, absences, or matching rules never unblocks a candidate slot", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        fc.subarray(ALL_BLOCKER_KINDS),
        fc.subarray(ALL_BLOCKER_KINDS),
        async (baseBlockers, extraBlockers) => {
          const baseSet = new Set<BlockerKind>(baseBlockers);
          const extendedSet = new Set<BlockerKind>([
            ...baseBlockers,
            ...extraBlockers,
          ]);

          const baseStatus = await querySlotStatus(baseSet);
          const extendedStatus = await querySlotStatus(extendedSet);

          expect(baseStatus).toBe(baseSet.size === 0 ? "AVAILABLE" : "BLOCKED");
          expect(extendedStatus).toBe(
            extendedSet.size === 0 ? "AVAILABLE" : "BLOCKED",
          );
          expect(
            baseStatus === "BLOCKED" && extendedStatus === "AVAILABLE",
          ).toBe(false);
        },
      ),
      "scheduling availability is monotone under added blockers",
    );
  });
});

async function querySlotStatus(blockers: ReadonlySet<BlockerKind>) {
  const t = createPropertyTestContext();
  const fixture = await createPropertySchedulingFixture(t, {
    scheduleEnd: "09:05",
    scheduleStart: "09:00",
  });
  const window = zonedWindow(fixture.date, { hour: 9, minute: 0 });

  await t.run(async (ctx) => {
    const now = BigInt(Date.now());

    if (blockers.has("appointment")) {
      await ctx.db.insert("appointments", {
        appointmentTypeLineageKey: fixture.appointmentTypeId,
        appointmentTypeTitle: "Property Checkup",
        createdAt: now,
        end: window.end,
        lastModified: now,
        locationLineageKey: fixture.locationId,
        occupancyScope: {
          kind: "practitioner",
          practitionerLineageKey: fixture.practitionerId,
        },
        practiceId: fixture.practiceId,
        start: window.start,
        title: "Property appointment",
        userId: fixture.userId,
      });
    }

    if (blockers.has("blockedSlot")) {
      await ctx.db.insert("blockedSlots", {
        createdAt: now,
        end: window.end,
        lastModified: now,
        locationLineageKey: fixture.locationId,
        practiceId: fixture.practiceId,
        practitionerLineageKey: fixture.practitionerId,
        start: window.start,
        title: "Property block",
      });
    }

    if (blockers.has("vacation")) {
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

    if (blockers.has("rule")) {
      const rootId = await ctx.db.insert("ruleConditions", {
        childOrder: 0,
        createdAt: now,
        enabled: true,
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
    }
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
  return result.slots[0]?.status;
}
