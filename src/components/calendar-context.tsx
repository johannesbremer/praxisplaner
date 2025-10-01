"use client";

import type React from "react";

import { createContext, useContext } from "react";

import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { SchedulingSimulatedContext } from "../types";

/**
 * Calendar context interface defining all shared state and actions
 * that calendar components need access to.
 */
interface CalendarContextValue {
  // Date and time state
  currentTime: Date;
  onDateChange: (date: Date) => void;
  selectedDate: Date;

  // Location state
  locationsData?: Doc<"locations">[] | undefined;
  onLocationSelect: (locationId: Id<"locations"> | undefined) => void;
  selectedLocationId: Id<"locations"> | undefined;

  // Simulation mode state
  onUpdateSimulatedContext?:
    | ((context: SchedulingSimulatedContext) => void)
    | undefined;
  simulatedContext?: SchedulingSimulatedContext | undefined;

  // Alert/notification state
  showGdtAlert?: boolean | undefined;

  // Location resolution
  onLocationResolved?:
    | ((locationId: Id<"locations">, locationName: string) => void)
    | undefined;
}

const CalendarContext = createContext<CalendarContextValue | null>(null);

/**
 * Hook to access calendar context.
 * Throws an error if used outside of CalendarProvider.
 */
export function useCalendarContext(): CalendarContextValue {
  const context = useContext(CalendarContext);

  if (!context) {
    throw new Error(
      "useCalendarContext must be used within a CalendarProvider",
    );
  }

  return context;
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
