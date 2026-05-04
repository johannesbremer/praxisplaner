import fc from "fast-check";
import { describe, expect, test } from "vitest";

import type { Appointment } from "../hooks/use-calendar-state";

import {
  checkCollision,
  findNextAvailableSlot,
} from "../utils/collision-detection";
import { SLOT_DURATION, slotToTime } from "../utils/time-calculations";
import { assertProperty, checkProperty } from "./property-test-utils";

const BUSINESS_START_HOUR = 8;
const TOTAL_SLOTS = (12 * 60) / SLOT_DURATION;
const TEST_COLUMN = "practitioner-a";
const OTHER_COLUMN = "practitioner-b";

interface SlotInterval {
  durationSlots: number;
  startSlot: number;
}

const slotIntervalArbitrary = fc
  .tuple(
    fc.integer({ max: TOTAL_SLOTS - 1, min: 0 }),
    fc.integer({ max: 12, min: 1 }),
  )
  .map(([startSlot, durationSlots]): SlotInterval => {
    const maxDurationSlots = TOTAL_SLOTS - startSlot;
    return {
      durationSlots: Math.min(durationSlots, maxDurationSlots),
      startSlot,
    };
  });

function overlaps(left: SlotInterval, right: SlotInterval): boolean {
  const leftEnd = left.startSlot + left.durationSlots;
  const rightEnd = right.startSlot + right.durationSlots;
  return left.startSlot < rightEnd && right.startSlot < leftEnd;
}

function toAppointment(
  interval: SlotInterval,
  column = TEST_COLUMN,
  id = "appointment",
): Appointment {
  return {
    color: "#2563eb",
    column,
    duration: interval.durationSlots * SLOT_DURATION,
    id,
    isSimulation: false,
    startTime: slotToTime(interval.startSlot, BUSINESS_START_HOUR),
    title: id,
  };
}

describe("calendar collision properties", () => {
  test("collision detection matches interval overlap semantics", () => {
    assertProperty(
      fc.property(
        slotIntervalArbitrary,
        slotIntervalArbitrary,
        fc.boolean(),
        (appointmentInterval, candidateInterval, sameColumn) => {
          const appointment = toAppointment(
            appointmentInterval,
            sameColumn ? TEST_COLUMN : OTHER_COLUMN,
          );

          expect(
            checkCollision(
              [appointment],
              TEST_COLUMN,
              candidateInterval.startSlot,
              candidateInterval.durationSlots * SLOT_DURATION,
              BUSINESS_START_HOUR,
            ),
          ).toBe(
            sameColumn && overlaps(appointmentInterval, candidateInterval),
          );
        },
      ),
    );
  });

  test("adjacent intervals do not collide", () => {
    assertProperty(
      fc.property(
        fc.integer({ max: TOTAL_SLOTS - 2, min: 0 }),
        fc.integer({ max: 12, min: 1 }),
        (startSlot, requestedDurationSlots) => {
          const durationSlots = Math.min(
            requestedDurationSlots,
            TOTAL_SLOTS - startSlot - 1,
          );
          const appointment = toAppointment({
            durationSlots,
            startSlot,
          });

          expect(
            checkCollision(
              [appointment],
              TEST_COLUMN,
              startSlot + durationSlots,
              SLOT_DURATION,
              BUSINESS_START_HOUR,
            ),
          ).toBe(false);
        },
      ),
    );
  });

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
    );
    expect(result.failed).toBe(false);
  });
});
