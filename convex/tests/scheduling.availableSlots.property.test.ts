import fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  createPropertySchedulingFixture,
  createPropertyTestContext,
  zonedWindow,
} from "../../src/tests/convex-property-fixtures";
import { assertAsyncProperty } from "../../src/tests/property-test-utils";
import { api } from "../_generated/api";

describe("available slot semantics properties", () => {
  test("a base-schedule slot is available iff no manual block or appointment occupies it", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        fc.boolean(),
        fc.boolean(),
        async (withAppointment, withBlockedSlot) => {
          const t = createPropertyTestContext();
          const fixture = await createPropertySchedulingFixture(t, {
            scheduleEnd: "09:05",
            scheduleStart: "09:00",
          });
          const now = BigInt(Date.now());
          const window = zonedWindow(fixture.date, { hour: 9, minute: 0 });
          await t.run(async (ctx) => {
            if (withAppointment) {
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
            if (withBlockedSlot) {
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
            withAppointment || withBlockedSlot ? "BLOCKED" : "AVAILABLE",
          );
        },
      ),
      "available slots respect occupancy blockers",
    );
  });
});
