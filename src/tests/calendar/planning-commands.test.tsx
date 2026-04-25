import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";

import { asLocationLineageKey, toTableId } from "../../../convex/identity";
import { useCalendarPlanningCommands } from "../../components/calendar/use-calendar-planning-commands";

const mutationQueue: {
  withOptimisticUpdate: (
    updater: (localStore: unknown, args: unknown) => void,
  ) => (args: unknown) => Promise<unknown>;
}[] = [];

vi.mock("convex/react", () => ({
  useMutation: () => {
    const mutation = mutationQueue.shift();
    if (!mutation) {
      throw new Error("Unexpected mutation request");
    }
    return mutation;
  },
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

describe("calendar planning commands", () => {
  beforeEach(() => {
    mutationQueue.length = 0;
  });

  it("exposes blocked-slot creation as a workbench command with history ownership", async () => {
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = toTableId<"locations">("location_lineage_1");
    const brandedLocationLineageKey = asLocationLineageKey(locationLineageKey);
    const practiceId = toTableId<"practices">("practice_1");
    const blockedSlotId = toTableId<"blockedSlots">("blocked_slot_1");
    const pushHistoryAction = vi.fn();
    const rememberCreatedBlockedSlotHistoryDoc = vi.fn();

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
      useCalendarPlanningCommands({
        blockedSlotsQueryArgs: null,
        calendarDayQueryArgs: null,
        forgetAppointmentHistoryDoc: vi.fn(),
        forgetBlockedSlotHistoryDoc: vi.fn(),
        getAppointmentCreationEnd: ({ start }) => start,
        getAppointmentHistoryDoc: vi.fn(),
        getAppointmentUpdateMutationHistoryDoc: vi.fn(),
        getBlockedSlotHistoryDoc: vi.fn(),
        getCurrentAppointmentDoc: vi.fn(),
        getCurrentBlockedSlotDoc: vi.fn(),
        getLocationLineageKeyForDisplayId: vi.fn(),
        getPractitionerLineageKeyForDisplayId: vi.fn(),
        getRequiredAppointmentTypeInfo: vi.fn(),
        hasAppointmentConflict: vi.fn(() => false),
        hasBlockedSlotConflict: vi.fn(() => false),
        parseZonedDateTime: vi.fn(),
        pushHistoryAction,
        refreshAllPracticeConflictData: vi.fn(() => Promise.resolve()),
        rememberAppointmentHistoryDoc: vi.fn(),
        rememberBlockedSlotHistoryDoc: vi.fn(),
        rememberCreatedAppointmentFromStrings: vi.fn(),
        rememberCreatedBlockedSlotHistoryDoc,
        resolveAppointmentReferenceDisplayIds: vi.fn(),
        resolveAppointmentReferenceLineageKeys: vi.fn(),
        resolveBlockedSlotReferenceDisplayIds: vi.fn(),
        resolveBlockedSlotReferenceLineageKeys: vi.fn(() => ({
          locationLineageKey: brandedLocationLineageKey,
        })),
      }),
    );

    let createdId: Id<"blockedSlots"> | undefined;
    await act(async () => {
      createdId = await result.current.createBlockedSlot({
        end: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
        locationId,
        practiceId,
        start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
        title: "Team meeting",
      });
    });

    expect(createdId).toBe(blockedSlotId);
    expect(rememberCreatedBlockedSlotHistoryDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        blockedSlotId,
        end: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
        isSimulation: false,
        locationLineageKey: brandedLocationLineageKey,
        practiceId,
        start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
        title: "Team meeting",
      }),
    );
    expect(pushHistoryAction).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Sperrung erstellt" }),
    );
  });
});
