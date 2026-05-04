import fc from "fast-check";

import type { Appointment } from "../hooks/use-calendar-state";

import { SLOT_DURATION, slotToTime } from "../utils/time-calculations";

export const BUSINESS_START_HOUR = 8;
export const TOTAL_SLOTS = (12 * 60) / SLOT_DURATION;
export const TEST_COLUMN = "practitioner-a";
export const OTHER_COLUMN = "practitioner-b";

export interface SlotInterval {
  durationSlots: number;
  startSlot: number;
}

export const slotIntervalArbitrary = fc
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

export function overlaps(left: SlotInterval, right: SlotInterval): boolean {
  const leftEnd = left.startSlot + left.durationSlots;
  const rightEnd = right.startSlot + right.durationSlots;
  return left.startSlot < rightEnd && right.startSlot < leftEnd;
}

export function toAppointment(
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
