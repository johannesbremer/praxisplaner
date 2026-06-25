import { renderHook } from "@testing-library/react";
import { Temporal } from "temporal-polyfill";
import { describe, expect, test } from "vitest";

import {
  asAppointmentTypeLineageKey,
  asLocationLineageKey,
  toTableId,
} from "../../../convex/identity";
import {
  calendarColumnScopeFromResourceColumn,
  sameCalendarColumnScope,
} from "../../../lib/calendar-occupancy";
import { useCalendarVisibleDay } from "../../components/calendar/use-calendar-visible-day";
import {
  buildCalendarAppointmentRecord,
  buildCalendarBlockedSlotRecord,
} from "./test-records";

describe("useCalendarVisibleDay", () => {
  test("keeps special resource columns interactive when they already contain appointments", () => {
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(locationId);
    const appointmentTypeLineageKey = asAppointmentTypeLineageKey(
      toTableId<"appointmentTypes">("appointment_type_1"),
    );

    const { result } = renderHook(() =>
      useCalendarVisibleDay({
        appointmentsData: [
          buildCalendarAppointmentRecord({
            _id: toTableId<"appointments">("appointment_1"),
            appointmentTypeLineageKey,
            appointmentTypeTitle: "Labor",
            calendarResourceColumn: "labor",
            end: "2026-04-24T09:30:00+02:00[Europe/Berlin]",
            locationLineageKey,
            practiceId: toTableId<"practices">("practice_1"),
            start: "2026-04-24T09:00:00+02:00[Europe/Berlin]",
            title: "Labor booking",
          }),
        ],
        baseSchedulesData: [],
        blockedSlotsData: [],
        currentDayOfWeek: 5,
        draggedAppointmentTypeLineageKey: undefined,
        getUnsupportedPractitionerIdsForAppointmentType: () => new Set(),
        locationLineageKeyById: new Map([[locationId, locationLineageKey]]),
        placementAppointmentTypeLineageKey: undefined,
        practitionerIdByLineageKey: new Map(),
        practitionerLineageKeyById: new Map(),
        practitionerNameByLineageKey: new Map(),
        practitionersData: [],
        selectedDate: Temporal.PlainDate.from("2026-04-24"),
        selectedLocationId: locationId,
        simulatedContext: undefined,
        timeToMinutes: (time) => {
          const [hours = "0", minutes = "0"] = time.split(":");
          return Number(hours) * 60 + Number(minutes);
        },
        vacationsData: [],
      }),
    );

    const laborColumn = result.current.columns.find((column) =>
      sameCalendarColumnScope(
        column.id,
        calendarColumnScopeFromResourceColumn("labor"),
      ),
    );
    const ekgColumn = result.current.columns.find((column) =>
      sameCalendarColumnScope(
        column.id,
        calendarColumnScopeFromResourceColumn("ekg"),
      ),
    );

    expect(laborColumn).toMatchObject({
      id: calendarColumnScopeFromResourceColumn("labor"),
      title: "Labor",
    });
    expect(laborColumn?.isUnavailable).toBeUndefined();
    expect(ekgColumn).toMatchObject({
      id: calendarColumnScopeFromResourceColumn("ekg"),
      title: "EKG",
    });
    expect(ekgColumn?.isUnavailable).toBeUndefined();
  });

  test("keeps special resource columns visible when they only contain manual blocked slots", () => {
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(locationId);

    const { result } = renderHook(() =>
      useCalendarVisibleDay({
        appointmentsData: [],
        baseSchedulesData: [],
        blockedSlotsData: [
          buildCalendarBlockedSlotRecord({
            _id: toTableId<"blockedSlots">("blocked_slot_1"),
            calendarResourceColumn: "ekg",
            end: "2026-04-24T09:30:00+02:00[Europe/Berlin]",
            locationLineageKey,
            practiceId: toTableId<"practices">("practice_1"),
            start: "2026-04-24T09:00:00+02:00[Europe/Berlin]",
            title: "EKG blocked",
          }),
        ],
        currentDayOfWeek: 5,
        draggedAppointmentTypeLineageKey: undefined,
        getUnsupportedPractitionerIdsForAppointmentType: () => new Set(),
        locationLineageKeyById: new Map([[locationId, locationLineageKey]]),
        placementAppointmentTypeLineageKey: undefined,
        practitionerIdByLineageKey: new Map(),
        practitionerLineageKeyById: new Map(),
        practitionerNameByLineageKey: new Map(),
        practitionersData: [],
        selectedDate: Temporal.PlainDate.from("2026-04-24"),
        selectedLocationId: locationId,
        simulatedContext: undefined,
        timeToMinutes: (time) => {
          const [hours = "0", minutes = "0"] = time.split(":");
          return Number(hours) * 60 + Number(minutes);
        },
        vacationsData: [],
      }),
    );

    expect(
      result.current.columns.some((column) =>
        sameCalendarColumnScope(
          column.id,
          calendarColumnScopeFromResourceColumn("ekg"),
        ),
      ),
    ).toBe(true);
  });
});
