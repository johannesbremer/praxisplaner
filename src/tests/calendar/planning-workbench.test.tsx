import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";
import type { CalendarPlanningCommand } from "../../components/calendar/calendar-planning-command";
import type {
  CalendarAppointmentRecord,
  CalendarBlockedSlotRecord,
} from "../../components/calendar/types";
import type { CalendarPlanningCommandExecutor } from "../../components/calendar/use-calendar-planning-history";

import {
  asAppointmentTypeLineageKey,
  asLocationLineageKey,
  asPractitionerLineageKey,
  toTableId,
} from "../../../convex/identity";
import { createCalendarPlacement } from "../../../lib/calendar-occupancy";
import {
  rememberRecreatedAliasId,
  resolveCurrentAliasId,
  useCalendarPlanningWorkbench,
} from "../../components/calendar/use-calendar-planning-workbench";
import { zonedDateTimeStringResult } from "../../utils/time-calculations";
import {
  buildCalendarAppointmentRecord,
  buildCalendarBlockedSlotRecord,
} from "./test-records";

const mutationQueue: {
  withOptimisticUpdate: (
    updater: (localStore: unknown, args: unknown) => void,
  ) => (args: unknown) => Promise<unknown>;
}[] = [];
const recordCalendarCommand =
  vi.fn<(command: CalendarPlanningCommand) => void>();
let executeRecordedCalendarCommand: CalendarPlanningCommandExecutor | null =
  null;
const convexQuery = vi.fn(() => Promise.resolve("blue"));

vi.mock("convex/react", () => ({
  useConvex: () => ({
    query: convexQuery,
  }),
  useMutation: () => {
    const mutation = mutationQueue.shift();
    if (!mutation) {
      throw new Error("Unexpected mutation request");
    }
    return mutation;
  },
}));

vi.mock("../../components/calendar/use-calendar-planning-history", () => ({
  useCalendarPlanningHistory: (executor: CalendarPlanningCommandExecutor) => {
    executeRecordedCalendarCommand = executor;
    return {
      recordCalendarCommand,
    };
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

const makeDeferredMutation = () => {
  let resolve: ((value: unknown) => void) | undefined;
  const promise = new Promise<unknown>((promiseResolve) => {
    resolve = promiseResolve;
  });
  if (!resolve) {
    throw new Error("Deferred mutation resolver was not initialized.");
  }
  const mutation = vi.fn((args: unknown) => {
    void args;
    return promise;
  });
  return {
    mutation: Object.assign(mutation, {
      withOptimisticUpdate:
        () =>
        async (args: unknown): Promise<unknown> =>
          mutation(args),
    }),
    resolve,
  };
};

const parseZonedDateTime = (value: string, source: string) =>
  zonedDateTimeStringResult(value, source).match(
    (typedValue) => typedValue,
    () => null,
  );

describe("calendar planning workbench", () => {
  beforeEach(() => {
    mutationQueue.length = 0;
    convexQuery.mockReset();
    convexQuery.mockResolvedValue("blue");
    recordCalendarCommand.mockReset();
    executeRecordedCalendarCommand = null;
  });

  it("preserves original id aliases across repeated appointment and blocked-slot redoes", () => {
    const originalAppointmentId = toTableId<"appointments">(
      "appointment_original",
    );
    const firstRecreatedAppointmentId = toTableId<"appointments">(
      "appointment_recreated_1",
    );
    const secondRecreatedAppointmentId = toTableId<"appointments">(
      "appointment_recreated_2",
    );
    const appointmentAliases = new Map<
      Id<"appointments">,
      Id<"appointments">
    >();

    rememberRecreatedAliasId(appointmentAliases, {
      currentId: firstRecreatedAppointmentId,
      originalId: originalAppointmentId,
    });
    rememberRecreatedAliasId(appointmentAliases, {
      currentId: secondRecreatedAppointmentId,
      originalId: firstRecreatedAppointmentId,
    });

    expect(
      resolveCurrentAliasId(appointmentAliases, originalAppointmentId),
    ).toBe(secondRecreatedAppointmentId);
    expect(
      resolveCurrentAliasId(appointmentAliases, firstRecreatedAppointmentId),
    ).toBe(secondRecreatedAppointmentId);

    const originalBlockedSlotId = toTableId<"blockedSlots">(
      "blocked_slot_original",
    );
    const firstRecreatedBlockedSlotId = toTableId<"blockedSlots">(
      "blocked_slot_recreated_1",
    );
    const secondRecreatedBlockedSlotId = toTableId<"blockedSlots">(
      "blocked_slot_recreated_2",
    );
    const blockedSlotAliases = new Map<
      Id<"blockedSlots">,
      Id<"blockedSlots">
    >();

    rememberRecreatedAliasId(blockedSlotAliases, {
      currentId: firstRecreatedBlockedSlotId,
      originalId: originalBlockedSlotId,
    });
    rememberRecreatedAliasId(blockedSlotAliases, {
      currentId: secondRecreatedBlockedSlotId,
      originalId: firstRecreatedBlockedSlotId,
    });

    expect(
      resolveCurrentAliasId(blockedSlotAliases, originalBlockedSlotId),
    ).toBe(secondRecreatedBlockedSlotId);
    expect(
      resolveCurrentAliasId(blockedSlotAliases, firstRecreatedBlockedSlotId),
    ).toBe(secondRecreatedBlockedSlotId);
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
      makeMutation(toTableId<"appointments">("appointment_restore_unused")),
      makeMutation(null),
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
          color: "blue",
          duration: 30,
          hasAppointmentPlan: false,
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
        placement: createCalendarPlacement({
          locationLineageKey,
          occupancyScope: {
            calendarResourceColumn: "ekg",
            kind: "resource",
          },
        }),
        practiceId,
        start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
        title: "Check-up",
      });
    });

    expect(createdId).toBe(appointmentId);
    expect(createAppointmentMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentTypeId,
        calendarResourceColumn: "ekg",
        locationId,
        practiceId,
        start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
        title: "Check-up",
      }),
    );
    expect(recordCalendarCommand).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Termin erstellt" }),
    );
  });

  it("preserves appointment smileys in delete undo create args", async () => {
    const appointmentId = toTableId<"appointments">("appointment_1");
    const appointmentTypeId = toTableId<"appointmentTypes">("type_1");
    const appointmentTypeLineageKey = asAppointmentTypeLineageKey(
      toTableId<"appointmentTypes">("type_lineage_1"),
    );
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(
      toTableId<"locations">("location_lineage_1"),
    );
    const practiceId = toTableId<"practices">("practice_1");
    const appointment = {
      ...buildCalendarAppointmentRecord({
        _id: appointmentId,
        appointmentTypeLineageKey,
        appointmentTypeTitle: "Check-up",
        calendarResourceColumn: "ekg",
        end: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
        locationLineageKey,
        practiceId,
        start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
        title: "Check-up",
      }),
      smiley: "👍",
    } satisfies CalendarAppointmentRecord;
    const appointmentMap = new Map([[appointment._id, appointment]]);
    const deleteAppointmentMutation = makeMutation(null);
    mutationQueue.push(
      makeMutation(toTableId<"appointments">("appointment_unused")),
      makeMutation(toTableId<"appointments">("appointment_restore_unused")),
      makeMutation(null),
      makeMutation(null),
      makeMutation(null),
      makeMutation(null),
      deleteAppointmentMutation,
      makeMutation(toTableId<"blockedSlots">("blocked_slot_unused")),
      makeMutation(null),
      makeMutation(null),
    );

    const { result } = renderHook(() =>
      useCalendarPlanningWorkbench({
        activeDayAppointmentMapRef: { current: appointmentMap },
        activeDayBlockedSlotMapRef: { current: new Map() },
        allPracticeAppointmentMap: appointmentMap,
        allPracticeAppointmentMapRef: { current: appointmentMap },
        allPracticeAppointmentsLoaded: true,
        allPracticeBlockedSlotMap: new Map(),
        allPracticeBlockedSlotMapRef: { current: new Map() },
        allPracticeBlockedSlotsLoaded: true,
        blockedSlotsQueryArgs: null,
        calendarDayQueryArgs: null,
        getRequiredAppointmentTypeInfo: () => ({
          color: "blue",
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

    await act(async () => {
      await result.current.commands.deleteAppointment({ id: appointmentId });
    });

    expect(deleteAppointmentMutation).toHaveBeenCalledWith({
      id: appointmentId,
    });
    const command = recordCalendarCommand.mock.calls[0]?.[0];
    expect(command?.kind).toBe("appointment.delete");
    if (command?.kind !== "appointment.delete") {
      throw new Error("Expected an appointment delete command.");
    }
    expect(command.payload.createArgs).toEqual(
      expect.objectContaining({
        smiley: "👍",
      }),
    );
  });

  it("records simulation smiley updates for real series appointments through the calendar command ledger", async () => {
    const appointmentId = toTableId<"appointments">("appointment_1");
    const appointmentTypeId = toTableId<"appointmentTypes">("type_1");
    const appointmentTypeLineageKey = asAppointmentTypeLineageKey(
      toTableId<"appointmentTypes">("type_lineage_1"),
    );
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(
      toTableId<"locations">("location_lineage_1"),
    );
    const practiceId = toTableId<"practices">("practice_1");
    const ruleSetId = toTableId<"ruleSets">("rule_set_1");
    const appointment = {
      ...buildCalendarAppointmentRecord({
        _id: appointmentId,
        appointmentTypeLineageKey,
        appointmentTypeTitle: "Check-up",
        calendarResourceColumn: "ekg",
        end: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
        locationLineageKey,
        practiceId,
        start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
        title: "Check-up",
      }),
      seriesId: "series-1",
      seriesStepId: "series-step-1",
      seriesStepIndex: 0n,
    } satisfies CalendarAppointmentRecord;
    const appointmentMap = new Map([[appointment._id, appointment]]);
    const updateAppointmentMutation = makeMutation(null);
    const updateSimulationSmileyMutation = makeMutation(null);
    mutationQueue.push(
      makeMutation(toTableId<"appointments">("appointment_unused")),
      makeMutation(toTableId<"appointments">("appointment_restore_unused")),
      updateAppointmentMutation,
      makeMutation(null),
      updateSimulationSmileyMutation,
      makeMutation(null),
      makeMutation(null),
      makeMutation(toTableId<"blockedSlots">("blocked_slot_unused")),
      makeMutation(null),
      makeMutation(null),
    );

    const { result } = renderHook(() =>
      useCalendarPlanningWorkbench({
        activeDayAppointmentMapRef: { current: appointmentMap },
        activeDayBlockedSlotMapRef: { current: new Map() },
        allPracticeAppointmentMap: appointmentMap,
        allPracticeAppointmentMapRef: { current: appointmentMap },
        allPracticeAppointmentsLoaded: true,
        allPracticeBlockedSlotMap: new Map(),
        allPracticeBlockedSlotMapRef: { current: new Map() },
        allPracticeBlockedSlotsLoaded: true,
        blockedSlotsQueryArgs: null,
        calendarDayQueryArgs: {
          dayEnd: "2026-04-26T00:00:00+02:00[Europe/Berlin]",
          dayStart: "2026-04-25T00:00:00+02:00[Europe/Berlin]",
          practiceId,
          scope: "simulation",
          selectedRuleSetId: ruleSetId,
        },
        getRequiredAppointmentTypeInfo: () => ({
          color: "blue",
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

    await act(async () => {
      await result.current.commands.updateAppointment({
        id: appointmentId,
        smiley: "👍",
      });
    });

    expect(updateSimulationSmileyMutation).toHaveBeenCalledWith({
      id: appointmentId,
      simulationRuleSetId: ruleSetId,
      smiley: "👍",
    });
    expect(updateAppointmentMutation).not.toHaveBeenCalled();
    const command = recordCalendarCommand.mock.calls[0]?.[0];
    expect(command?.kind).toBe("appointment.update");
    if (command?.kind !== "appointment.update") {
      throw new Error("Expected an appointment update command.");
    }
    expect(command.payload.beforeState.smiley).toBeUndefined();
    expect(command.payload.afterState.smiley).toBe("👍");
  });

  it("skips no-op smiley updates before calling mutations or recording commands", async () => {
    const appointmentId = toTableId<"appointments">("appointment_1");
    const appointmentTypeId = toTableId<"appointmentTypes">("type_1");
    const appointmentTypeLineageKey = asAppointmentTypeLineageKey(
      toTableId<"appointmentTypes">("type_lineage_1"),
    );
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(
      toTableId<"locations">("location_lineage_1"),
    );
    const practiceId = toTableId<"practices">("practice_1");
    const ruleSetId = toTableId<"ruleSets">("rule_set_1");
    const appointment = buildCalendarAppointmentRecord({
      _id: appointmentId,
      appointmentTypeLineageKey,
      appointmentTypeTitle: "Check-up",
      calendarResourceColumn: "ekg",
      end: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
      locationLineageKey,
      practiceId,
      smiley: "👍",
      start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
      title: "Check-up",
    });
    const appointmentMap = new Map([[appointment._id, appointment]]);
    const updateAppointmentMutation = makeMutation(null);
    const updateSimulationSmileyMutation = makeMutation(null);
    mutationQueue.push(
      makeMutation(toTableId<"appointments">("appointment_unused")),
      makeMutation(toTableId<"appointments">("appointment_restore_unused")),
      updateAppointmentMutation,
      makeMutation(null),
      updateSimulationSmileyMutation,
      makeMutation(null),
      makeMutation(null),
      makeMutation(toTableId<"blockedSlots">("blocked_slot_unused")),
      makeMutation(null),
      makeMutation(null),
    );

    const { result } = renderHook(() =>
      useCalendarPlanningWorkbench({
        activeDayAppointmentMapRef: { current: appointmentMap },
        activeDayBlockedSlotMapRef: { current: new Map() },
        allPracticeAppointmentMap: appointmentMap,
        allPracticeAppointmentMapRef: { current: appointmentMap },
        allPracticeAppointmentsLoaded: true,
        allPracticeBlockedSlotMap: new Map(),
        allPracticeBlockedSlotMapRef: { current: new Map() },
        allPracticeBlockedSlotsLoaded: true,
        blockedSlotsQueryArgs: null,
        calendarDayQueryArgs: {
          dayEnd: "2026-04-26T00:00:00+02:00[Europe/Berlin]",
          dayStart: "2026-04-25T00:00:00+02:00[Europe/Berlin]",
          practiceId,
          scope: "simulation",
          selectedRuleSetId: ruleSetId,
        },
        getRequiredAppointmentTypeInfo: () => ({
          color: "blue",
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

    await act(async () => {
      await result.current.commands.updateAppointment({
        id: appointmentId,
        smiley: "👍",
      });
    });

    expect(updateSimulationSmileyMutation).not.toHaveBeenCalled();
    expect(updateAppointmentMutation).not.toHaveBeenCalled();
    expect(recordCalendarCommand).not.toHaveBeenCalled();
  });

  it("serializes overlapping Appointment updates before recording history commands", async () => {
    const appointmentTypeId = toTableId<"appointmentTypes">("type_1");
    const appointmentTypeLineageKey = asAppointmentTypeLineageKey(
      toTableId<"appointmentTypes">("type_lineage_1"),
    );
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(
      toTableId<"locations">("location_lineage_1"),
    );
    const practiceId = toTableId<"practices">("practice_1");
    const appointment = buildCalendarAppointmentRecord({
      _id: toTableId<"appointments">("appointment_1"),
      appointmentTypeLineageKey,
      appointmentTypeTitle: "Check-up",
      calendarResourceColumn: "ekg",
      end: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
      locationLineageKey,
      practiceId,
      start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
      title: "Check-up",
    });
    const activeAppointments = new Map([[appointment._id, appointment]]);
    const firstUpdate = makeDeferredMutation();
    mutationQueue.push(
      makeMutation(toTableId<"appointments">("appointment_unused")),
      makeMutation(toTableId<"appointments">("appointment_restore_unused")),
      firstUpdate.mutation,
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
        activeDayAppointmentMapRef: { current: activeAppointments },
        activeDayBlockedSlotMapRef: { current: new Map() },
        allPracticeAppointmentMap: activeAppointments,
        allPracticeAppointmentMapRef: { current: activeAppointments },
        allPracticeAppointmentsLoaded: true,
        allPracticeBlockedSlotMap: new Map(),
        allPracticeBlockedSlotMapRef: { current: new Map() },
        allPracticeBlockedSlotsLoaded: true,
        blockedSlotsQueryArgs: null,
        calendarDayQueryArgs: null,
        getRequiredAppointmentTypeInfo: () => ({
          color: "blue",
          duration: 30,
          hasAppointmentPlan: false,
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

    let firstPromise!: Promise<unknown>;
    let secondPromise!: Promise<unknown>;
    await act(async () => {
      firstPromise = result.current.commands.updateAppointment({
        end: "2026-04-25T10:00:00+02:00[Europe/Berlin]",
        id: appointment._id,
        start: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
      });
      secondPromise = result.current.commands.updateAppointment({
        end: "2026-04-25T10:30:00+02:00[Europe/Berlin]",
        id: appointment._id,
        start: "2026-04-25T10:00:00+02:00[Europe/Berlin]",
      });
      await Promise.resolve();
    });

    expect(recordCalendarCommand).not.toHaveBeenCalled();

    await act(async () => {
      firstUpdate.resolve(null);
      await firstPromise;
      await secondPromise;
    });

    const firstCommand = recordCalendarCommand.mock.calls[0]?.[0];
    const secondCommand = recordCalendarCommand.mock.calls[1]?.[0];
    expect(firstCommand?.kind).toBe("appointment.update");
    expect(secondCommand?.kind).toBe("appointment.update");
    if (
      firstCommand?.kind !== "appointment.update" ||
      secondCommand?.kind !== "appointment.update"
    ) {
      throw new Error("Expected appointment update commands.");
    }
    expect(firstCommand.payload.beforeState.start).toBe(appointment.start);
    expect(secondCommand.payload.beforeState.start).toBe(
      firstCommand.payload.afterState.start,
    );
  });

  it("serializes overlapping Blocked Slot updates before recording history commands", async () => {
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(
      toTableId<"locations">("location_lineage_1"),
    );
    const practiceId = toTableId<"practices">("practice_1");
    const practitionerLineageKey = asPractitionerLineageKey(
      toTableId<"practitioners">("practitioner_lineage_1"),
    );
    const practitionerId = toTableId<"practitioners">("practitioner_1");
    const blockedSlot = buildCalendarBlockedSlotRecord({
      _id: toTableId<"blockedSlots">("blocked_slot_1"),
      end: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
      locationLineageKey,
      practiceId,
      practitionerLineageKey,
      start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
      title: "Team meeting",
    });
    const activeBlockedSlots = new Map([[blockedSlot._id, blockedSlot]]);
    const firstUpdate = makeDeferredMutation();
    mutationQueue.push(
      makeMutation(toTableId<"appointments">("appointment_unused")),
      makeMutation(toTableId<"appointments">("appointment_restore_unused")),
      makeMutation(null),
      makeMutation(null),
      makeMutation(null),
      makeMutation(null),
      makeMutation(null),
      makeMutation(toTableId<"blockedSlots">("blocked_slot_unused")),
      makeMutation(null),
      firstUpdate.mutation,
    );

    const { result } = renderHook(() =>
      useCalendarPlanningWorkbench({
        activeDayAppointmentMapRef: { current: new Map() },
        activeDayBlockedSlotMapRef: { current: activeBlockedSlots },
        allPracticeAppointmentMap: new Map(),
        allPracticeAppointmentMapRef: { current: new Map() },
        allPracticeAppointmentsLoaded: true,
        allPracticeBlockedSlotMap: activeBlockedSlots,
        allPracticeBlockedSlotMapRef: { current: activeBlockedSlots },
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
          practitionerIdByLineageKey: new Map([
            [practitionerLineageKey, practitionerId],
          ]),
          practitionerLineageKeyById: new Map([
            [practitionerId, practitionerLineageKey],
          ]),
        },
        refreshAllPracticeConflictData: vi.fn(() => Promise.resolve()),
      }),
    );

    let firstPromise!: Promise<unknown>;
    let secondPromise!: Promise<unknown>;
    await act(async () => {
      firstPromise = result.current.commands.updateBlockedSlot({
        end: "2026-04-25T10:00:00+02:00[Europe/Berlin]",
        id: blockedSlot._id,
        start: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
      });
      secondPromise = result.current.commands.updateBlockedSlot({
        end: "2026-04-25T10:30:00+02:00[Europe/Berlin]",
        id: blockedSlot._id,
        start: "2026-04-25T10:00:00+02:00[Europe/Berlin]",
      });
      await Promise.resolve();
    });

    expect(recordCalendarCommand).not.toHaveBeenCalled();

    await act(async () => {
      firstUpdate.resolve(null);
      await firstPromise;
      await secondPromise;
    });

    const firstCommand = recordCalendarCommand.mock.calls[0]?.[0];
    const secondCommand = recordCalendarCommand.mock.calls[1]?.[0];
    expect(firstCommand?.kind).toBe("blockedSlot.update");
    expect(secondCommand?.kind).toBe("blockedSlot.update");
    if (
      firstCommand?.kind !== "blockedSlot.update" ||
      secondCommand?.kind !== "blockedSlot.update"
    ) {
      throw new Error("Expected blocked slot update commands.");
    }
    expect(firstCommand.payload.beforeState.start).toBe(blockedSlot.start);
    expect(secondCommand.payload.beforeState.start).toBe(
      firstCommand.payload.afterState.start,
    );
  });

  it("records resource scope in Blocked Slot delete undo create args", async () => {
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(
      toTableId<"locations">("location_lineage_1"),
    );
    const practiceId = toTableId<"practices">("practice_1");
    const blockedSlot = buildCalendarBlockedSlotRecord({
      _id: toTableId<"blockedSlots">("blocked_slot_1"),
      calendarResourceColumn: "ekg",
      end: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
      locationLineageKey,
      practiceId,
      start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
      title: "EKG Wartung",
    });
    const activeBlockedSlots = new Map([[blockedSlot._id, blockedSlot]]);
    const deleteBlockedSlotMutation = makeMutation(null);
    mutationQueue.push(
      makeMutation(toTableId<"appointments">("appointment_unused")),
      makeMutation(toTableId<"appointments">("appointment_restore_unused")),
      makeMutation(null),
      makeMutation(null),
      makeMutation(null),
      makeMutation(null),
      makeMutation(null),
      makeMutation(toTableId<"blockedSlots">("blocked_slot_unused")),
      deleteBlockedSlotMutation,
      makeMutation(null),
    );

    const { result } = renderHook(() =>
      useCalendarPlanningWorkbench({
        activeDayAppointmentMapRef: { current: new Map() },
        activeDayBlockedSlotMapRef: { current: activeBlockedSlots },
        allPracticeAppointmentMap: new Map(),
        allPracticeAppointmentMapRef: { current: new Map() },
        allPracticeAppointmentsLoaded: true,
        allPracticeBlockedSlotMap: activeBlockedSlots,
        allPracticeBlockedSlotMapRef: { current: activeBlockedSlots },
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
      await result.current.commands.deleteBlockedSlot({ id: blockedSlot._id });
    });

    expect(deleteBlockedSlotMutation).toHaveBeenCalledWith({
      id: blockedSlot._id,
    });
    const command = recordCalendarCommand.mock.calls[0]?.[0];
    expect(command?.kind).toBe("blockedSlot.delete");
    if (command?.kind !== "blockedSlot.delete") {
      throw new Error("Expected a blocked slot delete command.");
    }
    expect(command.payload.createArgs.occupancyScope).toEqual({
      calendarResourceColumn: "ekg",
      kind: "resource",
    });
  });

  it("checks Blocked Slot conflict preflight through the Workbench history Interface", async () => {
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(
      toTableId<"locations">("location_lineage_1"),
    );
    const practiceId = toTableId<"practices">("practice_1");
    const blockedSlotId = toTableId<"blockedSlots">("blocked_slot_1");
    const conflictingAppointment: CalendarAppointmentRecord = {
      ...buildCalendarAppointmentRecord({
        _id: toTableId<"appointments">("appointment_conflict"),
        appointmentTypeLineageKey: asAppointmentTypeLineageKey(
          toTableId<"appointmentTypes">("type_lineage_1"),
        ),
        appointmentTypeTitle: "Check-up",
        calendarResourceColumn: "ekg",
        end: "2026-04-25T09:45:00+02:00[Europe/Berlin]",
        locationLineageKey,
        practiceId,
        start: "2026-04-25T09:15:00+02:00[Europe/Berlin]",
        title: "Existing Appointment",
      }),
      isSimulation: false,
    };
    const allPracticeAppointmentMap = new Map([
      [conflictingAppointment._id, conflictingAppointment],
    ]);

    mutationQueue.push(
      makeMutation(toTableId<"appointments">("appointment_unused")),
      makeMutation(toTableId<"appointments">("appointment_restore_unused")),
      makeMutation(null),
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
        occupancyScope: { calendarResourceColumn: "ekg", kind: "resource" },
        practiceId,
        start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
        title: "Team meeting",
      });
    });

    const command = recordCalendarCommand.mock.calls[0]?.[0];
    expect(command?.label).toBe("Sperrung erstellt");
    if (!command) {
      throw new Error("Expected a recorded calendar command");
    }
    if (!executeRecordedCalendarCommand) {
      throw new Error("Expected a calendar command executor");
    }
    const redoResult = await executeRecordedCalendarCommand(command, "redo");
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
    const practitionerLineageKey = asPractitionerLineageKey(
      toTableId<"practitioners">("practitioner_lineage_1"),
    );
    const practitionerId = toTableId<"practitioners">("practitioner_1");
    const blockedSlot: CalendarBlockedSlotRecord = {
      ...buildCalendarBlockedSlotRecord({
        _id: toTableId<"blockedSlots">("blocked_slot_1"),
        end: "2026-04-25T10:00:00+02:00[Europe/Berlin]",
        locationLineageKey,
        practiceId,
        practitionerLineageKey,
        start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
        title: "Team meeting",
      }),
      isSimulation: false,
    };
    const activeBlockedSlots = new Map([[blockedSlot._id, blockedSlot]]);

    mutationQueue.push(
      makeMutation(toTableId<"appointments">("appointment_unused")),
      makeMutation(toTableId<"appointments">("appointment_restore_unused")),
      makeMutation(null),
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
          practitionerIdByLineageKey: new Map([
            [practitionerLineageKey, practitionerId],
          ]),
          practitionerLineageKeyById: new Map([
            [practitionerId, practitionerLineageKey],
          ]),
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
        occupancyScope: { kind: "practitioner", practitionerId },
        practiceId,
        practitionerId,
        start: blockedSlot.start,
        title: "Team meeting",
      },
      slotIsSimulation: false,
    });
  });
});
