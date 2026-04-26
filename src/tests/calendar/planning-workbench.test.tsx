import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";
import type {
  CalendarAppointmentRecord,
  CalendarBlockedSlotRecord,
} from "../../components/calendar/types";
import type { LocalHistoryAction } from "../../hooks/use-local-history";

import {
  asAppointmentTypeLineageKey,
  asLocationLineageKey,
  toTableId,
} from "../../../convex/identity";
import { useCalendarPlanningWorkbench } from "../../components/calendar/use-calendar-planning-workbench";
import { zonedDateTimeStringResult } from "../../utils/time-calculations";

const mutationQueue: {
  withOptimisticUpdate: (
    updater: (localStore: unknown, args: unknown) => void,
  ) => (args: unknown) => Promise<unknown>;
}[] = [];
const pushHistoryAction = vi.fn<(action: LocalHistoryAction) => void>();

vi.mock("convex/react", () => ({
  useMutation: () => {
    const mutation = mutationQueue.shift();
    if (!mutation) {
      throw new Error("Unexpected mutation request");
    }
    return mutation;
  },
}));

vi.mock("../../components/calendar/use-calendar-planning-history", () => ({
  useCalendarPlanningHistory: () => ({
    pushHistoryAction,
  }),
}));

const makeMutation = (result: unknown) => {
  const mutation = vi.fn((args: unknown) => {
    void args;
    return Promise.resolve(result);
  });
  return Object.assign(mutation, {
    withOptimisticUpdate:
      () =>
      async (args: unknown): Promise<unknown> =>
        mutation(args),
  });
};

const parseZonedDateTime = (value: string, source: string) =>
  zonedDateTimeStringResult(value, source).match(
    (typedValue) => typedValue,
    () => null,
  );

describe("calendar planning workbench", () => {
  beforeEach(() => {
    mutationQueue.length = 0;
    pushHistoryAction.mockReset();
  });

  it("creates an Appointment through the deep Workbench Interface and owns history snapshots", async () => {
    const appointmentTypeId = toTableId<"appointmentTypes">("type_1");
    const appointmentTypeLineageKey = asAppointmentTypeLineageKey(
      toTableId<"appointmentTypes">("type_lineage_1"),
    );
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(
      toTableId<"locations">("location_lineage_1"),
    );
    const practiceId = toTableId<"practices">("practice_1");
    const appointmentId = toTableId<"appointments">("appointment_1");

    const createAppointmentMutation = makeMutation(appointmentId);
    mutationQueue.push(
      createAppointmentMutation,
      makeMutation(null),
      makeMutation(null),
      makeMutation(null),
      makeMutation(null),
      makeMutation(toTableId<"blockedSlots">("blocked_slot_unused")),
      makeMutation(null),
      makeMutation(null),
    );

    const { result } = renderHook(() =>
      useCalendarPlanningWorkbench({
        activeDayAppointmentMapRef: { current: new Map() },
        activeDayBlockedSlotMapRef: { current: new Map() },
        allPracticeAppointmentMap: new Map(),
        allPracticeAppointmentMapRef: { current: new Map() },
        allPracticeAppointmentsLoaded: true,
        allPracticeBlockedSlotMap: new Map(),
        allPracticeBlockedSlotMapRef: { current: new Map() },
        allPracticeBlockedSlotsLoaded: true,
        blockedSlotsQueryArgs: null,
        calendarDayQueryArgs: null,
        getRequiredAppointmentTypeInfo: () => ({
          duration: 30,
          hasFollowUpPlan: false,
          name: "Check-up",
        }),
        parseZonedDateTime,
        referenceMaps: {
          appointmentTypeIdByLineageKey: new Map([
            [appointmentTypeLineageKey, appointmentTypeId],
          ]),
          appointmentTypeLineageKeyById: new Map([
            [appointmentTypeId, appointmentTypeLineageKey],
          ]),
          locationIdByLineageKey: new Map([[locationLineageKey, locationId]]),
          locationLineageKeyById: new Map([[locationId, locationLineageKey]]),
          practitionerIdByLineageKey: new Map(),
          practitionerLineageKeyById: new Map(),
        },
        refreshAllPracticeConflictData: vi.fn(() => Promise.resolve()),
      }),
    );

    let createdId: Id<"appointments"> | undefined;
    await act(async () => {
      createdId = await result.current.commands.createAppointment({
        appointmentTypeId,
        locationId,
        practiceId,
        start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
        title: "Check-up",
      });
    });

    expect(createdId).toBe(appointmentId);
    expect(createAppointmentMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentTypeId,
        locationId,
        practiceId,
        start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
        title: "Check-up",
      }),
    );
    expect(pushHistoryAction).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Termin erstellt" }),
    );
  });

  it("checks Blocked Slot conflict preflight through the Workbench history Interface", async () => {
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(
      toTableId<"locations">("location_lineage_1"),
    );
    const practiceId = toTableId<"practices">("practice_1");
    const blockedSlotId = toTableId<"blockedSlots">("blocked_slot_1");
    const conflictingAppointment: CalendarAppointmentRecord = {
      _creationTime: 1,
      _id: toTableId<"appointments">("appointment_conflict"),
      appointmentTypeLineageKey: asAppointmentTypeLineageKey(
        toTableId<"appointmentTypes">("type_lineage_1"),
      ),
      appointmentTypeTitle: "Check-up",
      createdAt: 1n,
      end: "2026-04-25T09:45:00+02:00[Europe/Berlin]",
      isSimulation: false,
      lastModified: 1n,
      locationLineageKey,
      practiceId,
      start: "2026-04-25T09:15:00+02:00[Europe/Berlin]",
      title: "Existing Appointment",
    };
    const allPracticeAppointmentMap = new Map([
      [conflictingAppointment._id, conflictingAppointment],
    ]);

    mutationQueue.push(
      makeMutation(toTableId<"appointments">("appointment_unused")),
      makeMutation(null),
      makeMutation(null),
      makeMutation(null),
      makeMutation(null),
      makeMutation(blockedSlotId),
      makeMutation(null),
      makeMutation(null),
    );

    const { result } = renderHook(() =>
      useCalendarPlanningWorkbench({
        activeDayAppointmentMapRef: { current: new Map() },
        activeDayBlockedSlotMapRef: { current: new Map() },
        allPracticeAppointmentMap,
        allPracticeAppointmentMapRef: { current: allPracticeAppointmentMap },
        allPracticeAppointmentsLoaded: true,
        allPracticeBlockedSlotMap: new Map(),
        allPracticeBlockedSlotMapRef: { current: new Map() },
        allPracticeBlockedSlotsLoaded: true,
        blockedSlotsQueryArgs: null,
        calendarDayQueryArgs: null,
        getRequiredAppointmentTypeInfo: () => null,
        parseZonedDateTime,
        referenceMaps: {
          appointmentTypeIdByLineageKey: new Map(),
          appointmentTypeLineageKeyById: new Map(),
          locationIdByLineageKey: new Map([[locationLineageKey, locationId]]),
          locationLineageKeyById: new Map([[locationId, locationLineageKey]]),
          practitionerIdByLineageKey: new Map(),
          practitionerLineageKeyById: new Map(),
        },
        refreshAllPracticeConflictData: vi.fn(() => Promise.resolve()),
      }),
    );

    await act(async () => {
      await result.current.commands.createBlockedSlot({
        end: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
        locationId,
        practiceId,
        start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
        title: "Team meeting",
      });
    });

    const historyAction = pushHistoryAction.mock.calls[0]?.[0];
    expect(historyAction?.label).toBe("Sperrung erstellt");
    const redoResult = await historyAction?.redo();
    expect(redoResult).toEqual(
      expect.objectContaining({
        status: "conflict",
      }),
    );
  });

  it("exposes Blocked Slot editor data without leaking record memory primitives", () => {
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(
      toTableId<"locations">("location_lineage_1"),
    );
    const practiceId = toTableId<"practices">("practice_1");
    const blockedSlot: CalendarBlockedSlotRecord = {
      _creationTime: 1,
      _id: toTableId<"blockedSlots">("blocked_slot_1"),
      createdAt: 1n,
      end: "2026-04-25T10:00:00+02:00[Europe/Berlin]",
      isSimulation: false,
      lastModified: 1n,
      locationLineageKey,
      practiceId,
      start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
      title: "Team meeting",
    };
    const activeBlockedSlots = new Map([[blockedSlot._id, blockedSlot]]);

    mutationQueue.push(
      makeMutation(toTableId<"appointments">("appointment_unused")),
      makeMutation(null),
      makeMutation(null),
      makeMutation(null),
      makeMutation(null),
      makeMutation(toTableId<"blockedSlots">("blocked_slot_unused")),
      makeMutation(null),
      makeMutation(null),
    );

    const { result } = renderHook(() =>
      useCalendarPlanningWorkbench({
        activeDayAppointmentMapRef: { current: new Map() },
        activeDayBlockedSlotMapRef: { current: activeBlockedSlots },
        allPracticeAppointmentMap: new Map(),
        allPracticeAppointmentMapRef: { current: new Map() },
        allPracticeAppointmentsLoaded: true,
        allPracticeBlockedSlotMap: new Map(),
        allPracticeBlockedSlotMapRef: { current: new Map() },
        allPracticeBlockedSlotsLoaded: true,
        blockedSlotsQueryArgs: null,
        calendarDayQueryArgs: null,
        getRequiredAppointmentTypeInfo: () => null,
        parseZonedDateTime,
        referenceMaps: {
          appointmentTypeIdByLineageKey: new Map(),
          appointmentTypeLineageKeyById: new Map(),
          locationIdByLineageKey: new Map([[locationLineageKey, locationId]]),
          locationLineageKeyById: new Map([[locationId, locationLineageKey]]),
          practitionerIdByLineageKey: new Map(),
          practitionerLineageKeyById: new Map(),
        },
        refreshAllPracticeConflictData: vi.fn(() => Promise.resolve()),
      }),
    );

    expect(result.current.getBlockedSlotEditorData(blockedSlot._id)).toEqual({
      blockedSlotId: blockedSlot._id,
      currentTitle: "Team meeting",
      slotData: {
        end: blockedSlot.end,
        locationId,
        practiceId,
        start: blockedSlot.start,
        title: "Team meeting",
      },
      slotIsSimulation: false,
    });
  });
});
