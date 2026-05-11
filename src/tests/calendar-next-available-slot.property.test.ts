import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { findNextAvailableSlot } from "../utils/collision-detection";
import { SLOT_DURATION } from "../utils/time-calculations";
import {
  BUSINESS_START_HOUR,
  overlaps,
  slotIntervalArbitrary,
  TEST_COLUMN,
  toAppointment,
  TOTAL_SLOTS,
} from "./calendar-collision-property-utils";
import { assertProperty } from "./property-test-utils";

describe("calendar next available slot property", () => {
  test("findNextAvailableSlot returns a collision-free slot or no slot", () => {
    assertProperty(
      fc.property(
        fc.array(slotIntervalArbitrary, { maxLength: 16 }),
        fc.integer({ max: TOTAL_SLOTS - 1, min: 0 }),
        fc.integer({ max: 12, min: 1 }),
        (appointmentIntervals, startSlot, requestedDurationSlots) => {
          const durationSlots = Math.min(
            requestedDurationSlots,
            TOTAL_SLOTS - startSlot,
          );
          const duration = durationSlots * SLOT_DURATION;
          const appointments = appointmentIntervals.map((interval, index) =>
            toAppointment(interval, TEST_COLUMN, `appointment-${index}`),
          );
          const nextSlot = findNextAvailableSlot(
            appointments,
            TEST_COLUMN,
            startSlot,
            duration,
            BUSINESS_START_HOUR,
            TOTAL_SLOTS,
          );

          const expectedNextSlot = Array.from(
            { length: TOTAL_SLOTS - durationSlots - startSlot + 1 },
            (_, index) => startSlot + index,
          ).find((slot) => {
            const candidateInterval = {
              durationSlots,
              startSlot: slot,
            };
            return !appointmentIntervals.some((interval) =>
              overlaps(interval, candidateInterval),
            );
          });

          expect(nextSlot).toBe(expectedNextSlot ?? -1);
        },
      ),
      "calendar next available slot",
    );
  });
});
