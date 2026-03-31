"use client";

import type React from "react";

import { err, ok, type Result } from "neverthrow";
import { createContext, useContext } from "react";
import { Temporal } from "temporal-polyfill";

import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { PatientInfo } from "../types";
import type { SchedulingSimulatedContext } from "../types";

import {
  type FrontendError,
  missingContextError,
} from "../utils/frontend-errors";

/**
 * Calendar context interface defining all shared state and actions
 * that calendar components need access to.
 */
export interface CalendarContextValue {
  // Date and time state
  currentTime: Temporal.ZonedDateTime;
  onDateChange: (date: Temporal.PlainDate) => void;
  selectedDate: Temporal.PlainDate;

  // Location state
  locationsData?: Doc<"locations">[] | undefined;
  onLocationSelect: (locationId: Id<"locations"> | undefined) => void;
  selectedLocationId: Id<"locations"> | undefined;

  // Appointment type state
  onAppointmentTypeSelect?: (
    appointmentTypeId?: Id<"appointmentTypes">,
  ) => void;
  practiceId?: Id<"practices"> | undefined;
  ruleSetId?: Id<"ruleSets"> | undefined;
  selectedAppointmentTypeId?: Id<"appointmentTypes"> | undefined;

  // Simulation mode state
  onUpdateSimulatedContext?:
    | ((context: SchedulingSimulatedContext) => void)
    | undefined;
  simulatedContext?: SchedulingSimulatedContext | undefined;

  // Blocking mode state
  isBlockingModeActive?: boolean | undefined;
  onBlockingModeChange?: ((active: boolean) => void) | undefined;

  // Alert/notification state
  showGdtAlert?: boolean | undefined;

  // Location resolution
  onLocationResolved?:
    | ((locationId: Id<"locations">, locationName: string) => void)
    | undefined;

  // Appointment selection callback
  onAppointmentCreated?: (
    appointmentId: Id<"appointments">,
    patient?:
      | { id: Id<"patients">; type: "patient" }
      | { id: Id<"users">; type: "user" },
  ) => void;

  // Pending appointment title (set by sidebar modal before manual placement)
  onPendingTitleChange?: ((title: string | undefined) => void) | undefined;
  patient?: PatientInfo | undefined;

  // Optimistic mutations
  runCreateAppointment?: (args: {
    appointmentTypeId: Id<"appointmentTypes">;
    isNewPatient?: boolean;
    isSimulation?: boolean;
    locationId: Id<"locations">;
    patientDateOfBirth?: string;
    patientId?: Id<"patients">;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    replacesAppointmentId?: Id<"appointments">;
    start: string;
    title: string;
    userId?: Id<"users">;
  }) => Promise<Id<"appointments"> | undefined>;
}

const CalendarContext = createContext<CalendarContextValue | null>(null);

/**
 * Hook to access calendar context.
 * Throws an error if used outside of CalendarProvider.
 */
export function useCalendarContext(): Result<
  CalendarContextValue,
  FrontendError
> {
  const context = useContext(CalendarContext);

  if (!context) {
    return err(missingContextError("useCalendarContext", "a CalendarProvider"));
  }

  return ok(context);
}

/**
 * Calendar context provider props
 */
interface CalendarProviderProps {
  children: React.ReactNode;
  value: CalendarContextValue;
}

/**
 * Provider component that wraps calendar components and provides
 * shared state and actions through context.
 */
export function CalendarProvider({ children, value }: CalendarProviderProps) {
  return (
    <CalendarContext.Provider value={value}>
      {children}
    </CalendarContext.Provider>
  );
}
