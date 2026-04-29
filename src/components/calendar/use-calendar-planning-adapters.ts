import { useMemo } from "react";

import type { Id } from "../../../convex/_generated/dataModel";
import type {
  CalendarAppointmentLayout,
  CalendarBlockedSlotEditorRecord,
} from "./types";
import type { SimulatedBlockedSlotConversionResult } from "./use-calendar-logic-helpers";
import type { UseCalendarSimulationConversionArgs } from "./use-calendar-simulation-conversion";

import { useCalendarPlanningWorkbench } from "./use-calendar-planning-workbench";
import { useCalendarSimulationConversion } from "./use-calendar-simulation-conversion";

export interface CalendarPlanningAdapters {
  active: CalendarSimulationPlanningCommands;
  real: CalendarMutationPlanningCommands;
  simulation: CalendarSimulationPlanningCommands;
}

export interface CalendarSimulationPlanningCommands extends CalendarMutationPlanningCommands {
  convertRealAppointmentToSimulation: (
    appointment: CalendarAppointmentLayout,
    options: {
      columnOverride?: CalendarAppointmentLayout["column"];
      durationMinutes?: number;
      endISO?: string;
      locationId?: Id<"locations">;
      practitionerId?: Id<"practitioners">;
      startISO?: string;
    },
  ) => Promise<CalendarAppointmentLayout | null>;
  convertRealBlockedSlotToSimulation: (
    blockedSlotId: string,
    options: {
      endISO?: string;
      locationId?: Id<"locations">;
      practitionerId?: Id<"practitioners">;
      startISO?: string;
      title?: string;
    },
  ) => Promise<null | SimulatedBlockedSlotConversionResult>;
}

type CalendarMutationPlanningCommands = ReturnType<
  typeof useCalendarPlanningWorkbench
>["commands"];

type CalendarPlanningWorkbenchArgs = Parameters<
  typeof useCalendarPlanningWorkbench
>[0];

export function useCalendarPlanningAdapters(args: {
  simulation: Omit<
    UseCalendarSimulationConversionArgs,
    "runCreateAppointment" | "runCreateBlockedSlot"
  >;
  workbench: CalendarPlanningWorkbenchArgs;
}): {
  adapters: CalendarPlanningAdapters;
  commands: CalendarSimulationPlanningCommands;
  getBlockedSlotEditorData: (blockedSlotId: string) => null | {
    blockedSlotId: Id<"blockedSlots">;
    currentTitle: string;
    slotData: CalendarBlockedSlotEditorRecord;
    slotIsSimulation: boolean;
  };
} {
  const { commands: realPlanningCommands, getBlockedSlotEditorData } =
    useCalendarPlanningWorkbench(args.workbench);
  const simulationConversions = useCalendarSimulationConversion({
    ...args.simulation,
    runCreateAppointment: realPlanningCommands.createAppointment,
    runCreateBlockedSlot: realPlanningCommands.createBlockedSlot,
  });

  const simulationPlanningCommands = useMemo(
    () => ({
      ...realPlanningCommands,
      ...simulationConversions,
    }),
    [realPlanningCommands, simulationConversions],
  );

  const adapters = useMemo<CalendarPlanningAdapters>(
    () => ({
      active: simulationPlanningCommands,
      real: realPlanningCommands,
      simulation: simulationPlanningCommands,
    }),
    [realPlanningCommands, simulationPlanningCommands],
  );

  return {
    adapters,
    commands: adapters.active,
    getBlockedSlotEditorData,
  };
}
