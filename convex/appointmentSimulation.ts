import { type Infer, v } from "convex/values";

import type { Doc } from "./_generated/dataModel";

export const appointmentSimulationKindValidator = v.union(
  v.literal("draft"),
  v.literal("activation-reassignment"),
);

export type AppointmentSimulationKind = Infer<
  typeof appointmentSimulationKindValidator
>;

type SimulationAppointmentLike = Pick<
  Doc<"appointments">,
  "isSimulation" | "reassignmentSourceVacationLineageKey" | "simulationKind"
>;

export function isActivationBoundSimulation(
  appointment: SimulationAppointmentLike,
): boolean {
  if (appointment.isSimulation !== true) {
    return false;
  }

  if (appointment.simulationKind === "activation-reassignment") {
    return true;
  }

  return appointment.reassignmentSourceVacationLineageKey !== undefined;
}
