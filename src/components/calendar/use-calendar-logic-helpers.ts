import type { RefObject } from "react";

import { err, ok, type Result } from "neverthrow";
import { Temporal } from "temporal-polyfill";

import type { Id } from "../../../convex/_generated/dataModel";
import type { AppointmentResult } from "../../../convex/appointments";

import { invalidStateError } from "../../utils/frontend-errors";

export const TIMEZONE = "Europe/Berlin";

export interface BlockedSlotConversionOptions {
  endISO?: string;
  locationId?: Id<"locations">;
  practitionerId?: Id<"practitioners">;
  startISO?: string;
  title?: string;
}

export interface CalendarBlockedSlotRecord {
  end: string;
  locationId: Id<"locations">;
  practitionerId?: Id<"practitioners">;
  start: string;
}

export interface DeletedPractitionerCalendarRange {
  endMinutes: number;
  practitionerId: Id<"practitioners">;
  startMinutes: number;
}

export interface SimulatedBlockedSlotConversionResult {
  id: Id<"blockedSlots">;
  startISO: string;
}

export interface SimulationConversionOptions {
  columnOverride?: string;
  durationMinutes?: number;
  endISO?: string;
  locationId?: Id<"locations">;
  practitionerId?: Id<"practitioners">;
  startISO?: string;
}

interface ConflictAppointmentCandidate {
  end: string;
  isSimulation?: boolean;
  locationId: Id<"locations">;
  practitionerId?: Id<"practitioners">;
  replacesAppointmentId?: Id<"appointments">;
  start: string;
}

interface ConflictAppointmentRecord extends ConflictAppointmentCandidate {
  _id: Id<"appointments">;
}

interface ConflictBlockedSlotCandidate {
  end: string;
  isSimulation?: boolean;
  locationId: Id<"locations">;
  practitionerId?: Id<"practitioners">;
  start: string;
}

interface ConflictBlockedSlotRecord extends ConflictBlockedSlotCandidate {
  _id: Id<"blockedSlots">;
}

export function collectDeletedPractitionerCalendarRanges(args: {
  appointments: AppointmentResult[];
  blockedSlots: readonly CalendarBlockedSlotRecord[];
  deletedPractitionerIds: ReadonlySet<Id<"practitioners">>;
  effectiveLocationId: Id<"locations"> | undefined;
  selectedDate: Temporal.PlainDate;
}): DeletedPractitionerCalendarRange[] {
  const rangesByPractitioner = new Map<
    Id<"practitioners">,
    { endMinutes: number; startMinutes: number }
  >();

  const addRange = (
    practitionerId: Id<"practitioners">,
    startMinutes: number,
    endMinutes: number,
  ) => {
    const existing = rangesByPractitioner.get(practitionerId);
    if (!existing) {
      rangesByPractitioner.set(practitionerId, { endMinutes, startMinutes });
      return;
    }

    rangesByPractitioner.set(practitionerId, {
      endMinutes: Math.max(existing.endMinutes, endMinutes),
      startMinutes: Math.min(existing.startMinutes, startMinutes),
    });
  };

  for (const appointment of args.appointments) {
    if (
      !appointment.practitionerId ||
      !args.deletedPractitionerIds.has(appointment.practitionerId)
    ) {
      continue;
    }

    if (
      args.effectiveLocationId !== undefined &&
      appointment.locationId !== args.effectiveLocationId
    ) {
      continue;
    }

    const start = Temporal.ZonedDateTime.from(appointment.start);
    if (
      Temporal.PlainDate.compare(start.toPlainDate(), args.selectedDate) !== 0
    ) {
      continue;
    }

    const end = Temporal.ZonedDateTime.from(appointment.end);
    addRange(
      appointment.practitionerId,
      start.hour * 60 + start.minute,
      end.hour * 60 + end.minute,
    );
  }

  for (const blockedSlot of filterBlockedSlotsForDateAndLocation(
    args.blockedSlots,
    args.selectedDate,
    args.effectiveLocationId,
  )) {
    if (
      !blockedSlot.practitionerId ||
      !args.deletedPractitionerIds.has(blockedSlot.practitionerId)
    ) {
      continue;
    }

    const start = Temporal.ZonedDateTime.from(blockedSlot.start).toPlainTime();
    const end = Temporal.ZonedDateTime.from(blockedSlot.end).toPlainTime();
    addRange(
      blockedSlot.practitionerId,
      start.hour * 60 + start.minute,
      end.hour * 60 + end.minute,
    );
  }

  return [...rangesByPractitioner.entries()].map(([practitionerId, range]) => ({
    endMinutes: range.endMinutes,
    practitionerId,
    startMinutes: range.startMinutes,
  }));
}

export function filterBlockedSlotsForDateAndLocation<
  T extends CalendarBlockedSlotRecord,
>(
  blockedSlotsData: null | readonly T[] | undefined,
  selectedDate: Temporal.PlainDate,
  effectiveLocationId?: Id<"locations">,
): T[] {
  if (!blockedSlotsData) {
    return [];
  }

  return blockedSlotsData.filter((blockedSlot) => {
    const slotDate = Temporal.ZonedDateTime.from(
      blockedSlot.start,
    ).toPlainDate();
    if (Temporal.PlainDate.compare(slotDate, selectedDate) !== 0) {
      return false;
    }

    if (
      effectiveLocationId !== undefined &&
      blockedSlot.locationId !== effectiveLocationId
    ) {
      return false;
    }

    return true;
  });
}

export function handleEditBlockedSlot(
  blockedSlotId: string,
  justFinishedResizingRef: RefObject<null | string>,
): boolean {
  if (justFinishedResizingRef.current === blockedSlotId) {
    return false;
  }
  return true;
}

export function hasAppointmentConflictInRecords(
  candidate: ConflictAppointmentCandidate,
  appointments: Iterable<ConflictAppointmentRecord>,
  excludeId: Id<"appointments"> | undefined,
  toEpochMilliseconds: (iso: string) => number,
): boolean {
  const candidateStart = toEpochMilliseconds(candidate.start);
  const candidateEnd = toEpochMilliseconds(candidate.end);

  for (const existing of appointments) {
    if (excludeId && existing._id === excludeId) {
      continue;
    }

    if (
      candidate.replacesAppointmentId &&
      existing._id === candidate.replacesAppointmentId
    ) {
      continue;
    }

    if (existing.locationId !== candidate.locationId) {
      continue;
    }

    if (
      (existing.isSimulation === true) !==
      (candidate.isSimulation === true)
    ) {
      continue;
    }

    if (existing.practitionerId !== candidate.practitionerId) {
      continue;
    }

    const existingStart = toEpochMilliseconds(existing.start);
    const existingEnd = toEpochMilliseconds(existing.end);
    if (candidateStart < existingEnd && existingStart < candidateEnd) {
      return true;
    }
  }

  return false;
}

export function hasBlockedSlotConflictInRecords(args: {
  appointments: Iterable<ConflictAppointmentRecord>;
  blockedSlots: Iterable<ConflictBlockedSlotRecord>;
  candidate: ConflictBlockedSlotCandidate;
  excludeId?: Id<"blockedSlots">;
  toEpochMilliseconds: (iso: string) => number;
}): boolean {
  const candidateStart = args.toEpochMilliseconds(args.candidate.start);
  const candidateEnd = args.toEpochMilliseconds(args.candidate.end);

  for (const existing of args.blockedSlots) {
    if (args.excludeId && existing._id === args.excludeId) {
      continue;
    }

    if (existing.locationId !== args.candidate.locationId) {
      continue;
    }

    if (existing.practitionerId !== args.candidate.practitionerId) {
      continue;
    }

    if (
      (existing.isSimulation === true) !==
      (args.candidate.isSimulation === true)
    ) {
      continue;
    }

    const existingStart = args.toEpochMilliseconds(existing.start);
    const existingEnd = args.toEpochMilliseconds(existing.end);
    if (candidateStart < existingEnd && existingStart < candidateEnd) {
      return true;
    }
  }

  return hasAppointmentConflictInRecords(
    args.candidate,
    args.appointments,
    undefined,
    args.toEpochMilliseconds,
  );
}

export function mergeConflictRecordsById<T extends { _id: string }>(
  ...maps: readonly ReadonlyMap<string, T>[]
): T[] {
  return mergeConflictRecordsByIdExcluding({ maps });
}

export function mergeConflictRecordsByIdExcluding<
  T extends { _id: string },
>(args: {
  excludedIds?: ReadonlySet<string>;
  maps: readonly ReadonlyMap<string, T>[];
}): T[] {
  const merged = new Map<string, T>();

  for (const map of args.maps) {
    for (const [id, record] of map) {
      if (args.excludedIds?.has(id)) {
        continue;
      }

      merged.set(id, record);
    }
  }

  return [...merged.values()];
}

export function parsePlainTimeResult(
  value: string,
  source: string,
): Result<Temporal.PlainTime, ReturnType<typeof invalidStateError>> {
  try {
    return ok(Temporal.PlainTime.from(value));
  } catch (error) {
    return err(
      invalidStateError(`Invalid time format: ${value}`, source, error),
    );
  }
}
