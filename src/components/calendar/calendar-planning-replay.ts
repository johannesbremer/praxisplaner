import type { FunctionArgs } from "convex/server";

import type { Id } from "../../../convex/_generated/dataModel";
import type { AppointmentTypeLineageKey } from "../../../convex/identity";
import type { CalendarPlanningReplayAdapter } from "./calendar-planning-command";
import type { CalendarReferenceMaps } from "./calendar-reference-adapters";
import type {
  CalendarAppointmentPlacement,
  CalendarAppointmentRecord,
  CalendarBlockedSlotPlacement,
  CalendarBlockedSlotRecord,
} from "./types";

import { api } from "../../../convex/_generated/api";
import { sameCalendarOccupancyScope } from "../../../lib/calendar-occupancy";
import {
  type AppointmentOwnerRefs,
  getAppointmentOwnerRefs,
} from "./appointment-owner-refs";
import { resolveBlockedSlotPlacementDisplayRefs } from "./calendar-reference-adapters";

interface AppointmentCandidate {
  end: string;
  isSimulation: boolean;
  placement: CalendarAppointmentPlacement;
  replacesAppointmentId?: Id<"appointments">;
  start: string;
}

type AppointmentState = Pick<
  CalendarAppointmentRecord,
  "end" | "placement" | "start"
>;

interface BlockedSlotCandidate {
  end: string;
  isSimulation: boolean;
  placement: CalendarBlockedSlotPlacement;
  start: string;
}

type BlockedSlotState = Pick<
  CalendarBlockedSlotRecord,
  "end" | "placement" | "start" | "title"
>;

type CreateAppointmentMutationArgs = FunctionArgs<
  typeof api.appointments.createAppointment
>;

type CreateBlockedSlotMutationArgs = FunctionArgs<
  typeof api.appointments.createBlockedSlot
>;

interface CreatedAppointmentHistoryArgs extends AppointmentOwnerRefs {
  appointmentTypeLineageKey: AppointmentTypeLineageKey;
  appointmentTypeTitle: string;
  createdId: Id<"appointments">;
  createEnd: string;
  createStart: string;
  isSimulation: boolean;
  placement: CalendarAppointmentPlacement;
  practiceId: Id<"practices">;
  replacesAppointmentId?: Id<"appointments">;
  title: string;
}

interface CreatedBlockedSlotHistoryArgs {
  blockedSlotId: Id<"blockedSlots">;
  end: CalendarBlockedSlotRecord["end"];
  isSimulation: boolean;
  now: number;
  placement: CalendarBlockedSlotPlacement;
  practiceId: Id<"practices">;
  replacesBlockedSlotId?: Id<"blockedSlots">;
  start: CalendarBlockedSlotRecord["start"];
  title: string;
}

type DeleteAppointmentMutationArgs = FunctionArgs<
  typeof api.appointments.deleteAppointment
>;

type DeleteBlockedSlotMutationArgs = FunctionArgs<
  typeof api.appointments.deleteBlockedSlot
>;

type UpdateAppointmentMutationArgs = FunctionArgs<
  typeof api.appointments.updateAppointment
>;

type UpdateBlockedSlotMutationArgs = FunctionArgs<
  typeof api.appointments.updateBlockedSlot
>;

export function createAppointmentCreateReplay(params: {
  appointmentTypeLineageKey: AppointmentTypeLineageKey;
  appointmentTypeTitle: string;
  createArgs: CreateAppointmentMutationArgs & { isSimulation: boolean };
  createdId: Id<"appointments">;
  createEnd: string;
  ensureLatestConflictData: () => Promise<void>;
  forgetAppointmentHistoryDoc: (id: Id<"appointments">) => void;
  hasAppointmentConflict: (candidate: AppointmentCandidate) => boolean;
  placement: CalendarAppointmentPlacement;
  rememberCreatedAppointmentFromStrings: (
    args: CreatedAppointmentHistoryArgs,
  ) => boolean;
  runCreateAppointmentInternal: (
    args: CreateAppointmentMutationArgs,
  ) => Promise<Id<"appointments"> | null>;
  runDeleteAppointmentInternal: (
    args: DeleteAppointmentMutationArgs,
  ) => Promise<unknown>;
}): CalendarPlanningReplayAdapter {
  let currentAppointmentId = params.createdId;

  return {
    redo: async () => {
      await params.ensureLatestConflictData();
      if (
        params.hasAppointmentConflict({
          end: params.createEnd,
          isSimulation: params.createArgs.isSimulation,
          placement: params.placement,
          ...(params.createArgs.replacesAppointmentId && {
            replacesAppointmentId: params.createArgs.replacesAppointmentId,
          }),
          start: params.createArgs.start,
        })
      ) {
        return {
          message:
            "Der Termin kann nicht wiederhergestellt werden, weil der Zeitraum bereits belegt ist.",
          status: "conflict",
        };
      }

      const recreatedId = await params.runCreateAppointmentInternal(
        params.createArgs,
      );
      if (!recreatedId) {
        return { status: "conflict" };
      }

      currentAppointmentId = recreatedId;
      params.rememberCreatedAppointmentFromStrings({
        appointmentTypeLineageKey: params.appointmentTypeLineageKey,
        appointmentTypeTitle: params.appointmentTypeTitle,
        ...getAppointmentOwnerRefs(params.createArgs),
        createdId: recreatedId,
        createEnd: params.createEnd,
        createStart: params.createArgs.start,
        isSimulation: params.createArgs.isSimulation,
        placement: params.placement,
        practiceId: params.createArgs.practiceId,
        ...(params.createArgs.replacesAppointmentId && {
          replacesAppointmentId: params.createArgs.replacesAppointmentId,
        }),
        title: params.createArgs.title,
      });
      return { status: "applied" };
    },
    undo: async () => {
      try {
        await params.runDeleteAppointmentInternal({
          id: currentAppointmentId,
        });
        params.forgetAppointmentHistoryDoc(currentAppointmentId);
        return { status: "applied" };
      } catch {
        params.forgetAppointmentHistoryDoc(currentAppointmentId);
        return {
          message: "Der Termin wurde bereits entfernt.",
          status: "conflict",
        };
      }
    },
  };
}

export function createAppointmentDeleteReplay(params: {
  createArgs: CreateAppointmentMutationArgs;
  createEnd: string;
  deleted: CalendarAppointmentRecord;
  deletedId: Id<"appointments">;
  ensureLatestConflictData: () => Promise<void>;
  forgetAppointmentHistoryDoc: (id: Id<"appointments">) => void;
  hasAppointmentConflict: (candidate: AppointmentCandidate) => boolean;
  rememberAppointmentHistoryDoc: (
    appointment: CalendarAppointmentRecord,
  ) => void;
  runCreateAppointmentInternal: (
    args: CreateAppointmentMutationArgs,
  ) => Promise<Id<"appointments"> | null>;
  runDeleteAppointmentInternal: (
    args: DeleteAppointmentMutationArgs,
  ) => Promise<unknown>;
}): CalendarPlanningReplayAdapter {
  let currentAppointmentId = params.deletedId;

  return {
    redo: async () => {
      try {
        await params.runDeleteAppointmentInternal({
          id: currentAppointmentId,
        });
        params.forgetAppointmentHistoryDoc(currentAppointmentId);
        return { status: "applied" };
      } catch {
        params.forgetAppointmentHistoryDoc(currentAppointmentId);
        return { status: "applied" };
      }
    },
    undo: async () => {
      await params.ensureLatestConflictData();
      if (
        params.hasAppointmentConflict({
          end: params.createEnd,
          isSimulation: params.createArgs.isSimulation ?? false,
          placement: params.deleted.placement,
          ...(params.createArgs.replacesAppointmentId && {
            replacesAppointmentId: params.createArgs.replacesAppointmentId,
          }),
          start: params.createArgs.start,
        })
      ) {
        return {
          message:
            "Der gelöschte Termin kann nicht wiederhergestellt werden, weil der Zeitraum inzwischen belegt ist.",
          status: "conflict",
        };
      }

      const recreatedId = await params.runCreateAppointmentInternal(
        params.createArgs,
      );
      if (!recreatedId) {
        return { status: "conflict" };
      }

      currentAppointmentId = recreatedId;
      params.rememberAppointmentHistoryDoc({
        ...params.deleted,
        _id: recreatedId,
      });
      return { status: "applied" };
    },
  };
}

export function createAppointmentUpdateReplay(params: {
  afterSnapshot: CalendarAppointmentRecord;
  afterState: AppointmentState;
  appointmentId: Id<"appointments">;
  before: CalendarAppointmentRecord;
  beforeState: AppointmentState;
  ensureLatestConflictData: () => Promise<void>;
  getCurrentAppointmentDoc: (
    id: Id<"appointments">,
  ) => CalendarAppointmentRecord | undefined;
  hasAppointmentConflict: (
    candidate: AppointmentCandidate,
    excludeId?: Id<"appointments">,
  ) => boolean;
  rememberAppointmentHistoryDoc: (
    appointment: CalendarAppointmentRecord,
  ) => void;
  resolveAppointmentReferenceDisplayIds: (refs: {
    appointmentTypeLineageKey: AppointmentTypeLineageKey;
    placement: CalendarAppointmentPlacement;
  }) => null | {
    appointmentTypeId: Id<"appointmentTypes">;
    locationId: Id<"locations">;
    occupancyScope:
      | { calendarResourceColumn: "ekg" | "labor"; kind: "resource" }
      | { kind: "practitioner"; practitionerId: Id<"practitioners"> };
  };
  runUpdateAppointmentInternal: (
    args: UpdateAppointmentMutationArgs,
  ) => Promise<unknown>;
}): CalendarPlanningReplayAdapter {
  const matchesState = (
    appointment: CalendarAppointmentRecord,
    expected: AppointmentState,
  ) =>
    appointment.start === expected.start &&
    appointment.end === expected.end &&
    appointment.placement.locationLineageKey ===
      expected.placement.locationLineageKey &&
    sameCalendarOccupancyScope(
      appointment.placement.occupancyScope,
      expected.placement.occupancyScope,
    );

  const candidatePayload = (state: AppointmentState): AppointmentCandidate => ({
    end: state.end,
    isSimulation: params.before.isSimulation ?? false,
    placement: state.placement,
    start: state.start,
  });

  const updateToState = async (state: AppointmentState) => {
    const displayRefs = params.resolveAppointmentReferenceDisplayIds({
      appointmentTypeLineageKey: params.before.appointmentTypeLineageKey,
      placement: state.placement,
    });
    if (!displayRefs) {
      return false;
    }

    await params.runUpdateAppointmentInternal({
      end: state.end,
      id: params.appointmentId,
      locationId: displayRefs.locationId,
      ...(displayRefs.occupancyScope.kind === "resource"
        ? {
            calendarResourceColumn:
              displayRefs.occupancyScope.calendarResourceColumn,
          }
        : {
            practitionerId: displayRefs.occupancyScope.practitionerId,
          }),
      start: state.start,
    });
    return true;
  };

  return {
    redo: async () => {
      await params.ensureLatestConflictData();
      const current = params.getCurrentAppointmentDoc(params.appointmentId);
      if (!current || !matchesState(current, params.beforeState)) {
        return {
          message:
            "Der Termin wurde zwischenzeitlich geändert und kann nicht erneut angewendet werden.",
          status: "conflict",
        };
      }

      if (
        params.hasAppointmentConflict(
          candidatePayload(params.afterState),
          params.appointmentId,
        )
      ) {
        return {
          message:
            "Die Terminänderung kollidiert mit einer neueren Terminplanung.",
          status: "conflict",
        };
      }

      const applied = await updateToState(params.afterState);
      if (!applied) {
        return {
          message:
            "Die Terminänderung kann nicht erneut angewendet werden, weil die Referenzen nicht mehr aufgelöst werden konnten.",
          status: "conflict",
        };
      }
      params.rememberAppointmentHistoryDoc(params.afterSnapshot);
      return { status: "applied" };
    },
    undo: async () => {
      await params.ensureLatestConflictData();
      const current = params.getCurrentAppointmentDoc(params.appointmentId);
      if (!current || !matchesState(current, params.afterState)) {
        return {
          message:
            "Der Termin wurde zwischenzeitlich geändert und kann nicht zurückgesetzt werden.",
          status: "conflict",
        };
      }

      if (
        params.hasAppointmentConflict(
          candidatePayload(params.beforeState),
          params.appointmentId,
        )
      ) {
        return {
          message:
            "Der ursprüngliche Termin kollidiert mit einer neueren Terminplanung.",
          status: "conflict",
        };
      }

      const applied = await updateToState(params.beforeState);
      if (!applied) {
        return {
          message:
            "Der ursprüngliche Termin kann nicht wiederhergestellt werden, weil die Referenzen nicht mehr aufgelöst werden konnten.",
          status: "conflict",
        };
      }
      params.rememberAppointmentHistoryDoc(params.before);
      return { status: "applied" };
    },
  };
}

export function createBlockedSlotCreateReplay(params: {
  blockedSlotReferences: CalendarBlockedSlotPlacement;
  createArgs: CreateBlockedSlotMutationArgs & { isSimulation: boolean };
  createdId: Id<"blockedSlots">;
  ensureLatestConflictData: () => Promise<void>;
  forgetBlockedSlotHistoryDoc: (id: Id<"blockedSlots">) => void;
  hasBlockedSlotConflict: (candidate: BlockedSlotCandidate) => boolean;
  now: number;
  rememberCreatedBlockedSlotHistoryDoc: (
    args: CreatedBlockedSlotHistoryArgs,
  ) => void;
  runCreateBlockedSlotInternal: (
    args: CreateBlockedSlotMutationArgs,
  ) => Promise<Id<"blockedSlots"> | null>;
  runDeleteBlockedSlotInternal: (
    args: DeleteBlockedSlotMutationArgs,
  ) => Promise<unknown>;
}): CalendarPlanningReplayAdapter {
  let currentBlockedSlotId = params.createdId;

  return {
    redo: async () => {
      await params.ensureLatestConflictData();
      if (
        params.hasBlockedSlotConflict({
          end: params.createArgs.end,
          isSimulation: params.createArgs.isSimulation,
          placement: params.blockedSlotReferences,
          start: params.createArgs.start,
        })
      ) {
        return {
          message:
            "Die Sperrung kann nicht wiederhergestellt werden, weil der Zeitraum inzwischen belegt ist.",
          status: "conflict",
        };
      }

      const recreatedId = await params.runCreateBlockedSlotInternal(
        params.createArgs,
      );
      if (!recreatedId) {
        return { status: "conflict" };
      }

      currentBlockedSlotId = recreatedId;
      params.rememberCreatedBlockedSlotHistoryDoc({
        blockedSlotId: recreatedId,
        end: params.createArgs.end,
        isSimulation: params.createArgs.isSimulation,
        now: params.now,
        placement: params.blockedSlotReferences,
        practiceId: params.createArgs.practiceId,
        ...(params.createArgs.replacesBlockedSlotId && {
          replacesBlockedSlotId: params.createArgs.replacesBlockedSlotId,
        }),
        start: params.createArgs.start,
        title: params.createArgs.title,
      });
      return { status: "applied" };
    },
    undo: async () => {
      try {
        await params.runDeleteBlockedSlotInternal({
          id: currentBlockedSlotId,
        });
        params.forgetBlockedSlotHistoryDoc(currentBlockedSlotId);
        return { status: "applied" };
      } catch {
        params.forgetBlockedSlotHistoryDoc(currentBlockedSlotId);
        return {
          message: "Die Sperrung wurde bereits entfernt.",
          status: "conflict",
        };
      }
    },
  };
}

export function createBlockedSlotDeleteReplay(params: {
  createArgs: CreateBlockedSlotMutationArgs;
  deleted: CalendarBlockedSlotRecord;
  deletedId: Id<"blockedSlots">;
  ensureLatestConflictData: () => Promise<void>;
  forgetBlockedSlotHistoryDoc: (id: Id<"blockedSlots">) => void;
  hasBlockedSlotConflict: (candidate: BlockedSlotCandidate) => boolean;
  rememberBlockedSlotHistoryDoc: (slot: CalendarBlockedSlotRecord) => void;
  runCreateBlockedSlotInternal: (
    args: CreateBlockedSlotMutationArgs,
  ) => Promise<Id<"blockedSlots"> | null>;
  runDeleteBlockedSlotInternal: (
    args: DeleteBlockedSlotMutationArgs,
  ) => Promise<unknown>;
}): CalendarPlanningReplayAdapter {
  let currentBlockedSlotId = params.deletedId;

  return {
    redo: async () => {
      try {
        await params.runDeleteBlockedSlotInternal({
          id: currentBlockedSlotId,
        });
        params.forgetBlockedSlotHistoryDoc(currentBlockedSlotId);
        return { status: "applied" };
      } catch {
        params.forgetBlockedSlotHistoryDoc(currentBlockedSlotId);
        return { status: "applied" };
      }
    },
    undo: async () => {
      await params.ensureLatestConflictData();
      if (
        params.hasBlockedSlotConflict({
          end: params.createArgs.end,
          isSimulation: params.createArgs.isSimulation ?? false,
          placement: params.deleted.placement,
          start: params.createArgs.start,
        })
      ) {
        return {
          message:
            "Die gelöschte Sperrung kann nicht wiederhergestellt werden, weil der Zeitraum inzwischen belegt ist.",
          status: "conflict",
        };
      }

      const recreatedId = await params.runCreateBlockedSlotInternal(
        params.createArgs,
      );
      if (!recreatedId) {
        return { status: "conflict" };
      }

      currentBlockedSlotId = recreatedId;
      params.rememberBlockedSlotHistoryDoc({
        ...params.deleted,
        _id: recreatedId,
      });
      return { status: "applied" };
    },
  };
}

export function createBlockedSlotUpdateReplay(params: {
  afterSnapshot: CalendarBlockedSlotRecord;
  afterState: BlockedSlotState;
  before: CalendarBlockedSlotRecord;
  beforeState: BlockedSlotState;
  blockedSlotId: Id<"blockedSlots">;
  ensureLatestConflictData: () => Promise<void>;
  getCurrentBlockedSlotDoc: (
    id: Id<"blockedSlots">,
  ) => CalendarBlockedSlotRecord | undefined;
  hasBlockedSlotConflict: (
    candidate: BlockedSlotCandidate,
    excludeId?: Id<"blockedSlots">,
  ) => boolean;
  referenceMaps: CalendarReferenceMaps;
  rememberBlockedSlotHistoryDoc: (slot: CalendarBlockedSlotRecord) => void;
  runUpdateBlockedSlotInternal: (
    args: UpdateBlockedSlotMutationArgs,
  ) => Promise<unknown>;
}): CalendarPlanningReplayAdapter {
  const matchesState = (
    slot: CalendarBlockedSlotRecord,
    expected: BlockedSlotState,
  ) =>
    slot.start === expected.start &&
    slot.end === expected.end &&
    slot.placement.locationLineageKey ===
      expected.placement.locationLineageKey &&
    sameCalendarOccupancyScope(
      slot.placement.occupancyScope,
      expected.placement.occupancyScope,
    ) &&
    slot.title === expected.title;

  const candidatePayload = (state: BlockedSlotState): BlockedSlotCandidate => ({
    end: state.end,
    isSimulation: params.before.isSimulation ?? false,
    placement: state.placement,
    start: state.start,
  });

  const updateToState = async (state: BlockedSlotState) => {
    const displayRefs = resolveBlockedSlotPlacementDisplayRefs(
      state.placement,
      params.referenceMaps,
    );
    if (!displayRefs) {
      return false;
    }

    await params.runUpdateBlockedSlotInternal({
      end: state.end,
      id: params.blockedSlotId,
      locationId: displayRefs.locationId,
      occupancyScope: displayRefs.occupancyScope,
      start: state.start,
      title: state.title,
    });
    return true;
  };

  return {
    redo: async () => {
      await params.ensureLatestConflictData();
      const current = params.getCurrentBlockedSlotDoc(params.blockedSlotId);
      if (!current || !matchesState(current, params.beforeState)) {
        return {
          message:
            "Die Sperrung wurde zwischenzeitlich geändert und kann nicht erneut angewendet werden.",
          status: "conflict",
        };
      }

      if (
        params.hasBlockedSlotConflict(
          candidatePayload(params.afterState),
          params.blockedSlotId,
        )
      ) {
        return {
          message: "Die Sperrung kollidiert mit einer neueren Planung.",
          status: "conflict",
        };
      }

      const applied = await updateToState(params.afterState);
      if (!applied) {
        return {
          message:
            "Die Sperrung kann nicht erneut angewendet werden, weil die Referenzen nicht mehr aufgelöst werden konnten.",
          status: "conflict",
        };
      }
      params.rememberBlockedSlotHistoryDoc(params.afterSnapshot);
      return { status: "applied" };
    },
    undo: async () => {
      await params.ensureLatestConflictData();
      const current = params.getCurrentBlockedSlotDoc(params.blockedSlotId);
      if (!current || !matchesState(current, params.afterState)) {
        return {
          message:
            "Die Sperrung wurde zwischenzeitlich geändert und kann nicht zurückgesetzt werden.",
          status: "conflict",
        };
      }

      if (
        params.hasBlockedSlotConflict(
          candidatePayload(params.beforeState),
          params.blockedSlotId,
        )
      ) {
        return {
          message:
            "Die ursprüngliche Sperrung kollidiert mit einer neueren Planung.",
          status: "conflict",
        };
      }

      const applied = await updateToState(params.beforeState);
      if (!applied) {
        return {
          message:
            "Die ursprüngliche Sperrung kann nicht wiederhergestellt werden, weil die Referenzen nicht mehr aufgelöst werden konnten.",
          status: "conflict",
        };
      }
      params.rememberBlockedSlotHistoryDoc(params.before);
      return { status: "applied" };
    },
  };
}
