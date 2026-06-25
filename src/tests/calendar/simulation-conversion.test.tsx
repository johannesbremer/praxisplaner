import { renderHook } from "@testing-library/react";
import { Temporal } from "temporal-polyfill";
import { describe, expect, test, vi } from "vitest";

import type { CreateBlockedSlotMutationArgs } from "../../components/calendar/calendar-planning-command";
import type { CalendarAppointmentLayout } from "../../components/calendar/types";
import type { CalendarAppointmentCreateCommandArgs } from "../../components/calendar/use-calendar-planning-workbench";

import {
  asAppointmentTypeLineageKey,
  asLocationLineageKey,
  asPractitionerLineageKey,
  toTableId,
} from "../../../convex/identity";
import {
  calendarColumnScopeFromPractitioner,
  sameCalendarOccupancyScope,
} from "../../../lib/calendar-occupancy";
import { useCalendarSimulationConversion } from "../../components/calendar/use-calendar-simulation-conversion";
import { zonedDateTimeStringResult } from "../../utils/time-calculations";
import {
  buildCalendarAppointmentRecord,
  buildCalendarBlockedSlotRecord,
} from "./test-records";

const parseZonedDateTime = (value: string, source: string) =>
  zonedDateTimeStringResult(value, source).match(
    (typedValue) => typedValue,
    () => null,
  );

describe("useCalendarSimulationConversion", () => {
  test("clears resource occupancy and sends the target practitioner when converting to simulation", async () => {
    const appointmentTypeId =
      toTableId<"appointmentTypes">("appointment_type_1");
    const appointmentTypeLineageKey =
      asAppointmentTypeLineageKey(appointmentTypeId);
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(locationId);
    const practiceId = toTableId<"practices">("practice_1");
    const sourcePractitionerId = toTableId<"practitioners">("practitioner_1");
    const sourcePractitionerLineageKey =
      asPractitionerLineageKey(sourcePractitionerId);
    const targetPractitionerId = toTableId<"practitioners">("practitioner_2");
    const targetPractitionerLineageKey =
      asPractitionerLineageKey(targetPractitionerId);
    const simulatedAppointmentId = toTableId<"appointments">(
      "appointment_simulated",
    );

    const appointment: CalendarAppointmentLayout = {
      column: calendarColumnScopeFromPractitioner(sourcePractitionerLineageKey),
      duration: 30,
      id: "appointment_1",
      record: buildCalendarAppointmentRecord({
        _id: toTableId<"appointments">("appointment_1"),
        appointmentTypeLineageKey,
        appointmentTypeTitle: "Checkup",
        end: "2026-04-23T09:30:00+02:00[Europe/Berlin]",
        locationLineageKey,
        practiceId,
        practitionerLineageKey: sourcePractitionerLineageKey,
        start: "2026-04-23T09:00:00+02:00[Europe/Berlin]",
        title: "Checkup",
      }),
      startTime: "09:00",
    };

    const runCreateAppointment = vi.fn<
      (
        args: CalendarAppointmentCreateCommandArgs,
      ) => Promise<typeof simulatedAppointmentId>
    >(() => Promise.resolve(simulatedAppointmentId));

    const { result } = renderHook(() =>
      useCalendarSimulationConversion({
        blockedSlotDocMapRef: { current: new Map() },
        getAppointmentTypeIdForLineageKey: () => appointmentTypeId,
        getLocationIdForLineageKey: () => locationId,
        getLocationLineageKeyForDisplayId: () => locationLineageKey,
        getPractitionerIdForColumn: () => sourcePractitionerId,
        getPractitionerIdForLineageKey: (lineageKey) =>
          lineageKey === targetPractitionerLineageKey
            ? targetPractitionerId
            : sourcePractitionerId,
        getPractitionerLineageKeyForDisplayId: (displayId) =>
          displayId === targetPractitionerId
            ? targetPractitionerLineageKey
            : sourcePractitionerLineageKey,
        parseZonedDateTime,
        patientDateOfBirth: undefined,
        patientIsNewPatient: false,
        practiceId,
        runCreateAppointment,
        runCreateBlockedSlot: vi.fn(),
        selectedDate: Temporal.PlainDate.from("2026-04-23"),
        selectedLocationId: locationId,
        simulatedContext: {
          locationLineageKey,
          patient: { isNew: false },
        },
      }),
    );

    await result.current.convertRealAppointmentToSimulation(appointment, {
      calendarResourceColumn: null,
      endISO: "2026-04-23T10:30:00+02:00[Europe/Berlin]",
      practitionerId: targetPractitionerId,
      startISO: "2026-04-23T10:00:00+02:00[Europe/Berlin]",
    });

    expect(runCreateAppointment).toHaveBeenCalledWith(
      expect.objectContaining({
        end: "2026-04-23T10:30:00+02:00[Europe/Berlin]",
        placement: {
          locationLineageKey,
          occupancyScope: {
            kind: "practitioner",
            practitionerLineageKey: targetPractitionerLineageKey,
          },
        },
      }),
    );
    const createdArgs = runCreateAppointment.mock.calls[0]?.[0];
    expect(createdArgs).toBeDefined();
    expect(
      createdArgs === undefined
        ? false
        : sameCalendarOccupancyScope(createdArgs.placement.occupancyScope, {
            kind: "practitioner",
            practitionerLineageKey: targetPractitionerLineageKey,
          }),
    ).toBe(true);
    expect(createdArgs).not.toHaveProperty("calendarResourceColumn");
    expect(createdArgs).not.toHaveProperty("practitionerId");
    expect(createdArgs).not.toHaveProperty("locationId");
  });

  test("moves a resource blocked slot to a practitioner when converting to simulation", async () => {
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(locationId);
    const practiceId = toTableId<"practices">("practice_1");
    const targetPractitionerId = toTableId<"practitioners">("practitioner_2");
    const targetPractitionerLineageKey =
      asPractitionerLineageKey(targetPractitionerId);
    const blockedSlotId = toTableId<"blockedSlots">("blocked_slot_1");
    const simulatedBlockedSlotId = toTableId<"blockedSlots">(
      "blocked_slot_simulated",
    );
    const blockedSlot = buildCalendarBlockedSlotRecord({
      _id: blockedSlotId,
      calendarResourceColumn: "labor",
      end: "2026-04-23T09:30:00+02:00[Europe/Berlin]",
      locationLineageKey,
      practiceId,
      start: "2026-04-23T09:00:00+02:00[Europe/Berlin]",
      title: "Labor block",
    });

    const runCreateBlockedSlot = vi.fn<
      (
        args: CreateBlockedSlotMutationArgs,
      ) => Promise<typeof simulatedBlockedSlotId>
    >(() => Promise.resolve(simulatedBlockedSlotId));

    const { result } = renderHook(() =>
      useCalendarSimulationConversion({
        blockedSlotDocMapRef: {
          current: new Map([[blockedSlotId, blockedSlot]]),
        },
        getAppointmentTypeIdForLineageKey: vi.fn(),
        getLocationIdForLineageKey: () => locationId,
        getLocationLineageKeyForDisplayId: () => locationLineageKey,
        getPractitionerIdForColumn: () => targetPractitionerId,
        getPractitionerIdForLineageKey: () => targetPractitionerId,
        getPractitionerLineageKeyForDisplayId: () =>
          targetPractitionerLineageKey,
        parseZonedDateTime,
        patientDateOfBirth: undefined,
        patientIsNewPatient: false,
        practiceId,
        runCreateAppointment: vi.fn(),
        runCreateBlockedSlot,
        selectedDate: Temporal.PlainDate.from("2026-04-23"),
        selectedLocationId: locationId,
        simulatedContext: {
          locationLineageKey,
          patient: { isNew: false },
        },
      }),
    );

    await result.current.convertRealBlockedSlotToSimulation(blockedSlotId, {
      endISO: "2026-04-23T10:30:00+02:00[Europe/Berlin]",
      locationId,
      practitionerId: targetPractitionerId,
      startISO: "2026-04-23T10:00:00+02:00[Europe/Berlin]",
      title: "Moved block",
    });

    expect(runCreateBlockedSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        end: "2026-04-23T10:30:00+02:00[Europe/Berlin]",
        occupancyScope: {
          kind: "practitioner",
          practitionerId: targetPractitionerId,
        },
        replacesBlockedSlotId: blockedSlotId,
        start: "2026-04-23T10:00:00+02:00[Europe/Berlin]",
        title: "Moved block",
      }),
    );
  });

  test("clears a resource blocked slot when converting to a location-wide simulation", async () => {
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(locationId);
    const practiceId = toTableId<"practices">("practice_1");
    const blockedSlotId = toTableId<"blockedSlots">("blocked_slot_1");
    const simulatedBlockedSlotId = toTableId<"blockedSlots">(
      "blocked_slot_simulated",
    );
    const blockedSlot = buildCalendarBlockedSlotRecord({
      _id: blockedSlotId,
      calendarResourceColumn: "labor",
      end: "2026-04-23T09:30:00+02:00[Europe/Berlin]",
      locationLineageKey,
      practiceId,
      start: "2026-04-23T09:00:00+02:00[Europe/Berlin]",
      title: "Labor block",
    });

    const runCreateBlockedSlot = vi.fn<
      (
        args: CreateBlockedSlotMutationArgs,
      ) => Promise<typeof simulatedBlockedSlotId>
    >(() => Promise.resolve(simulatedBlockedSlotId));

    const { result } = renderHook(() =>
      useCalendarSimulationConversion({
        blockedSlotDocMapRef: {
          current: new Map([[blockedSlotId, blockedSlot]]),
        },
        getAppointmentTypeIdForLineageKey: vi.fn(),
        getLocationIdForLineageKey: () => locationId,
        getLocationLineageKeyForDisplayId: () => locationLineageKey,
        getPractitionerIdForColumn: vi.fn(),
        getPractitionerIdForLineageKey: vi.fn(),
        getPractitionerLineageKeyForDisplayId: vi.fn(),
        parseZonedDateTime,
        patientDateOfBirth: undefined,
        patientIsNewPatient: false,
        practiceId,
        runCreateAppointment: vi.fn(),
        runCreateBlockedSlot,
        selectedDate: Temporal.PlainDate.from("2026-04-23"),
        selectedLocationId: locationId,
        simulatedContext: {
          locationLineageKey,
          patient: { isNew: false },
        },
      }),
    );

    await result.current.convertRealBlockedSlotToSimulation(blockedSlotId, {
      calendarResourceColumn: null,
      locationId,
    });

    expect(runCreateBlockedSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        occupancyScope: { kind: "location-wide" },
        replacesBlockedSlotId: blockedSlotId,
      }),
    );
  });
});
