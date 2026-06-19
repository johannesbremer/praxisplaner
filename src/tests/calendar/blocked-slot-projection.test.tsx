import { renderHook } from "@testing-library/react";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";

import {
  asAppointmentTypeLineageKey,
  asLocationLineageKey,
  asPractitionerLineageKey,
  toTableId,
} from "../../../convex/identity";
import { calendarColumnScopeFromPractitioner } from "../../../lib/calendar-occupancy";
import { SLOT_DURATION } from "../../components/calendar/types";
import { useCalendarBlockedSlotProjection } from "../../components/calendar/use-calendar-blocked-slot-projection";
import { buildCalendarAppointmentRecord } from "./test-records";

describe("useCalendarBlockedSlotProjection", () => {
  it("projects before-root Kettentermine by subtracting the step duration and offset", () => {
    const selectedDate = Temporal.PlainDate.from("2026-04-25");
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(
      toTableId<"locations">("location_lineage_1"),
    );
    const practitionerId = toTableId<"practitioners">("practitioner_1");
    const practitionerLineageKey = asPractitionerLineageKey(
      toTableId<"practitioners">("practitioner_lineage_1"),
    );
    const practiceId = toTableId<"practices">("practice_1");
    const rootAppointmentTypeLineageKey = asAppointmentTypeLineageKey(
      toTableId<"appointmentTypes">("root_type_lineage_1"),
    );
    const beAppointmentTypeLineageKey = asAppointmentTypeLineageKey(
      toTableId<"appointmentTypes">("be_type_lineage_1"),
    );
    const practitionerColumn = calendarColumnScopeFromPractitioner(
      practitionerLineageKey,
    );
    const businessStartMinutes = 8 * 60;
    const timeToSlot = (time: string) => {
      const [hourText, minuteText] = time.split(":");
      const hour = Number(hourText);
      const minute = Number(minuteText);
      return (hour * 60 + minute - businessStartMinutes) / SLOT_DURATION;
    };

    const { result } = renderHook(() =>
      useCalendarBlockedSlotProjection({
        appointmentsData: [
          buildCalendarAppointmentRecord({
            _id: toTableId<"appointments">("appointment_1"),
            appointmentTypeLineageKey: beAppointmentTypeLineageKey,
            end: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
            locationLineageKey,
            practiceId,
            practitionerLineageKey,
            start: "2026-04-25T08:55:00+02:00[Europe/Berlin]",
            title: "BE",
          }),
        ],
        appointmentTypeInfoByLineageKey: new Map([
          [
            beAppointmentTypeLineageKey,
            {
              appointmentPlan: { steps: [] },
              defaultOccupancy: undefined,
              duration: 5,
            },
          ],
          [
            rootAppointmentTypeLineageKey,
            {
              appointmentPlan: {
                steps: [
                  {
                    appointmentTypeLineageKey: beAppointmentTypeLineageKey,
                    occupancy: { kind: "inheritRootPractitioner" },
                    required: true,
                    stepId: "be-before",
                    timing: { kind: "beforeRootStart", offsetMinutes: 0 },
                  },
                ],
              },
              defaultOccupancy: undefined,
              duration: 30,
            },
          ],
        ]),
        baseSchedulesData: undefined,
        blockedSlotsData: [],
        blockedSlotsWithoutAppointmentTypeSlots: undefined,
        businessStartHour: 8,
        columns: [{ id: practitionerColumn, title: "Dr. Chain" }],
        excludedAppointmentIdForAvailability: undefined,
        getPractitionerIdForLineageKey: (lineageKey) =>
          lineageKey === practitionerLineageKey ? practitionerId : undefined,
        locationLineageKeyById: new Map([[locationId, locationLineageKey]]),
        placementAppointmentTypeLineageKey: rootAppointmentTypeLineageKey,
        practitionerLineageKeyById: new Map([
          [practitionerId, practitionerLineageKey],
        ]),
        selectedDate,
        selectedLocationId: locationId,
        simulatedContext: undefined,
        slots: [
          {
            practitionerLineageKey,
            startTime: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
            status: "AVAILABLE",
          },
        ],
        timeToSlot,
        totalSlots: 108,
        vacationsData: undefined,
        workingPractitioners: [
          {
            endTime: "17:00",
            lineageKey: practitionerLineageKey,
            name: "Dr. Chain",
            startTime: "08:00",
          },
        ],
      }),
    );

    expect(result.current.baseAppointmentSeriesRootBlockedSlots).toEqual(
      expect.arrayContaining([
        {
          column: practitionerColumn,
          reason: "Kettentermin nicht planbar",
          slot: timeToSlot("09:00"),
        },
      ]),
    );
  });
});
