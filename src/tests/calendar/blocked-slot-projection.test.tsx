import { renderHook } from "@testing-library/react";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";

import {
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
import { buildCalendarBlockedSlotRecord } from "./test-records";

describe("useCalendarBlockedSlotProjection", () => {
  const selectedDate = Temporal.PlainDate.from("2026-04-25");
  const locationId = toTableId<"locations">("location_1");
  const locationLineageKey = asLocationLineageKey(
    toTableId<"locations">("location_lineage_1"),
  );
  const practitionerId = toTableId<"practitioners">("practitioner_1");
  const rawPractitionerLineageId = toTableId<"practitioners">(
    "practitioner_lineage_1",
  );
  const practitionerLineageKey = asPractitionerLineageKey(
    rawPractitionerLineageId,
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
  const noPractitionerIdForLineageKey = (): Id<"practitioners"> | undefined => {
    return;
  };

  function renderProjection(args: {
    appointmentSeriesRootBlockedSlots?: {
      blockingRuleIds?: Id<"ruleConditions">[];
      calendarResourceColumn?: "ekg" | "labor";
      canOverride: boolean;
      duration: number;
      practitionerLineageKey?: typeof rawPractitionerLineageId;
      provenance?: "ruleBlock";
      reason?: string;
      startTime: string;
      status: "available" | "unavailable";
    }[];
    appointmentTypeSelected: boolean;
    blockedSlotsWithoutAppointmentTypeSlots?: {
      practitionerLineageKey?: typeof practitionerLineageKey;
      reason?: string;
      startTime: string;
      status: string;
    }[];
    resourceDefaultCalendarResourceColumn?: "ekg" | "labor";
    slots?: {
      practitionerLineageKey?: typeof practitionerLineageKey;
      reason?: string;
      startTime: string;
      status: string;
    }[];
  }) {
    return renderHook(() =>
      useCalendarBlockedSlotProjection({
        appointmentsData: [],
        appointmentSeriesRootBlockedSlots:
          args.appointmentSeriesRootBlockedSlots,
        appointmentTypeSelected: args.appointmentTypeSelected,
        baseSchedulesData: undefined,
        blockedSlotsData: [],
        blockedSlotsWithoutAppointmentTypeSlots:
          args.blockedSlotsWithoutAppointmentTypeSlots,
        businessStartHour: 8,
        columns: [
          { id: practitionerColumn, title: "Dr. Chain" },
          { id: calendarColumnScopeFromResourceColumn("ekg"), title: "EKG" },
          {
            id: calendarColumnScopeFromResourceColumn("labor"),
            title: "Labor",
          },
        ],
        getPractitionerIdForLineageKey: (lineageKey) =>
          lineageKey === practitionerLineageKey ? practitionerId : undefined,
        locationLineageKeyById: new Map([[locationId, locationLineageKey]]),
        practitionerLineageKeyById: new Map([
          [practitionerId, practitionerLineageKey],
        ]),
        resourceDefaultCalendarResourceColumn:
          args.resourceDefaultCalendarResourceColumn,
        selectedDate,
        selectedLocationId: locationId,
        simulatedContext: undefined,
        slots: args.slots,
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
  }

  it("projects resource-scoped manual blocked slots into resource columns", () => {
    const laborColumn = calendarColumnScopeFromResourceColumn("labor");

    const { result } = renderHook(() =>
      useCalendarBlockedSlotProjection({
        appointmentsData: [],
        appointmentSeriesRootBlockedSlots: undefined,
        appointmentTypeSelected: false,
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
        getPractitionerIdForLineageKey: noPractitionerIdForLineageKey,
        locationLineageKeyById: new Map([[locationId, locationLineageKey]]),
        practitionerLineageKeyById: new Map(),
        resourceDefaultCalendarResourceColumn: undefined,
        selectedDate: Temporal.PlainDate.from("2026-04-24"),
        selectedLocationId: locationId,
        simulatedContext: undefined,
        slots: undefined,
        timeToSlot,
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

  it("maps server-planned practitioner Kettentermin root blocks into calendar slots", () => {
    const { result } = renderProjection({
      appointmentSeriesRootBlockedSlots: [
        {
          canOverride: false,
          duration: SLOT_DURATION,
          practitionerLineageKey: rawPractitionerLineageId,
          reason: "Kettentermin nicht planbar",
          startTime: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
          status: "unavailable",
        },
      ],
      appointmentTypeSelected: true,
    });

    expect(result.current.serverAppointmentSeriesRootBlockedSlots).toEqual([
      {
        blocksPlacementStartOnly: true,
        canOverride: false,
        column: practitionerColumn,
        reason: "Kettentermin nicht planbar",
        slot: 12,
      },
    ]);
  });

  it("maps server-planned resource Kettentermin root blocks into resource columns", () => {
    const ekgColumn = calendarColumnScopeFromResourceColumn("ekg");
    const { result } = renderProjection({
      appointmentSeriesRootBlockedSlots: [
        {
          calendarResourceColumn: "ekg",
          canOverride: false,
          duration: SLOT_DURATION,
          reason: "Kettentermin nicht planbar",
          startTime: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
          status: "unavailable",
        },
      ],
      appointmentTypeSelected: true,
    });

    expect(result.current.serverAppointmentSeriesRootBlockedSlots).toEqual([
      {
        blocksPlacementStartOnly: true,
        canOverride: false,
        column: ekgColumn,
        reason: "Kettentermin nicht planbar",
        slot: 12,
      },
    ]);
  });

  it("projects vacation blocks with the selected absence reason", () => {
    const { result } = renderHook(() =>
      useCalendarBlockedSlotProjection({
        appointmentsData: [],
        appointmentSeriesRootBlockedSlots: undefined,
        appointmentTypeSelected: false,
        baseSchedulesData: [
          {
            dayOfWeek: 6,
            endTime: "12:00",
            locationLineageKey,
            practitionerId,
            practitionerLineageKey,
            startTime: "08:00",
          },
        ],
        blockedSlotsData: [],
        blockedSlotsWithoutAppointmentTypeSlots: undefined,
        businessStartHour: 8,
        columns: [{ id: practitionerColumn, title: "Dr. Chain" }],
        getPractitionerIdForLineageKey: (lineageKey) =>
          lineageKey === practitionerLineageKey ? practitionerId : undefined,
        locationLineageKeyById: new Map([[locationId, locationLineageKey]]),
        practitionerLineageKeyById: new Map([
          [practitionerId, practitionerLineageKey],
        ]),
        resourceDefaultCalendarResourceColumn: undefined,
        selectedDate,
        selectedLocationId: locationId,
        simulatedContext: undefined,
        slots: undefined,
        timeToSlot,
        totalSlots: 108,
        vacationsData: [
          {
            date: selectedDate.toString(),
            portion: "morning",
            practitionerLineageKey,
            reason: "sick",
            staffType: "practitioner",
          },
        ],
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

    expect(result.current.baseVacationBlockedSlots[0]).toMatchObject({
      column: practitionerColumn,
      reason: "Krank",
      slot: 0,
    });
  });

  it("projects server-planned Candidate Slot decisions as exact start blocks", () => {
    const { result } = renderProjection({
      appointmentSeriesRootBlockedSlots: [
        {
          canOverride: false,
          duration: 15,
          practitionerLineageKey: rawPractitionerLineageId,
          reason: "Der ausgewählte Starttermin ist nicht mehr verfügbar",
          startTime: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
          status: "unavailable",
        },
      ],
      appointmentTypeSelected: true,
    });

    expect(result.current.serverAppointmentSeriesRootBlockedSlots).toEqual([
      {
        blocksPlacementStartOnly: true,
        canOverride: false,
        column: practitionerColumn,
        reason: "Der ausgewählte Starttermin ist nicht mehr verfügbar",
        slot: 12,
      },
    ]);
  });

  it("keeps server-planned Kettentermin rule provenance on projected slots", () => {
    const { result } = renderProjection({
      appointmentSeriesRootBlockedSlots: [
        {
          blockingRuleIds: [toTableId<"ruleConditions">("rule_condition_1")],
          canOverride: true,
          duration: SLOT_DURATION,
          practitionerLineageKey: rawPractitionerLineageId,
          provenance: "ruleBlock",
          reason: "Regel blockiert Folgetermin",
          startTime: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
          status: "unavailable",
        },
      ],
      appointmentTypeSelected: true,
    });

    expect(result.current.serverAppointmentSeriesRootBlockedSlots).toEqual([
      {
        blockedByRuleId: "rule_condition_1",
        blocksPlacementStartOnly: true,
        canOverride: true,
        column: practitionerColumn,
        provenance: "ruleBlock",
        reason: "Regel blockiert Folgetermin",
        slot: 12,
      },
    ]);
  });

  it("does not block candidate slots while planner results are loading", () => {
    const { result } = renderProjection({
      appointmentTypeSelected: true,
    });

    expect(result.current.serverAppointmentSeriesRootBlockedSlots).toEqual([]);
  });

  it("blocks non-default columns for resource-default appointment types", () => {
    const ekgColumn = calendarColumnScopeFromResourceColumn("ekg");
    const laborColumn = calendarColumnScopeFromResourceColumn("labor");
    const { result } = renderProjection({
      appointmentTypeSelected: true,
      resourceDefaultCalendarResourceColumn: "ekg",
    });

    expect(
      result.current.resourceDefaultWrongColumnBlockedSlots.filter((slot) =>
        sameCalendarColumnScope(slot.column, ekgColumn),
      ),
    ).toEqual([]);
    expect(
      result.current.resourceDefaultWrongColumnBlockedSlots.filter((slot) =>
        sameCalendarColumnScope(slot.column, practitionerColumn),
      ),
    ).toHaveLength(108);
    expect(
      result.current.resourceDefaultWrongColumnBlockedSlots.filter((slot) =>
        sameCalendarColumnScope(slot.column, laborColumn),
      ),
    ).toHaveLength(108);
    expect(result.current.resourceDefaultWrongColumnBlockedSlots[0]).toEqual({
      blocksPlacementStartOnly: true,
      canOverride: false,
      column: practitionerColumn,
      reason: "Diese Terminart kann nur in der EKG-Spalte gebucht werden.",
      slot: 0,
    });
  });

  it("uses server planner blocks instead of pending candidates after results arrive", () => {
    const { result } = renderProjection({
      appointmentSeriesRootBlockedSlots: [
        {
          canOverride: false,
          duration: SLOT_DURATION,
          practitionerLineageKey: rawPractitionerLineageId,
          reason: "Kettentermin nicht planbar",
          startTime: "2026-04-25T09:05:00+02:00[Europe/Berlin]",
          status: "unavailable",
        },
      ],
      appointmentTypeSelected: true,
    });

    expect(result.current.serverAppointmentSeriesRootBlockedSlots).toEqual([
      {
        blocksPlacementStartOnly: true,
        canOverride: false,
        column: practitionerColumn,
        reason: "Kettentermin nicht planbar",
        slot: 13,
      },
    ]);
  });

  it("does not hard-block selected appointment placement with pre-selection rule blocks", () => {
    const { result } = renderProjection({
      appointmentTypeSelected: true,
      blockedSlotsWithoutAppointmentTypeSlots: [
        {
          practitionerLineageKey,
          reason: "Generic rule block",
          startTime: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
          status: "BLOCKED",
        },
      ],
    });

    expect(result.current.baseBlockedSlots).toEqual([]);
  });

  it("does not hard-block selected appointment placement with raw scheduler blocks", () => {
    const { result } = renderProjection({
      appointmentTypeSelected: true,
      slots: [
        {
          practitionerLineageKey,
          reason: "Raw scheduler block",
          startTime: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
          status: "BLOCKED",
        },
      ],
    });

    expect(result.current.baseBlockedSlots).toEqual([]);
  });

  it("shows appointment-type-independent blocks before an appointment type is selected", () => {
    const { result } = renderProjection({
      appointmentTypeSelected: false,
      blockedSlotsWithoutAppointmentTypeSlots: [
        {
          practitionerLineageKey,
          reason: "Generic rule block",
          startTime: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
          status: "BLOCKED",
        },
      ],
    });

    expect(result.current.baseBlockedSlots).toEqual([
      {
        column: practitionerColumn,
        reason: "Generic rule block",
        slot: 12,
      },
    ]);
  });
});
