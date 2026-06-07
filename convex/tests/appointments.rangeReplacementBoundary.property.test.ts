import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { describe, expect, test } from "vitest";

import {
  createPropertySchedulingFixture,
  createPropertyTestContext,
  zonedWindow,
} from "../../src/tests/convex-property-fixtures";
import { assertAsyncProperty } from "../../src/tests/property-test-utils";
import { api } from "../_generated/api";

const rangeReplacementScenarioArbitrary = fc.record({
  cancelRoot: fc.boolean(),
  rangeLengthSlots: fc.integer({ max: 6, min: 2 }),
  rangeStartSlot: fc.integer({ max: 16, min: 4 }),
  scenario: fc.constantFrom("replacement_after_end", "root_before_start"),
  spacingSlots: fc.integer({ max: 4, min: 1 }),
});

describe("appointment range replacement boundary properties", () => {
  test("range queries honor same-day roots before the range and same-day replacements after the range end", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(rangeReplacementScenarioArbitrary, async (scenario) => {
        const t = createPropertyTestContext();
        const fixture = await createPropertySchedulingFixture(t);
        const { expectedIds, rangeEnd, rangeStart } = await t.run(
          async (ctx) => {
            const now = BigInt(Date.now());
            const rootSlot =
              scenario.scenario === "root_before_start"
                ? scenario.rangeStartSlot - scenario.spacingSlots
                : scenario.rangeStartSlot;
            const replacementSlot =
              scenario.scenario === "root_before_start"
                ? scenario.rangeStartSlot +
                  Math.min(scenario.spacingSlots, scenario.rangeLengthSlots - 1)
                : scenario.rangeStartSlot +
                  scenario.rangeLengthSlots +
                  scenario.spacingSlots;
            const rootWindow = slotWindowForSlot(fixture.date, rootSlot);
            const rootId = await ctx.db.insert("appointments", {
              appointmentTypeLineageKey: fixture.appointmentTypeId,
              appointmentTypeTitle: "Property Checkup",
              ...(scenario.cancelRoot ? { cancelledAt: now } : {}),
              createdAt: now,
              end: rootWindow.end,
              lastModified: now,
              locationLineageKey: fixture.locationId,
              occupancyScope: {
                kind: "practitioner",
                practitionerLineageKey: fixture.practitionerId,
              },
              practiceId: fixture.practiceId,
              start: rootWindow.start,
              title: "Chain root",
              userId: fixture.userId,
            });

            const replacementWindow = slotWindowForSlot(
              fixture.date,
              replacementSlot,
            );
            const replacementId = await ctx.db.insert("appointments", {
              appointmentTypeLineageKey: fixture.appointmentTypeId,
              appointmentTypeTitle: "Property Checkup",
              createdAt: now,
              end: replacementWindow.end,
              lastModified: now,
              locationLineageKey: fixture.locationId,
              occupancyScope: {
                kind: "practitioner",
                practitionerLineageKey: fixture.practitionerId,
              },
              practiceId: fixture.practiceId,
              replacesAppointmentId: rootId,
              start: replacementWindow.start,
              title: "Chain replacement",
              userId: fixture.userId,
            });

            const rangeStart = slotStartForSlot(
              fixture.date,
              scenario.rangeStartSlot,
            );
            const rangeEnd = Temporal.ZonedDateTime.from(rangeStart)
              .add({ minutes: scenario.rangeLengthSlots * 5 })
              .toString();

            return {
              expectedIds:
                scenario.cancelRoot ||
                scenario.scenario === "replacement_after_end"
                  ? []
                  : [replacementId],
              rangeEnd,
              rangeStart,
            };
          },
        );

        const appointmentsInRange = await t.query(
          api.appointments.getAppointmentsInRange,
          {
            activeRuleSetId: fixture.ruleSetId,
            end: rangeEnd,
            practiceId: fixture.practiceId,
            scope: "real",
            selectedRuleSetId: fixture.ruleSetId,
            start: rangeStart,
          },
        );
        expect(
          appointmentsInRange.map((appointment) => appointment._id),
        ).toEqual(expectedIds);
      }),
      "appointment range boundary respects same-day replacement roots",
    );
  });
});

function slotStartForSlot(baseDate: string, slot: number): string {
  return slotWindowForSlot(baseDate, slot).start;
}

function slotWindowForSlot(baseDate: string, slot: number) {
  return zonedWindow(Temporal.PlainDate.from(baseDate), {
    hour: 8 + Math.floor(slot / 12),
    minute: (slot % 12) * 5,
  });
}
