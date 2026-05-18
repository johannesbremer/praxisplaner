import fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  createPropertySchedulingFixture,
  createPropertyTestContext,
  zonedWindow,
} from "../../src/tests/convex-property-fixtures";
import { assertAsyncProperty } from "../../src/tests/property-test-utils";
import { findConflictingCalendarOccupancy } from "../appointmentConflicts";
import { asLocationLineageKey } from "../identity";

describe("appointment conflict occupancy properties", () => {
  test("resource appointments do not block practitioner occupancy in the same location", async () => {
    const context = createPropertyTestContext();
    const fixture = await createPropertySchedulingFixture(context);
    const window = zonedWindow("2026-06-15", {
      durationMinutes: 10,
      hour: 9,
      minute: 0,
    });

    const conflict = await context.run(async (ctx) => {
      const now = BigInt(Date.now());
      await ctx.db.insert("appointments", {
        appointmentTypeLineageKey: fixture.appointmentTypeId,
        appointmentTypeTitle: "Resource booking",
        createdAt: now,
        end: window.end,
        lastModified: now,
        locationLineageKey: fixture.locationId,
        occupancyScope: { calendarResourceColumn: "labor", kind: "resource" },
        practiceId: fixture.practiceId,
        start: window.start,
        title: "Labor booking",
        userId: fixture.userId,
      });

      return await findConflictingCalendarOccupancy(ctx.db, {
        candidate: {
          end: window.end,
          locationLineageKey: asLocationLineageKey(fixture.locationId),
          occupancyScope: {
            kind: "practitioner",
            practitionerLineageKey: fixture.practitionerId,
          },
          start: window.start,
        },
        occupancyView: "live",
        practiceId: fixture.practiceId,
      });
    });

    expect(conflict).toBeNull();
  });

  test("resource appointments still block the same resource column", async () => {
    const context = createPropertyTestContext();
    const fixture = await createPropertySchedulingFixture(context);
    const window = zonedWindow("2026-06-15", {
      durationMinutes: 10,
      hour: 9,
      minute: 0,
    });

    const conflict = await context.run(async (ctx) => {
      const now = BigInt(Date.now());
      await ctx.db.insert("appointments", {
        appointmentTypeLineageKey: fixture.appointmentTypeId,
        appointmentTypeTitle: "Resource booking",
        createdAt: now,
        end: window.end,
        lastModified: now,
        locationLineageKey: fixture.locationId,
        occupancyScope: { calendarResourceColumn: "labor", kind: "resource" },
        practiceId: fixture.practiceId,
        start: window.start,
        title: "Labor booking",
        userId: fixture.userId,
      });

      return await findConflictingCalendarOccupancy(ctx.db, {
        candidate: {
          end: window.end,
          locationLineageKey: asLocationLineageKey(fixture.locationId),
          occupancyScope: { calendarResourceColumn: "labor", kind: "resource" },
          start: window.start,
        },
        occupancyView: "live",
        practiceId: fixture.practiceId,
      });
    });

    expect(conflict?.kind).toBe("appointment");
  });

  test("appointments and blocked slots block equivalent candidate intervals", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        fc.integer({ max: 25, min: 0 }),
        async (startOffsetMinutes) => {
          const window = zonedWindow("2026-06-15", {
            durationMinutes: 10,
            hour: 9,
            minute: startOffsetMinutes,
          });

          const appointmentContext = createPropertyTestContext();
          const appointmentFixture =
            await createPropertySchedulingFixture(appointmentContext);
          const appointmentConflict = await appointmentContext.run(
            async (ctx) => {
              const now = BigInt(Date.now());
              await ctx.db.insert("appointments", {
                appointmentTypeLineageKey: appointmentFixture.appointmentTypeId,
                appointmentTypeTitle: "Property Checkup",
                createdAt: now,
                end: window.end,
                lastModified: now,
                locationLineageKey: appointmentFixture.locationId,
                occupancyScope: {
                  kind: "practitioner",
                  practitionerLineageKey: appointmentFixture.practitionerId,
                },
                practiceId: appointmentFixture.practiceId,
                start: window.start,
                title: "Property appointment",
                userId: appointmentFixture.userId,
              });

              return await findConflictingCalendarOccupancy(ctx.db, {
                candidate: {
                  end: window.end,
                  locationLineageKey: asLocationLineageKey(
                    appointmentFixture.locationId,
                  ),
                  occupancyScope: {
                    kind: "practitioner",
                    practitionerLineageKey: appointmentFixture.practitionerId,
                  },
                  start: window.start,
                },
                occupancyView: "live",
                practiceId: appointmentFixture.practiceId,
              });
            },
          );

          const blockedSlotContext = createPropertyTestContext();
          const blockedSlotFixture =
            await createPropertySchedulingFixture(blockedSlotContext);
          const blockedSlotConflict = await blockedSlotContext.run(
            async (ctx) => {
              const now = BigInt(Date.now());
              await ctx.db.insert("blockedSlots", {
                createdAt: now,
                end: window.end,
                lastModified: now,
                locationLineageKey: blockedSlotFixture.locationId,
                practiceId: blockedSlotFixture.practiceId,
                practitionerLineageKey: blockedSlotFixture.practitionerId,
                start: window.start,
                title: "Property block",
              });

              return await findConflictingCalendarOccupancy(ctx.db, {
                candidate: {
                  end: window.end,
                  locationLineageKey: asLocationLineageKey(
                    blockedSlotFixture.locationId,
                  ),
                  occupancyScope: {
                    kind: "practitioner",
                    practitionerLineageKey: blockedSlotFixture.practitionerId,
                  },
                  start: window.start,
                },
                occupancyView: "live",
                practiceId: blockedSlotFixture.practiceId,
              });
            },
          );

          expect(appointmentConflict?.kind).toBe("appointment");
          expect(blockedSlotConflict?.kind).toBe("blockedSlot");
        },
      ),
      "appointment conflicts appointment blocked-slot symmetry",
    );
  });
});
