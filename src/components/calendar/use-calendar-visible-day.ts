import { useMemo } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";

import type { Id } from "../../../convex/_generated/dataModel";
import type {
  AppointmentTypeLineageKey,
  LocationLineageKey,
  PractitionerLineageKey,
} from "../../../convex/identity";
import type {
  CalendarAppointmentRecord,
  CalendarBlockedSlotRecord,
  CalendarColumn,
  WorkingPractitioner,
} from "./types";

import { asPractitionerLineageKey } from "../../../convex/identity";
import {
  getPractitionerAvailabilityRangesForDate,
  type VacationPortion,
} from "../../../lib/vacation-utils";
import { SLOT_DURATION } from "./types";
import { collectDeletedPractitionerCalendarRanges } from "./use-calendar-logic-helpers";

interface UseCalendarVisibleDayArgs {
  appointmentsData: readonly CalendarAppointmentRecord[];
  baseSchedulesData: readonly VisibleDaySchedule[] | undefined;
  blockedSlotsData: readonly CalendarBlockedSlotRecord[];
  currentDayOfWeek: number;
  draggedAppointmentTypeLineageKey: AppointmentTypeLineageKey | undefined;
  getUnsupportedPractitionerIdsForAppointmentType: (
    appointmentTypeLineageKey: AppointmentTypeLineageKey | undefined,
    practitionerLineageKeys: PractitionerLineageKey[],
  ) => Set<PractitionerLineageKey>;
  locationLineageKeyById: ReadonlyMap<Id<"locations">, LocationLineageKey>;
  placementAppointmentTypeLineageKey: AppointmentTypeLineageKey | undefined;
  practitionerIdByLineageKey: ReadonlyMap<
    PractitionerLineageKey,
    Id<"practitioners">
  >;
  practitionerLineageKeyById: ReadonlyMap<
    Id<"practitioners">,
    PractitionerLineageKey
  >;
  practitionerNameByLineageKey: ReadonlyMap<PractitionerLineageKey, string>;
  practitionersData: readonly VisibleDayPractitioner[] | undefined;
  selectedDate: Temporal.PlainDate;
  selectedLocationId: Id<"locations"> | undefined;
  simulatedContext:
    | undefined
    | {
        locationLineageKey?: LocationLineageKey;
      };
  timeToMinutes: (timeStr: string) => null | number;
  vacationsData: readonly VisibleDayVacation[] | undefined;
}

interface VisibleDayPractitioner {
  _id: Id<"practitioners">;
  deleted?: boolean;
  lineageKey?: Id<"practitioners">;
  name: string;
}

interface VisibleDaySchedule {
  dayOfWeek: number;
  endTime: string;
  locationLineageKey: LocationLineageKey;
  practitionerId: Id<"practitioners">;
  practitionerLineageKey: Id<"practitioners">;
  startTime: string;
}

interface VisibleDayVacation {
  date: string;
  portion: VacationPortion;
  practitionerLineageKey?: Id<"practitioners">;
  staffType: "mfa" | "practitioner";
}

export function useCalendarVisibleDay({
  appointmentsData,
  baseSchedulesData,
  blockedSlotsData,
  currentDayOfWeek,
  draggedAppointmentTypeLineageKey,
  getUnsupportedPractitionerIdsForAppointmentType,
  locationLineageKeyById,
  placementAppointmentTypeLineageKey,
  practitionerIdByLineageKey,
  practitionerLineageKeyById,
  practitionerNameByLineageKey,
  practitionersData,
  selectedDate,
  selectedLocationId,
  simulatedContext,
  timeToMinutes,
  vacationsData,
}: UseCalendarVisibleDayArgs): {
  businessEndHour: number;
  businessStartHour: number;
  columns: CalendarColumn[];
  totalSlots: number;
  workingPractitioners: WorkingPractitioner[];
} {
  return useMemo(() => {
    if (!practitionersData || !baseSchedulesData) {
      return emptyVisibleDay();
    }

    const practitionerNameByDisplayId = new Map(
      practitionersData.map((practitioner) => [
        practitioner._id,
        practitioner.name,
      ]),
    );

    let daySchedules = baseSchedulesData.filter(
      (schedule) => schedule.dayOfWeek === currentDayOfWeek,
    );
    const effectiveLocationLineageKey =
      simulatedContext?.locationLineageKey ??
      (selectedLocationId === undefined
        ? undefined
        : locationLineageKeyById.get(selectedLocationId));

    if (effectiveLocationLineageKey) {
      daySchedules = daySchedules.filter(
        (schedule) =>
          schedule.locationLineageKey === effectiveLocationLineageKey,
      );
    }

    const appointmentsForSelectedDate = appointmentsData.filter(
      (appointment) => {
        if (!appointment.practitionerLineageKey) {
          return false;
        }

        if (
          Temporal.PlainDate.compare(
            Temporal.ZonedDateTime.from(appointment.start).toPlainDate(),
            selectedDate,
          ) !== 0
        ) {
          return false;
        }

        return (
          effectiveLocationLineageKey === undefined ||
          appointment.locationLineageKey === effectiveLocationLineageKey
        );
      },
    );
    const deletedPractitionerIds = new Set(
      practitionersData
        .filter((practitioner) => practitioner.deleted === true)
        .flatMap((practitioner) =>
          practitioner.lineageKey === undefined
            ? []
            : [asPractitionerLineageKey(practitioner.lineageKey)],
        ),
    );
    const deletedPractitionerCalendarRanges =
      collectDeletedPractitionerCalendarRanges({
        appointments: [...appointmentsData],
        blockedSlots: blockedSlotsData,
        deletedPractitionerLineageKeys: deletedPractitionerIds,
        effectiveLocationLineageKey,
        selectedDate,
      });
    const deletedPractitionerIdsWithCalendarItems = new Set(
      deletedPractitionerCalendarRanges.map(
        (range) => range.practitionerLineageKey,
      ),
    );

    if (
      daySchedules.length === 0 &&
      deletedPractitionerIdsWithCalendarItems.size === 0
    ) {
      return emptyVisibleDay();
    }

    let validSchedules = daySchedules.filter((schedule) => {
      const startMinutes = timeToMinutes(schedule.startTime);
      const endMinutes = timeToMinutes(schedule.endTime);

      if (startMinutes === null || endMinutes === null) {
        const practitionerName =
          practitionerNameByDisplayId.get(schedule.practitionerId) ??
          "Unbekannt";
        toast.error(
          `Ungültige Zeitangabe für ${practitionerName}: ${schedule.startTime}-${schedule.endTime}`,
        );
        return false;
      }
      return true;
    });

    const mutedPractitionerIds = new Set<PractitionerLineageKey>();

    if (vacationsData) {
      const practitionersWithAppointments = new Set(
        appointmentsForSelectedDate
          .map((appointment) => appointment.practitionerLineageKey)
          .filter((lineageKey) => lineageKey !== undefined),
      );

      const hiddenPractitionerIds = new Set(
        vacationsData
          .filter(
            (vacation) =>
              vacation.staffType === "practitioner" &&
              vacation.date === selectedDate.toString() &&
              vacation.portion === "full" &&
              vacation.practitionerLineageKey &&
              !practitionersWithAppointments.has(
                asPractitionerLineageKey(vacation.practitionerLineageKey),
              ),
          )
          .flatMap((vacation) => {
            if (!vacation.practitionerLineageKey) {
              return [];
            }
            return [asPractitionerLineageKey(vacation.practitionerLineageKey)];
          }),
      );

      for (const vacation of vacationsData) {
        if (
          vacation.staffType === "practitioner" &&
          vacation.date === selectedDate.toString() &&
          vacation.portion === "full" &&
          vacation.practitionerLineageKey &&
          practitionersWithAppointments.has(
            asPractitionerLineageKey(vacation.practitionerLineageKey),
          )
        ) {
          mutedPractitionerIds.add(
            asPractitionerLineageKey(vacation.practitionerLineageKey),
          );
        }
      }

      if (hiddenPractitionerIds.size > 0) {
        validSchedules = validSchedules.filter((schedule) => {
          const lineageKey = practitionerLineageKeyById.get(
            schedule.practitionerId,
          );
          return (
            lineageKey === undefined || !hiddenPractitionerIds.has(lineageKey)
          );
        });
      }
    }

    if (validSchedules.length < daySchedules.length) {
      const invalidCount = daySchedules.length - validSchedules.length;
      toast.warning(
        `${invalidCount} Zeitplan${invalidCount > 1 ? "e" : ""} mit ungültigen Zeiten wurde${invalidCount > 1 ? "n" : ""} übersprungen`,
      );
    }

    const working: WorkingPractitioner[] = validSchedules.flatMap(
      (schedule) => {
        const lineageKey = practitionerLineageKeyById.get(
          schedule.practitionerId,
        );
        if (!lineageKey) {
          return [];
        }

        return [
          {
            endTime: schedule.endTime,
            lineageKey,
            name:
              practitionerNameByLineageKey.get(lineageKey) ??
              practitionerNameByDisplayId.get(schedule.practitionerId) ??
              "Unbekannt",
            startTime: schedule.startTime,
          },
        ];
      },
    );
    const workingPractitionerIds = new Set(
      working.map((practitioner) => practitioner.lineageKey),
    );

    for (const {
      endMinutes,
      practitionerLineageKey,
      startMinutes,
    } of deletedPractitionerCalendarRanges) {
      const brandedPractitionerLineageKey = asPractitionerLineageKey(
        practitionerLineageKey,
      );
      mutedPractitionerIds.add(brandedPractitionerLineageKey);
      if (workingPractitionerIds.has(brandedPractitionerLineageKey)) {
        continue;
      }

      if (!practitionerIdByLineageKey.get(brandedPractitionerLineageKey)) {
        continue;
      }

      working.push({
        endTime: formatMinutesAsTime(endMinutes),
        lineageKey: brandedPractitionerLineageKey,
        name:
          practitionerNameByLineageKey.get(brandedPractitionerLineageKey) ??
          "Unbekannt",
        startTime: formatMinutesAsTime(startMinutes),
      });
      workingPractitionerIds.add(brandedPractitionerLineageKey);
    }

    const effectiveWorkingRanges = working.flatMap((practitioner) => {
      return getPractitionerAvailabilityRangesForDate(
        selectedDate,
        practitioner.lineageKey,
        [...baseSchedulesData],
        [...(vacationsData ?? [])],
        effectiveLocationLineageKey,
      );
    });
    const practitionerIds = new Set(
      working.map((practitioner) => practitioner.lineageKey),
    );
    const appointmentRanges = appointmentsForSelectedDate.flatMap(
      (appointment) => {
        if (
          appointment.practitionerLineageKey === undefined ||
          !practitionerIds.has(appointment.practitionerLineageKey)
        ) {
          return [];
        }

        const start = Temporal.ZonedDateTime.from(appointment.start);
        const end = Temporal.ZonedDateTime.from(appointment.end);

        return [
          {
            endMinutes: end.hour * 60 + end.minute,
            startMinutes: start.hour * 60 + start.minute,
          },
        ];
      },
    );
    const deletedPractitionerCalendarItemRanges =
      deletedPractitionerCalendarRanges.map(({ endMinutes, startMinutes }) => ({
        endMinutes,
        startMinutes,
      }));
    const visibleRanges = [
      ...effectiveWorkingRanges,
      ...appointmentRanges,
      ...deletedPractitionerCalendarItemRanges,
    ];

    const startTimes = visibleRanges.map((range) => range.startMinutes);
    const endTimes = visibleRanges.map((range) => range.endMinutes);

    if (startTimes.length === 0 || endTimes.length === 0) {
      return emptyVisibleDay();
    }

    const earliestStartMinutes = Math.min(...startTimes);
    const latestEndMinutes = Math.max(...endTimes);
    const businessStartHour = Math.floor(earliestStartMinutes / 60);
    const businessEndHour = Math.ceil(latestEndMinutes / 60);
    const totalSlots =
      ((businessEndHour - businessStartHour) * 60) / SLOT_DURATION;

    const workingPractitionerIdList = working.map(
      (practitioner) => practitioner.lineageKey,
    );
    const placementUnsupportedPractitionerIds =
      getUnsupportedPractitionerIdsForAppointmentType(
        placementAppointmentTypeLineageKey,
        workingPractitionerIdList,
      );
    const dragUnsupportedPractitionerIds =
      getUnsupportedPractitionerIdsForAppointmentType(
        draggedAppointmentTypeLineageKey,
        workingPractitionerIdList,
      );

    const practitionerColumns: CalendarColumn[] = working.map(
      (practitioner) => ({
        id: practitioner.lineageKey,
        isAppointmentTypeUnavailable: placementUnsupportedPractitionerIds.has(
          practitioner.lineageKey,
        ),
        isDragDisabled: dragUnsupportedPractitionerIds.has(
          practitioner.lineageKey,
        ),
        isMuted:
          mutedPractitionerIds.has(practitioner.lineageKey) ||
          placementUnsupportedPractitionerIds.has(practitioner.lineageKey) ||
          dragUnsupportedPractitionerIds.has(practitioner.lineageKey),
        isUnavailable: deletedPractitionerIdsWithCalendarItems.has(
          practitioner.lineageKey,
        ),
        title: practitioner.name,
      }),
    );

    const specialColumns: CalendarColumn[] =
      working.length > 0
        ? [
            {
              id: "ekg",
              isMuted: false,
              isUnavailable: false,
              title: "EKG",
            },
            {
              id: "labor",
              isMuted: false,
              isUnavailable: false,
              title: "Labor",
            },
          ]
        : [];

    return {
      businessEndHour,
      businessStartHour,
      columns: [...practitionerColumns, ...specialColumns],
      totalSlots,
      workingPractitioners: working,
    };
  }, [
    appointmentsData,
    baseSchedulesData,
    blockedSlotsData,
    currentDayOfWeek,
    draggedAppointmentTypeLineageKey,
    getUnsupportedPractitionerIdsForAppointmentType,
    locationLineageKeyById,
    placementAppointmentTypeLineageKey,
    practitionerIdByLineageKey,
    practitionerLineageKeyById,
    practitionerNameByLineageKey,
    practitionersData,
    selectedDate,
    selectedLocationId,
    simulatedContext,
    timeToMinutes,
    vacationsData,
  ]);
}

function emptyVisibleDay() {
  return {
    businessEndHour: 0,
    businessStartHour: 0,
    columns: [],
    totalSlots: 0,
    workingPractitioners: [],
  };
}

function formatMinutesAsTime(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
