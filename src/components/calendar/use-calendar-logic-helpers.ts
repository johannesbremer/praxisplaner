import type { RefObject } from "react";

import { err, ok, type Result } from "neverthrow";
import { Temporal } from "temporal-polyfill";

import type { Id } from "../../../convex/_generated/dataModel";
import type { CalendarAppointmentRecord, CalendarColumnId } from "./types";

import {
  getAppointmentPractitionerLineageKey,
  getBlockedSlotPractitionerLineageKey,
} from "../../../convex/appointmentOccupancy";
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
  placement: {
    locationLineageKey: Id<"locations">;
    occupancyScope:
      | { kind: "location-wide" }
      | { kind: "practitioner"; practitionerLineageKey: Id<"practitioners"> };
  };
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
  calendarResourceColumn?: "ekg" | "labor" | null;
  columnOverride?: CalendarColumnId;
  durationMinutes?: number;
  endISO?: string;
  locationId?: Id<"locations">;
  practitionerId?: Id<"practitioners">;
  startISO?: string;
}

export function collectDeletedPractitionerCalendarRanges(args: {
  appointments: CalendarAppointmentRecord[];
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
    const practitionerLineageKey = getAppointmentPractitionerLineageKey(
      appointment.placement.occupancyScope,
    );
    if (
      !practitionerLineageKey ||
      !args.deletedPractitionerLineageKeys.has(practitionerLineageKey)
    ) {
      continue;
    }

    if (
      args.effectiveLocationLineageKey !== undefined &&
      appointment.placement.locationLineageKey !==
        args.effectiveLocationLineageKey
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
      practitionerLineageKey,
      start.hour * 60 + start.minute,
      end.hour * 60 + end.minute,
    );
  }

  for (const blockedSlot of filterBlockedSlotsForDateAndLocation(
    args.blockedSlots,
    args.selectedDate,
    args.effectiveLocationLineageKey,
  )) {
    const practitionerLineageKey = getBlockedSlotPractitionerLineageKey(
      blockedSlot.placement.occupancyScope,
    );
    if (
      !practitionerLineageKey ||
      !args.deletedPractitionerLineageKeys.has(practitionerLineageKey)
    ) {
      continue;
    }

    const start = Temporal.ZonedDateTime.from(blockedSlot.start).toPlainTime();
    const end = Temporal.ZonedDateTime.from(blockedSlot.end).toPlainTime();
    addRange(
      practitionerLineageKey,
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
      blockedSlot.placement.locationLineageKey !== effectiveLocationLineageKey
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
