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
  test("day views infer the same-day replacement tail and cancelled roots hide the chain", async () => {
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
          const appointments = await t.query(
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

          expect(appointments.map((appointment) => appointment._id)).toEqual(
            cancelRoot ? [] : [ids[ids.length - 1]],
          );
        },
      ),
      "appointment replacement chain current tail visibility",
    );
  });
});
