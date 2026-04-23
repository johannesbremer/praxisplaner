import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Temporal } from "temporal-polyfill";

import type { Doc, Id } from "../../../convex/_generated/dataModel";
import type { AppointmentResult } from "../../../convex/appointments";
import type { PatientInfo } from "../../types";

import { api } from "../../../convex/_generated/api";
import { createSimulatedContext } from "../../../lib/utils";
import {
  captureFrontendError,
  invalidStateError,
} from "../../utils/frontend-errors";
import { buildCalendarDayQueryArgs } from "./calendar-query-args";
import { buildCalendarAppointments } from "./calendar-view-models";

export function useCalendarData(args: {
  patient: PatientInfo | undefined;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets"> | undefined;
  selectedAppointmentTypeId: Id<"appointmentTypes"> | undefined;
  selectedDate: Temporal.PlainDate;
  selectedLocationId: Id<"locations"> | undefined;
  simulatedContext:
    | undefined
    | {
        appointmentTypeId?: Id<"appointmentTypes">;
        locationId?: Id<"locations">;
        patient: { dateOfBirth?: string; isNew: boolean };
      };
}) {
  const activeRuleSetData = useQuery(
    api.ruleSets.getActiveRuleSet,
    args.practiceId ? { practiceId: args.practiceId } : "skip",
  );
  const appointmentScope = args.simulatedContext ? "simulation" : "real";
  const activeRuleSetId = activeRuleSetData?._id;
  const effectiveLocationId =
    args.simulatedContext?.locationId ?? args.selectedLocationId;
  const calendarDayQueryArgs = useMemo(
    () =>
      buildCalendarDayQueryArgs({
        activeRuleSetId,
        locationId: effectiveLocationId,
        practiceId: args.practiceId,
        ruleSetId: args.ruleSetId,
        scope: appointmentScope,
        selectedDate: args.selectedDate,
      }),
    [
      activeRuleSetId,
      appointmentScope,
      args.practiceId,
      args.ruleSetId,
      args.selectedDate,
      effectiveLocationId,
    ],
  );

  const appointmentsData = useQuery(
    api.appointments.getCalendarDayAppointments,
    calendarDayQueryArgs ?? "skip",
  );
  const blockedSlotsData = useQuery(
    api.appointments.getCalendarDayBlockedSlots,
    calendarDayQueryArgs ?? "skip",
  );
  const vacationsData = useQuery(
    api.vacations.getVacationsInRange,
    args.practiceId && args.ruleSetId
      ? {
          endDateExclusive: args.selectedDate.add({ days: 1 }).toString(),
          ruleSetId: args.ruleSetId,
          startDate: args.selectedDate.toString(),
        }
      : "skip",
  );

  const appointmentDocMap = useMemo(() => {
    const map = new Map<Id<"appointments">, AppointmentResult>();
    for (const appointment of appointmentsData ?? []) {
      map.set(appointment._id, appointment);
    }
    return map;
  }, [appointmentsData]);
  const appointmentDocMapRef = useRef(appointmentDocMap);
  useEffect(() => {
    appointmentDocMapRef.current = appointmentDocMap;
  }, [appointmentDocMap]);

  const blockedSlotDocMap = useMemo(() => {
    const map = new Map<string, Doc<"blockedSlots">>();
    for (const blockedSlot of blockedSlotsData ?? []) {
      map.set(blockedSlot._id, blockedSlot);
    }
    return map;
  }, [blockedSlotsData]);
  const blockedSlotDocMapRef = useRef(blockedSlotDocMap);
  useEffect(() => {
    blockedSlotDocMapRef.current = blockedSlotDocMap;
  }, [blockedSlotDocMap]);

  const practitionersData = useQuery(
    args.ruleSetId
      ? api.entities.getPractitioners
      : api.entities.getPractitionersFromActive,
    args.ruleSetId
      ? { includeDeleted: true, ruleSetId: args.ruleSetId }
      : args.practiceId
        ? { practiceId: args.practiceId }
        : "skip",
  );
  const baseSchedulesData = useQuery(
    args.ruleSetId
      ? api.entities.getBaseSchedules
      : api.entities.getBaseSchedulesFromActive,
    args.ruleSetId
      ? { ruleSetId: args.ruleSetId }
      : args.practiceId
        ? { practiceId: args.practiceId }
        : "skip",
  );
  const locationsData = useQuery(
    args.ruleSetId
      ? api.entities.getLocations
      : api.entities.getLocationsFromActive,
    args.ruleSetId
      ? { includeDeleted: true, ruleSetId: args.ruleSetId }
      : args.practiceId
        ? { practiceId: args.practiceId }
        : "skip",
  );
  const appointmentTypesData = useQuery(
    args.ruleSetId
      ? api.entities.getAppointmentTypes
      : api.entities.getAppointmentTypesFromActive,
    args.ruleSetId
      ? { includeDeleted: true, ruleSetId: args.ruleSetId }
      : args.practiceId
        ? { practiceId: args.practiceId }
        : "skip",
  );

  const appointmentTypeMap = useMemo(() => {
    const map = new Map<
      Id<"appointmentTypes">,
      {
        allowedPractitionerIds: Id<"practitioners">[];
        duration: number;
        hasFollowUpPlan: boolean;
        name: string;
      }
    >();
    for (const appointmentType of appointmentTypesData ?? []) {
      map.set(appointmentType._id, {
        allowedPractitionerIds: appointmentType.allowedPractitionerIds,
        duration: appointmentType.duration,
        hasFollowUpPlan: (appointmentType.followUpPlan?.length ?? 0) > 0,
        name: appointmentType.name,
      });
    }
    return map;
  }, [appointmentTypesData]);

  const getRequiredAppointmentTypeInfo = useCallback(
    (appointmentTypeId: Id<"appointmentTypes">, source: string) => {
      const appointmentTypeInfo = appointmentTypeMap.get(appointmentTypeId);
      if (appointmentTypeInfo) {
        return appointmentTypeInfo;
      }

      captureFrontendError(
        invalidStateError(
          `Terminart ${appointmentTypeId} konnte nicht in appointmentTypeMap aufgelöst werden.`,
          source,
        ),
        {
          appointmentTypeId,
          context: "appointment_type_missing",
          source,
        },
        `${source}:${appointmentTypeId}`,
      );
      return null;
    },
    [appointmentTypeMap],
  );

  const slotsResult = useQuery(
    api.scheduling.getSlotsForDay,
    args.simulatedContext?.appointmentTypeId &&
      args.simulatedContext.locationId &&
      args.practiceId &&
      args.ruleSetId
      ? {
          date: args.selectedDate.toString(),
          practiceId: args.practiceId,
          ruleSetId: args.ruleSetId,
          scope: "simulation",
          simulatedContext: args.simulatedContext,
        }
      : args.selectedAppointmentTypeId &&
          args.selectedLocationId &&
          args.practiceId &&
          args.ruleSetId
        ? (() => {
            const patientDateOfBirth = args.patient?.dateOfBirth;
            return {
              date: args.selectedDate.toString(),
              practiceId: args.practiceId,
              ruleSetId: args.ruleSetId,
              scope: "real" as const,
              simulatedContext: createSimulatedContext({
                appointmentTypeId: args.selectedAppointmentTypeId,
                isNewPatient: args.patient?.isNewPatient ?? false,
                locationId: args.selectedLocationId,
                ...(patientDateOfBirth !== undefined && {
                  patientDateOfBirth,
                }),
              }),
            };
          })()
        : "skip",
  );

  const blockedSlotsWithoutAppointmentTypeResult = useQuery(
    api.scheduling.getBlockedSlotsWithoutAppointmentType,
    args.practiceId && args.ruleSetId
      ? {
          date: args.selectedDate.toString(),
          practiceId: args.practiceId,
          ruleSetId: args.ruleSetId,
          ...(effectiveLocationId && { locationId: effectiveLocationId }),
        }
      : "skip",
  );

  const appointmentPatientIds = useMemo(() => {
    const ids = new Set<Id<"patients">>();
    for (const appointment of appointmentsData ?? []) {
      if (appointment.patientId) {
        ids.add(appointment.patientId);
      }
    }
    return [...ids];
  }, [appointmentsData]);
  const appointmentUserIds = useMemo(() => {
    const ids = new Set<Id<"users">>();
    for (const appointment of appointmentsData ?? []) {
      if (appointment.userId) {
        ids.add(appointment.userId);
      }
    }
    return [...ids];
  }, [appointmentsData]);

  const patientData = useQuery(
    api.patients.getPatientsByIds,
    appointmentPatientIds.length > 0
      ? { patientIds: appointmentPatientIds }
      : "skip",
  );
  const userData = useQuery(
    api.users.getUsersByIds,
    appointmentUserIds.length > 0 ? { userIds: appointmentUserIds } : "skip",
  );

  const appointments = useMemo(
    () =>
      buildCalendarAppointments({
        appointments: appointmentsData ?? [],
        patientData,
        userData,
      }),
    [appointmentsData, patientData, userData],
  );

  return {
    activeRuleSetId,
    appointmentDocMap,
    appointmentDocMapRef,
    appointments,
    appointmentsData,
    appointmentTypeMap,
    baseSchedulesData,
    blockedSlotDocMap,
    blockedSlotDocMapRef,
    blockedSlotsData,
    blockedSlotsWithoutAppointmentTypeResult,
    calendarDayQueryArgs,
    getRequiredAppointmentTypeInfo,
    locationsData,
    practitionersData,
    slotsResult,
    vacationsData,
  };
}
