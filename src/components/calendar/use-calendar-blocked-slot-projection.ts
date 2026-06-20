import { useCallback, useMemo } from "react";
import { Temporal } from "temporal-polyfill";

import type { Id } from "../../../convex/_generated/dataModel";
import type { AppointmentSeriesPlanningFailureKind } from "../../../convex/appointmentSeriesPlanner";
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

import {
  getAppointmentPractitionerLineageKey,
  getBlockedSlotPractitionerLineageKey,
} from "../../../convex/appointmentOccupancy";
import { asPractitionerLineageKey } from "../../../convex/identity";
import {
  calendarColumnScopeFromPractitioner,
  calendarColumnScopeFromResourceColumn,
  sameCalendarColumnScope,
} from "../../../lib/calendar-occupancy";
import { getPractitionerVacationRangesForDate } from "../../../lib/vacation-utils";
import {
  captureFrontendError,
  invalidStateError,
} from "../../utils/frontend-errors";
import { SLOT_DURATION } from "./types";
import { filterBlockedSlotsForDateAndLocation } from "./use-calendar-logic-helpers";

type BlockedSlotProjection =
  | CalendarManualBlockedSlot
  | RuleBlockedSlotProjection;

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

interface RuleBlockedSlotProjection {
  blockedByRuleId?: Id<"ruleConditions">;
  blocksPlacementStartOnly?: boolean;
  canOverride?: boolean;
  column: CalendarColumnId;
  isManual?: false;
  provenance?: "insufficientDuration" | AppointmentSeriesPlanningFailureKind;
  reason?: string;
  slot: number;
  title?: string;
}

interface SchedulingSlot {
  blockedByBlockedSlotId?: Id<"blockedSlots">;
  blockedByRuleId?: Id<"ruleConditions">;
  practitionerLineageKey?: PractitionerLineageKey;
  reason?: string;
  startTime: string;
  status: string;
}

interface ServerAppointmentSeriesRootPendingCandidate {
  calendarResourceColumn?: "ekg" | "labor";
  duration: number;
  practitionerLineageKey?: Id<"practitioners">;
  startTime: string;
}

interface ServerCandidateSlotDecision {
  blockingRuleIds?: Id<"ruleConditions">[];
  calendarResourceColumn?: "ekg" | "labor";
  canOverride: boolean;
  duration: number;
  practitionerLineageKey?: Id<"practitioners">;
  provenance?: "insufficientDuration" | AppointmentSeriesPlanningFailureKind;
  reason?: string;
  startTime: string;
  status: "available" | "unavailable";
}

interface UseCalendarBlockedSlotProjectionArgs {
  appointmentsData: readonly CalendarAppointmentRecord[];
  appointmentSeriesRootBlockedSlots:
    | readonly ServerCandidateSlotDecision[]
    | undefined;
  appointmentSeriesRootPendingCandidates:
    | readonly ServerAppointmentSeriesRootPendingCandidate[]
    | undefined;
  appointmentTypeSelected: boolean;
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
  appointmentSeriesRootBlockedSlots,
  appointmentSeriesRootPendingCandidates,
  appointmentTypeSelected,
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
    if (!appointmentTypeSelected) {
      appendSchedulingSlots({
        blocked,
        skipExisting: true,
        slots: blockedSlotsWithoutAppointmentTypeSlots,
        timeToSlot,
        workingPractitioners,
      });
    }

    return blocked;
  }, [
    appointmentTypeSelected,
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
            column: calendarColumnScopeFromPractitioner(
              practitionerColumn.lineageKey,
            ),
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
      const blockedSlotPractitionerLineageKey =
        getBlockedSlotPractitionerLineageKey(
          blockedSlot.placement.occupancyScope,
        );
      const resolvedPractitionerColumn =
        blockedSlotPractitionerLineageKey === undefined
          ? undefined
          : workingPractitioners.find(
              (practitioner) =>
                practitioner.lineageKey === blockedSlotPractitionerLineageKey,
            );

      if (resolvedPractitionerColumn) {
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
        if (durationMinutes <= 0) {
          captureFrontendError(
            invalidStateError(
              "Manual blocked slot has invalid duration.",
              "useCalendarBlockedSlotProjection.manualBlockedSlots",
            ),
            {
              blockedSlotId: blockedSlot._id,
              end: blockedSlot.end,
              start: blockedSlot.start,
            },
            `manualBlockedSlotInvalidDuration:${blockedSlot._id}`,
          );
          continue;
        }

        for (let slot = startSlot; slot < endSlot; slot++) {
          manual.push({
            column: calendarColumnScopeFromPractitioner(
              resolvedPractitionerColumn.lineageKey,
            ),
            duration: durationMinutes,
            id: blockedSlot._id,
            isManual: true,
            reason: blockedSlot.title,
            slot,
            startSlot,
            title: blockedSlot.title,
          });
        }
      } else if (blockedSlotPractitionerLineageKey) {
        captureFrontendError(
          invalidStateError(
            "Manual blocked slot practitioner not in visible columns.",
            "useCalendarBlockedSlotProjection.manualBlockedSlots",
          ),
          {
            blockedSlotId: blockedSlot._id,
            locationLineageKey: blockedSlot.placement.locationLineageKey,
            practitionerLineageKey: blockedSlotPractitionerLineageKey,
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
        !appointmentsData.some((appointment) => {
          const practitionerLineageKey = getAppointmentPractitionerLineageKey(
            appointment.placement.occupancyScope,
          );
          return (
            practitionerLineageKey === practitioner.lineageKey &&
            Temporal.PlainDate.compare(
              Temporal.ZonedDateTime.from(appointment.start).toPlainDate(),
              selectedDate,
            ) === 0
          );
        }) &&
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
            column: calendarColumnScopeFromPractitioner(
              practitioner.lineageKey,
            ),
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

  const projectAppointmentSeriesRootSlots = useCallback(
    (
      slots:
        | readonly (
            | ServerAppointmentSeriesRootPendingCandidate
            | ServerCandidateSlotDecision
          )[]
        | undefined,
      defaultReason: string,
    ) =>
      (slots ?? []).flatMap((blockedSlot) => {
        const column =
          blockedSlot.calendarResourceColumn === undefined
            ? blockedSlot.practitionerLineageKey === undefined
              ? null
              : calendarColumnScopeFromPractitioner(
                  asPractitionerLineageKey(blockedSlot.practitionerLineageKey),
                )
            : calendarColumnScopeFromResourceColumn(
                blockedSlot.calendarResourceColumn,
              );
        if (column === null) {
          return [];
        }

        const startTime = Temporal.ZonedDateTime.from(
          blockedSlot.startTime,
        ).toPlainTime();
        const startSlot = timeToSlot(startTime.toString().slice(0, 5));
        const slotCount = 1;

        if ("status" in blockedSlot && blockedSlot.status === "available") {
          return [];
        }

        const blockedByRuleId =
          "blockingRuleIds" in blockedSlot
            ? blockedSlot.blockingRuleIds.at(0)
            : undefined;
        const provenance =
          "provenance" in blockedSlot ? blockedSlot.provenance : undefined;
        const reason =
          "reason" in blockedSlot
            ? (blockedSlot.reason ?? defaultReason)
            : defaultReason;

        return Array.from({ length: slotCount }, (_, offset) => ({
          ...(blockedByRuleId === undefined ? {} : { blockedByRuleId }),
          blocksPlacementStartOnly: true,
          column,
          ...("canOverride" in blockedSlot
            ? { canOverride: blockedSlot.canOverride }
            : {}),
          ...(provenance === undefined ? {} : { provenance }),
          reason,
          slot: startSlot + offset,
        }));
      }),
    [timeToSlot],
  );

  const serverAppointmentSeriesRootBlockedSlots = useMemo(
    () =>
      projectAppointmentSeriesRootSlots(
        appointmentSeriesRootPendingCandidates ??
          appointmentSeriesRootBlockedSlots,
        appointmentSeriesRootPendingCandidates === undefined
          ? "Kettentermin nicht planbar"
          : "Kettentermine werden geprüft",
      ),
    [
      appointmentSeriesRootBlockedSlots,
      appointmentSeriesRootPendingCandidates,
      projectAppointmentSeriesRootSlots,
    ],
  );

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
    serverAppointmentSeriesRootBlockedSlots,
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
        sameCalendarColumnScope(
          blockedSlot.column,
          calendarColumnScopeFromPractitioner(practitionerColumn.lineageKey),
        ) && blockedSlot.slot === slot,
    );

    if (args.skipExisting === true && alreadyBlocked) {
      continue;
    }

    args.blocked.push({
      column: calendarColumnScopeFromPractitioner(
        practitionerColumn.lineageKey,
      ),
      slot,
      ...(slotData.reason === undefined ? {} : { reason: slotData.reason }),
      ...(slotData.blockedByRuleId === undefined
        ? {}
        : { blockedByRuleId: slotData.blockedByRuleId }),
    });
  }
}
