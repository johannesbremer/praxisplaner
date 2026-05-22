// Types for the booking wizard components

import type { Id } from "@/convex/_generated/dataModel";
import type {
  BookingStepGroup,
  CalendarSelectionStepName,
  DataInputStepName,
} from "@/lib/booking-session-steps";

import { api } from "@/convex/_generated/api";
import {
  BOOKING_SESSION_STEP_KIND,
  getBookingSessionStepGroup,
  getBookingSessionStepLabel,
  isBackLockedStep,
  isCalendarSelectionStepName,
  isDataInputStepName,
} from "@/lib/booking-session-steps";

// The session state from Convex
export type BookingSessionState = NonNullable<ActiveBookingSession>["state"];
type ActiveBookingSession =
  (typeof api.bookingSessions.getActiveForUser)["_returnType"];

// Type helper to extract state at a specific step
export type CalendarSelectionState = StateAtStep<CalendarSelectionStepName>;
export type DataInputState = StateAtStep<DataInputStepName>;
export type StateAtStep<S extends BookingSessionState["step"]> = Extract<
  BookingSessionState,
  { step: S }
>;

// Common props for step components
export interface StepComponentProps {
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
  sessionId: Id<"bookingSessions">;
  state: BookingSessionState;
}

// Step names mapped to readable labels
const BOOKING_SESSION_STEPS = Object.keys(
  BOOKING_SESSION_STEP_KIND,
) as BookingSessionState["step"][];

export const STEP_LABELS = Object.fromEntries(
  BOOKING_SESSION_STEPS.map((step) => [step, getBookingSessionStepLabel(step)]),
) as Record<BookingSessionState["step"], string>;

// Group steps for progress indicator
export type StepGroup = BookingStepGroup;

export function getStepGroup(step: BookingSessionState["step"]): StepGroup {
  return getBookingSessionStepGroup(step);
}

export function getStepLabel(step: BookingSessionState["step"]): string {
  return getBookingSessionStepLabel(step);
}

// Check if we can go back from a given step
export function canGoBack(step: BookingSessionState["step"]): boolean {
  return !isBackLockedStep(step);
}

export function isCalendarSelectionState(
  state: BookingSessionState,
): state is CalendarSelectionState {
  return isCalendarSelectionStepName(state.step);
}

export function isDataInputState(
  state: BookingSessionState,
): state is DataInputState {
  return isDataInputStepName(state.step);
}
