import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { checkCollision } from "../utils/collision-detection";
import { SLOT_DURATION } from "../utils/time-calculations";
import {
  BUSINESS_START_HOUR,
  OTHER_COLUMN,
  overlaps,
  slotIntervalArbitrary,
  TEST_COLUMN,
  toAppointment,
} from "./calendar-collision-property-utils";
import { assertAsyncProperty } from "./property-test-utils";

describe("calendar collision overlap property", () => {
  test("collision detection matches interval overlap semantics", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        slotIntervalArbitrary,
        slotIntervalArbitrary,
        fc.boolean(),
        async (appointmentInterval, candidateInterval, sameColumn) => {
          await Promise.resolve();
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
      "calendar collision overlap",
    );
  });
});
