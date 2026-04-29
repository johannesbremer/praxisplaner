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
  CalendarAppointmentRecord,
  CalendarBlockedSlotRecord,
  CalendarColumnId,
} from "./types";
import type {
  BlockedSlotConversionOptions,
  SimulatedBlockedSlotConversionResult,
  SimulationConversionOptions,
} from "./use-calendar-logic-helpers";

import { findIdInList } from "../../utils/convex-ids";
import {
  captureFrontendError,
  frontendErrorFromUnknown,
  invalidStateError,
  resultFromNullable,
} from "../../utils/frontend-errors";
import { formatTime, safeParseISOToZoned } from "../../utils/time-calculations";
import { SLOT_DURATION } from "./types";
import { parsePlainTimeResult, TIMEZONE } from "./use-calendar-logic-helpers";

export interface CalendarPlanningSimulatedContext {
  appointmentTypeLineageKey?: AppointmentTypeLineageKey;
  locationLineageKey?: LocationLineageKey;
  patient: { dateOfBirth?: string; isNew: boolean };
}

export interface UseCalendarSimulationConversionArgs {
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
  runCreateAppointment: (args: {
    appointmentTypeId: Id<"appointmentTypes">;
    isNewPatient?: boolean;
    isSimulation?: boolean;
    locationId: Id<"locations">;
    patientDateOfBirth?: string;
    patientId?: Id<"patients">;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    replacesAppointmentId?: Id<"appointments">;
    start: string;
    title: string;
    userId?: Id<"users">;
  }) => Promise<Id<"appointments"> | undefined>;
  runCreateBlockedSlot: (args: {
    end: string;
    isSimulation?: boolean;
    locationId: Id<"locations">;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    replacesBlockedSlotId?: Id<"blockedSlots">;
    start: string;
    title: string;
  }) => Promise<Id<"blockedSlots"> | undefined>;
  selectedDate: Temporal.PlainDate;
  selectedLocationId: Id<"locations"> | undefined;
  simulatedContext: CalendarPlanningSimulatedContext | undefined;
}

interface CalendarRecordRef<T> {
  current: T;
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

      const practitionerId: Id<"practitioners"> | undefined =
        options.practitionerId ??
        getPractitionerIdForColumn(appointment.column) ??
        (appointmentRecord.practitionerLineageKey === undefined
          ? undefined
          : getPractitionerIdForLineageKey(
              appointmentRecord.practitionerLineageKey,
            ));

      const contextLocationId: Id<"locations"> | undefined =
        simulatedContext.locationLineageKey === undefined
          ? undefined
          : getLocationIdForLineageKey(simulatedContext.locationLineageKey);

      const locationId: Id<"locations"> | undefined =
        options.locationId ??
        contextLocationId ??
        getLocationIdForLineageKey(appointmentRecord.locationLineageKey) ??
        selectedLocationId;

      if (!locationId) {
        toast.error(
          "Standort fehlt. Bitte wählen Sie einen Standort aus oder stellen Sie sicher, dass der Termin einen Standort hat.",
        );
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

      const appointmentData: Parameters<typeof runCreateAppointment>[0] = {
        appointmentTypeId,
        isNewPatient: patientIsNewPatient ?? simulatedContext.patient.isNew,
        isSimulation: true,
        locationId,
        ...(patientDateOfBirth === undefined ? {} : { patientDateOfBirth }),
        practiceId,
        replacesAppointmentId: originalAppointmentId,
        start: startISO,
        title: appointmentRecord.title,
      };

      if (appointmentRecord.patientId !== undefined) {
        appointmentData.patientId = appointmentRecord.patientId;
      }

      if (appointmentRecord.userId !== undefined) {
        appointmentData.userId = appointmentRecord.userId;
      }

      if (practitionerId !== undefined) {
        appointmentData.practitionerId = practitionerId;
      }

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
            const durationMinutes =
              options.durationMinutes ??
              Math.max(
                SLOT_DURATION,
                Math.round(
                  startZoned.until(endZoned, { largestUnit: "minutes" })
                    .minutes,
                ),
              );
            const resolvedLocationLineageKey =
              getLocationLineageKeyForDisplayId(locationId) ??
              appointmentRecord.locationLineageKey;
            const resolvedPractitionerLineageKey =
              practitionerId === undefined
                ? appointmentRecord.practitionerLineageKey
                : (getPractitionerLineageKeyForDisplayId(practitionerId) ??
                  appointmentRecord.practitionerLineageKey);
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
            const updatedRecord: CalendarAppointmentRecord = {
              ...appointmentRecord,
              _id: newId,
              end: parsedEnd,
              isSimulation: true,
              locationLineageKey: resolvedLocationLineageKey,
              ...(appointmentRecord.patientId === undefined
                ? {}
                : { patientId: appointmentRecord.patientId }),
              ...(resolvedPractitionerLineageKey === undefined
                ? {}
                : {
                    practitionerLineageKey: resolvedPractitionerLineageKey,
                  }),
              replacesAppointmentId: originalAppointmentId,
              start: parsedStart,
              title: appointmentRecord.title,
              ...(appointmentRecord.userId === undefined
                ? {}
                : { userId: appointmentRecord.userId }),
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
          getLocationIdForLineageKey(original.locationLineageKey),
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
        options.practitionerId ??
        (original.practitionerLineageKey === undefined
          ? undefined
          : getPractitionerIdForLineageKey(original.practitionerLineageKey));
      const startISO = options.startISO ?? original.start;
      const endISO = options.endISO ?? original.end;
      const title = options.title || original.title || "Gesperrter Zeitraum";

      return await ResultAsync.fromPromise(
        runCreateBlockedSlot({
          end: endISO,
          isSimulation: true,
          locationId,
          practiceId: original.practiceId,
          replacesBlockedSlotId: original._id,
          start: startISO,
          title,
          ...(practitionerId === undefined ? {} : { practitionerId }),
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
