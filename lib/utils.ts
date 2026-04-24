import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

import type { Id } from "../convex/_generated/dataModel";
import type { SchedulingSimulatedContext } from "../src/types";
import type { IsoDateString } from "./typed-regex";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Creates a reset/initial simulated context for scheduling.
 * This ensures consistent context creation across the application.
 * @param options Optional configuration for the context
 * @param options.appointmentTypeLineageKey The default appointment type lineage to set
 * @param options.isNewPatient Whether the patient is new (defaults to true)
 * @param options.locationLineageKey The default location lineage to set
 * @param options.patientDateOfBirth The patient's date of birth (YYYY-MM-DD)
 * @returns A properly typed SchedulingSimulatedContext
 */
export function createSimulatedContext(options?: {
  appointmentTypeLineageKey?: Id<"appointmentTypes">;
  isNewPatient?: boolean;
  locationLineageKey?: Id<"locations">;
  patientDateOfBirth?: IsoDateString;
}): SchedulingSimulatedContext {
  const context: SchedulingSimulatedContext = {
    patient: {
      isNew: options?.isNewPatient ?? true,
      ...(options?.patientDateOfBirth && {
        dateOfBirth: options.patientDateOfBirth,
      }),
    },
  };

  if (options?.appointmentTypeLineageKey) {
    context.appointmentTypeLineageKey = options.appointmentTypeLineageKey;
  }

  if (options?.locationLineageKey) {
    context.locationLineageKey = options.locationLineageKey;
  }

  return context;
}
