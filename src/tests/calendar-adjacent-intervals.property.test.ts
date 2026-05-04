import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { checkCollision } from "../utils/collision-detection";
import { SLOT_DURATION } from "../utils/time-calculations";
import {
  BUSINESS_START_HOUR,
  TEST_COLUMN,
  toAppointment,
  TOTAL_SLOTS,
} from "./calendar-collision-property-utils";
import { assertAsyncProperty } from "./property-test-utils";

describe("calendar adjacent interval property", () => {
  test("adjacent intervals do not collide", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        fc.integer({ max: TOTAL_SLOTS - 2, min: 0 }),
        fc.integer({ max: 12, min: 1 }),
        async (startSlot, requestedDurationSlots) => {
          await Promise.resolve();
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
      "calendar adjacent intervals",
    );
  });
});
