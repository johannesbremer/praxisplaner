import type { Id } from "../../../convex/_generated/dataModel";

interface ConflictAppointmentCandidate {
  calendarResourceColumn?: "ekg" | "labor";
  end: string;
  isSimulation?: boolean;
  locationLineageKey: Id<"locations">;
  practitionerLineageKey?: Id<"practitioners">;
  replacesAppointmentId?: Id<"appointments">;
  start: string;
}

interface ConflictAppointmentRecord extends ConflictAppointmentCandidate {
  _id: Id<"appointments">;
}

interface ConflictBlockedSlotCandidate {
  end: string;
  isSimulation?: boolean;
  locationLineageKey: Id<"locations">;
  practitionerLineageKey?: Id<"practitioners">;
  start: string;
}

interface ConflictBlockedSlotRecord extends ConflictBlockedSlotCandidate {
  _id: Id<"blockedSlots">;
}

export function getCurrentCalendarRecordById<T extends { _id: string }>(args: {
  activeDayMap?: ReadonlyMap<string, T>;
  allPracticeMap: ReadonlyMap<string, T>;
  deletedIds?: ReadonlySet<string>;
  historyMap: ReadonlyMap<string, T>;
  id: string;
}): T | undefined {
  if (args.deletedIds?.has(args.id)) {
    return undefined;
  }

  return (
    args.allPracticeMap.get(args.id) ??
    args.activeDayMap?.get(args.id) ??
    args.historyMap.get(args.id)
  );
}

export function hasCalendarOccupancyConflictInRecords(args: {
  appointments: Iterable<ConflictAppointmentRecord>;
  blockedSlots: Iterable<ConflictBlockedSlotRecord>;
  candidate: ConflictAppointmentCandidate | ConflictBlockedSlotCandidate;
  excludeId?: string;
  toEpochMilliseconds: (iso: string) => number;
}): boolean {
  for (const existing of args.blockedSlots) {
    if (
      isCalendarOccupancyConflict({
        candidate: args.candidate,
        ...(args.excludeId === undefined ? {} : { excludeId: args.excludeId }),
        existing,
        toEpochMilliseconds: args.toEpochMilliseconds,
      })
    ) {
      return true;
    }
  }

  for (const existing of args.appointments) {
    if (
      isCalendarOccupancyConflict({
        candidate: args.candidate,
        ...(args.excludeId === undefined ? {} : { excludeId: args.excludeId }),
        existing,
        toEpochMilliseconds: args.toEpochMilliseconds,
      })
    ) {
      return true;
    }
  }

  return false;
}

export function mergeConflictRecordsById<T extends { _id: string }>(
  ...maps: readonly ReadonlyMap<string, T>[]
): T[] {
  return mergeConflictRecordsByIdExcluding({ maps });
}

export function mergeConflictRecordsByIdExcluding<
  T extends { _id: string },
>(args: {
  excludedIds?: ReadonlySet<string>;
  maps: readonly ReadonlyMap<string, T>[];
}): T[] {
  const merged = new Map<string, T>();

  for (const map of args.maps) {
    for (const [id, record] of map) {
      if (args.excludedIds?.has(id)) {
        continue;
      }

      merged.set(id, record);
    }
  }

  return [...merged.values()];
}

export function mergeCurrentConflictRecordsByIdExcluding<
  T extends { _id: string },
>(args: {
  allPracticeMap: ReadonlyMap<string, T>;
  excludedIds?: ReadonlySet<string>;
  historyMap: ReadonlyMap<string, T>;
}): T[] {
  return mergeConflictRecordsByIdExcluding({
    maps: [args.historyMap, args.allPracticeMap],
    ...(args.excludedIds === undefined
      ? {}
      : { excludedIds: args.excludedIds }),
  });
}

function getCalendarOccupancyScope(args: {
  calendarResourceColumn?: "ekg" | "labor";
  practitionerLineageKey?: Id<"practitioners">;
}) {
  if (args.practitionerLineageKey !== undefined) {
    return {
      kind: "practitioner" as const,
      value: args.practitionerLineageKey,
    };
  }
  if (args.calendarResourceColumn !== undefined) {
    return {
      kind: "resource" as const,
      value: args.calendarResourceColumn,
    };
  }
  return {
    kind: "location-wide" as const,
    value: undefined,
  };
}

function isCalendarOccupancyConflict(args: {
  candidate: ConflictAppointmentCandidate | ConflictBlockedSlotCandidate;
  excludeId?: string;
  existing: {
    _id: string;
    calendarResourceColumn?: "ekg" | "labor";
    end: string;
    isSimulation?: boolean;
    locationLineageKey: Id<"locations">;
    practitionerLineageKey?: Id<"practitioners">;
    start: string;
  };
  toEpochMilliseconds: (iso: string) => number;
}): boolean {
  const candidateStart = args.toEpochMilliseconds(args.candidate.start);
  const candidateEnd = args.toEpochMilliseconds(args.candidate.end);

  if (args.excludeId && args.existing._id === args.excludeId) {
    return false;
  }

  if (
    "replacesAppointmentId" in args.candidate &&
    args.candidate.replacesAppointmentId &&
    args.existing._id === args.candidate.replacesAppointmentId
  ) {
    return false;
  }

  if (args.existing.locationLineageKey !== args.candidate.locationLineageKey) {
    return false;
  }

  if (
    (args.existing.isSimulation === true) !==
    (args.candidate.isSimulation === true)
  ) {
    return false;
  }

  const existingScope = getCalendarOccupancyScope(args.existing);
  const candidateScope = getCalendarOccupancyScope(args.candidate);
  if (
    existingScope.kind !== "location-wide" &&
    candidateScope.kind !== "location-wide" &&
    (existingScope.kind !== candidateScope.kind ||
      existingScope.value !== candidateScope.value)
  ) {
    return false;
  }

  const existingStart = args.toEpochMilliseconds(args.existing.start);
  const existingEnd = args.toEpochMilliseconds(args.existing.end);
  return candidateStart < existingEnd && existingStart < candidateEnd;
}
