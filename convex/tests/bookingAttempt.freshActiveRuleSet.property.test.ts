import type { GenericDatabaseWriter } from "convex/server";

import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { describe, expect, test } from "vitest";

import type { DataModel, Id } from "../_generated/dataModel";

import {
  createPropertySchedulingFixture,
  createPropertyTestContext,
} from "../../src/tests/convex-property-fixtures";
import { assertAsyncProperty } from "../../src/tests/property-test-utils";
import { api } from "../_generated/api";
import { insertSelfLineageEntity } from "../lineage";

type DatabaseWriter = GenericDatabaseWriter<DataModel>;
type RuleSetAvailabilityState = "available" | "blocked_by_rule" | "no_schedule";

const ruleSetAvailabilityStateArbitrary =
  fc.constantFrom<RuleSetAvailabilityState>(
    "available",
    "blocked_by_rule",
    "no_schedule",
  );

describe("booking attempt freshness properties", () => {
  test("availability without an explicit Rule Set follows the current Active Rule Set", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        ruleSetAvailabilityStateArbitrary,
        ruleSetAvailabilityStateArbitrary,
        async (oldState, newState) => {
          const t = createPropertyTestContext();
          const fixture = await createPropertySchedulingFixture(t, {
            scheduleEnd: "09:05",
            scheduleStart: "09:00",
          });
          const oldSummary = await t.run(async (ctx) => {
            await configureRuleSetAvailability(ctx.db, {
              appointmentTypeId: fixture.appointmentTypeId,
              baseScheduleId: fixture.baseScheduleId,
              practiceId: fixture.practiceId,
              ruleSetId: fixture.ruleSetId,
              state: oldState,
            });
            return summarizeRuleSetAvailabilityState(oldState);
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
              appointmentPlan: { steps: [] },
              createdAt: now,
              defaultOccupancy: { kind: "selectedPractitioner" },
              duration: 5,
              lastModified: now,
              lineageKey: fixture.appointmentTypeId,
              name: "Fresh Checkup",
              practiceId: fixture.practiceId,
              ruleSetId,
            });
            let copiedBaseScheduleId: Id<"baseSchedules"> | undefined;
            if (newState !== "no_schedule") {
              copiedBaseScheduleId = await insertSelfLineageEntity(
                ctx.db,
                "baseSchedules",
                {
                  dayOfWeek: date.dayOfWeek === 7 ? 0 : date.dayOfWeek,
                  endTime: "09:05",
                  lineageKey: fixture.baseScheduleId,
                  locationLineageKey: fixture.locationId,
                  practiceId: fixture.practiceId,
                  practitionerLineageKey: fixture.practitionerId,
                  ruleSetId,
                  startTime: "09:00",
                },
              );
            }
            await configureRuleSetAvailability(ctx.db, {
              appointmentTypeId: fixture.appointmentTypeId,
              baseScheduleId: copiedBaseScheduleId,
              practiceId: fixture.practiceId,
              ruleSetId,
              state: newState,
            });
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
              clientType: "MFA",
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
              clientType: "MFA",
              locationLineageKey: fixture.locationId,
              patient: { isNew: true },
            },
          });

          expect(summarizeSlotsForExpectation(implicitActive)).toEqual(
            summarizeRuleSetAvailabilityState(newState),
          );
          expect(summarizeSlotsForExpectation(explicitOld)).toEqual(oldSummary);
          expect(newActiveRuleSetId).not.toBe(fixture.ruleSetId);
        },
      ),
      "booking availability uses current active rule set",
    );
  });
});

async function configureRuleSetAvailability(
  db: DatabaseWriter,
  args: {
    appointmentTypeId: Id<"appointmentTypes">;
    baseScheduleId?: Id<"baseSchedules"> | undefined;
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
    state: RuleSetAvailabilityState;
  },
) {
  if (args.state === "no_schedule" && args.baseScheduleId) {
    await db.delete("baseSchedules", args.baseScheduleId);
  }

  if (args.state !== "blocked_by_rule") {
    return;
  }

  const now = BigInt(Date.now());
  const rootId = await db.insert("ruleConditions", {
    childOrder: 0,
    createdAt: now,
    isRoot: true,
    lastModified: now,
    practiceId: args.practiceId,
    ruleSetId: args.ruleSetId,
  });
  await db.insert("ruleConditions", {
    childOrder: 0,
    conditionType: "APPOINTMENT_TYPE",
    createdAt: now,
    isRoot: false,
    lastModified: now,
    nodeType: "CONDITION",
    operator: "IS",
    parentConditionId: rootId,
    practiceId: args.practiceId,
    ruleSetId: args.ruleSetId,
    valueIds: [args.appointmentTypeId],
  });
}

function summarizeRuleSetAvailabilityState(state: RuleSetAvailabilityState) {
  if (state === "no_schedule") {
    return { slotCount: 0, status: null as null | string };
  }

  return {
    slotCount: 1,
    status: state === "available" ? "AVAILABLE" : "BLOCKED",
  };
}

function summarizeSlotsForExpectation(result: { slots: { status: string }[] }) {
  return {
    slotCount: result.slots.length,
    status: result.slots[0]?.status ?? null,
  };
}
