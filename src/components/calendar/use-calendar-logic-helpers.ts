import type { RefObject } from "react";

import { err, ok, type Result } from "neverthrow";
import { Temporal } from "temporal-polyfill";

import type { Id } from "../../../convex/_generated/dataModel";
import type { AppointmentResult } from "../../../convex/appointments";
import type { CalendarColumnId } from "./types";

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
  locationLineageKey: Id<"locations">;
  practitionerLineageKey?: Id<"practitioners">;
  start: string;
}

export interface DeletedPractitionerCalendarRange {
  endMinutes: number;
  practitionerLineageKey: Id<"practitioners">;
  startMinutes: number;
}

export interface SimulatedBlockedSlotConversionResult {
  id: Id<"blockedSlots">;
  startISO: string;
}

export interface SimulationConversionOptions {
  columnOverride?: CalendarColumnId;
  durationMinutes?: number;
  endISO?: string;
  locationId?: Id<"locations">;
  practitionerId?: Id<"practitioners">;
  startISO?: string;
}

interface ConflictAppointmentCandidate {
  end: string;
  isSimulation?: boolean;
  locationLineageKey: Id<"locations">;
  practitionerLineageKey?: Id<"practitioners">;
  replacesAppointmentId?: Id<"appointments">;
  start: string;
}

interface ConflictAppointmentRecord extends ConflictAppointmentCandidate {
  _id: Id<"appointments">;
}

interface ConflictBlockedSlotCandidate {
  end: string;
  isSimulation?: boolean;
  locationLineageKey: Id<"locations">;
  practitionerLineageKey?: Id<"practitioners">;
  start: string;
}

interface ConflictBlockedSlotRecord extends ConflictBlockedSlotCandidate {
  _id: Id<"blockedSlots">;
}

export function collectDeletedPractitionerCalendarRanges(args: {
  appointments: AppointmentResult[];
  blockedSlots: readonly CalendarBlockedSlotRecord[];
  deletedPractitionerLineageKeys: ReadonlySet<Id<"practitioners">>;
  effectiveLocationLineageKey: Id<"locations"> | undefined;
  selectedDate: Temporal.PlainDate;
}): DeletedPractitionerCalendarRange[] {
  const rangesByPractitioner = new Map<
    Id<"practitioners">,
    { endMinutes: number; startMinutes: number }
  >();

  const addRange = (
    practitionerLineageKey: Id<"practitioners">,
    startMinutes: number,
    endMinutes: number,
  ) => {
    const existing = rangesByPractitioner.get(practitionerLineageKey);
    if (!existing) {
      rangesByPractitioner.set(practitionerLineageKey, {
        endMinutes,
        startMinutes,
      });
      return;
    }

    rangesByPractitioner.set(practitionerLineageKey, {
      endMinutes: Math.max(existing.endMinutes, endMinutes),
      startMinutes: Math.min(existing.startMinutes, startMinutes),
    });
  };

  for (const appointment of args.appointments) {
    if (
      !appointment.practitionerLineageKey ||
      !args.deletedPractitionerLineageKeys.has(
        appointment.practitionerLineageKey,
      )
    ) {
      continue;
    }

    if (
      args.effectiveLocationLineageKey !== undefined &&
      appointment.locationLineageKey !== args.effectiveLocationLineageKey
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
      appointment.practitionerLineageKey,
      start.hour * 60 + start.minute,
      end.hour * 60 + end.minute,
    );
  }

  for (const blockedSlot of filterBlockedSlotsForDateAndLocation(
    args.blockedSlots,
    args.selectedDate,
    args.effectiveLocationLineageKey,
  )) {
    if (
      !blockedSlot.practitionerLineageKey ||
      !args.deletedPractitionerLineageKeys.has(
        blockedSlot.practitionerLineageKey,
      )
    ) {
      continue;
    }

    const start = Temporal.ZonedDateTime.from(blockedSlot.start).toPlainTime();
    const end = Temporal.ZonedDateTime.from(blockedSlot.end).toPlainTime();
    addRange(
      blockedSlot.practitionerLineageKey,
      start.hour * 60 + start.minute,
      end.hour * 60 + end.minute,
    );
  }

  return [...rangesByPractitioner.entries()].map(
    ([practitionerLineageKey, range]) => ({
      endMinutes: range.endMinutes,
      practitionerLineageKey,
      startMinutes: range.startMinutes,
    }),
  );
}

export function filterBlockedSlotsForDateAndLocation<
  T extends CalendarBlockedSlotRecord,
>(
  blockedSlotsData: null | readonly T[] | undefined,
  selectedDate: Temporal.PlainDate,
  effectiveLocationLineageKey?: Id<"locations">,
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
      effectiveLocationLineageKey !== undefined &&
      blockedSlot.locationLineageKey !== effectiveLocationLineageKey
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

export function hasCalendarOccupancyConflictInRecords(args: {
  appointments: Iterable<ConflictAppointmentRecord>;
  blockedSlots: Iterable<ConflictBlockedSlotRecord>;
  candidate: ConflictAppointmentCandidate | ConflictBlockedSlotCandidate;
  excludeId?: string;
  toEpochMilliseconds: (iso: string) => number;
}): boolean {
  for (const existing of args.blockedSlots) {
    if (
      isCalendarOccupancyConflict({
        candidate: args.candidate,
        ...(args.excludeId === undefined ? {} : { excludeId: args.excludeId }),
        existing,
        toEpochMilliseconds: args.toEpochMilliseconds,
      })
    ) {
      return true;
    }
  }

  for (const existing of args.appointments) {
    if (
      isCalendarOccupancyConflict({
        candidate: args.candidate,
        ...(args.excludeId === undefined ? {} : { excludeId: args.excludeId }),
        existing,
        toEpochMilliseconds: args.toEpochMilliseconds,
      })
    ) {
      return true;
    }
  }

  return false;
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

function isCalendarOccupancyConflict(args: {
  candidate: ConflictAppointmentCandidate | ConflictBlockedSlotCandidate;
  excludeId?: string;
  existing: {
    _id: string;
    end: string;
    isSimulation?: boolean;
    locationLineageKey: Id<"locations">;
    practitionerLineageKey?: Id<"practitioners">;
    start: string;
  };
  toEpochMilliseconds: (iso: string) => number;
}): boolean {
  const candidateStart = args.toEpochMilliseconds(args.candidate.start);
  const candidateEnd = args.toEpochMilliseconds(args.candidate.end);

  if (args.excludeId && args.existing._id === args.excludeId) {
    return false;
  }

  if (
    "replacesAppointmentId" in args.candidate &&
    args.candidate.replacesAppointmentId &&
    args.existing._id === args.candidate.replacesAppointmentId
  ) {
    return false;
  }

  if (args.existing.locationLineageKey !== args.candidate.locationLineageKey) {
    return false;
  }

  if (
    (args.existing.isSimulation === true) !==
    (args.candidate.isSimulation === true)
  ) {
    return false;
  }

  if (
    args.existing.practitionerLineageKey !==
    args.candidate.practitionerLineageKey
  ) {
    return false;
  }

  const existingStart = args.toEpochMilliseconds(args.existing.start);
  const existingEnd = args.toEpochMilliseconds(args.existing.end);
  return candidateStart < existingEnd && existingStart < candidateEnd;
}
