import type { RefObject } from "react";

import { err, ok, type Result } from "neverthrow";
import { Temporal } from "temporal-polyfill";

import type { Id } from "../../../convex/_generated/dataModel";
import type { CalendarResourceColumn } from "../../../lib/calendar-occupancy";
import type {
  CalendarAppointmentRecord,
  CalendarBlockedSlotRecord,
  CalendarColumnId,
} from "./types";

import {
  getAppointmentPractitionerLineageKey,
  getBlockedSlotPractitionerLineageKey,
} from "../../../convex/appointmentOccupancy";
import { invalidStateError } from "../../utils/frontend-errors";

export const TIMEZONE = "Europe/Berlin";

export interface BlockedSlotConversionOptions {
  calendarResourceColumn?: CalendarResourceColumn;
  endISO?: string;
  locationId?: Id<"locations">;
  practitionerId?: Id<"practitioners">;
  startISO?: string;
  title?: string;
}

export type BlockedSlotDropResolution =
  | { calendarResourceColumn: CalendarResourceColumn; kind: "resource" }
  | { kind: "practitioner"; practitionerId: Id<"practitioners"> };

export interface DeletedPractitionerCalendarRange {
  endMinutes: number;
  practitionerLineageKey: Id<"practitioners">;
  startMinutes: number;
}

export interface SimulatedBlockedSlotConversionResult {
  id: Id<"blockedSlots">;
  startISO: string;
}

export type SimulationConversionOptions = SimulationConversionPlacementOptions &
  SimulationConversionTimingOptions;

interface SimulationConversionPlacementOptions {
  calendarResourceColumn?: "ekg" | "labor" | null;
  columnOverride?: CalendarColumnId;
  locationId?: Id<"locations">;
  practitionerId?: Id<"practitioners">;
}

type SimulationConversionTimingOptions =
  | {
      endISO: string;
      startISO: string;
    }
  | {
      endISO?: undefined;
      startISO?: undefined;
    };

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

export function resolveBlockedSlotDropOccupancyScope(args: {
  column: CalendarColumnId;
  getPractitionerIdForColumn: (
    column: CalendarColumnId,
  ) => Id<"practitioners"> | undefined;
}): BlockedSlotDropResolution | null {
  const practitionerId = args.getPractitionerIdForColumn(args.column);
  if (practitionerId !== undefined) {
    return { kind: "practitioner", practitionerId };
  }

  if (args.column.kind === "resource") {
    return {
      calendarResourceColumn: args.column.calendarResourceColumn,
      kind: "resource",
    };
  }

  return null;
}

export function resolveDragPreviewSlot(args: {
  durationMinutes: number;
  pointerSlot: number;
  slotDurationMinutes: number;
  totalSlots: number;
}): number {
  const durationSlots = Math.ceil(
    args.durationMinutes / args.slotDurationMinutes,
  );
  const latestStartSlot = Math.max(0, args.totalSlots - durationSlots);

  return Math.max(0, Math.min(latestStartSlot, args.pointerSlot));
}

export function resolvePointerSlot(args: {
  pointerOffsetPx: number;
  renderedSlotHeightPx: number;
  totalSlots: number;
}): number {
  if (args.totalSlots <= 0 || args.renderedSlotHeightPx <= 0) {
    return 0;
  }

  const pointerSlot = Math.floor(
    args.pointerOffsetPx / args.renderedSlotHeightPx,
  );

  return Math.max(0, Math.min(args.totalSlots - 1, pointerSlot));
}
