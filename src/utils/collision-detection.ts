import type { Appointment } from "../hooks/use-calendar-state";

import { SLOT_DURATION, timeToSlot } from "./time-calculations";

/**
 * Determines whether a new appointment would overlap with existing appointments.
 * @param appointments List of currently scheduled appointments.
 * @param column The column identifier (practitioner or resource).
 * @param startSlot The starting time slot index.
 * @param duration Length of the appointment in minutes.
 * @param businessStartHour The hour when business operations begin.
 * @param excludeId An appointment ID to ignore during collision checking.
 * @returns Whether a scheduling conflict exists.
 * @example
 * ```ts
 * const hasCollision = checkCollision(
 *   appointments,
 *   'practitioner-123',
 *   24, // 10:00 if business starts at 8:00
 *   30, // 30 minutes
 *   8,  // business starts at 8:00
 * );
 * ```
 */
export function checkCollision(
  appointments: Appointment[],
  column: string,
  startSlot: number,
  duration: number,
  businessStartHour: number,
  excludeId?: string,
): boolean {
  const endSlot = startSlot + Math.ceil(duration / SLOT_DURATION);

  return appointments.some((apt) => {
    // Skip if it's the same appointment or different column
    if (apt.id === excludeId || apt.column !== column) {
      return false;
    }

    const aptStartSlot = timeToSlot(apt.startTime, businessStartHour);
    const aptEndSlot = aptStartSlot + Math.ceil(apt.duration / SLOT_DURATION);

    // Check if the time ranges overlap
    // Two ranges [a1, a2] and [b1, b2] overlap if: a1 < b2 AND b1 < a2
    return startSlot < aptEndSlot && aptStartSlot < endSlot;
  });
}

/**
 * Locates the earliest available time slot that can accommodate an appointment.
 * @param appointments List of currently scheduled appointments.
 * @param column The column identifier to search within.
 * @param startSlot The time slot index to begin searching from.
 * @param duration Length of the appointment in minutes.
 * @param businessStartHour The hour when business operations begin.
 * @param totalSlots Maximum number of available time slots.
 * @returns The slot index of the next opening, or -1 if none exists.
 * @example
 * ```ts
 * const nextSlot = findNextAvailableSlot(
 *   appointments,
 *   'practitioner-123',
 *   24, // Start searching from 10:00
 *   30, // Need 30 minutes
 *   8,  // Business starts at 8:00
 *   144 // Total slots (12 hours * 60 minutes / 5 minute slots)
 * );
 * ```
 */
export function findNextAvailableSlot(
  appointments: Appointment[],
  column: string,
  startSlot: number,
  duration: number,
  businessStartHour: number,
  totalSlots: number,
): number {
  const slotsNeeded = Math.ceil(duration / SLOT_DURATION);

  for (let slot = startSlot; slot <= totalSlots - slotsNeeded; slot++) {
    if (
      !checkCollision(appointments, column, slot, duration, businessStartHour)
    ) {
      return slot;
    }
  }

  return -1; // No available slot found
}

/**
 * Identifies all time slots that can accommodate an appointment of the specified duration.
 * @param appointments List of currently scheduled appointments.
 * @param column The column identifier to search within.
 * @param duration Length of the appointment in minutes.
 * @param businessStartHour The hour when business operations begin.
 * @param totalSlots Maximum number of available time slots.
 * @returns An array of all available slot indices.
 * @example
 * ```ts
 * const availableSlots = findAvailableSlots(
 *   appointments,
 *   'practitioner-123',
 *   30, // 30 minutes
 *   8,  // Business starts at 8:00
 *   144 // Total slots
 * );
 * // Returns: [0, 6, 12, 18, ...] (all available slots)
 * ```
 */
export function findAvailableSlots(
  appointments: Appointment[],
  column: string,
  duration: number,
  businessStartHour: number,
  totalSlots: number,
): number[] {
  const availableSlots: number[] = [];
  const slotsNeeded = Math.ceil(duration / SLOT_DURATION);

  for (let slot = 0; slot <= totalSlots - slotsNeeded; slot++) {
    if (
      !checkCollision(appointments, column, slot, duration, businessStartHour)
    ) {
      availableSlots.push(slot);
    }
  }

  return availableSlots;
}

/**
 * Validates whether adjusting an appointment's duration would create a scheduling conflict.
 * @param appointments List of currently scheduled appointments.
 * @param appointmentId Unique identifier of the appointment being modified.
 * @param column The column identifier where the appointment is located.
 * @param startSlot The starting time slot index of the appointment.
 * @param newDuration The proposed new duration in minutes.
 * @param businessStartHour The hour when business operations begin.
 * @returns Whether the resize operation would cause a conflict.
 */
export function checkResizeCollision(
  appointments: Appointment[],
  appointmentId: string,
  column: string,
  startSlot: number,
  newDuration: number,
  businessStartHour: number,
): boolean {
  return checkCollision(
    appointments,
    column,
    startSlot,
    newDuration,
    businessStartHour,
    appointmentId, // Exclude self from collision check
  );
}

/**
 * Validates whether relocating an appointment would create a scheduling conflict.
 * @param appointments List of currently scheduled appointments.
 * @param appointmentId Unique identifier of the appointment being moved.
 * @param targetColumn The destination column identifier.
 * @param targetSlot The destination time slot index.
 * @param duration Length of the appointment in minutes.
 * @param businessStartHour The hour when business operations begin.
 * @returns Whether the move operation would cause a conflict.
 */
export function checkMoveCollision(
  appointments: Appointment[],
  appointmentId: string,
  targetColumn: string,
  targetSlot: number,
  duration: number,
  businessStartHour: number,
): boolean {
  return checkCollision(
    appointments,
    targetColumn,
    targetSlot,
    duration,
    businessStartHour,
    appointmentId, // Exclude self from collision check
  );
}

/**
 * Retrieves all appointments that intersect with a specified time range.
 * @param appointments List of currently scheduled appointments.
 * @param column The column identifier to search within.
 * @param startSlot The beginning time slot index of the range.
 * @param endSlot The ending time slot index of the range.
 * @param businessStartHour The hour when business operations begin.
 * @returns All appointments that overlap with the specified range.
 */
export function getOverlappingAppointments(
  appointments: Appointment[],
  column: string,
  startSlot: number,
  endSlot: number,
  businessStartHour: number,
): Appointment[] {
  return appointments.filter((apt) => {
    if (apt.column !== column) {
      return false;
    }

    const aptStartSlot = timeToSlot(apt.startTime, businessStartHour);
    const aptEndSlot = aptStartSlot + Math.ceil(apt.duration / SLOT_DURATION);

    return startSlot < aptEndSlot && aptStartSlot < endSlot;
  });
}
