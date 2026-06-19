import { useCallback, useMemo } from "react";
import { Temporal } from "temporal-polyfill";

import type { Id } from "../../../convex/_generated/dataModel";
import type {
  AppointmentPlan,
  AppointmentTypeDefaultOccupancy,
} from "../../../convex/appointmentPlans";
import type {
  AppointmentTypeLineageKey,
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
import {
  calendarColumnScopeFromOccupancy,
  calendarColumnScopeFromPractitioner,
  calendarColumnScopeFromResourceColumn,
  calendarColumnScopeKey,
  sameCalendarColumnScope,
} from "../../../lib/calendar-occupancy";
import { getPractitionerVacationRangesForDate } from "../../../lib/vacation-utils";
import {
  captureFrontendError,
  invalidStateError,
} from "../../utils/frontend-errors";
import { SLOT_DURATION } from "./types";
import { filterBlockedSlotsForDateAndLocation } from "./use-calendar-logic-helpers";

interface AppointmentTypeInfo {
  appointmentPlan: AppointmentPlan;
  defaultOccupancy: AppointmentTypeDefaultOccupancy | undefined;
  duration: number;
}

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
  column: CalendarColumnId;
  isManual?: false;
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

interface UseCalendarBlockedSlotProjectionArgs {
  appointmentsData: readonly CalendarAppointmentRecord[];
  appointmentTypeInfoByLineageKey: ReadonlyMap<
    AppointmentTypeLineageKey,
    AppointmentTypeInfo
  >;
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
  placementAppointmentTypeLineageKey: AppointmentTypeLineageKey | undefined;
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
  appointmentTypeInfoByLineageKey,
  baseSchedulesData,
  blockedSlotsData,
  blockedSlotsWithoutAppointmentTypeSlots,
  businessStartHour,
  columns,
  getPractitionerIdForLineageKey,
  locationLineageKeyById,
  placementAppointmentTypeLineageKey,
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

  const baseAppointmentSeriesRootBlockedSlots = useMemo(() => {
    if (
      !placementAppointmentTypeLineageKey ||
      !slots ||
      workingPractitioners.length === 0
    ) {
      return [];
    }

    const rootAppointmentType = appointmentTypeInfoByLineageKey.get(
      placementAppointmentTypeLineageKey,
    );
    const appointmentPlan = rootAppointmentType?.appointmentPlan;
    if (!rootAppointmentType || !appointmentPlan?.steps.length) {
      return [];
    }
    if (rootAppointmentType.defaultOccupancy?.kind === "resourceColumn") {
      return [];
    }

    const occupied = new Set<string>();
    const addOccupiedSlot = (column: CalendarColumnId, slot: number) => {
      occupied.add(`${calendarColumnScopeKey(column)}:${slot}`);
    };
    const addOccupiedRange = (
      column: CalendarColumnId,
      start: string,
      end: string,
    ) => {
      const startSlot = timeToSlot(
        Temporal.ZonedDateTime.from(start).toPlainTime().toString().slice(0, 5),
      );
      const endSlot = timeToSlot(
        Temporal.ZonedDateTime.from(end).toPlainTime().toString().slice(0, 5),
      );
      for (let slot = startSlot; slot < endSlot; slot++) {
        addOccupiedSlot(column, slot);
      }
    };

    for (const blockedSlot of [
      ...baseBlockedSlots,
      ...baseBreakSlots,
      ...baseManualBlockedSlots,
      ...baseVacationBlockedSlots,
    ]) {
      addOccupiedSlot(blockedSlot.column, blockedSlot.slot);
    }

    for (const appointment of appointmentsData) {
      const column = calendarColumnScopeFromOccupancy(
        appointment.placement.occupancyScope,
      );
      if (!column) {
        continue;
      }
      addOccupiedRange(column, appointment.start, appointment.end);
    }

    const blockedRootSlots: BlockedSlotProjection[] = [];
    for (const slot of slots) {
      if (slot.status !== "AVAILABLE" || !slot.practitionerLineageKey) {
        continue;
      }

      const rootColumn = calendarColumnScopeFromPractitioner(
        slot.practitionerLineageKey,
      );
      const rootStart = Temporal.ZonedDateTime.from(slot.startTime);
      const rootEnd = rootStart.add({
        minutes: rootAppointmentType.duration,
      });
      const plannedSteps = new Map<
        string,
        {
          column: CalendarColumnId;
          durationMinutes: number;
          end: Temporal.ZonedDateTime;
          start: Temporal.ZonedDateTime;
        }
      >([
        [
          "root",
          {
            column: rootColumn,
            durationMinutes: rootAppointmentType.duration,
            end: rootEnd,
            start: rootStart,
          },
        ],
      ]);
      let previousStep = plannedSteps.get("root");
      let hasVisibleConflict = false;

      for (const step of appointmentPlan.steps) {
        if (!previousStep) {
          break;
        }

        const targetAppointmentType = appointmentTypeInfoByLineageKey.get(
          step.appointmentTypeLineageKey,
        );
        if (!targetAppointmentType) {
          break;
        }

        const stepColumn =
          step.occupancy.kind === "resourceColumn"
            ? calendarColumnScopeFromResourceColumn(
                step.occupancy.calendarResourceColumn,
              )
            : rootColumn;
        const stepStart = resolveVisibleAppointmentPlanStepStart({
          plannedSteps,
          previousStep,
          rootStart,
          timing: step.timing,
        });

        if (!stepStart) {
          previousStep = undefined;
          break;
        }

        const stepEnd = stepStart.add({
          minutes: targetAppointmentType.duration,
        });
        const plannedStep = {
          column: stepColumn,
          durationMinutes: targetAppointmentType.duration,
          end: stepEnd,
          start: stepStart,
        };
        plannedSteps.set(step.stepId, plannedStep);
        previousStep = plannedStep;

        if (
          Temporal.PlainDate.compare(stepStart.toPlainDate(), selectedDate) !==
          0
        ) {
          continue;
        }

        const startSlot = timeToSlot(
          stepStart.toPlainTime().toString().slice(0, 5),
        );
        const endSlot = timeToSlot(
          stepEnd.toPlainTime().toString().slice(0, 5),
        );
        for (let stepSlot = startSlot; stepSlot < endSlot; stepSlot++) {
          if (
            occupied.has(`${calendarColumnScopeKey(stepColumn)}:${stepSlot}`)
          ) {
            hasVisibleConflict = true;
            break;
          }
        }

        if (hasVisibleConflict) {
          break;
        }
      }

      if (!hasVisibleConflict) {
        continue;
      }

      const startTime = rootStart.toPlainTime().toString().slice(0, 5);
      blockedRootSlots.push({
        column: rootColumn,
        reason: "Kettentermin nicht planbar",
        slot: timeToSlot(startTime),
      });
    }

    return blockedRootSlots;
  }, [
    appointmentTypeInfoByLineageKey,
    appointmentsData,
    baseBlockedSlots,
    baseBreakSlots,
    baseManualBlockedSlots,
    baseVacationBlockedSlots,
    placementAppointmentTypeLineageKey,
    selectedDate,
    slots,
    timeToSlot,
    workingPractitioners,
  ]);

  return {
    baseAppointmentSeriesRootBlockedSlots,
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

function resolveVisibleAppointmentPlanStepStart(args: {
  plannedSteps: ReadonlyMap<
    string,
    { end: Temporal.ZonedDateTime; start: Temporal.ZonedDateTime }
  >;
  previousStep: { end: Temporal.ZonedDateTime };
  rootStart: Temporal.ZonedDateTime;
  timing: NonNullable<AppointmentPlan>["steps"][number]["timing"];
}): null | Temporal.ZonedDateTime {
  switch (args.timing.kind) {
    case "afterPreviousEnd": {
      if (args.timing.offsetUnit !== "minutes") {
        return null;
      }
      return args.previousStep.end.add({ minutes: args.timing.offsetValue });
    }
    case "beforeRootStart": {
      return args.rootStart.subtract({ minutes: args.timing.offsetMinutes });
    }
    case "sameStartAs": {
      return (
        args.plannedSteps.get(args.timing.anchorStepId)?.start ??
        (args.timing.anchorStepId === "root" ? args.rootStart : null)
      );
    }
  }
}
