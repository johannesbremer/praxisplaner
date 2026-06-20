import type { CalendarColumnId } from "./types";

import { sameCalendarColumnScope } from "../../../lib/calendar-occupancy";

export interface CalendarSlotBlock {
  column: CalendarColumnId;
  id?: string | undefined;
  reason?: string | undefined;
  slot: number;
  title?: string | undefined;
}

export function buildInsufficientCapacityBlockedSlots(args: {
  columns: readonly CalendarColumnId[];
  durationMinutes: number;
  isRangeUnavailable: (input: {
    column: CalendarColumnId;
    startSlot: number;
  }) => boolean;
  reason: string;
  slotDurationMinutes: number;
  totalSlots: number;
}): { column: CalendarColumnId; reason: string; slot: number }[] {
  const slotCount = Math.max(
    1,
    Math.ceil(args.durationMinutes / args.slotDurationMinutes),
  );
  const blockedSlots: {
    column: CalendarColumnId;
    reason: string;
    slot: number;
  }[] = [];

  for (const column of args.columns) {
    for (let slot = 0; slot < args.totalSlots; slot += 1) {
      if (
        slot + slotCount > args.totalSlots ||
        args.isRangeUnavailable({ column, startSlot: slot })
      ) {
        blockedSlots.push({
          column,
          reason: args.reason,
          slot,
        });
      }
    }
  }

  return blockedSlots;
}

export function findFirstBlockedSlotInRange(args: {
  blockedSlots: readonly CalendarSlotBlock[];
  column: CalendarColumnId;
  durationMinutes: number;
  excludeBlockedSlotId?: string;
  slotDurationMinutes: number;
  startSlot: number;
}): CalendarSlotBlock | undefined {
  const slotCount = Math.max(
    1,
    Math.ceil(args.durationMinutes / args.slotDurationMinutes),
  );
  const endSlot = args.startSlot + slotCount;

  return args.blockedSlots.find((blockedSlot) => {
    if (
      args.excludeBlockedSlotId !== undefined &&
      blockedSlot.id === args.excludeBlockedSlotId
    ) {
      return false;
    }

    return (
      sameCalendarColumnScope(blockedSlot.column, args.column) &&
      blockedSlot.slot >= args.startSlot &&
      blockedSlot.slot < endSlot
    );
  });
}
