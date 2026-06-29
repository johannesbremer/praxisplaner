import { useConvex, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { AppointmentColor } from "../../../convex/schema";
import type { PatientInfo } from "../../types";
import type {
  CalendarAppointmentRecord,
  CalendarBlockedSlotRecord,
} from "./types";

import { api } from "../../../convex/_generated/api";
import {
  asAppointmentTypeLineageKey,
  asLocationLineageKey,
  asPractitionerLineageKey,
} from "../../../convex/identity";
import { DEFAULT_APPOINTMENT_COLOR } from "../../../lib/appointment-colors";
import { createSimulatedContext } from "../../../lib/utils";
import {
  captureFrontendError,
  invalidStateError,
} from "../../utils/frontend-errors";
import {
  buildCalendarDayQueryArgs,
  buildCalendarDayRange,
} from "./calendar-query-args";
import {
  toCalendarAppointmentRecord,
  toCalendarBlockedSlotRecord,
} from "./calendar-view-models";

interface CalendarAppointmentTypeInfo {
  allowedPractitionerLineageKeys: PractitionerLineageKey[];
  appointmentPlan: AppointmentPlan;
  color: AppointmentColor;
  defaultOccupancy: AppointmentTypeDefaultOccupancy;
  duration: number;
  hasAppointmentPlan: boolean;
  lineageKey: AppointmentTypeLineageKey;
  name: string;
}

export function useCalendarData(args: {
  excludedAppointmentIdsForAvailability?: readonly Id<"appointments">[];
  patient: PatientInfo | undefined;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets"> | undefined;
  schedulingAppointmentTypeLineageKey?: AppointmentTypeLineageKey | undefined;
  selectedAppointmentTypeId: Id<"appointmentTypes"> | undefined;
  selectedDate: Temporal.PlainDate;
  selectedLocationId: Id<"locations"> | undefined;
  simulatedContext:
    | undefined
    | {
        appointmentTypeLineageKey?: AppointmentTypeLineageKey;
        clientType?: string;
        locationLineageKey?: LocationLineageKey;
        patient: { dateOfBirth?: string; isNew: boolean };
      };
}) {
  const convex = useConvex();
  const activeRuleSetData = useQuery(
    api.ruleSets.getActiveRuleSet,
    args.practiceId ? { practiceId: args.practiceId } : "skip",
  );
  const locationsData = useQuery(
    args.ruleSetId
      ? api.entities.getLocations
      : api.entities.getLocationsFromActive,
    args.ruleSetId
      ? { includeDeleted: false, ruleSetId: args.ruleSetId }
      : args.practiceId
        ? { practiceId: args.practiceId }
        : "skip",
  );
  const appointmentTypesData = useQuery(
    args.ruleSetId
      ? api.entities.getAppointmentTypes
      : api.entities.getAppointmentTypesFromActive,
    args.ruleSetId
      ? { includeDeleted: false, ruleSetId: args.ruleSetId }
      : args.practiceId
        ? { practiceId: args.practiceId }
        : "skip",
  );
  const appointmentScope = args.simulatedContext ? "simulation" : "real";
  const activeRuleSetId = activeRuleSetData?._id;
  const effectiveRuleSetId = args.ruleSetId ?? activeRuleSetId;
  const appointmentTypeFoldersData = useQuery(
    api.entities.getAppointmentTypeFolders,
    effectiveRuleSetId ? { ruleSetId: effectiveRuleSetId } : "skip",
  );
  const effectiveLocationId =
    args.simulatedContext?.locationLineageKey === undefined
      ? args.selectedLocationId
      : (locationsData?.find(
          (location) =>
            location.lineageKey === args.simulatedContext?.locationLineageKey,
        )?._id ?? args.selectedLocationId);
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

  const appointmentResultsData = useQuery(
    api.appointments.getCalendarDayAppointments,
    calendarDayQueryArgs ?? "skip",
  );
  const blockedSlotResultsData = useQuery(
    api.appointments.getCalendarDayBlockedSlots,
    calendarDayQueryArgs ?? "skip",
  );
  const allPracticeConflictScopeKey = useMemo(
    () =>
      `${args.practiceId}:${activeRuleSetId ?? "active"}:${args.ruleSetId ?? "selected"}:${args.selectedDate.toString()}`,
    [activeRuleSetId, args.practiceId, args.ruleSetId, args.selectedDate],
  );
  const [allPracticeConflictData, setAllPracticeConflictData] = useState<{
    appointments: CalendarAppointmentRecord[] | undefined;
    blockedSlots: CalendarBlockedSlotRecord[] | undefined;
    key: string;
  }>({
    appointments: undefined,
    blockedSlots: undefined,
    key: allPracticeConflictScopeKey,
  });
  const appointmentsData = useMemo(
    () =>
      (appointmentResultsData ?? []).map((appointment) =>
        toCalendarAppointmentRecord(appointment),
      ),
    [appointmentResultsData],
  );
  const blockedSlotsData = useMemo(
    () =>
      (blockedSlotResultsData ?? []).map((blockedSlot) =>
        toCalendarBlockedSlotRecord(blockedSlot),
      ),
    [blockedSlotResultsData],
  );
  const vacationsData = useQuery(
    api.vacations.getVacationsInRange,
    args.practiceId && effectiveRuleSetId
      ? {
          endDateExclusive: args.selectedDate.add({ days: 1 }).toString(),
          ruleSetId: effectiveRuleSetId,
          startDate: args.selectedDate.toString(),
        }
      : "skip",
  );

  const appointmentDocMap = useMemo(() => {
    const map = new Map<Id<"appointments">, CalendarAppointmentRecord>();
    for (const appointment of appointmentsData) {
      map.set(appointment._id, appointment);
    }
    return map;
  }, [appointmentsData]);
  const appointmentDocMapRef = useRef(appointmentDocMap);
  useEffect(() => {
    appointmentDocMapRef.current = appointmentDocMap;
  }, [appointmentDocMap]);

  const blockedSlotDocMap = useMemo(() => {
    const map = new Map<Id<"blockedSlots">, CalendarBlockedSlotRecord>();
    for (const blockedSlot of blockedSlotsData) {
      map.set(blockedSlot._id, blockedSlot);
    }
    return map;
  }, [blockedSlotsData]);
  const blockedSlotDocMapRef = useRef(blockedSlotDocMap);
  useEffect(() => {
    blockedSlotDocMapRef.current = blockedSlotDocMap;
  }, [blockedSlotDocMap]);

  const buildAllPracticeAppointmentDocMap = useCallback(
    (appointments: readonly CalendarAppointmentRecord[]) => {
      const map = new Map<Id<"appointments">, CalendarAppointmentRecord>();
      for (const appointment of appointments) {
        map.set(appointment._id, appointment);
      }
      return map;
    },
    [],
  );

  const buildAllPracticeBlockedSlotDocMap = useCallback(
    (blockedSlots: readonly CalendarBlockedSlotRecord[]) => {
      const map = new Map<Id<"blockedSlots">, CalendarBlockedSlotRecord>();
      for (const blockedSlot of blockedSlots) {
        map.set(blockedSlot._id, blockedSlot);
      }
      return map;
    },
    [],
  );

  const allPracticeAppointmentDocMapRef = useRef(
    new Map<Id<"appointments">, CalendarAppointmentRecord>(),
  );
  const allPracticeBlockedSlotDocMapRef = useRef(
    new Map<Id<"blockedSlots">, CalendarBlockedSlotRecord>(),
  );
  const fullPracticeConflictLoadRef = useRef(0);

  const refreshAllPracticeConflictData = useCallback(async () => {
    const requestId = ++fullPracticeConflictLoadRef.current;
    const dayRange = buildCalendarDayRange(args.selectedDate);
    const [appointments, blockedSlots] = await Promise.all([
      convex.query(api.appointments.getAppointmentsInRange, {
        ...(activeRuleSetId === undefined ? {} : { activeRuleSetId }),
        end: dayRange.dayEnd,
        practiceId: args.practiceId,
        scope: "all",
        ...(args.ruleSetId === undefined
          ? {}
          : { selectedRuleSetId: args.ruleSetId }),
        start: dayRange.dayStart,
      }),
      convex.query(api.appointments.getBlockedSlotsInRange, {
        ...(activeRuleSetId === undefined ? {} : { activeRuleSetId }),
        end: dayRange.dayEnd,
        practiceId: args.practiceId,
        scope: "all",
        ...(args.ruleSetId === undefined
          ? {}
          : { selectedRuleSetId: args.ruleSetId }),
        start: dayRange.dayStart,
      }),
    ]);

    if (requestId !== fullPracticeConflictLoadRef.current) {
      return;
    }

    const nextAppointments = appointments
      .filter((appointment) => appointment.practiceId === args.practiceId)
      .map((appointment) => toCalendarAppointmentRecord(appointment));
    const nextBlockedSlots = blockedSlots
      .filter((blockedSlot) => blockedSlot.practiceId === args.practiceId)
      .map((blockedSlot) => toCalendarBlockedSlotRecord(blockedSlot));

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
    args.selectedDate,
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
      ? { includeDeleted: false, ruleSetId: args.ruleSetId }
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
  const appointmentTypeIdByLineageKey = useMemo(
    () =>
      new Map<AppointmentTypeLineageKey, Id<"appointmentTypes">>(
        (appointmentTypesData ?? []).flatMap((appointmentType) =>
          appointmentType.lineageKey
            ? [
                [
                  asAppointmentTypeLineageKey(appointmentType.lineageKey),
                  appointmentType._id,
                ] as const,
              ]
            : [],
        ),
      ),
    [appointmentTypesData],
  );
  const locationLineageKeyById = useMemo(
    () =>
      new Map<Id<"locations">, LocationLineageKey>(
        (locationsData ?? []).flatMap((location) =>
          location.lineageKey
            ? [
                [
                  location._id,
                  asLocationLineageKey(location.lineageKey),
                ] as const,
              ]
            : [],
        ),
      ),
    [locationsData],
  );
  const locationIdByLineageKey = useMemo(
    () =>
      new Map<LocationLineageKey, Id<"locations">>(
        (locationsData ?? []).flatMap((location) =>
          location.lineageKey
            ? [
                [
                  asLocationLineageKey(location.lineageKey),
                  location._id,
                ] as const,
              ]
            : [],
        ),
      ),
    [locationsData],
  );
  const practitionerIdByLineageKey = useMemo(
    () =>
      new Map<PractitionerLineageKey, Id<"practitioners">>(
        (practitionersData ?? []).flatMap((practitioner) =>
          practitioner.lineageKey
            ? [
                [
                  asPractitionerLineageKey(practitioner.lineageKey),
                  practitioner._id,
                ] as const,
              ]
            : [],
        ),
      ),
    [practitionersData],
  );
  const practitionerLineageKeyById = useMemo(
    () =>
      new Map<Id<"practitioners">, PractitionerLineageKey>(
        (practitionersData ?? []).flatMap((practitioner) =>
          practitioner.lineageKey
            ? [
                [
                  practitioner._id,
                  asPractitionerLineageKey(practitioner.lineageKey),
                ] as const,
              ]
            : [],
        ),
      ),
    [practitionersData],
  );
  const appointmentTypeLineageKeyById = useMemo(
    () =>
      new Map<Id<"appointmentTypes">, AppointmentTypeLineageKey>(
        (appointmentTypesData ?? []).flatMap((appointmentType) =>
          appointmentType.lineageKey
            ? [
                [
                  appointmentType._id,
                  asAppointmentTypeLineageKey(appointmentType.lineageKey),
                ] as const,
              ]
            : [],
        ),
      ),
    [appointmentTypesData],
  );
  const appointmentTypeInfoByLineageKey = useMemo(() => {
    const map = new Map<
      AppointmentTypeLineageKey,
      CalendarAppointmentTypeInfo
    >();
    const folderById = new Map<
      Id<"appointmentTypeFolders">,
      {
        color: AppointmentColor | undefined;
        parentFolderId: Id<"appointmentTypeFolders"> | undefined;
      }
    >(
      (appointmentTypeFoldersData ?? []).map((folder) => [
        folder._id,
        {
          color: folder.color,
          parentFolderId: folder.parentFolderId,
        },
      ]),
    );
    const resolveAppointmentTypeColor = (appointmentType: {
      color?: AppointmentColor;
      treeFolderId?: Id<"appointmentTypeFolders">;
    }): AppointmentColor => {
      if (appointmentType.color !== undefined) {
        return appointmentType.color;
      }

      let folderId = appointmentType.treeFolderId;
      const visitedFolderIds = new Set<Id<"appointmentTypeFolders">>();
      while (folderId !== undefined && !visitedFolderIds.has(folderId)) {
        visitedFolderIds.add(folderId);
        const folder = folderById.get(folderId);
        if (folder === undefined) {
          break;
        }
        if (folder.color !== undefined) {
          return folder.color;
        }
        folderId = folder.parentFolderId;
      }

      return DEFAULT_APPOINTMENT_COLOR;
    };

    for (const appointmentType of appointmentTypesData ?? []) {
      if (!appointmentType.lineageKey) {
        continue;
      }

      const allowedPractitionerLineageKeys =
        appointmentType.allowedPractitionerLineageKeys.map((lineageKey) =>
          asPractitionerLineageKey(lineageKey),
        );

      map.set(asAppointmentTypeLineageKey(appointmentType.lineageKey), {
        allowedPractitionerLineageKeys,
        appointmentPlan: {
          steps: appointmentType.appointmentPlan.steps.map((step) => ({
            ...step,
            appointmentTypeLineageKey: asAppointmentTypeLineageKey(
              step.appointmentTypeLineageKey,
            ),
          })),
        },
        color: resolveAppointmentTypeColor(appointmentType),
        defaultOccupancy: appointmentType.defaultOccupancy,
        duration: appointmentType.duration,
        hasAppointmentPlan: appointmentType.appointmentPlan.steps.length > 0,
        lineageKey: asAppointmentTypeLineageKey(appointmentType.lineageKey),
        name: appointmentType.name,
      });
    }
    return map;
  }, [appointmentTypeFoldersData, appointmentTypesData]);
  const practitionerNameByLineageKey = useMemo(
    () =>
      new Map<PractitionerLineageKey, string>(
        (practitionersData ?? []).flatMap((practitioner) =>
          practitioner.lineageKey
            ? [
                [
                  asPractitionerLineageKey(practitioner.lineageKey),
                  practitioner.name,
                ] as const,
              ]
            : [],
        ),
      ),
    [practitionersData],
  );
  const getRequiredAppointmentTypeInfo = useCallback(
    (appointmentTypeId: Id<"appointmentTypes">, source: string) => {
      const appointmentTypeLineageKey =
        appointmentTypeLineageKeyById.get(appointmentTypeId);
      const appointmentTypeInfo =
        appointmentTypeLineageKey === undefined
          ? undefined
          : appointmentTypeInfoByLineageKey.get(appointmentTypeLineageKey);
      if (appointmentTypeInfo) {
        return appointmentTypeInfo;
      }

      captureFrontendError(
        invalidStateError(
          `Terminart ${appointmentTypeId} konnte nicht in appointmentTypeInfoByLineageKey aufgelöst werden.`,
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
    [appointmentTypeInfoByLineageKey, appointmentTypeLineageKeyById],
  );

  const slotsResult = useQuery(
    api.scheduling.getSlotsForDay,
    args.simulatedContext?.appointmentTypeLineageKey &&
      args.simulatedContext.locationLineageKey &&
      args.practiceId &&
      effectiveRuleSetId
      ? {
          date: args.selectedDate.toString(),
          ...(args.excludedAppointmentIdsForAvailability === undefined ||
          args.excludedAppointmentIdsForAvailability.length === 0
            ? {}
            : {
                excludedAppointmentIds: [
                  ...args.excludedAppointmentIdsForAvailability,
                ],
              }),
          practiceId: args.practiceId,
          ruleSetId: effectiveRuleSetId,
          scope: "simulation",
          simulatedContext: args.simulatedContext,
        }
      : (args.schedulingAppointmentTypeLineageKey ||
            args.selectedAppointmentTypeId) &&
          args.selectedLocationId &&
          args.practiceId &&
          effectiveRuleSetId
        ? (() => {
            const patientDateOfBirth = args.patient?.dateOfBirth;
            const appointmentTypeLineageKey =
              args.schedulingAppointmentTypeLineageKey ??
              appointmentTypesData?.find(
                (appointmentType) =>
                  appointmentType._id === args.selectedAppointmentTypeId,
              )?.lineageKey;
            const locationLineageKey = locationsData?.find(
              (location) => location._id === args.selectedLocationId,
            )?.lineageKey;
            return {
              date: args.selectedDate.toString(),
              ...(args.excludedAppointmentIdsForAvailability === undefined ||
              args.excludedAppointmentIdsForAvailability.length === 0
                ? {}
                : {
                    excludedAppointmentIds: [
                      ...args.excludedAppointmentIdsForAvailability,
                    ],
                  }),
              practiceId: args.practiceId,
              ruleSetId: effectiveRuleSetId,
              scope: "real" as const,
              simulatedContext: createSimulatedContext({
                ...(appointmentTypeLineageKey === undefined
                  ? {}
                  : {
                      appointmentTypeLineageKey: asAppointmentTypeLineageKey(
                        appointmentTypeLineageKey,
                      ),
                    }),
                clientType: "MFA",
                isNewPatient: args.patient?.isNewPatient ?? false,
                ...(locationLineageKey === undefined
                  ? {}
                  : {
                      locationLineageKey:
                        asLocationLineageKey(locationLineageKey),
                    }),
                ...(patientDateOfBirth !== undefined && {
                  patientDateOfBirth,
                }),
              }),
            };
          })()
        : "skip",
  );
  const blockedSlotsClientType =
    args.simulatedContext === undefined
      ? "MFA"
      : args.simulatedContext.clientType;
  const blockedSlotsWithoutAppointmentTypeResult = useQuery(
    api.scheduling.getBlockedSlotsWithoutAppointmentType,
    args.practiceId && effectiveRuleSetId && blockedSlotsClientType
      ? {
          clientType: blockedSlotsClientType,
          date: args.selectedDate.toString(),
          practiceId: args.practiceId,
          ruleSetId: effectiveRuleSetId,
          ...(effectiveLocationId && { locationId: effectiveLocationId }),
        }
      : "skip",
  );

  const appointmentPatientIds = useMemo(() => {
    const ids = new Set<Id<"patients">>();
    for (const appointment of appointmentsData) {
      if (appointment.patientId) {
        ids.add(appointment.patientId);
      }
    }
    return [...ids];
  }, [appointmentsData]);
  const appointmentUserIds = useMemo(() => {
    const ids = new Set<Id<"users">>();
    for (const appointment of appointmentsData) {
      if (appointment.userId) {
        ids.add(appointment.userId);
      }
    }
    return [...ids];
  }, [appointmentsData]);

  const patientData = useQuery(
    api.patients.getPatientsByIds,
    appointmentPatientIds.length > 0
      ? { patientIds: appointmentPatientIds, practiceId: args.practiceId }
      : "skip",
  );
  const userData = useQuery(
    api.users.getUsersByIds,
    appointmentUserIds.length > 0
      ? { practiceId: args.practiceId, userIds: appointmentUserIds }
      : "skip",
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
    appointmentsData,
    appointmentTypeIdByLineageKey,
    appointmentTypeInfoByLineageKey,
    appointmentTypeLineageKeyById,
    baseSchedulesData,
    blockedSlotDocMap,
    blockedSlotDocMapRef,
    blockedSlotsData,
    blockedSlotsWithoutAppointmentTypeResult,
    calendarDayQueryArgs,
    effectiveRuleSetId,
    getRequiredAppointmentTypeInfo,
    locationIdByLineageKey,
    locationLineageKeyById,
    locationsData,
    patientData,
    practitionerIdByLineageKey,
    practitionerLineageKeyById,
    practitionerNameByLineageKey,
    practitionersData,
    refreshAllPracticeConflictData,
    slotsResult,
    userData,
    vacationsData,
  };
}
