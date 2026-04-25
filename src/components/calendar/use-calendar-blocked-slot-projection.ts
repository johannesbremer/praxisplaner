import { useCallback, useMemo } from "react";
import { Temporal } from "temporal-polyfill";

import type { Id } from "../../../convex/_generated/dataModel";
import type {
  LocationLineageKey,
  PractitionerLineageKey,
} from "../../../convex/identity";
import type {
  CalendarAppointmentRecord,
  CalendarBlockedSlotRecord,
  CalendarColumn,
  CalendarColumnId,
  WorkingPractitioner,
} from "./types";
import type { CalendarManualBlockedSlot } from "./use-calendar-interactions";

import { getPractitionerVacationRangesForDate } from "../../../lib/vacation-utils";
import {
  captureFrontendError,
  invalidStateError,
} from "../../utils/frontend-errors";
import { SLOT_DURATION } from "./types";
import { filterBlockedSlotsForDateAndLocation } from "./use-calendar-logic-helpers";

interface BlockedSlotProjection {
  blockedByRuleId?: Id<"ruleConditions">;
  column: CalendarColumnId;
  duration?: number;
  id?: string;
  isManual?: boolean;
  reason?: string;
  slot: number;
  startSlot?: number;
  title?: string;
}

interface BlockedSlotSchedule {
  breakTimes?: { end: string; start: string }[];
  practitionerId: Id<"practitioners">;
}

interface BlockedSlotVacation {
  date: string;
  portion: "afternoon" | "full" | "morning";
  practitionerLineageKey?: string;
  staffType: "mfa" | "practitioner";
}

interface SchedulingSlot {
  blockedByBlockedSlotId?: Id<"blockedSlots">;
  blockedByRuleId?: Id<"ruleConditions">;
  practitionerLineageKey?: PractitionerLineageKey;
  reason?: string;
  startTime: string;
  status: string;
}

interface UseCalendarBlockedSlotProjectionArgs {
  appointmentsData: readonly CalendarAppointmentRecord[];
  baseSchedulesData: readonly VacationSchedule[] | undefined;
  blockedSlotsData: readonly CalendarBlockedSlotRecord[];
  blockedSlotsWithoutAppointmentTypeSlots:
    | readonly SchedulingSlot[]
    | undefined;
  businessStartHour: number;
  columns: readonly CalendarColumn[];
  getPractitionerIdForLineageKey: (
    practitionerLineageKey: PractitionerLineageKey,
  ) => Id<"practitioners"> | undefined;
  locationLineageKeyById: ReadonlyMap<Id<"locations">, LocationLineageKey>;
  practitionerLineageKeyById: ReadonlyMap<
    Id<"practitioners">,
    PractitionerLineageKey
  >;
  selectedDate: Temporal.PlainDate;
  selectedLocationId: Id<"locations"> | undefined;
  simulatedContext:
    | undefined
    | {
        locationLineageKey?: LocationLineageKey;
      };
  slots: readonly SchedulingSlot[] | undefined;
  timeToSlot: (time: string) => number;
  totalSlots: number;
  vacationsData: readonly BlockedSlotVacation[] | undefined;
  workingPractitioners: readonly WorkingPractitioner[];
}

interface VacationSchedule extends BlockedSlotSchedule {
  dayOfWeek: number;
  endTime: string;
  locationLineageKey?: string;
  practitionerLineageKey: string;
  startTime: string;
}

export function useCalendarBlockedSlotProjection({
  appointmentsData,
  baseSchedulesData,
  blockedSlotsData,
  blockedSlotsWithoutAppointmentTypeSlots,
  businessStartHour,
  columns,
  getPractitionerIdForLineageKey,
  locationLineageKeyById,
  practitionerLineageKeyById,
  selectedDate,
  selectedLocationId,
  simulatedContext,
  slots,
  timeToSlot,
  totalSlots,
  vacationsData,
  workingPractitioners,
}: UseCalendarBlockedSlotProjectionArgs) {
  const createBlockedSlotsForColumns = useCallback(
    (
      reason: string,
      predicate: (column: CalendarColumn) => boolean,
    ): BlockedSlotProjection[] => {
      return columns.flatMap((column) =>
        predicate(column)
          ? Array.from({ length: totalSlots }, (_, slot) => ({
              column: column.id,
              reason,
              slot,
            }))
          : [],
      );
    },
    [columns, totalSlots],
  );

  const baseBlockedSlots = useMemo(() => {
    if (workingPractitioners.length === 0) {
      return [];
    }

    const blocked: BlockedSlotProjection[] = [];
    appendSchedulingSlots({
      blocked,
      slots,
      timeToSlot,
      workingPractitioners,
    });
    appendSchedulingSlots({
      blocked,
      skipExisting: true,
      slots: blockedSlotsWithoutAppointmentTypeSlots,
      timeToSlot,
      workingPractitioners,
    });

    return blocked;
  }, [
    blockedSlotsWithoutAppointmentTypeSlots,
    slots,
    timeToSlot,
    workingPractitioners,
  ]);

  const baseBreakSlots = useMemo(() => {
    if (!baseSchedulesData || workingPractitioners.length === 0) {
      return [];
    }

    const breaks: BlockedSlotProjection[] = [];

    for (const schedule of baseSchedulesData) {
      if (!schedule.breakTimes || schedule.breakTimes.length === 0) {
        continue;
      }

      const practitionerColumn = workingPractitioners.find(
        (practitioner) =>
          practitioner.lineageKey ===
          practitionerLineageKeyById.get(schedule.practitionerId),
      );

      if (!practitionerColumn) {
        continue;
      }

      for (const breakTime of schedule.breakTimes) {
        const startSlot = timeToSlot(breakTime.start);
        const endSlot = timeToSlot(breakTime.end);

        for (let slot = startSlot; slot < endSlot; slot++) {
          breaks.push({
            column: practitionerColumn.lineageKey,
            reason: "Pause",
            slot,
          });
        }
      }
    }

    return breaks;
  }, [
    baseSchedulesData,
    practitionerLineageKeyById,
    timeToSlot,
    workingPractitioners,
  ]);

  const baseManualBlockedSlots = useMemo<CalendarManualBlockedSlot[]>(() => {
    if (workingPractitioners.length === 0) {
      return [];
    }

    const manual: CalendarManualBlockedSlot[] = [];
    const effectiveLocationLineageKey =
      simulatedContext?.locationLineageKey ??
      (selectedLocationId === undefined
        ? undefined
        : locationLineageKeyById.get(selectedLocationId));
    const dateFilteredBlocks = filterBlockedSlotsForDateAndLocation(
      blockedSlotsData,
      selectedDate,
      effectiveLocationLineageKey,
    );

    for (const blockedSlot of dateFilteredBlocks) {
      const practitionerColumn = blockedSlot.practitionerLineageKey
        ? workingPractitioners.find(
            (practitioner) =>
              practitioner.lineageKey === blockedSlot.practitionerLineageKey,
          )
        : undefined;

      if (practitionerColumn) {
        const startTime = Temporal.ZonedDateTime.from(
          blockedSlot.start,
        ).toPlainTime();
        const endTime = Temporal.ZonedDateTime.from(
          blockedSlot.end,
        ).toPlainTime();
        const startSlot = timeToSlot(startTime.toString().slice(0, 5));
        const endSlot = timeToSlot(endTime.toString().slice(0, 5));
        const durationMinutes =
          Temporal.PlainTime.compare(endTime, startTime) >= 0
            ? endTime.since(startTime).total("minutes")
            : 0;

        for (let slot = startSlot; slot < endSlot; slot++) {
          manual.push({
            column: practitionerColumn.lineageKey,
            duration: durationMinutes,
            id: blockedSlot._id,
            isManual: true,
            reason: blockedSlot.title,
            slot,
            startSlot,
            title: blockedSlot.title,
          });
        }
      } else if (blockedSlot.practitionerLineageKey) {
        captureFrontendError(
          invalidStateError(
            "Manual blocked slot practitioner not in visible columns.",
            "useCalendarBlockedSlotProjection.manualBlockedSlots",
          ),
          {
            blockedSlotId: blockedSlot._id,
            locationLineageKey: blockedSlot.locationLineageKey,
            practitionerLineageKey: blockedSlot.practitionerLineageKey,
            selectedDate: selectedDate.toString(),
          },
          `manualBlockedSlotMissingColumn:${blockedSlot._id}`,
        );
      }
    }

    return manual;
  }, [
    blockedSlotsData,
    locationLineageKeyById,
    selectedDate,
    selectedLocationId,
    simulatedContext?.locationLineageKey,
    timeToSlot,
    workingPractitioners,
  ]);

  const baseVacationBlockedSlots = useMemo(() => {
    if (
      !baseSchedulesData ||
      !vacationsData ||
      workingPractitioners.length === 0
    ) {
      return [];
    }

    const blocked: BlockedSlotProjection[] = [];
    const effectiveLocationLineageKey =
      simulatedContext?.locationLineageKey ??
      (selectedLocationId === undefined
        ? undefined
        : locationLineageKeyById.get(selectedLocationId));

    for (const practitioner of workingPractitioners) {
      const practitionerId = getPractitionerIdForLineageKey(
        practitioner.lineageKey,
      );
      if (!practitionerId) {
        continue;
      }

      const hasOnlyConflictFreeFullDayVacation =
        !appointmentsData.some(
          (appointment) =>
            appointment.practitionerLineageKey === practitioner.lineageKey &&
            Temporal.PlainDate.compare(
              Temporal.ZonedDateTime.from(appointment.start).toPlainDate(),
              selectedDate,
            ) === 0,
        ) &&
        vacationsData.some(
          (vacation) =>
            vacation.staffType === "practitioner" &&
            vacation.practitionerLineageKey === practitioner.lineageKey &&
            vacation.date === selectedDate.toString() &&
            vacation.portion === "full",
        );

      if (hasOnlyConflictFreeFullDayVacation) {
        continue;
      }

      const ranges = getPractitionerVacationRangesForDate(
        selectedDate,
        practitioner.lineageKey,
        [...baseSchedulesData],
        [...vacationsData],
        effectiveLocationLineageKey,
      );

      for (const range of ranges) {
        const startSlot = Math.floor(
          (range.startMinutes - businessStartHour * 60) / SLOT_DURATION,
        );
        const endSlot = Math.ceil(
          (range.endMinutes - businessStartHour * 60) / SLOT_DURATION,
        );

        for (let slot = Math.max(0, startSlot); slot < endSlot; slot++) {
          blocked.push({
            column: practitioner.lineageKey,
            reason: "Urlaub",
            slot,
          });
        }
      }
    }

    return blocked;
  }, [
    appointmentsData,
    baseSchedulesData,
    businessStartHour,
    getPractitionerIdForLineageKey,
    locationLineageKeyById,
    selectedDate,
    selectedLocationId,
    simulatedContext,
    vacationsData,
    workingPractitioners,
  ]);

  return {
    baseAppointmentTypeUnavailableBlockedSlots: createBlockedSlotsForColumns(
      "Behandler nicht für Terminart freigegeben",
      (column) => column.isAppointmentTypeUnavailable === true,
    ),
    baseBlockedSlots,
    baseBreakSlots,
    baseDragDisabledPractitionerBlockedSlots: createBlockedSlotsForColumns(
      "Behandler nicht für Terminart freigegeben",
      (column) => column.isDragDisabled === true,
    ),
    baseManualBlockedSlots,
    baseUnavailablePractitionerBlockedSlots: createBlockedSlotsForColumns(
      "Behandler gelöscht",
      (column) => column.isUnavailable === true,
    ),
    baseVacationBlockedSlots,
  };
}

function appendSchedulingSlots(args: {
  blocked: BlockedSlotProjection[];
  skipExisting?: boolean;
  slots: readonly SchedulingSlot[] | undefined;
  timeToSlot: (time: string) => number;
  workingPractitioners: readonly WorkingPractitioner[];
}) {
  if (!args.slots) {
    return;
  }

  for (const slotData of args.slots) {
    if (slotData.status !== "BLOCKED" || !slotData.practitionerLineageKey) {
      continue;
    }

    const practitionerColumn = args.workingPractitioners.find(
      (practitioner) =>
        practitioner.lineageKey === slotData.practitionerLineageKey,
    );

    if (!practitionerColumn) {
      continue;
    }

    const startTime = Temporal.ZonedDateTime.from(
      slotData.startTime,
    ).toPlainTime();
    const slot = args.timeToSlot(startTime.toString().slice(0, 5));
    const alreadyBlocked = args.blocked.some(
      (blockedSlot) =>
        blockedSlot.column === practitionerColumn.lineageKey &&
        blockedSlot.slot === slot,
    );

    if (args.skipExisting === true && alreadyBlocked) {
      continue;
    }

    args.blocked.push({
      column: practitionerColumn.lineageKey,
      slot,
      ...(slotData.reason === undefined ? {} : { reason: slotData.reason }),
      ...(slotData.blockedByRuleId === undefined
        ? {}
        : { blockedByRuleId: slotData.blockedByRuleId }),
      ...(slotData.blockedByBlockedSlotId === undefined
        ? {}
        : {
            id: slotData.blockedByBlockedSlotId,
            isManual: true,
          }),
    });
  }
}
