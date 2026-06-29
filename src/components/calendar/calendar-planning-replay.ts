import type { Id } from "../../../convex/_generated/dataModel";
import type { AppointmentTypeLineageKey } from "../../../convex/identity";
import type { AppointmentColor } from "../../../convex/schema";
import type {
  LedgerExecutionResult,
  LedgerOperation,
} from "../../utils/command-ledger";
import type {
  AppointmentState,
  BlockedSlotState,
  CalendarAppointmentCreateCommand,
  CalendarAppointmentDeleteCommand,
  CalendarAppointmentUpdateCommand,
  CalendarBlockedSlotCreateCommand,
  CalendarBlockedSlotDeleteCommand,
  CalendarBlockedSlotUpdateCommand,
  CalendarPlanningCommand,
  CreateAppointmentMutationArgs,
  CreateBlockedSlotMutationArgs,
  DeleteAppointmentMutationArgs,
  DeleteBlockedSlotMutationArgs,
  RestoreDeletedAppointmentMutationArgs,
  UpdateAppointmentMutationArgs,
  UpdateBlockedSlotMutationArgs,
} from "./calendar-planning-command";
import type { CalendarReferenceMaps } from "./calendar-reference-adapters";
import type {
  CalendarAppointmentPlacement,
  CalendarAppointmentRecord,
  CalendarBlockedSlotPlacement,
  CalendarBlockedSlotRecord,
} from "./types";

import { sameCalendarOccupancyScope } from "../../../lib/calendar-occupancy";
import {
  type AppointmentOwnerRefs,
  getAppointmentOwnerRefs,
} from "./appointment-owner-refs";
import { resolveBlockedSlotPlacementDisplayRefs } from "./calendar-reference-adapters";

export interface CalendarPlanningCommandExecutorContext {
  ensureLatestConflictData: () => Promise<void>;
  forgetAppointmentHistoryDoc: (id: Id<"appointments">) => void;
  forgetBlockedSlotHistoryDoc: (id: Id<"blockedSlots">) => void;
  getAppointmentColor?: (id: Id<"appointments">) => Promise<AppointmentColor>;
  getCurrentAppointmentDoc: (
    id: Id<"appointments">,
  ) => CalendarAppointmentRecord | undefined;
  getCurrentBlockedSlotDoc: (
    id: Id<"blockedSlots">,
  ) => CalendarBlockedSlotRecord | undefined;
  hasAppointmentConflict: (
    candidate: AppointmentCandidate,
    excludeId?: Id<"appointments">,
  ) => boolean;
  hasBlockedSlotConflict: (
    candidate: BlockedSlotCandidate,
    excludeId?: Id<"blockedSlots">,
  ) => boolean;
  isMissingAppointmentError?: (error: unknown) => boolean;
  isMissingBlockedSlotError?: (error: unknown) => boolean;
  referenceMaps: CalendarReferenceMaps;
  rememberAppointmentHistoryDoc: (
    appointment: CalendarAppointmentRecord,
  ) => void;
  rememberBlockedSlotHistoryDoc: (slot: CalendarBlockedSlotRecord) => void;
  rememberCreatedAppointmentFromStrings: (
    args: CreatedAppointmentHistoryArgs,
  ) => boolean;
  rememberCreatedBlockedSlotHistoryDoc: (
    args: CreatedBlockedSlotHistoryArgs,
  ) => void;
  rememberRecreatedAppointmentId: (args: {
    currentId: Id<"appointments">;
    originalId: Id<"appointments">;
  }) => void;
  rememberRecreatedBlockedSlotId: (args: {
    currentId: Id<"blockedSlots">;
    originalId: Id<"blockedSlots">;
  }) => void;
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
  resolveCurrentAppointmentId: (id: Id<"appointments">) => Id<"appointments">;
  resolveCurrentBlockedSlotId: (id: Id<"blockedSlots">) => Id<"blockedSlots">;
  runCreateAppointmentInternal: (
    args: CreateAppointmentMutationArgs,
  ) => Promise<Id<"appointments"> | null>;
  runCreateBlockedSlotInternal: (
    args: CreateBlockedSlotMutationArgs,
  ) => Promise<Id<"blockedSlots"> | null>;
  runDeleteAppointmentInternal: (
    args: DeleteAppointmentMutationArgs,
  ) => Promise<unknown>;
  runDeleteBlockedSlotInternal: (
    args: DeleteBlockedSlotMutationArgs,
  ) => Promise<unknown>;
  runRestoreDeletedAppointmentInternal: (
    args: RestoreDeletedAppointmentMutationArgs,
  ) => Promise<Id<"appointments"> | null>;
  runUpdateAppointmentInternal: (
    args: UpdateAppointmentMutationArgs,
  ) => Promise<unknown>;
  runUpdateBlockedSlotInternal: (
    args: UpdateBlockedSlotMutationArgs,
  ) => Promise<unknown>;
}

interface AppointmentCandidate {
  end: string;
  isSimulation: boolean;
  placement: CalendarAppointmentPlacement;
  replacesAppointmentId?: Id<"appointments">;
  start: string;
}

interface BlockedSlotCandidate {
  end: string;
  isSimulation: boolean;
  placement: CalendarBlockedSlotPlacement;
  start: string;
}

type CalendarPlanningReplayResult =
  | LedgerExecutionResult
  | {
      message?: string;
      status: "conflict";
    };

interface CreatedAppointmentHistoryArgs extends AppointmentOwnerRefs {
  appointmentTypeLineageKey: AppointmentTypeLineageKey;
  appointmentTypeTitle: string;
  color: AppointmentColor;
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

const appointmentMatchesState = (
  appointment: CalendarAppointmentRecord,
  expected: AppointmentState,
) =>
  appointment.start === expected.start &&
  appointment.end === expected.end &&
  appointment.smiley === expected.smiley &&
  appointment.placement.locationLineageKey ===
    expected.placement.locationLineageKey &&
  sameCalendarOccupancyScope(
    appointment.placement.occupancyScope,
    expected.placement.occupancyScope,
  );

const hasAppointmentSchedulingStateChange = (
  left: AppointmentState,
  right: AppointmentState,
) =>
  left.start !== right.start ||
  left.end !== right.end ||
  left.placement.locationLineageKey !== right.placement.locationLineageKey ||
  !sameCalendarOccupancyScope(
    left.placement.occupancyScope,
    right.placement.occupancyScope,
  );

const hasAppointmentStateChange = (
  left: AppointmentState,
  right: AppointmentState,
) =>
  left.smiley !== right.smiley ||
  hasAppointmentSchedulingStateChange(left, right);

const blockedSlotMatchesState = (
  slot: CalendarBlockedSlotRecord,
  expected: BlockedSlotState,
) =>
  slot.start === expected.start &&
  slot.end === expected.end &&
  slot.placement.locationLineageKey === expected.placement.locationLineageKey &&
  sameCalendarOccupancyScope(
    slot.placement.occupancyScope,
    expected.placement.occupancyScope,
  ) &&
  slot.title === expected.title;

const withFreshAppointmentHistoryIdentity = (
  appointment: CalendarAppointmentRecord,
  id: Id<"appointments">,
): CalendarAppointmentRecord => ({
  ...appointment,
  _id: id,
  lastModified: BigInt(Date.now()),
});

const withFreshBlockedSlotHistoryIdentity = (
  blockedSlot: CalendarBlockedSlotRecord,
  id: Id<"blockedSlots">,
): CalendarBlockedSlotRecord => ({
  ...blockedSlot,
  _id: id,
  lastModified: BigInt(Date.now()),
});

const rememberFreshAppointment = (
  context: CalendarPlanningCommandExecutorContext,
  appointment: CalendarAppointmentRecord,
  id: Id<"appointments">,
) => {
  context.rememberAppointmentHistoryDoc(
    withFreshAppointmentHistoryIdentity(appointment, id),
  );
};

const rememberFreshBlockedSlot = (
  context: CalendarPlanningCommandExecutorContext,
  blockedSlot: CalendarBlockedSlotRecord,
  id: Id<"blockedSlots">,
) => {
  context.rememberBlockedSlotHistoryDoc(
    withFreshBlockedSlotHistoryIdentity(blockedSlot, id),
  );
};

export function executeCalendarPlanningCommand(
  command: CalendarPlanningCommand,
  operation: LedgerOperation,
  context: CalendarPlanningCommandExecutorContext,
): Promise<LedgerExecutionResult> {
  const result = (() => {
    switch (command.kind) {
      case "appointment.create": {
        return executeAppointmentCreateCommand(command, operation, context);
      }
      case "appointment.delete": {
        return executeAppointmentDeleteCommand(command, operation, context);
      }
      case "appointment.update": {
        return executeAppointmentUpdateCommand(command, operation, context);
      }
      case "blockedSlot.create": {
        return executeBlockedSlotCreateCommand(command, operation, context);
      }
      case "blockedSlot.delete": {
        return executeBlockedSlotDeleteCommand(command, operation, context);
      }
      case "blockedSlot.update": {
        return executeBlockedSlotUpdateCommand(command, operation, context);
      }
    }
  })();

  return Promise.resolve(result).then(toLedgerExecutionResult);
}

async function executeAppointmentCreateCommand(
  command: CalendarAppointmentCreateCommand,
  operation: LedgerOperation,
  context: CalendarPlanningCommandExecutorContext,
): Promise<CalendarPlanningReplayResult> {
  const { payload } = command;

  if (operation === "redo") {
    await context.ensureLatestConflictData();
    if (
      context.hasAppointmentConflict({
        end: payload.createEnd,
        isSimulation: payload.createArgs.isSimulation,
        placement: payload.placement,
        ...(payload.createArgs.replacesAppointmentId && {
          replacesAppointmentId: payload.createArgs.replacesAppointmentId,
        }),
        start: payload.createArgs.start,
      })
    ) {
      return {
        message:
          "Der Termin kann nicht wiederhergestellt werden, weil der Zeitraum bereits belegt ist.",
        status: "conflict",
      };
    }

    const originalAppointmentId = payload.currentAppointmentId;
    const recreatedId = await context.runCreateAppointmentInternal(
      payload.createArgs,
    );
    if (!recreatedId) {
      return { status: "conflict" };
    }

    payload.currentAppointmentId = recreatedId;
    context.rememberRecreatedAppointmentId({
      currentId: recreatedId,
      originalId: originalAppointmentId,
    });
    const persistedColor =
      (await context.getAppointmentColor?.(recreatedId)) ?? payload.color;
    context.rememberCreatedAppointmentFromStrings({
      appointmentTypeLineageKey: payload.appointmentTypeLineageKey,
      appointmentTypeTitle: payload.appointmentTypeTitle,
      color: persistedColor,
      ...getAppointmentOwnerRefs(payload.createArgs),
      createdId: recreatedId,
      createEnd: payload.createEnd,
      createStart: payload.createArgs.start,
      isSimulation: payload.createArgs.isSimulation,
      placement: payload.placement,
      practiceId: payload.createArgs.practiceId,
      ...(payload.createArgs.replacesAppointmentId && {
        replacesAppointmentId: payload.createArgs.replacesAppointmentId,
      }),
      title: payload.createArgs.title,
    });
    return { status: "applied" };
  }

  try {
    await context.runDeleteAppointmentInternal({
      id: payload.currentAppointmentId,
    });
    context.forgetAppointmentHistoryDoc(payload.currentAppointmentId);
    return { status: "applied" };
  } catch (error: unknown) {
    context.forgetAppointmentHistoryDoc(payload.currentAppointmentId);
    if (context.isMissingAppointmentError?.(error)) {
      return { status: "applied" };
    }
    return {
      message:
        error instanceof Error
          ? error.message
          : "Der Termin konnte nicht entfernt werden.",
      status: "conflict",
    };
  }
}

async function executeAppointmentDeleteCommand(
  command: CalendarAppointmentDeleteCommand,
  operation: LedgerOperation,
  context: CalendarPlanningCommandExecutorContext,
): Promise<CalendarPlanningReplayResult> {
  const { payload } = command;

  if (operation === "redo") {
    try {
      await context.runDeleteAppointmentInternal({
        id: payload.currentAppointmentId,
      });
      context.forgetAppointmentHistoryDoc(payload.currentAppointmentId);
      return { status: "applied" };
    } catch (error: unknown) {
      context.forgetAppointmentHistoryDoc(payload.currentAppointmentId);
      if (context.isMissingAppointmentError?.(error)) {
        return { status: "applied" };
      }
      return {
        message:
          error instanceof Error
            ? error.message
            : "Der Termin konnte nicht entfernt werden.",
        status: "conflict",
      };
    }
  }

  await context.ensureLatestConflictData();
  if (
    context.hasAppointmentConflict({
      end: payload.deleted.end,
      isSimulation: payload.createArgs.isSimulation ?? false,
      placement: payload.deleted.placement,
      ...(payload.createArgs.replacesAppointmentId && {
        replacesAppointmentId: payload.createArgs.replacesAppointmentId,
      }),
      start: payload.createArgs.start,
    })
  ) {
    return {
      message:
        "Der gelöschte Termin kann nicht wiederhergestellt werden, weil der Zeitraum inzwischen belegt ist.",
      status: "conflict",
    };
  }

  const recreatedId = await context.runRestoreDeletedAppointmentInternal({
    originalAppointmentId: payload.currentAppointmentId,
  });
  if (!recreatedId) {
    return { status: "conflict" };
  }

  const originalAppointmentId = payload.currentAppointmentId;
  payload.currentAppointmentId = recreatedId;
  context.rememberRecreatedAppointmentId({
    currentId: recreatedId,
    originalId: originalAppointmentId,
  });
  context.rememberAppointmentHistoryDoc({
    ...payload.deleted,
    _id: recreatedId,
  });
  return { status: "applied" };
}

async function executeAppointmentUpdateCommand(
  command: CalendarAppointmentUpdateCommand,
  operation: LedgerOperation,
  context: CalendarPlanningCommandExecutorContext,
): Promise<CalendarPlanningReplayResult> {
  const { payload } = command;
  const currentAppointmentId = context.resolveCurrentAppointmentId(
    payload.appointmentId,
  );
  const candidatePayload = (state: AppointmentState): AppointmentCandidate => ({
    end: state.end,
    isSimulation: payload.before.isSimulation ?? false,
    placement: state.placement,
    start: state.start,
  });
  const updateToState = async (
    state: AppointmentState,
    previousState: AppointmentState,
  ) => {
    const hasSchedulingChange = hasAppointmentSchedulingStateChange(
      state,
      previousState,
    );
    if (!hasSchedulingChange && state.smiley === previousState.smiley) {
      return true;
    }

    const smileyUpdate =
      state.smiley === previousState.smiley
        ? {}
        : { smiley: state.smiley ?? null };
    if (!hasSchedulingChange) {
      await context.runUpdateAppointmentInternal({
        id: currentAppointmentId,
        ...smileyUpdate,
      });
      return true;
    }

    const displayRefs = context.resolveAppointmentReferenceDisplayIds({
      appointmentTypeLineageKey: payload.before.appointmentTypeLineageKey,
      placement: state.placement,
    });
    if (!displayRefs) {
      return false;
    }

    await context.runUpdateAppointmentInternal({
      end: state.end,
      id: currentAppointmentId,
      locationId: displayRefs.locationId,
      ...(displayRefs.occupancyScope.kind === "resource"
        ? {
            calendarResourceColumn:
              displayRefs.occupancyScope.calendarResourceColumn,
          }
        : {
            practitionerId: displayRefs.occupancyScope.practitionerId,
          }),
      ...smileyUpdate,
      start: state.start,
    });
    return true;
  };

  if (operation === "redo") {
    await context.ensureLatestConflictData();
    const current = context.getCurrentAppointmentDoc(currentAppointmentId);
    if (!current) {
      return {
        message:
          "Der Termin wurde zwischenzeitlich geändert und kann nicht erneut angewendet werden.",
        status: "conflict",
      };
    }
    if (!hasAppointmentStateChange(payload.beforeState, payload.afterState)) {
      rememberFreshAppointment(context, payload.before, currentAppointmentId);
      return { status: "noop" };
    }
    if (appointmentMatchesState(current, payload.afterState)) {
      rememberFreshAppointment(
        context,
        payload.afterSnapshot,
        currentAppointmentId,
      );
      return { status: "applied" };
    }
    if (!appointmentMatchesState(current, payload.beforeState)) {
      return {
        message:
          "Der Termin wurde zwischenzeitlich geändert und kann nicht erneut angewendet werden.",
        status: "conflict",
      };
    }

    if (
      hasAppointmentSchedulingStateChange(
        payload.beforeState,
        payload.afterState,
      ) &&
      context.hasAppointmentConflict(
        candidatePayload(payload.afterState),
        currentAppointmentId,
      )
    ) {
      return {
        message:
          "Die Terminänderung kollidiert mit einer neueren Terminplanung.",
        status: "conflict",
      };
    }

    const applied = await updateToState(
      payload.afterState,
      payload.beforeState,
    );
    if (!applied) {
      return {
        message:
          "Die Terminänderung kann nicht erneut angewendet werden, weil die Referenzen nicht mehr aufgelöst werden konnten.",
        status: "conflict",
      };
    }
    rememberFreshAppointment(
      context,
      payload.afterSnapshot,
      currentAppointmentId,
    );
    return { status: "applied" };
  }

  await context.ensureLatestConflictData();
  const current = context.getCurrentAppointmentDoc(currentAppointmentId);
  if (!current) {
    return {
      message:
        "Der Termin wurde zwischenzeitlich geändert und kann nicht zurückgesetzt werden.",
      status: "conflict",
    };
  }
  if (!hasAppointmentStateChange(payload.afterState, payload.beforeState)) {
    rememberFreshAppointment(context, payload.before, currentAppointmentId);
    return { status: "noop" };
  }
  if (appointmentMatchesState(current, payload.beforeState)) {
    rememberFreshAppointment(context, payload.before, currentAppointmentId);
    return { status: "applied" };
  }
  if (!appointmentMatchesState(current, payload.afterState)) {
    return {
      message:
        "Der Termin wurde zwischenzeitlich geändert und kann nicht zurückgesetzt werden.",
      status: "conflict",
    };
  }

  if (
    hasAppointmentSchedulingStateChange(
      payload.afterState,
      payload.beforeState,
    ) &&
    context.hasAppointmentConflict(
      candidatePayload(payload.beforeState),
      currentAppointmentId,
    )
  ) {
    return {
      message:
        "Der ursprüngliche Termin kollidiert mit einer neueren Terminplanung.",
      status: "conflict",
    };
  }

  const applied = await updateToState(payload.beforeState, payload.afterState);
  if (!applied) {
    return {
      message:
        "Der ursprüngliche Termin kann nicht wiederhergestellt werden, weil die Referenzen nicht mehr aufgelöst werden konnten.",
      status: "conflict",
    };
  }
  rememberFreshAppointment(context, payload.before, currentAppointmentId);
  return { status: "applied" };
}

async function executeBlockedSlotCreateCommand(
  command: CalendarBlockedSlotCreateCommand,
  operation: LedgerOperation,
  context: CalendarPlanningCommandExecutorContext,
): Promise<CalendarPlanningReplayResult> {
  const { payload } = command;

  if (operation === "redo") {
    await context.ensureLatestConflictData();
    if (
      context.hasBlockedSlotConflict({
        end: payload.createArgs.end,
        isSimulation: payload.createArgs.isSimulation,
        placement: payload.blockedSlotReferences,
        start: payload.createArgs.start,
      })
    ) {
      return {
        message:
          "Die Sperrung kann nicht wiederhergestellt werden, weil der Zeitraum inzwischen belegt ist.",
        status: "conflict",
      };
    }

    const originalBlockedSlotId = payload.currentBlockedSlotId;
    const recreatedId = await context.runCreateBlockedSlotInternal(
      payload.createArgs,
    );
    if (!recreatedId) {
      return { status: "conflict" };
    }

    payload.currentBlockedSlotId = recreatedId;
    context.rememberRecreatedBlockedSlotId({
      currentId: recreatedId,
      originalId: originalBlockedSlotId,
    });
    context.rememberCreatedBlockedSlotHistoryDoc({
      blockedSlotId: recreatedId,
      end: payload.createArgs.end,
      isSimulation: payload.createArgs.isSimulation,
      now: payload.now,
      placement: payload.blockedSlotReferences,
      practiceId: payload.createArgs.practiceId,
      ...(payload.createArgs.replacesBlockedSlotId && {
        replacesBlockedSlotId: payload.createArgs.replacesBlockedSlotId,
      }),
      start: payload.createArgs.start,
      title: payload.createArgs.title,
    });
    return { status: "applied" };
  }

  try {
    await context.runDeleteBlockedSlotInternal({
      id: payload.currentBlockedSlotId,
    });
    context.forgetBlockedSlotHistoryDoc(payload.currentBlockedSlotId);
    return { status: "applied" };
  } catch (error: unknown) {
    context.forgetBlockedSlotHistoryDoc(payload.currentBlockedSlotId);
    if (context.isMissingBlockedSlotError?.(error)) {
      return { status: "applied" };
    }
    return {
      message:
        error instanceof Error
          ? error.message
          : "Die Sperrung konnte nicht entfernt werden.",
      status: "conflict",
    };
  }
}

async function executeBlockedSlotDeleteCommand(
  command: CalendarBlockedSlotDeleteCommand,
  operation: LedgerOperation,
  context: CalendarPlanningCommandExecutorContext,
): Promise<CalendarPlanningReplayResult> {
  const { payload } = command;

  if (operation === "redo") {
    try {
      await context.runDeleteBlockedSlotInternal({
        id: payload.currentBlockedSlotId,
      });
      context.forgetBlockedSlotHistoryDoc(payload.currentBlockedSlotId);
      return { status: "applied" };
    } catch (error: unknown) {
      context.forgetBlockedSlotHistoryDoc(payload.currentBlockedSlotId);
      if (context.isMissingBlockedSlotError?.(error)) {
        return { status: "applied" };
      }
      return {
        message:
          error instanceof Error
            ? error.message
            : "Die Sperrung konnte nicht entfernt werden.",
        status: "conflict",
      };
    }
  }

  await context.ensureLatestConflictData();
  if (
    context.hasBlockedSlotConflict({
      end: payload.createArgs.end,
      isSimulation: payload.createArgs.isSimulation ?? false,
      placement: payload.deleted.placement,
      start: payload.createArgs.start,
    })
  ) {
    return {
      message:
        "Die gelöschte Sperrung kann nicht wiederhergestellt werden, weil der Zeitraum inzwischen belegt ist.",
      status: "conflict",
    };
  }

  const recreatedId = await context.runCreateBlockedSlotInternal(
    payload.createArgs,
  );
  if (!recreatedId) {
    return { status: "conflict" };
  }

  const originalBlockedSlotId = payload.currentBlockedSlotId;
  payload.currentBlockedSlotId = recreatedId;
  context.rememberRecreatedBlockedSlotId({
    currentId: recreatedId,
    originalId: originalBlockedSlotId,
  });
  context.rememberBlockedSlotHistoryDoc({
    ...payload.deleted,
    _id: recreatedId,
  });
  return { status: "applied" };
}

async function executeBlockedSlotUpdateCommand(
  command: CalendarBlockedSlotUpdateCommand,
  operation: LedgerOperation,
  context: CalendarPlanningCommandExecutorContext,
): Promise<CalendarPlanningReplayResult> {
  const { payload } = command;
  const currentBlockedSlotId = context.resolveCurrentBlockedSlotId(
    payload.blockedSlotId,
  );
  const candidatePayload = (state: BlockedSlotState): BlockedSlotCandidate => ({
    end: state.end,
    isSimulation: payload.before.isSimulation ?? false,
    placement: state.placement,
    start: state.start,
  });

  const updateToState = async (state: BlockedSlotState) => {
    const displayRefs = resolveBlockedSlotPlacementDisplayRefs(
      state.placement,
      context.referenceMaps,
    );
    if (!displayRefs) {
      return false;
    }

    await context.runUpdateBlockedSlotInternal({
      end: state.end,
      id: currentBlockedSlotId,
      locationId: displayRefs.locationId,
      occupancyScope: displayRefs.occupancyScope,
      start: state.start,
      title: state.title,
    });
    return true;
  };

  if (operation === "redo") {
    await context.ensureLatestConflictData();
    const current = context.getCurrentBlockedSlotDoc(currentBlockedSlotId);
    if (!current) {
      return {
        message:
          "Die Sperrung wurde zwischenzeitlich geändert und kann nicht erneut angewendet werden.",
        status: "conflict",
      };
    }
    if (blockedSlotMatchesState(current, payload.afterState)) {
      rememberFreshBlockedSlot(
        context,
        payload.afterSnapshot,
        currentBlockedSlotId,
      );
      return { status: "applied" };
    }
    if (!blockedSlotMatchesState(current, payload.beforeState)) {
      return {
        message:
          "Die Sperrung wurde zwischenzeitlich geändert und kann nicht erneut angewendet werden.",
        status: "conflict",
      };
    }

    if (
      context.hasBlockedSlotConflict(
        candidatePayload(payload.afterState),
        currentBlockedSlotId,
      )
    ) {
      return {
        message: "Die Sperrung kollidiert mit einer neueren Planung.",
        status: "conflict",
      };
    }

    const applied = await updateToState(payload.afterState);
    if (!applied) {
      return {
        message:
          "Die Sperrung kann nicht erneut angewendet werden, weil die Referenzen nicht mehr aufgelöst werden konnten.",
        status: "conflict",
      };
    }
    rememberFreshBlockedSlot(
      context,
      payload.afterSnapshot,
      currentBlockedSlotId,
    );
    return { status: "applied" };
  }

  await context.ensureLatestConflictData();
  const current = context.getCurrentBlockedSlotDoc(currentBlockedSlotId);
  if (!current) {
    return {
      message:
        "Die Sperrung wurde zwischenzeitlich geändert und kann nicht zurückgesetzt werden.",
      status: "conflict",
    };
  }
  if (blockedSlotMatchesState(current, payload.beforeState)) {
    rememberFreshBlockedSlot(context, payload.before, currentBlockedSlotId);
    return { status: "applied" };
  }
  if (!blockedSlotMatchesState(current, payload.afterState)) {
    return {
      message:
        "Die Sperrung wurde zwischenzeitlich geändert und kann nicht zurückgesetzt werden.",
      status: "conflict",
    };
  }

  if (
    context.hasBlockedSlotConflict(
      candidatePayload(payload.beforeState),
      currentBlockedSlotId,
    )
  ) {
    return {
      message:
        "Die ursprüngliche Sperrung kollidiert mit einer neueren Planung.",
      status: "conflict",
    };
  }

  const applied = await updateToState(payload.beforeState);
  if (!applied) {
    return {
      message:
        "Die ursprüngliche Sperrung kann nicht wiederhergestellt werden, weil die Referenzen nicht mehr aufgelöst werden konnten.",
      status: "conflict",
    };
  }
  rememberFreshBlockedSlot(context, payload.before, currentBlockedSlotId);
  return { status: "applied" };
}

function toLedgerExecutionResult(
  result: CalendarPlanningReplayResult,
): LedgerExecutionResult {
  if (result.status !== "conflict") {
    return result;
  }
  if ("conflict" in result) {
    return result;
  }
  return {
    message:
      result.message ?? "Die Kalender-Aktion konnte nicht ausgeführt werden.",
    status: "conflict",
  };
}
