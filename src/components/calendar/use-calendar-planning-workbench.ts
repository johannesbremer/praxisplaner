import { useCallback, useEffect, useRef } from "react";
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
} from "./types";

import { findIdInList, isOptimisticId } from "../../utils/convex-ids";
import {
  getCurrentCalendarRecordById,
  hasCalendarOccupancyConflictInRecords,
  mergeCurrentConflictRecordsByIdExcluding,
} from "./calendar-planning-records";

interface AppointmentCandidate {
  end: string;
  isSimulation: boolean;
  locationLineageKey: LocationLineageKey;
  practitionerLineageKey?: PractitionerLineageKey;
  replacesAppointmentId?: Id<"appointments">;
  start: string;
}

interface BlockedSlotCandidate {
  end: string;
  isSimulation: boolean;
  locationLineageKey: LocationLineageKey;
  practitionerLineageKey?: PractitionerLineageKey;
  start: string;
}

interface CalendarRecordRef<T> {
  current: T;
}

interface CreatedAppointmentHistoryArgs {
  appointmentId: Id<"appointments">;
  appointmentTypeLineageKey: AppointmentTypeLineageKey;
  appointmentTypeTitle: string;
  end: CalendarAppointmentRecord["end"];
  isSimulation: boolean;
  locationLineageKey: LocationLineageKey;
  now: number;
  patientId?: Id<"patients">;
  practiceId: Id<"practices">;
  practitionerLineageKey?: PractitionerLineageKey;
  replacesAppointmentId?: Id<"appointments">;
  start: CalendarAppointmentRecord["start"];
  title: string;
  userId?: Id<"users">;
}

interface CreatedBlockedSlotHistoryArgs {
  blockedSlotId: Id<"blockedSlots">;
  end: CalendarBlockedSlotRecord["end"];
  isSimulation: boolean;
  locationLineageKey: LocationLineageKey;
  now: number;
  practiceId: Id<"practices">;
  practitionerLineageKey?: PractitionerLineageKey;
  replacesBlockedSlotId?: Id<"blockedSlots">;
  start: CalendarBlockedSlotRecord["start"];
  title: string;
}

export function useCalendarPlanningWorkbench(args: {
  activeDayAppointmentMapRef: CalendarRecordRef<
    ReadonlyMap<Id<"appointments">, CalendarAppointmentRecord>
  >;
  activeDayBlockedSlotMapRef: CalendarRecordRef<
    ReadonlyMap<Id<"blockedSlots">, CalendarBlockedSlotRecord>
  >;
  allPracticeAppointmentMap: ReadonlyMap<
    Id<"appointments">,
    CalendarAppointmentRecord
  >;
  allPracticeAppointmentMapRef: CalendarRecordRef<
    ReadonlyMap<Id<"appointments">, CalendarAppointmentRecord>
  >;
  allPracticeAppointmentsLoaded: boolean;
  allPracticeBlockedSlotMap: ReadonlyMap<
    Id<"blockedSlots">,
    CalendarBlockedSlotRecord
  >;
  allPracticeBlockedSlotMapRef: CalendarRecordRef<
    ReadonlyMap<Id<"blockedSlots">, CalendarBlockedSlotRecord>
  >;
  allPracticeBlockedSlotsLoaded: boolean;
}) {
  const appointmentHistoryDocMapRef = useRef(
    new Map<Id<"appointments">, CalendarAppointmentRecord>(),
  );
  const deletedAppointmentIdsRef = useRef(new Set<Id<"appointments">>());
  const blockedSlotHistoryDocMapRef = useRef(
    new Map<Id<"blockedSlots">, CalendarBlockedSlotRecord>(),
  );
  const deletedBlockedSlotIdsRef = useRef(new Set<Id<"blockedSlots">>());

  useEffect(() => {
    if (!args.allPracticeAppointmentsLoaded) {
      return;
    }

    for (const id of appointmentHistoryDocMapRef.current.keys()) {
      if (isOptimisticId(id) || args.allPracticeAppointmentMap.has(id)) {
        appointmentHistoryDocMapRef.current.delete(id);
      }
    }

    for (const appointmentId of args.allPracticeAppointmentMap.keys()) {
      deletedAppointmentIdsRef.current.delete(appointmentId);
    }
  }, [args.allPracticeAppointmentMap, args.allPracticeAppointmentsLoaded]);

  useEffect(() => {
    if (!args.allPracticeBlockedSlotsLoaded) {
      return;
    }

    for (const id of blockedSlotHistoryDocMapRef.current.keys()) {
      if (isOptimisticId(id) || args.allPracticeBlockedSlotMap.has(id)) {
        blockedSlotHistoryDocMapRef.current.delete(id);
      }
    }

    for (const blockedSlotId of args.allPracticeBlockedSlotMap.keys()) {
      deletedBlockedSlotIdsRef.current.delete(blockedSlotId);
    }
  }, [args.allPracticeBlockedSlotMap, args.allPracticeBlockedSlotsLoaded]);

  const getAppointmentHistoryDoc = useCallback(
    (id: Id<"appointments">) => {
      if (deletedAppointmentIdsRef.current.has(id)) {
        return;
      }

      return (
        appointmentHistoryDocMapRef.current.get(id) ??
        args.activeDayAppointmentMapRef.current.get(id) ??
        args.allPracticeAppointmentMapRef.current.get(id)
      );
    },
    [args.activeDayAppointmentMapRef, args.allPracticeAppointmentMapRef],
  );

  const getCurrentAppointmentDoc = useCallback(
    (id: Id<"appointments">) =>
      getCurrentCalendarRecordById({
        activeDayMap: args.activeDayAppointmentMapRef.current,
        allPracticeMap: args.allPracticeAppointmentMapRef.current,
        deletedIds: deletedAppointmentIdsRef.current,
        historyMap: appointmentHistoryDocMapRef.current,
        id,
      }),
    [args.activeDayAppointmentMapRef, args.allPracticeAppointmentMapRef],
  );

  const getBlockedSlotHistoryDoc = useCallback(
    (id: Id<"blockedSlots">) => {
      if (deletedBlockedSlotIdsRef.current.has(id)) {
        return;
      }

      return (
        blockedSlotHistoryDocMapRef.current.get(id) ??
        args.activeDayBlockedSlotMapRef.current.get(id) ??
        args.allPracticeBlockedSlotMapRef.current.get(id)
      );
    },
    [args.activeDayBlockedSlotMapRef, args.allPracticeBlockedSlotMapRef],
  );

  const getCurrentBlockedSlotDoc = useCallback(
    (id: Id<"blockedSlots">) =>
      getCurrentCalendarRecordById({
        activeDayMap: args.activeDayBlockedSlotMapRef.current,
        allPracticeMap: args.allPracticeBlockedSlotMapRef.current,
        deletedIds: deletedBlockedSlotIdsRef.current,
        historyMap: blockedSlotHistoryDocMapRef.current,
        id,
      }),
    [args.activeDayBlockedSlotMapRef, args.allPracticeBlockedSlotMapRef],
  );

  const resolveBlockedSlotId = useCallback(
    (blockedSlotId: string): Id<"blockedSlots"> | undefined => {
      return findIdInList(
        [
          ...blockedSlotHistoryDocMapRef.current.keys(),
          ...args.activeDayBlockedSlotMapRef.current.keys(),
          ...args.allPracticeBlockedSlotMapRef.current.keys(),
        ],
        blockedSlotId,
      );
    },
    [args.activeDayBlockedSlotMapRef, args.allPracticeBlockedSlotMapRef],
  );

  const rememberAppointmentHistoryDoc = useCallback(
    (appointment: CalendarAppointmentRecord) => {
      if (isOptimisticId(appointment._id)) {
        return;
      }
      deletedAppointmentIdsRef.current.delete(appointment._id);
      appointmentHistoryDocMapRef.current.set(appointment._id, appointment);
    },
    [],
  );

  const rememberCreatedAppointmentHistoryDoc = useCallback(
    (args: CreatedAppointmentHistoryArgs) => {
      rememberAppointmentHistoryDoc({
        _creationTime: args.now,
        _id: args.appointmentId,
        appointmentTypeLineageKey: args.appointmentTypeLineageKey,
        appointmentTypeTitle: args.appointmentTypeTitle,
        createdAt: BigInt(args.now),
        end: args.end,
        isSimulation: args.isSimulation,
        lastModified: BigInt(args.now),
        locationLineageKey: args.locationLineageKey,
        ...(args.patientId === undefined ? {} : { patientId: args.patientId }),
        practiceId: args.practiceId,
        ...(args.practitionerLineageKey === undefined
          ? {}
          : { practitionerLineageKey: args.practitionerLineageKey }),
        ...(args.replacesAppointmentId === undefined
          ? {}
          : { replacesAppointmentId: args.replacesAppointmentId }),
        start: args.start,
        title: args.title,
        ...(args.userId === undefined ? {} : { userId: args.userId }),
      });
    },
    [rememberAppointmentHistoryDoc],
  );

  const forgetAppointmentHistoryDoc = useCallback((id: Id<"appointments">) => {
    deletedAppointmentIdsRef.current.add(id);
    appointmentHistoryDocMapRef.current.delete(id);
  }, []);

  const rememberBlockedSlotHistoryDoc = useCallback(
    (blockedSlot: CalendarBlockedSlotRecord) => {
      if (isOptimisticId(blockedSlot._id)) {
        return;
      }
      deletedBlockedSlotIdsRef.current.delete(blockedSlot._id);
      blockedSlotHistoryDocMapRef.current.set(blockedSlot._id, blockedSlot);
    },
    [],
  );

  const rememberCreatedBlockedSlotHistoryDoc = useCallback(
    (args: CreatedBlockedSlotHistoryArgs) => {
      rememberBlockedSlotHistoryDoc({
        _creationTime: args.now,
        _id: args.blockedSlotId,
        createdAt: BigInt(args.now),
        end: args.end,
        isSimulation: args.isSimulation,
        lastModified: BigInt(args.now),
        locationLineageKey: args.locationLineageKey,
        practiceId: args.practiceId,
        ...(args.practitionerLineageKey === undefined
          ? {}
          : { practitionerLineageKey: args.practitionerLineageKey }),
        ...(args.replacesBlockedSlotId === undefined
          ? {}
          : { replacesBlockedSlotId: args.replacesBlockedSlotId }),
        start: args.start,
        title: args.title,
      });
    },
    [rememberBlockedSlotHistoryDoc],
  );

  const forgetBlockedSlotHistoryDoc = useCallback((id: Id<"blockedSlots">) => {
    deletedBlockedSlotIdsRef.current.add(id);
    blockedSlotHistoryDocMapRef.current.delete(id);
  }, []);

  const toEpochMilliseconds = useCallback(
    (iso: string) => Temporal.ZonedDateTime.from(iso).epochMilliseconds,
    [],
  );

  const hasAppointmentConflict = useCallback(
    (candidate: AppointmentCandidate, excludeId?: Id<"appointments">) => {
      return hasCalendarOccupancyConflictInRecords({
        appointments: mergeCurrentConflictRecordsByIdExcluding({
          allPracticeMap: args.allPracticeAppointmentMapRef.current,
          excludedIds: deletedAppointmentIdsRef.current,
          historyMap: appointmentHistoryDocMapRef.current,
        }),
        blockedSlots: mergeCurrentConflictRecordsByIdExcluding({
          allPracticeMap: args.allPracticeBlockedSlotMapRef.current,
          excludedIds: deletedBlockedSlotIdsRef.current,
          historyMap: blockedSlotHistoryDocMapRef.current,
        }),
        candidate,
        ...(excludeId === undefined ? {} : { excludeId }),
        toEpochMilliseconds,
      });
    },
    [
      args.allPracticeAppointmentMapRef,
      args.allPracticeBlockedSlotMapRef,
      toEpochMilliseconds,
    ],
  );

  const hasBlockedSlotConflict = useCallback(
    (candidate: BlockedSlotCandidate, excludeId?: Id<"blockedSlots">) => {
      return hasCalendarOccupancyConflictInRecords({
        appointments: mergeCurrentConflictRecordsByIdExcluding({
          allPracticeMap: args.allPracticeAppointmentMapRef.current,
          excludedIds: deletedAppointmentIdsRef.current,
          historyMap: appointmentHistoryDocMapRef.current,
        }),
        blockedSlots: mergeCurrentConflictRecordsByIdExcluding({
          allPracticeMap: args.allPracticeBlockedSlotMapRef.current,
          excludedIds: deletedBlockedSlotIdsRef.current,
          historyMap: blockedSlotHistoryDocMapRef.current,
        }),
        candidate,
        ...(excludeId === undefined ? {} : { excludeId }),
        toEpochMilliseconds,
      });
    },
    [
      args.allPracticeAppointmentMapRef,
      args.allPracticeBlockedSlotMapRef,
      toEpochMilliseconds,
    ],
  );

  return {
    forgetAppointmentHistoryDoc,
    forgetBlockedSlotHistoryDoc,
    getAppointmentHistoryDoc,
    getBlockedSlotHistoryDoc,
    getCurrentAppointmentDoc,
    getCurrentBlockedSlotDoc,
    hasAppointmentConflict,
    hasBlockedSlotConflict,
    rememberAppointmentHistoryDoc,
    rememberBlockedSlotHistoryDoc,
    rememberCreatedAppointmentHistoryDoc,
    rememberCreatedBlockedSlotHistoryDoc,
    resolveBlockedSlotId,
  };
}
