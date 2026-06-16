import type { FunctionArgs } from "convex/server";

import type { Id } from "../../../convex/_generated/dataModel";
import type { AppointmentTypeLineageKey } from "../../../convex/identity";
import type { LedgerCommand } from "../../utils/command-ledger";
import type {
  CalendarAppointmentPlacement,
  CalendarAppointmentRecord,
  CalendarBlockedSlotPlacement,
  CalendarBlockedSlotRecord,
} from "./types";

import { api } from "../../../convex/_generated/api";

export type AppointmentState = Pick<
  CalendarAppointmentRecord,
  "end" | "placement" | "smiley" | "start"
>;

export type BlockedSlotState = Pick<
  CalendarBlockedSlotRecord,
  "end" | "placement" | "start" | "title"
>;

export interface CalendarAppointmentCreateCommand extends CalendarPlanningCommandBase {
  kind: "appointment.create";
  payload: {
    appointmentTypeLineageKey: AppointmentTypeLineageKey;
    appointmentTypeTitle: string;
    createArgs: CreateAppointmentMutationArgs & { isSimulation: boolean };
    createEnd: string;
    currentAppointmentId: Id<"appointments">;
    placement: CalendarAppointmentPlacement;
  };
}

export interface CalendarAppointmentDeleteCommand extends CalendarPlanningCommandBase {
  kind: "appointment.delete";
  payload: {
    createArgs: CreateAppointmentMutationArgs;
    createEnd: string;
    currentAppointmentId: Id<"appointments">;
    deleted: CalendarAppointmentRecord;
  };
}

export interface CalendarAppointmentUpdateCommand extends CalendarPlanningCommandBase {
  kind: "appointment.update";
  payload: {
    afterSnapshot: CalendarAppointmentRecord;
    afterState: AppointmentState;
    appointmentId: Id<"appointments">;
    before: CalendarAppointmentRecord;
    beforeState: AppointmentState;
  };
}

export interface CalendarBlockedSlotCreateCommand extends CalendarPlanningCommandBase {
  kind: "blockedSlot.create";
  payload: {
    blockedSlotReferences: CalendarBlockedSlotPlacement;
    createArgs: CreateBlockedSlotMutationArgs & { isSimulation: boolean };
    currentBlockedSlotId: Id<"blockedSlots">;
    now: number;
  };
}

export interface CalendarBlockedSlotDeleteCommand extends CalendarPlanningCommandBase {
  kind: "blockedSlot.delete";
  payload: {
    createArgs: CreateBlockedSlotMutationArgs;
    currentBlockedSlotId: Id<"blockedSlots">;
    deleted: CalendarBlockedSlotRecord;
  };
}

export interface CalendarBlockedSlotUpdateCommand extends CalendarPlanningCommandBase {
  kind: "blockedSlot.update";
  payload: {
    afterSnapshot: CalendarBlockedSlotRecord;
    afterState: BlockedSlotState;
    before: CalendarBlockedSlotRecord;
    beforeState: BlockedSlotState;
    blockedSlotId: Id<"blockedSlots">;
  };
}

export type CalendarPlanningCommand =
  | CalendarAppointmentCreateCommand
  | CalendarAppointmentDeleteCommand
  | CalendarAppointmentUpdateCommand
  | CalendarBlockedSlotCreateCommand
  | CalendarBlockedSlotDeleteCommand
  | CalendarBlockedSlotUpdateCommand;

export type CalendarPlanningCommandKind = CalendarPlanningCommand["kind"];

export type CreateAppointmentMutationArgs = FunctionArgs<
  typeof api.appointments.createAppointment
>;

export type CreateBlockedSlotMutationArgs = FunctionArgs<
  typeof api.appointments.createBlockedSlot
>;

export type DeleteAppointmentMutationArgs = FunctionArgs<
  typeof api.appointments.deleteAppointment
>;

export type DeleteBlockedSlotMutationArgs = FunctionArgs<
  typeof api.appointments.deleteBlockedSlot
>;

export type UpdateAppointmentMutationArgs = FunctionArgs<
  typeof api.appointments.updateAppointment
>;

export type UpdateBlockedSlotMutationArgs = FunctionArgs<
  typeof api.appointments.updateBlockedSlot
>;

interface CalendarPlanningCommandBase extends LedgerCommand {
  clearHistoryBefore?: boolean;
}
