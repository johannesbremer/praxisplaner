import fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  checkCollision,
  findNextAvailableSlot,
} from "../utils/collision-detection";
import { SLOT_DURATION } from "../utils/time-calculations";
import {
  BUSINESS_START_HOUR,
  slotIntervalArbitrary,
  TEST_COLUMN,
  toAppointment,
  TOTAL_SLOTS,
} from "./calendar-collision-property-utils";
import { checkProperty } from "./property-test-utils";

describe("calendar next available slot property", () => {
  test("findNextAvailableSlot returns a collision-free slot or no slot", () => {
    const result = checkProperty(
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

          if (nextSlot === -1) {
            let everyRemainingSlotCollides = true;
            for (
              let slot = startSlot;
              slot <= TOTAL_SLOTS - durationSlots;
              slot += 1
            ) {
              everyRemainingSlotCollides &&= checkCollision(
                appointments,
                TEST_COLUMN,
                slot,
                duration,
                BUSINESS_START_HOUR,
              );
            }
            return everyRemainingSlotCollides;
          }

          return (
            nextSlot >= startSlot &&
            nextSlot <= TOTAL_SLOTS - durationSlots &&
            Array.from(
              { length: nextSlot - startSlot },
              (_, index) => startSlot + index,
            ).every((slot) =>
              checkCollision(
                appointments,
                TEST_COLUMN,
                slot,
                duration,
                BUSINESS_START_HOUR,
              ),
            ) &&
            !checkCollision(
              appointments,
              TEST_COLUMN,
              nextSlot,
              duration,
              BUSINESS_START_HOUR,
            )
          );
        },
      ),
      "calendar next available slot",
    );
    expect(result.failed).toBe(false);
  });
});
