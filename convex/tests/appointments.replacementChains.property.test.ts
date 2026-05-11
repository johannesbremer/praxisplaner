import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";

import {
  createPropertySchedulingFixture,
  createPropertyTestContext,
  zonedWindow,
} from "../../src/tests/convex-property-fixtures";
import { assertAsyncProperty } from "../../src/tests/property-test-utils";
import { api } from "../_generated/api";

describe("appointment replacement chain properties", () => {
  test("same-day replacement chains expose only the current tail unless the root is cancelled", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        fc.integer({ max: 4, min: 1 }),
        fc.boolean(),
        async (chainLength, cancelRoot) => {
          const t = createPropertyTestContext();
          const fixture = await createPropertySchedulingFixture(t);
          const ids = await t.run(async (ctx) => {
            const now = BigInt(Date.now());
            const ids: Id<"appointments">[] = [];
            for (let index = 0; index < chainLength; index += 1) {
              const window = zonedWindow(fixture.date, {
                hour: 9,
                minute: index * 5,
              });
              const id = await ctx.db.insert("appointments", {
                appointmentTypeLineageKey: fixture.appointmentTypeId,
                appointmentTypeTitle: "Property Checkup",
                ...(cancelRoot && index === 0 ? { cancelledAt: now } : {}),
                createdAt: now,
                end: window.end,
                lastModified: now,
                locationLineageKey: fixture.locationId,
                practiceId: fixture.practiceId,
                practitionerLineageKey: fixture.practitionerId,
                ...(index === 0
                  ? {}
                  : { replacesAppointmentId: ids[index - 1] }),
                start: window.start,
                title: `Chain ${index}`,
                userId: fixture.userId,
              });
              ids.push(id);
            }
            return ids;
          });

          const dayStart = Temporal.PlainDate.from(
            fixture.date,
          ).toZonedDateTime({
            plainTime: { hour: 0, minute: 0 },
            timeZone: "Europe/Berlin",
          });
          const expectedIds = cancelRoot ? [] : [ids[ids.length - 1]];

          const dayAppointments = await t.query(
            api.appointments.getCalendarDayAppointments,
            {
              activeRuleSetId: fixture.ruleSetId,
              dayEnd: dayStart.add({ days: 1 }).toString(),
              dayStart: dayStart.toString(),
              practiceId: fixture.practiceId,
              scope: "real",
              selectedRuleSetId: fixture.ruleSetId,
            },
          );
          const appointments = await t.query(api.appointments.getAppointments, {
            activeRuleSetId: fixture.ruleSetId,
            scope: "real",
            selectedRuleSetId: fixture.ruleSetId,
          });
          const appointmentsInRange = await t.query(
            api.appointments.getAppointmentsInRange,
            {
              activeRuleSetId: fixture.ruleSetId,
              end: dayStart.add({ days: 1 }).toString(),
              scope: "real",
              selectedRuleSetId: fixture.ruleSetId,
              start: dayStart.toString(),
            },
          );

          expect(dayAppointments.map((appointment) => appointment._id)).toEqual(
            expectedIds,
          );
          expect(appointments.map((appointment) => appointment._id)).toEqual(
            expectedIds,
          );
          expect(
            appointmentsInRange.map((appointment) => appointment._id),
          ).toEqual(expectedIds);
        },
      ),
      "appointment replacement chain current tail visibility",
    );
  });

  test("range queries honor same-day roots that start before the requested range", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(fc.boolean(), async (cancelRoot) => {
        const t = createPropertyTestContext();
        const fixture = await createPropertySchedulingFixture(t);
        const { rangeStart, replacementId } = await t.run(async (ctx) => {
          const now = BigInt(Date.now());
          const rootWindow = zonedWindow(fixture.date, {
            hour: 8,
            minute: 0,
          });
          const rootId = await ctx.db.insert("appointments", {
            appointmentTypeLineageKey: fixture.appointmentTypeId,
            appointmentTypeTitle: "Property Checkup",
            ...(cancelRoot ? { cancelledAt: now } : {}),
            createdAt: now,
            end: rootWindow.end,
            lastModified: now,
            locationLineageKey: fixture.locationId,
            practiceId: fixture.practiceId,
            practitionerLineageKey: fixture.practitionerId,
            start: rootWindow.start,
            title: "Chain root",
            userId: fixture.userId,
          });

          const replacementWindow = zonedWindow(fixture.date, {
            hour: 10,
            minute: 0,
          });
          const replacementId = await ctx.db.insert("appointments", {
            appointmentTypeLineageKey: fixture.appointmentTypeId,
            appointmentTypeTitle: "Property Checkup",
            createdAt: now,
            end: replacementWindow.end,
            lastModified: now,
            locationLineageKey: fixture.locationId,
            practiceId: fixture.practiceId,
            practitionerLineageKey: fixture.practitionerId,
            replacesAppointmentId: rootId,
            start: replacementWindow.start,
            title: "Chain replacement",
            userId: fixture.userId,
          });

          return {
            rangeStart: Temporal.PlainDate.from(fixture.date)
              .toZonedDateTime({
                plainTime: { hour: 9, minute: 0 },
                timeZone: "Europe/Berlin",
              })
              .toString(),
            replacementId,
          };
        });

        const appointmentsInRange = await t.query(
          api.appointments.getAppointmentsInRange,
          {
            activeRuleSetId: fixture.ruleSetId,
            end: Temporal.ZonedDateTime.from(rangeStart)
              .add({ days: 1 })
              .toString(),
            scope: "real",
            selectedRuleSetId: fixture.ruleSetId,
            start: rangeStart,
          },
        );

        expect(
          appointmentsInRange.map((appointment) => appointment._id),
        ).toEqual(cancelRoot ? [] : [replacementId]);
      }),
      "appointment range boundary respects same-day replacement roots",
    );
  });
});
