import { renderHook } from "@testing-library/react";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";

import {
  asLocationLineageKey,
  asPractitionerLineageKey,
  toTableId,
} from "../../../convex/identity";
import { calendarColumnScopeFromPractitioner } from "../../../lib/calendar-occupancy";
import { SLOT_DURATION } from "../../components/calendar/types";
import { useCalendarBlockedSlotProjection } from "../../components/calendar/use-calendar-blocked-slot-projection";

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
    const [hourText, minuteText] = time.split(":");
    const hour = Number(hourText);
    const minute = Number(minuteText);
    return (hour * 60 + minute - businessStartMinutes) / SLOT_DURATION;
  };

  function renderProjection(args: {
    appointmentSeriesRootBlockedSlots?: {
      blockingRuleIds?: Id<"ruleConditions">[];
      failureKind?: "ruleBlock";
      practitionerLineageKey?: typeof rawPractitionerLineageId;
      reason?: string;
      startTime: string;
    }[];
    appointmentTypeSelected: boolean;
    blockedSlotsWithoutAppointmentTypeSlots?: {
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
        columns: [{ id: practitionerColumn, title: "Dr. Chain" }],
        getPractitionerIdForLineageKey: (lineageKey) =>
          lineageKey === practitionerLineageKey ? practitionerId : undefined,
        locationLineageKeyById: new Map([[locationId, locationLineageKey]]),
        practitionerLineageKeyById: new Map([
          [practitionerId, practitionerLineageKey],
        ]),
        selectedDate,
        selectedLocationId: locationId,
        simulatedContext: undefined,
        slots: undefined,
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

  it("maps server-planned Kettentermin root blocks into calendar slots", () => {
    const { result } = renderProjection({
      appointmentSeriesRootBlockedSlots: [
        {
          practitionerLineageKey: rawPractitionerLineageId,
          reason: "Kettentermin nicht planbar",
          startTime: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
        },
      ],
      appointmentTypeSelected: true,
    });

    expect(result.current.baseAppointmentSeriesRootBlockedSlots).toEqual([
      {
        column: practitionerColumn,
        reason: "Kettentermin nicht planbar",
        slot: 12,
      },
    ]);
  });

  it("keeps server-planned Kettentermin rule provenance on projected slots", () => {
    const { result } = renderProjection({
      appointmentSeriesRootBlockedSlots: [
        {
          blockingRuleIds: [toTableId<"ruleConditions">("rule_condition_1")],
          failureKind: "ruleBlock",
          practitionerLineageKey: rawPractitionerLineageId,
          reason: "Regel blockiert Folgetermin",
          startTime: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
        },
      ],
      appointmentTypeSelected: true,
    });

    expect(result.current.baseAppointmentSeriesRootBlockedSlots).toEqual([
      {
        blockedByRuleId: "rule_condition_1",
        column: practitionerColumn,
        failureKind: "ruleBlock",
        reason: "Regel blockiert Folgetermin",
        slot: 12,
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
