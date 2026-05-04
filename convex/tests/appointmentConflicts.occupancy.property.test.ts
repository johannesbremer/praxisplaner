import fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  createPropertySchedulingFixture,
  createPropertyTestContext,
  zonedWindow,
} from "../../src/tests/convex-property-fixtures";
import { assertAsyncProperty } from "../../src/tests/property-test-utils";
import { findConflictingCalendarOccupancy } from "../appointmentConflicts";
import { asLocationLineageKey, asPractitionerLineageKey } from "../identity";

describe("appointment conflict occupancy properties", () => {
  test("appointments and blocked slots block equivalent candidate intervals", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        fc.integer({ max: 25, min: 0 }),
        fc.boolean(),
        async (startOffsetMinutes, useBlockedSlot) => {
          const t = createPropertyTestContext();
          const fixture = await createPropertySchedulingFixture(t);
          const now = BigInt(Date.now());
          const window = zonedWindow(fixture.date, {
            durationMinutes: 10,
            hour: 9,
            minute: startOffsetMinutes,
          });

          const result = await t.run(async (ctx) => {
            if (useBlockedSlot) {
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
            } else {
              await ctx.db.insert("appointments", {
                appointmentTypeLineageKey: fixture.appointmentTypeId,
                appointmentTypeTitle: "Property Checkup",
                createdAt: now,
                end: window.end,
                lastModified: now,
                locationLineageKey: fixture.locationId,
                practiceId: fixture.practiceId,
                practitionerLineageKey: fixture.practitionerId,
                start: window.start,
                title: "Property appointment",
                userId: fixture.userId,
              });
            }

            return await findConflictingCalendarOccupancy(ctx.db, {
              candidate: {
                end: window.end,
                locationLineageKey: asLocationLineageKey(fixture.locationId),
                practitionerLineageKey: asPractitionerLineageKey(
                  fixture.practitionerId,
                ),
                start: window.start,
              },
              occupancyView: "live",
              practiceId: fixture.practiceId,
            });
          });

          expect(result?.kind).toBe(
            useBlockedSlot ? "blockedSlot" : "appointment",
          );
        },
      ),
      "appointment conflicts appointment blocked-slot symmetry",
    );
  });
});
