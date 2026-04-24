import { useConvex, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Temporal } from "temporal-polyfill";

import type { Id } from "../../../convex/_generated/dataModel";
import type {
  AppointmentResult,
  BlockedSlotResult,
} from "../../../convex/appointments";
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
  const convex = useConvex();
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
  const allPracticeConflictScopeKey = useMemo(
    () =>
      `${args.practiceId}:${activeRuleSetId ?? "active"}:${args.ruleSetId ?? "selected"}`,
    [activeRuleSetId, args.practiceId, args.ruleSetId],
  );
  const [allPracticeConflictData, setAllPracticeConflictData] = useState<{
    appointments: AppointmentResult[] | undefined;
    blockedSlots: BlockedSlotResult[] | undefined;
    key: string;
  }>({
    appointments: undefined,
    blockedSlots: undefined,
    key: allPracticeConflictScopeKey,
  });
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
    const map = new Map<Id<"blockedSlots">, BlockedSlotResult>();
    for (const blockedSlot of blockedSlotsData ?? []) {
      map.set(blockedSlot._id, blockedSlot);
    }
    return map;
  }, [blockedSlotsData]);
  const blockedSlotDocMapRef = useRef(blockedSlotDocMap);
  useEffect(() => {
    blockedSlotDocMapRef.current = blockedSlotDocMap;
  }, [blockedSlotDocMap]);

  const buildAllPracticeAppointmentDocMap = useCallback(
    (appointments: readonly AppointmentResult[]) => {
      const map = new Map<Id<"appointments">, AppointmentResult>();
      for (const appointment of appointments) {
        map.set(appointment._id, appointment);
      }
      return map;
    },
    [],
  );

  const buildAllPracticeBlockedSlotDocMap = useCallback(
    (blockedSlots: readonly BlockedSlotResult[]) => {
      const map = new Map<Id<"blockedSlots">, BlockedSlotResult>();
      for (const blockedSlot of blockedSlots) {
        map.set(blockedSlot._id, blockedSlot);
      }
      return map;
    },
    [],
  );

  const allPracticeAppointmentDocMapRef = useRef(
    new Map<Id<"appointments">, AppointmentResult>(),
  );
  const allPracticeBlockedSlotDocMapRef = useRef(
    new Map<Id<"blockedSlots">, BlockedSlotResult>(),
  );
  const fullPracticeConflictLoadRef = useRef(0);

  const refreshAllPracticeConflictData = useCallback(async () => {
    const requestId = ++fullPracticeConflictLoadRef.current;
    const [appointments, blockedSlots] = await Promise.all([
      convex.query(api.appointments.getAppointments, {
        ...(activeRuleSetId === undefined ? {} : { activeRuleSetId }),
        scope: "all",
        ...(args.ruleSetId === undefined
          ? {}
          : { selectedRuleSetId: args.ruleSetId }),
      }),
      convex.query(api.appointments.getBlockedSlots, {
        ...(activeRuleSetId === undefined ? {} : { activeRuleSetId }),
        scope: "all",
        ...(args.ruleSetId === undefined
          ? {}
          : { selectedRuleSetId: args.ruleSetId }),
      }),
    ]);

    if (requestId !== fullPracticeConflictLoadRef.current) {
      return;
    }

    const nextAppointments = appointments.filter(
      (appointment) => appointment.practiceId === args.practiceId,
    );
    const nextBlockedSlots = blockedSlots.filter(
      (blockedSlot) => blockedSlot.practiceId === args.practiceId,
    );

    allPracticeAppointmentDocMapRef.current =
      buildAllPracticeAppointmentDocMap(nextAppointments);
    allPracticeBlockedSlotDocMapRef.current =
      buildAllPracticeBlockedSlotDocMap(nextBlockedSlots);
    setAllPracticeConflictData({
      appointments: nextAppointments,
      blockedSlots: nextBlockedSlots,
      key: allPracticeConflictScopeKey,
    });
  }, [
    activeRuleSetId,
    allPracticeConflictScopeKey,
    args.practiceId,
    args.ruleSetId,
    buildAllPracticeAppointmentDocMap,
    buildAllPracticeBlockedSlotDocMap,
    convex,
  ]);

  useEffect(() => {
    fullPracticeConflictLoadRef.current += 1;
    allPracticeAppointmentDocMapRef.current = new Map();
    allPracticeBlockedSlotDocMapRef.current = new Map();
    void refreshAllPracticeConflictData();
  }, [refreshAllPracticeConflictData]);

  const allAppointmentsData =
    allPracticeConflictData.key === allPracticeConflictScopeKey
      ? allPracticeConflictData.appointments
      : undefined;
  const allBlockedSlotsData =
    allPracticeConflictData.key === allPracticeConflictScopeKey
      ? allPracticeConflictData.blockedSlots
      : undefined;

  const allPracticeAppointmentDocMap = useMemo(() => {
    return buildAllPracticeAppointmentDocMap(allAppointmentsData ?? []);
  }, [allAppointmentsData, buildAllPracticeAppointmentDocMap]);
  useEffect(() => {
    allPracticeAppointmentDocMapRef.current = allPracticeAppointmentDocMap;
  }, [allPracticeAppointmentDocMap]);

  const allPracticeBlockedSlotDocMap = useMemo(() => {
    return buildAllPracticeBlockedSlotDocMap(allBlockedSlotsData ?? []);
  }, [allBlockedSlotsData, buildAllPracticeBlockedSlotDocMap]);
  useEffect(() => {
    allPracticeBlockedSlotDocMapRef.current = allPracticeBlockedSlotDocMap;
  }, [allPracticeBlockedSlotDocMap]);

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

  const appointmentTypeLineageKeyById = useMemo(
    () =>
      new Map(
        (appointmentTypesData ?? []).flatMap((appointmentType) =>
          appointmentType.lineageKey
            ? [[appointmentType._id, appointmentType.lineageKey] as const]
            : [],
        ),
      ),
    [appointmentTypesData],
  );
  const locationLineageKeyById = useMemo(
    () =>
      new Map(
        (locationsData ?? []).flatMap((location) =>
          location.lineageKey
            ? [[location._id, location.lineageKey] as const]
            : [],
        ),
      ),
    [locationsData],
  );
  const practitionerIdByLineageKey = useMemo(
    () =>
      new Map(
        (practitionersData ?? []).flatMap((practitioner) =>
          practitioner.lineageKey
            ? [[practitioner.lineageKey, practitioner._id] as const]
            : [],
        ),
      ),
    [practitionersData],
  );
  const practitionerLineageKeyById = useMemo(
    () =>
      new Map(
        (practitionersData ?? []).flatMap((practitioner) =>
          practitioner.lineageKey
            ? [[practitioner._id, practitioner.lineageKey] as const]
            : [],
        ),
      ),
    [practitionersData],
  );
  const practitionerNameByLineageKey = useMemo(
    () =>
      new Map(
        (practitionersData ?? []).flatMap((practitioner) =>
          practitioner.lineageKey
            ? [[practitioner.lineageKey, practitioner.name] as const]
            : [],
        ),
      ),
    [practitionersData],
  );
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
    allPracticeAppointmentDocMap,
    allPracticeAppointmentDocMapRef,
    allPracticeAppointmentsLoaded: allAppointmentsData !== undefined,
    allPracticeBlockedSlotDocMap,
    allPracticeBlockedSlotDocMapRef,
    allPracticeBlockedSlotsLoaded: allBlockedSlotsData !== undefined,
    appointmentDocMap,
    appointmentDocMapRef,
    appointments,
    appointmentsData,
    appointmentTypeLineageKeyById,
    appointmentTypeMap,
    baseSchedulesData,
    blockedSlotDocMap,
    blockedSlotDocMapRef,
    blockedSlotsData,
    blockedSlotsWithoutAppointmentTypeResult,
    calendarDayQueryArgs,
    getRequiredAppointmentTypeInfo,
    locationLineageKeyById,
    locationsData,
    practitionerIdByLineageKey,
    practitionerLineageKeyById,
    practitionerNameByLineageKey,
    practitionersData,
    refreshAllPracticeConflictData,
    slotsResult,
    vacationsData,
  };
}
