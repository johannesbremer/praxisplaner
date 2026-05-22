import type { BookingSessionState } from "./bookingSessions.shared";

export type InternalBookingSessionState = BookingSessionState;

export function assertValidSanitizedBookingSessionState(
  expectedStep: BookingSessionState["step"],
  state: BookingSessionState,
): void {
  if (state.step !== expectedStep) {
    throw new Error(
      `Invalid booking state: expected '${expectedStep}', got '${state.step}'.`,
    );
  }
}

export function computePreviousInternalState(
  state: InternalBookingSessionState,
): InternalBookingSessionState | null {
  void state;
  return null;
}
