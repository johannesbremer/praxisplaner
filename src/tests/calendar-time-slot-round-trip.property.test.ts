import fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  SLOT_DURATION,
  slotToTime,
  timeToSlot,
} from "../utils/time-calculations";
import { assertAsyncProperty } from "./property-test-utils";

const SLOTS_PER_DAY = (24 * 60) / SLOT_DURATION;

describe("calendar time slot round-trip property", () => {
  test("timeToSlot(slotToTime(slot)) returns the original slot", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        fc.integer({ max: 23, min: 0 }),
        fc.integer({ max: SLOTS_PER_DAY - 1, min: 0 }),
        async (businessStartHour, slot) => {
          fc.pre(businessStartHour * 60 + slot * SLOT_DURATION < 24 * 60);
          await Promise.resolve();

          expect(
            timeToSlot(slotToTime(slot, businessStartHour), businessStartHour),
          ).toBe(slot);
        },
      ),
      "calendar time slot round-trip",
    );
  });
});
