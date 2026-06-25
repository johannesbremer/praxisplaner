import { ResultAsync } from "neverthrow";
import { useCallback } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";

import type { Id } from "../../../convex/_generated/dataModel";
import type {
  AppointmentTypeLineageKey,
  LocationLineageKey,
  PractitionerLineageKey,
} from "../../../convex/identity";
import type { ZonedDateTimeString } from "../../../convex/typedDtos";
import type {
  CalendarAppointmentLayout,
  CalendarAppointmentPlacement,
  CalendarAppointmentRecord,
  CalendarBlockedSlotRecord,
  CalendarColumnId,
} from "./types";
import type {
  BlockedSlotConversionOptions,
  SimulatedBlockedSlotConversionResult,
  SimulationConversionOptions,
} from "./use-calendar-logic-helpers";
import type { CalendarAppointmentCreateCommandArgs } from "./use-calendar-planning-workbench";

import {
  createCalendarPlacement,
  getCalendarResourceColumnFromColumn,
  getCalendarResourceColumnFromOccupancy,
  getPractitionerLineageKeyFromOccupancy,
} from "../../../lib/calendar-occupancy";
import { findIdInList } from "../../utils/convex-ids";
import {
  captureFrontendError,
  frontendErrorFromUnknown,
  invalidStateError,
  resultFromNullable,
} from "../../utils/frontend-errors";
import { formatTime, safeParseISOToZoned } from "../../utils/time-calculations";
import { getAppointmentOwnerRefs } from "./appointment-owner-refs";
import { parsePlainTimeResult, TIMEZONE } from "./use-calendar-logic-helpers";

interface CalendarRecordRef<T> {
  current: T;
}

interface SimulatedContext {
  appointmentTypeLineageKey?: AppointmentTypeLineageKey;
  locationLineageKey?: LocationLineageKey;
  patient: { dateOfBirth?: string; isNew: boolean };
}

interface UseCalendarSimulationConversionArgs {
  blockedSlotDocMapRef: CalendarRecordRef<
    ReadonlyMap<Id<"blockedSlots">, CalendarBlockedSlotRecord>
  >;
  getAppointmentTypeIdForLineageKey: (
    appointmentTypeLineageKey: AppointmentTypeLineageKey,
  ) => Id<"appointmentTypes"> | undefined;
  getLocationIdForLineageKey: (
    locationLineageKey: LocationLineageKey,
  ) => Id<"locations"> | undefined;
  getLocationLineageKeyForDisplayId: (
    locationId: Id<"locations">,
  ) => LocationLineageKey | undefined;
  getPractitionerIdForColumn: (
    column: CalendarColumnId,
  ) => Id<"practitioners"> | undefined;
  getPractitionerIdForLineageKey: (
    practitionerLineageKey: PractitionerLineageKey,
  ) => Id<"practitioners"> | undefined;
  getPractitionerLineageKeyForDisplayId: (
    practitionerId: Id<"practitioners">,
  ) => PractitionerLineageKey | undefined;
  parseZonedDateTime: (
    value: string,
    source: string,
  ) => null | ZonedDateTimeString;
  patientDateOfBirth: string | undefined;
  patientIsNewPatient: boolean | undefined;
  practiceId: Id<"practices">;
  runCreateAppointment: (
    args: CalendarAppointmentCreateCommandArgs,
  ) => Promise<Id<"appointments"> | undefined>;
  runCreateBlockedSlot: (args: {
    end: string;
    isSimulation?: boolean;
    locationId: Id<"locations">;
    occupancyScope:
      | { calendarResourceColumn: "ekg" | "labor"; kind: "resource" }
      | { kind: "location-wide" }
      | { kind: "practitioner"; practitionerId: Id<"practitioners"> };
    practiceId: Id<"practices">;
    replacesBlockedSlotId?: Id<"blockedSlots">;
    start: string;
    title: string;
  }) => Promise<Id<"blockedSlots"> | undefined>;
  selectedDate: Temporal.PlainDate;
  selectedLocationId: Id<"locations"> | undefined;
  simulatedContext: SimulatedContext | undefined;
}

export function useCalendarSimulationConversion({
  blockedSlotDocMapRef,
  getAppointmentTypeIdForLineageKey,
  getLocationIdForLineageKey,
  getLocationLineageKeyForDisplayId,
  getPractitionerIdForColumn,
  getPractitionerIdForLineageKey,
  getPractitionerLineageKeyForDisplayId,
  parseZonedDateTime,
  patientDateOfBirth,
  patientIsNewPatient,
  practiceId,
  runCreateAppointment,
  runCreateBlockedSlot,
  selectedDate,
  selectedLocationId,
  simulatedContext,
}: UseCalendarSimulationConversionArgs) {
  const convertRealAppointmentToSimulation = useCallback(
    async (
      appointment: CalendarAppointmentLayout,
      options: SimulationConversionOptions,
    ): Promise<CalendarAppointmentLayout | null> => {
      const appointmentRecord = appointment.record;

      if (appointmentRecord.isSimulation === true) {
        return appointment;
      }

      const originalAppointmentId = appointmentRecord._id;

      if (!simulatedContext) {
        toast.error(
          "Simulation ist nicht aktiv. Termin kann nicht kopiert werden.",
        );
        return appointment;
      }

      const startZoned =
        options.startISO === undefined
          ? parsePlainTimeResult(
              appointment.startTime,
              "convertRealAppointmentToSimulation.startTime",
            ).match(
              (plainTime) =>
                selectedDate.toZonedDateTime({
                  plainTime,
                  timeZone: TIMEZONE,
                }),
              (error) => {
                captureFrontendError(error, {
                  context: "Failed to parse start time",
                  startISO: options.startISO,
                  startTime: appointment.startTime,
                });
                toast.error("Startzeit konnte nicht ermittelt werden");
                return null;
              },
            )
          : resultFromNullable(
              safeParseISOToZoned(options.startISO),
              invalidStateError(
                `Invalid start ISO string: ${options.startISO}`,
                "convertRealAppointmentToSimulation.startISO",
              ),
            ).match(
              (parsedStart) => parsedStart,
              (error) => {
                captureFrontendError(error, {
                  context: "Failed to parse start time",
                  startISO: options.startISO,
                  startTime: appointment.startTime,
                });
                toast.error("Startzeit konnte nicht ermittelt werden");
                return null;
              },
            );
      if (!startZoned) {
        return null;
      }

      const startISO = options.startISO ?? startZoned.toString();

      const endZoned =
        options.endISO === undefined
          ? startZoned.add({ minutes: appointment.duration })
          : resultFromNullable(
              safeParseISOToZoned(options.endISO),
              invalidStateError(
                `Invalid end ISO string: ${options.endISO}`,
                "convertRealAppointmentToSimulation.endISO",
              ),
            ).match(
              (parsedEnd) => parsedEnd,
              (error) => {
                captureFrontendError(error, {
                  context: "Failed to parse end time",
                  duration: appointment.duration,
                  endISO: options.endISO,
                });
                toast.error("Endzeit konnte nicht ermittelt werden");
                return null;
              },
            );
      if (!endZoned) {
        return null;
      }

      const currentPractitionerLineageKey =
        getPractitionerLineageKeyFromOccupancy(
          appointmentRecord.placement.occupancyScope,
        );
      const targetColumn = options.columnOverride ?? appointment.column;
      const explicitCalendarResourceColumn = options.calendarResourceColumn;
      const targetResourceColumn =
        explicitCalendarResourceColumn === undefined
          ? getCalendarResourceColumnFromColumn(targetColumn)
          : (explicitCalendarResourceColumn ?? undefined);
      const practitionerId: Id<"practitioners"> | undefined =
        targetResourceColumn === undefined
          ? (options.practitionerId ??
            getPractitionerIdForColumn(targetColumn) ??
            (currentPractitionerLineageKey === undefined
              ? undefined
              : getPractitionerIdForLineageKey(currentPractitionerLineageKey)))
          : undefined;
      const calendarResourceColumn =
        targetResourceColumn ??
        (practitionerId === undefined
          ? getCalendarResourceColumnFromOccupancy(
              appointmentRecord.placement.occupancyScope,
            )
          : undefined);

      const contextLocationId: Id<"locations"> | undefined =
        simulatedContext.locationLineageKey === undefined
          ? undefined
          : getLocationIdForLineageKey(simulatedContext.locationLineageKey);

      const locationId: Id<"locations"> | undefined =
        options.locationId ??
        contextLocationId ??
        getLocationIdForLineageKey(
          appointmentRecord.placement.locationLineageKey,
        ) ??
        selectedLocationId;

      if (!locationId) {
        toast.error(
          "Standort fehlt. Bitte wählen Sie einen Standort aus oder stellen Sie sicher, dass der Termin einen Standort hat.",
        );
        return null;
      }
      const locationLineageKey = getLocationLineageKeyForDisplayId(locationId);
      if (locationLineageKey === undefined) {
        toast.error("Standort konnte nicht aufgelöst werden.");
        return null;
      }

      const appointmentTypeId = resultFromNullable(
        getAppointmentTypeIdForLineageKey(
          appointmentRecord.appointmentTypeLineageKey,
        ),
        invalidStateError(
          "Terminart fehlt",
          "convertRealAppointmentToSimulation.appointmentTypeId",
        ),
      ).match(
        (appointmentTypeIdValue) => appointmentTypeIdValue,
        (error) => {
          toast.error(error.message);
          return null;
        },
      );
      if (!appointmentTypeId) {
        return null;
      }
      const placementOccupancyScope =
        calendarResourceColumn === undefined
          ? practitionerId === undefined
            ? null
            : (() => {
                const practitionerLineageKey =
                  getPractitionerLineageKeyForDisplayId(practitionerId);
                return practitionerLineageKey === undefined
                  ? null
                  : {
                      kind: "practitioner" as const,
                      practitionerLineageKey,
                    };
              })()
          : {
              calendarResourceColumn,
              kind: "resource" as const,
            };
      if (placementOccupancyScope === null) {
        toast.error("Behandler konnte nicht aufgelöst werden.");
        return null;
      }

      const appointmentData: Parameters<typeof runCreateAppointment>[0] = {
        appointmentTypeId,
        ...getAppointmentOwnerRefs(appointmentRecord),
        end: endZoned.toString(),
        isNewPatient: patientIsNewPatient ?? simulatedContext.patient.isNew,
        isSimulation: true,
        ...(patientDateOfBirth === undefined ? {} : { patientDateOfBirth }),
        placement: createCalendarPlacement({
          locationLineageKey,
          occupancyScope: placementOccupancyScope,
        }),
        practiceId,
        replacesAppointmentId: originalAppointmentId,
        start: startISO,
        title: appointmentRecord.title,
      };

      return await ResultAsync.fromPromise(
        runCreateAppointment(appointmentData),
        (error) =>
          frontendErrorFromUnknown(error, {
            kind: "unknown",
            message: "Simulierter Termin konnte nicht erstellt werden.",
            source: "convertRealAppointmentToSimulation.createAppointment",
          }),
      )
        .andThen((newId) =>
          resultFromNullable(
            newId,
            invalidStateError(
              "Simulierter Termin konnte nicht erstellt werden.",
              "convertRealAppointmentToSimulation.createAppointmentResult",
            ),
          ),
        )
        .match(
          (newId) => {
            const durationMinutes = getDurationMinutesFromRange({
              end: endZoned,
              start: startZoned,
            });
            if (durationMinutes === null) {
              toast.error("Termindauer konnte nicht ermittelt werden.");
              return null;
            }
            const resolvedLocationLineageKey =
              getLocationLineageKeyForDisplayId(locationId) ??
              appointmentRecord.placement.locationLineageKey;
            const resolvedPractitionerLineageKey =
              practitionerId === undefined
                ? currentPractitionerLineageKey
                : (getPractitionerLineageKeyForDisplayId(practitionerId) ??
                  currentPractitionerLineageKey);
            const parsedStart = parseZonedDateTime(
              startISO,
              "convertRealAppointmentToSimulation.updatedRecord.start",
            );
            const parsedEnd = parseZonedDateTime(
              endZoned.toString(),
              "convertRealAppointmentToSimulation.updatedRecord.end",
            );
            if (!parsedStart || !parsedEnd) {
              return null;
            }
            if (
              calendarResourceColumn === undefined &&
              resolvedPractitionerLineageKey === undefined &&
              currentPractitionerLineageKey === undefined
            ) {
              toast.error(
                "Belegung des simulierten Termins konnte nicht ermittelt werden.",
              );
              return null;
            }
            const updatedPractitionerLineageKey =
              resolvedPractitionerLineageKey ?? currentPractitionerLineageKey;
            let updatedPlacement: CalendarAppointmentPlacement;
            if (calendarResourceColumn === undefined) {
              if (updatedPractitionerLineageKey === undefined) {
                toast.error(
                  "Belegung des simulierten Termins konnte nicht ermittelt werden.",
                );
                return null;
              }
              updatedPlacement = createCalendarPlacement({
                locationLineageKey: resolvedLocationLineageKey,
                occupancyScope: {
                  kind: "practitioner",
                  practitionerLineageKey: updatedPractitionerLineageKey,
                },
              });
            } else {
              updatedPlacement = createCalendarPlacement({
                locationLineageKey: resolvedLocationLineageKey,
                occupancyScope: {
                  calendarResourceColumn,
                  kind: "resource",
                },
              });
            }
            const updatedRecord: CalendarAppointmentRecord = {
              ...appointmentRecord,
              _id: newId,
              end: parsedEnd,
              isSimulation: true,
              placement: updatedPlacement,
              replacesAppointmentId: originalAppointmentId,
              start: parsedStart,
              title: appointmentRecord.title,
            };

            return {
              column: options.columnOverride ?? appointment.column,
              duration: durationMinutes,
              id: newId,
              record: updatedRecord,
              startTime: formatTime(startZoned.toPlainTime()),
            };
          },
          (error) => {
            captureFrontendError(error, {
              appointmentId: appointmentRecord._id,
              context: "NewCalendar - Failed to create simulated replacement",
              hasSimulatedContext: Boolean(simulatedContext),
              locationId,
              options,
              practitionerId,
            });
            toast.error(
              `Simulierter Termin konnte nicht erstellt werden: ${error.message}`,
            );
            return null;
          },
        );
    },
    [
      getAppointmentTypeIdForLineageKey,
      getLocationIdForLineageKey,
      getLocationLineageKeyForDisplayId,
      getPractitionerIdForColumn,
      getPractitionerIdForLineageKey,
      getPractitionerLineageKeyForDisplayId,
      patientDateOfBirth,
      patientIsNewPatient,
      parseZonedDateTime,
      practiceId,
      runCreateAppointment,
      selectedDate,
      selectedLocationId,
      simulatedContext,
    ],
  );

  const convertRealBlockedSlotToSimulation = useCallback(
    async (
      blockedSlotId: string,
      options: BlockedSlotConversionOptions,
    ): Promise<null | SimulatedBlockedSlotConversionResult> => {
      if (!simulatedContext) {
        return null;
      }

      const resolvedBlockedSlotId = findIdInList(
        [...blockedSlotDocMapRef.current.keys()],
        blockedSlotId,
      );
      const original = resultFromNullable(
        resolvedBlockedSlotId === undefined
          ? undefined
          : blockedSlotDocMapRef.current.get(resolvedBlockedSlotId),
        invalidStateError(
          "Gesperrter Zeitraum wurde nicht gefunden.",
          "convertRealBlockedSlotToSimulation.original",
        ),
      ).match(
        (originalBlockedSlot) => originalBlockedSlot,
        (error) => {
          toast.error(error.message);
          return null;
        },
      );
      if (!original) {
        return null;
      }

      if (original.isSimulation) {
        return {
          id: original._id,
          startISO: original.start,
        };
      }

      const locationId = resultFromNullable(
        options.locationId ??
          getLocationIdForLineageKey(original.placement.locationLineageKey),
        invalidStateError(
          "Standort für den gesperrten Zeitraum fehlt.",
          "convertRealBlockedSlotToSimulation.locationId",
        ),
      ).match(
        (resolvedLocationId) => resolvedLocationId,
        (error) => {
          toast.error(error.message);
          return null;
        },
      );
      if (!locationId) {
        return null;
      }

      const practitionerId =
        options.calendarResourceColumn === undefined
          ? (options.practitionerId ??
            (original.placement.occupancyScope.kind === "practitioner"
              ? getPractitionerIdForLineageKey(
                  original.placement.occupancyScope.practitionerLineageKey,
                )
              : undefined))
          : undefined;
      const calendarResourceColumn =
        options.calendarResourceColumn ??
        (practitionerId === undefined &&
        original.placement.occupancyScope.kind === "resource"
          ? original.placement.occupancyScope.calendarResourceColumn
          : undefined);
      const occupancyScope =
        calendarResourceColumn === undefined
          ? practitionerId === undefined
            ? { kind: "location-wide" as const }
            : { kind: "practitioner" as const, practitionerId }
          : {
              calendarResourceColumn,
              kind: "resource" as const,
            };
      const startISO = options.startISO ?? original.start;
      const endISO = options.endISO ?? original.end;
      const title = options.title || original.title || "Gesperrter Zeitraum";

      return await ResultAsync.fromPromise(
        runCreateBlockedSlot({
          end: endISO,
          isSimulation: true,
          locationId,
          occupancyScope,
          practiceId: original.practiceId,
          replacesBlockedSlotId: original._id,
          start: startISO,
          title,
        }),
        (error) =>
          frontendErrorFromUnknown(error, {
            kind: "unknown",
            message:
              "Simulierter gesperrter Zeitraum konnte nicht erstellt werden.",
            source: "convertRealBlockedSlotToSimulation.createBlockedSlot",
          }),
      )
        .andThen((newId) =>
          resultFromNullable(
            newId,
            invalidStateError(
              "Simulierter gesperrter Zeitraum konnte nicht erstellt werden.",
              "convertRealBlockedSlotToSimulation.createBlockedSlotResult",
            ),
          ),
        )
        .match(
          (newId) => ({
            id: newId,
            startISO,
          }),
          (error) => {
            captureFrontendError(error, {
              blockedSlotId,
              context: "NewCalendar - Failed to convert blocked slot",
            });
            toast.error(error.message);
            return null;
          },
        );
    },
    [
      blockedSlotDocMapRef,
      getLocationIdForLineageKey,
      getPractitionerIdForLineageKey,
      runCreateBlockedSlot,
      simulatedContext,
    ],
  );

  return {
    convertRealAppointmentToSimulation,
    convertRealBlockedSlotToSimulation,
  };
}

function getDurationMinutesFromRange(args: {
  end: Temporal.ZonedDateTime;
  start: Temporal.ZonedDateTime;
}): null | number {
  const durationMinutes = Math.round(
    args.start.until(args.end, { largestUnit: "minutes" }).minutes,
  );

  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    return null;
  }

  return durationMinutes;
}
