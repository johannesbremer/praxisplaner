import fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  checkCollision,
  findAvailableSlots,
} from "../utils/collision-detection";
import { SLOT_DURATION } from "../utils/time-calculations";
import {
  BUSINESS_START_HOUR,
  slotIntervalArbitrary,
  TEST_COLUMN,
  toAppointment,
  TOTAL_SLOTS,
} from "./calendar-collision-property-utils";
import { assertProperty } from "./property-test-utils";

describe("calendar findAvailableSlots property", () => {
  test("findAvailableSlots returns exactly the non-colliding candidate slots", () => {
    assertProperty(
      fc.property(
        fc.array(slotIntervalArbitrary, { maxLength: 16 }),
        fc.integer({ max: 12, min: 1 }),
        (appointmentIntervals, requestedDurationSlots) => {
          const duration = requestedDurationSlots * SLOT_DURATION;
          const appointments = appointmentIntervals.map((interval, index) =>
            toAppointment(interval, TEST_COLUMN, `appointment-${index}`),
          );
          const expected = Array.from(
            { length: TOTAL_SLOTS - requestedDurationSlots + 1 },
            (_, slot) => slot,
          ).filter(
            (slot) =>
              !checkCollision(
                appointments,
                TEST_COLUMN,
                slot,
                duration,
                BUSINESS_START_HOUR,
              ),
          );

          expect(
            findAvailableSlots(
              appointments,
              TEST_COLUMN,
              duration,
              BUSINESS_START_HOUR,
              TOTAL_SLOTS,
            ),
          ).toEqual(expected);
        },
      ),
      "calendar findAvailableSlots exact set",
    );
  });
});
