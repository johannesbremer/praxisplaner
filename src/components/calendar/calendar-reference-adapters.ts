import type { Id } from "../../../convex/_generated/dataModel";
import type {
  CalendarBlockedSlotEditorRecord,
  CalendarBlockedSlotRecord,
} from "./types";

export interface CalendarReferenceMaps {
  appointmentTypeIdByLineageKey: ReadonlyMap<
    Id<"appointmentTypes">,
    Id<"appointmentTypes">
  >;
  appointmentTypeLineageKeyById: ReadonlyMap<
    Id<"appointmentTypes">,
    Id<"appointmentTypes">
  >;
  locationIdByLineageKey: ReadonlyMap<Id<"locations">, Id<"locations">>;
  locationLineageKeyById: ReadonlyMap<Id<"locations">, Id<"locations">>;
  practitionerIdByLineageKey: ReadonlyMap<
    Id<"practitioners">,
    Id<"practitioners">
  >;
  practitionerLineageKeyById: ReadonlyMap<
    Id<"practitioners">,
    Id<"practitioners">
  >;
}

export function resolveAppointmentDisplayRefs(
  args: {
    appointmentTypeLineageKey: Id<"appointmentTypes">;
    locationLineageKey: Id<"locations">;
    practitionerLineageKey?: Id<"practitioners">;
  },
  maps: CalendarReferenceMaps,
): null | {
  appointmentTypeId: Id<"appointmentTypes">;
  locationId: Id<"locations">;
  practitionerId?: Id<"practitioners">;
} {
  const appointmentTypeId = maps.appointmentTypeIdByLineageKey.get(
    args.appointmentTypeLineageKey,
  );
  const locationId = maps.locationIdByLineageKey.get(args.locationLineageKey);
  const practitionerId =
    args.practitionerLineageKey === undefined
      ? undefined
      : maps.practitionerIdByLineageKey.get(args.practitionerLineageKey);

  if (
    appointmentTypeId === undefined ||
    locationId === undefined ||
    (args.practitionerLineageKey !== undefined && practitionerId === undefined)
  ) {
    return null;
  }

  return {
    appointmentTypeId,
    locationId,
    ...(practitionerId === undefined ? {} : { practitionerId }),
  };
}

export function resolveAppointmentLineageRefs(
  args: {
    appointmentTypeId: Id<"appointmentTypes">;
    locationId: Id<"locations">;
    practitionerId?: Id<"practitioners">;
  },
  maps: CalendarReferenceMaps,
): null | {
  appointmentTypeLineageKey: Id<"appointmentTypes">;
  locationLineageKey: Id<"locations">;
  practitionerLineageKey?: Id<"practitioners">;
} {
  const appointmentTypeLineageKey = maps.appointmentTypeLineageKeyById.get(
    args.appointmentTypeId,
  );
  const locationLineageKey = maps.locationLineageKeyById.get(args.locationId);
  const practitionerLineageKey =
    args.practitionerId === undefined
      ? undefined
      : maps.practitionerLineageKeyById.get(args.practitionerId);

  if (
    appointmentTypeLineageKey === undefined ||
    locationLineageKey === undefined ||
    (args.practitionerId !== undefined && practitionerLineageKey === undefined)
  ) {
    return null;
  }

  return {
    appointmentTypeLineageKey,
    locationLineageKey,
    ...(practitionerLineageKey === undefined ? {} : { practitionerLineageKey }),
  };
}

export function resolveBlockedSlotDisplayRefs(
  args: {
    locationLineageKey: Id<"locations">;
    practitionerLineageKey?: Id<"practitioners">;
  },
  maps: CalendarReferenceMaps,
): null | {
  locationId: Id<"locations">;
  practitionerId?: Id<"practitioners">;
} {
  const locationId = maps.locationIdByLineageKey.get(args.locationLineageKey);
  const practitionerId =
    args.practitionerLineageKey === undefined
      ? undefined
      : maps.practitionerIdByLineageKey.get(args.practitionerLineageKey);

  if (
    locationId === undefined ||
    (args.practitionerLineageKey !== undefined && practitionerId === undefined)
  ) {
    return null;
  }

  return {
    locationId,
    ...(practitionerId === undefined ? {} : { practitionerId }),
  };
}

export function resolveBlockedSlotLineageRefs(
  args: {
    locationId: Id<"locations">;
    practitionerId?: Id<"practitioners">;
  },
  maps: CalendarReferenceMaps,
): null | {
  locationLineageKey: Id<"locations">;
  practitionerLineageKey?: Id<"practitioners">;
} {
  const locationLineageKey = maps.locationLineageKeyById.get(args.locationId);
  const practitionerLineageKey =
    args.practitionerId === undefined
      ? undefined
      : maps.practitionerLineageKeyById.get(args.practitionerId);

  if (
    locationLineageKey === undefined ||
    (args.practitionerId !== undefined && practitionerLineageKey === undefined)
  ) {
    return null;
  }

  return {
    locationLineageKey,
    ...(practitionerLineageKey === undefined ? {} : { practitionerLineageKey }),
  };
}

export function toBlockedSlotEditorRecord(
  blockedSlot: CalendarBlockedSlotRecord,
  maps: CalendarReferenceMaps,
): CalendarBlockedSlotEditorRecord | null {
  const displayRefs = resolveBlockedSlotDisplayRefs(
    {
      locationLineageKey: blockedSlot.locationLineageKey,
      ...(blockedSlot.practitionerLineageKey === undefined
        ? {}
        : { practitionerLineageKey: blockedSlot.practitionerLineageKey }),
    },
    maps,
  );
  if (!displayRefs) {
    return null;
  }

  return {
    end: blockedSlot.end,
    locationId: displayRefs.locationId,
    practiceId: blockedSlot.practiceId,
    ...(displayRefs.practitionerId === undefined
      ? {}
      : { practitionerId: displayRefs.practitionerId }),
    start: blockedSlot.start,
    title: blockedSlot.title,
  };
}
