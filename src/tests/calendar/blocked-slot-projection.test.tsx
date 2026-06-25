import { renderHook } from "@testing-library/react";
import { Temporal } from "temporal-polyfill";
import { describe, expect, test } from "vitest";

import { asLocationLineageKey, toTableId } from "../../../convex/identity";
import {
  calendarColumnScopeFromResourceColumn,
  sameCalendarColumnScope,
} from "../../../lib/calendar-occupancy";
import { useCalendarBlockedSlotProjection } from "../../components/calendar/use-calendar-blocked-slot-projection";
import { buildCalendarBlockedSlotRecord } from "./test-records";

describe("useCalendarBlockedSlotProjection", () => {
  test("projects resource-scoped manual blocked slots into resource columns", () => {
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(locationId);
    const laborColumn = calendarColumnScopeFromResourceColumn("labor");

    const { result } = renderHook(() =>
      useCalendarBlockedSlotProjection({
        appointmentsData: [],
        baseSchedulesData: undefined,
        blockedSlotsData: [
          buildCalendarBlockedSlotRecord({
            _id: toTableId<"blockedSlots">("blocked_slot_1"),
            calendarResourceColumn: "labor",
            end: "2026-04-24T09:30:00+02:00[Europe/Berlin]",
            locationLineageKey,
            practiceId: toTableId<"practices">("practice_1"),
            start: "2026-04-24T09:00:00+02:00[Europe/Berlin]",
            title: "Labor blocked",
          }),
        ],
        blockedSlotsWithoutAppointmentTypeSlots: undefined,
        businessStartHour: 8,
        columns: [{ id: laborColumn, title: "Labor" }],
        getPractitionerIdForLineageKey: () => {
          return;
        },
        locationLineageKeyById: new Map([[locationId, locationLineageKey]]),
        practitionerLineageKeyById: new Map(),
        selectedDate: Temporal.PlainDate.from("2026-04-24"),
        selectedLocationId: locationId,
        simulatedContext: undefined,
        slots: undefined,
        timeToSlot: (time) => {
          const [hours = "0", minutes = "0"] = time.split(":");
          return (Number(hours) - 8) * 12 + Math.floor(Number(minutes) / 5);
        },
        totalSlots: 96,
        vacationsData: undefined,
        workingPractitioners: [],
      }),
    );

    expect(result.current.baseManualBlockedSlots).toHaveLength(6);
    expect(
      result.current.baseManualBlockedSlots.every((slot) =>
        sameCalendarColumnScope(slot.column, laborColumn),
      ),
    ).toBe(true);
    expect(result.current.baseManualBlockedSlots[0]).toMatchObject({
      duration: 30,
      id: "blocked_slot_1",
      isManual: true,
      reason: "Labor blocked",
      slot: 12,
      startSlot: 12,
      title: "Labor blocked",
    });
  });
});
