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
          {
            practitionerLineageKey,
            startTime: "2026-04-25T09:15:00+02:00[Europe/Berlin]",
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

  it("blocks practitioner-root Kettentermine without full scheduler availability", () => {
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
      toTableId<"appointmentTypes">("root_type_lineage_practitioner_rules"),
    );
    const followUpAppointmentTypeLineageKey = asAppointmentTypeLineageKey(
      toTableId<"appointmentTypes">(
        "follow_up_type_lineage_practitioner_rules",
      ),
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
        appointmentsData: [],
        appointmentTypeInfoByLineageKey: new Map([
          [
            followUpAppointmentTypeLineageKey,
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
                    appointmentTypeLineageKey:
                      followUpAppointmentTypeLineageKey,
                    occupancy: { kind: "inheritRootPractitioner" },
                    required: true,
                    stepId: "follow-up",
                    timing: {
                      kind: "afterPreviousEnd",
                      offsetUnit: "minutes",
                      offsetValue: 0,
                    },
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
          {
            practitionerLineageKey,
            reason: "Pause",
            startTime: "2026-04-25T09:15:00+02:00[Europe/Berlin]",
            status: "BLOCKED",
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

  it("blocks Kettentermine when a practitioner follow-up lacks full scheduler availability", () => {
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
      toTableId<"appointmentTypes">("root_type_lineage_follow_up_rules"),
    );
    const followUpAppointmentTypeLineageKey = asAppointmentTypeLineageKey(
      toTableId<"appointmentTypes">("follow_up_type_lineage_follow_up_rules"),
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
        appointmentsData: [],
        appointmentTypeInfoByLineageKey: new Map([
          [
            followUpAppointmentTypeLineageKey,
            {
              appointmentPlan: { steps: [] },
              defaultOccupancy: undefined,
              duration: 30,
            },
          ],
          [
            rootAppointmentTypeLineageKey,
            {
              appointmentPlan: {
                steps: [
                  {
                    appointmentTypeLineageKey:
                      followUpAppointmentTypeLineageKey,
                    occupancy: { kind: "inheritRootPractitioner" },
                    required: true,
                    stepId: "follow-up",
                    timing: {
                      kind: "afterPreviousEnd",
                      offsetUnit: "minutes",
                      offsetValue: 0,
                    },
                  },
                ],
              },
              defaultOccupancy: undefined,
              duration: 15,
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
          ...["09:00", "09:05", "09:10", "09:15", "09:20", "09:25"].map(
            (time) => ({
              practitionerLineageKey,
              startTime: `2026-04-25T${time}:00+02:00[Europe/Berlin]`,
              status: "AVAILABLE",
            }),
          ),
          {
            practitionerLineageKey,
            reason: "Pause",
            startTime: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
            status: "BLOCKED",
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

  it("blocks resource-root Kettentermine without full scheduler availability", () => {
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
      toTableId<"appointmentTypes">("root_type_lineage_resource"),
    );
    const ekgAppointmentTypeLineageKey = asAppointmentTypeLineageKey(
      toTableId<"appointmentTypes">("ekg_type_lineage_resource"),
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
                    stepId: "ekg-step",
                    timing: { anchorStepId: "root", kind: "sameStartAs" },
                  },
                ],
              },
              defaultOccupancy: {
                calendarResourceColumn: "ekg",
                kind: "resourceColumn",
              },
              duration: 30,
            },
          ],
        ]),
        baseSchedulesData: undefined,
        blockedSlotsData: [],
        blockedSlotsWithoutAppointmentTypeSlots: undefined,
        businessStartHour: 8,
        columns: [{ id: ekgColumn, title: "EKG" }],
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
          {
            practitionerLineageKey,
            reason: "Pause",
            startTime: "2026-04-25T09:15:00+02:00[Europe/Berlin]",
            status: "BLOCKED",
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
          column: ekgColumn,
          reason: "Kettentermin nicht planbar",
          slot: timeToSlot("09:00"),
        },
      ]),
    );
  });

  it("blocks resource-root Kettentermine when the root resource range is occupied", () => {
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
      toTableId<"appointmentTypes">("root_type_lineage_resource_occupied"),
    );
    const ekgAppointmentTypeLineageKey = asAppointmentTypeLineageKey(
      toTableId<"appointmentTypes">("ekg_type_lineage_resource_occupied"),
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
        appointmentsData: [
          buildCalendarAppointmentRecord({
            _id: toTableId<"appointments">("appointment_ekg_occupied"),
            appointmentTypeLineageKey: ekgAppointmentTypeLineageKey,
            calendarResourceColumn: "ekg",
            end: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
            locationLineageKey,
            practiceId,
            start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
            title: "EKG",
          }),
        ],
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
                    stepId: "ekg-step",
                    timing: {
                      kind: "afterPreviousEnd",
                      offsetUnit: "minutes",
                      offsetValue: 0,
                    },
                  },
                ],
              },
              defaultOccupancy: {
                calendarResourceColumn: "ekg",
                kind: "resourceColumn",
              },
              duration: 30,
            },
          ],
        ]),
        baseSchedulesData: undefined,
        blockedSlotsData: [],
        blockedSlotsWithoutAppointmentTypeSlots: undefined,
        businessStartHour: 8,
        columns: [{ id: ekgColumn, title: "EKG" }],
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
        slots: ["09:00", "09:05", "09:10", "09:15", "09:20", "09:25"].map(
          (time) => ({
            practitionerLineageKey,
            startTime: `2026-04-25T${time}:00+02:00[Europe/Berlin]`,
            status: "AVAILABLE",
          }),
        ),
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
          column: ekgColumn,
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
              end: "2026-04-25T09:45:00+02:00[Europe/Berlin]",
              locationLineageKey,
              practiceId,
              practitionerLineageKey,
              start: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
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
              duration: 15,
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
                    timing: {
                      kind: "afterPreviousEnd",
                      offsetUnit: "minutes",
                      offsetValue: 0,
                    },
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
          "09:00",
          "09:05",
          "09:10",
          "09:15",
          "09:20",
          "09:25",
          "09:30",
          "09:35",
          "09:40",
        ].map((time) => ({
          practitionerLineageKey,
          startTime: `2026-04-25T${time}:00+02:00[Europe/Berlin]`,
          status: "AVAILABLE",
        })),
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
