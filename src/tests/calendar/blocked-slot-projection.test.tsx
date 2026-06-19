import { renderHook } from "@testing-library/react";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";

import {
  asAppointmentTypeLineageKey,
  asLocationLineageKey,
  asPractitionerLineageKey,
  toTableId,
} from "../../../convex/identity";
import {
  calendarColumnScopeFromPractitioner,
  calendarColumnScopeFromResourceColumn,
  sameCalendarColumnScope,
} from "../../../lib/calendar-occupancy";
import { SLOT_DURATION } from "../../components/calendar/types";
import { useCalendarBlockedSlotProjection } from "../../components/calendar/use-calendar-blocked-slot-projection";
import {
  buildCalendarAppointmentRecord,
  buildCalendarBlockedSlotRecord,
} from "./test-records";

describe("useCalendarBlockedSlotProjection", () => {
  it("projects resource-scoped manual blocked slots into resource columns", () => {
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(locationId);
    const laborColumn = calendarColumnScopeFromResourceColumn("labor");

    const { result } = renderHook(() =>
      useCalendarBlockedSlotProjection({
        appointmentsData: [],
        appointmentTypeInfoByLineageKey: new Map(),
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
        excludedAppointmentIdForAvailability: undefined,
        getPractitionerIdForLineageKey: () => undefined,
        locationLineageKeyById: new Map([[locationId, locationLineageKey]]),
        placementAppointmentTypeLineageKey: undefined,
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
      const [hourText = "0", minuteText = "0"] = time.split(":");
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
        excludedAppointmentIdsForAvailability: new Set(),
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

  it("tracks projected Kettentermine as occupied for later projected steps", () => {
    const selectedDate = Temporal.PlainDate.from("2026-04-25");
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(
      toTableId<"locations">("location_lineage_1"),
    );
    const practitionerId = toTableId<"practitioners">("practitioner_1");
    const practitionerLineageKey = asPractitionerLineageKey(
      toTableId<"practitioners">("practitioner_lineage_1"),
    );
    const rootAppointmentTypeLineageKey = asAppointmentTypeLineageKey(
      toTableId<"appointmentTypes">("root_type_lineage_1"),
    );
    const ekgAppointmentTypeLineageKey = asAppointmentTypeLineageKey(
      toTableId<"appointmentTypes">("ekg_type_lineage_1"),
    );
    const practitionerColumn = calendarColumnScopeFromPractitioner(
      practitionerLineageKey,
    );
    const ekgColumn = calendarColumnScopeFromResourceColumn("ekg");
    const businessStartMinutes = 8 * 60;
    const timeToSlot = (time: string) => {
      const [hourText, minuteText] = time.split(":");
      const hour = Number(hourText);
      const minute = Number(minuteText);
      return (hour * 60 + minute - businessStartMinutes) / SLOT_DURATION;
    };

    const { result } = renderHook(() =>
      useCalendarBlockedSlotProjection({
        appointmentsData: [],
        appointmentTypeInfoByLineageKey: new Map([
          [
            ekgAppointmentTypeLineageKey,
            {
              appointmentPlan: { steps: [] },
              defaultOccupancy: undefined,
              duration: 10,
            },
          ],
          [
            rootAppointmentTypeLineageKey,
            {
              appointmentPlan: {
                steps: [
                  {
                    appointmentTypeLineageKey: ekgAppointmentTypeLineageKey,
                    occupancy: {
                      calendarResourceColumn: "ekg",
                      kind: "resourceColumn",
                    },
                    required: true,
                    stepId: "ekg-1",
                    timing: { anchorStepId: "root", kind: "sameStartAs" },
                  },
                  {
                    appointmentTypeLineageKey: ekgAppointmentTypeLineageKey,
                    occupancy: {
                      calendarResourceColumn: "ekg",
                      kind: "resourceColumn",
                    },
                    required: true,
                    stepId: "ekg-2",
                    timing: { anchorStepId: "root", kind: "sameStartAs" },
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
        columns: [
          { id: practitionerColumn, title: "Dr. Chain" },
          { id: ekgColumn, title: "EKG" },
        ],
        excludedAppointmentIdsForAvailability: new Set(),
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

  it("does not project the dragged series as blocking itself", () => {
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
    const excludedAppointmentId = toTableId<"appointments">("appointment_1");
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
          {
            ...buildCalendarAppointmentRecord({
              _id: excludedAppointmentId,
              appointmentTypeLineageKey: beAppointmentTypeLineageKey,
              end: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
              locationLineageKey,
              practiceId,
              practitionerLineageKey,
              start: "2026-04-25T08:55:00+02:00[Europe/Berlin]",
              title: "BE",
            }),
            seriesId: "series_1",
            seriesStepIndex: 1n,
          },
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
        excludedAppointmentIdsForAvailability: new Set([excludedAppointmentId]),
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

    expect(result.current.baseAppointmentSeriesRootBlockedSlots).not.toEqual(
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
