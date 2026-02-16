import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

import type { Id } from "../convex/_generated/dataModel";
import type { SchedulingSimulatedContext } from "../src/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Creates a reset/initial simulated context for scheduling.
 * This ensures consistent context creation across the application.
 * @param options Optional configuration for the context
 * @param options.appointmentTypeId The default appointment type to set
 * @param options.locationId The default location to set
 * @param options.isNewPatient Whether the patient is new (defaults to true)
 * @param options.patientDateOfBirth The patient's date of birth (YYYY-MM-DD or TTMMJJJJ)
 * @returns A properly typed SchedulingSimulatedContext
 */
export function createSimulatedContext(options?: {
  appointmentTypeId?: Id<"appointmentTypes">;
  isNewPatient?: boolean;
  locationId?: Id<"locations">;
  patientDateOfBirth?: string;
}): SchedulingSimulatedContext {
  const context: SchedulingSimulatedContext = {
    patient: {
      isNew: options?.isNewPatient ?? true,
      ...(options?.patientDateOfBirth && {
        dateOfBirth: options.patientDateOfBirth,
      }),
    },
  };

  if (options?.appointmentTypeId) {
    context.appointmentTypeId = options.appointmentTypeId;
  }

  if (options?.locationId) {
    context.locationId = options.locationId;
  }

  return context;
}
