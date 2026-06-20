import { describe, expect, test } from "vitest";

import { asPractitionerLineageKey, toTableId } from "../../../convex/identity";
import { calendarColumnScopeFromPractitioner } from "../../../lib/calendar-occupancy";
import {
  buildInsufficientCapacityBlockedSlots,
  findFirstBlockedSlotInRange,
} from "../../components/calendar/calendar-slot-blocking";

describe("calendar slot blocking", () => {
  const practitioner = asPractitionerLineageKey(
    toTableId<"practitioners">("practitioner_1"),
  );
  const otherPractitioner = asPractitionerLineageKey(
    toTableId<"practitioners">("practitioner_2"),
  );
  const column = calendarColumnScopeFromPractitioner(practitioner);
  const otherColumn = calendarColumnScopeFromPractitioner(otherPractitioner);

  test("detects a projected block anywhere inside the appointment duration", () => {
    const blockedSlot = findFirstBlockedSlotInRange({
      blockedSlots: [{ column, reason: "Regel", slot: 5 }],
      column,
      durationMinutes: 30,
      slotDurationMinutes: 5,
      startSlot: 0,
    });

    expect(blockedSlot).toEqual({ column, reason: "Regel", slot: 5 });
  });

  test("ignores blocks outside the target column and duration", () => {
    expect(
      findFirstBlockedSlotInRange({
        blockedSlots: [
          { column: otherColumn, slot: 2 },
          { column, slot: 6 },
        ],
        column,
        durationMinutes: 30,
        slotDurationMinutes: 5,
        startSlot: 0,
      }),
    ).toBeUndefined();
  });

  test("ignores the dragged blocked slot itself", () => {
    expect(
      findFirstBlockedSlotInRange({
        blockedSlots: [
          { column, id: "blocked-slot-1", slot: 2 },
          { column, id: "blocked-slot-1", slot: 3 },
        ],
        column,
        durationMinutes: 20,
        excludeBlockedSlotId: "blocked-slot-1",
        slotDurationMinutes: 5,
        startSlot: 0,
      }),
    ).toBeUndefined();
  });

  test("projects start slots that cannot fit the selected duration before unavailable time", () => {
    const blockedSlots = buildInsufficientCapacityBlockedSlots({
      columns: [column],
      durationMinutes: 10,
      isRangeUnavailable: ({ startSlot }) =>
        startSlot <= 2 && 2 < startSlot + 2,
      reason: "Nicht genug freie Zeit",
      slotDurationMinutes: 5,
      totalSlots: 6,
    });

    expect(blockedSlots).toEqual([
      { column, reason: "Nicht genug freie Zeit", slot: 1 },
      { column, reason: "Nicht genug freie Zeit", slot: 2 },
      { column, reason: "Nicht genug freie Zeit", slot: 5 },
    ]);
  });
});
