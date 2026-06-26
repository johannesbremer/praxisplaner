import type { Id } from "../../../convex/_generated/dataModel";
import type {
  AppointmentTypeLineageKey,
  LocationLineageKey,
  PractitionerLineageKey,
} from "../../../convex/identity";
import type { CalendarResourceColumn } from "../../../lib/calendar-occupancy";
import type {
  CalendarAppointmentPlacement,
  CalendarBlockedSlotEditorRecord,
  CalendarBlockedSlotPlacement,
  CalendarBlockedSlotRecord,
} from "./types";

export type AppointmentDisplayOccupancyScope =
  | { calendarResourceColumn: CalendarResourceColumn; kind: "resource" }
  | { kind: "practitioner"; practitionerId: Id<"practitioners"> };

export type BlockedSlotDisplayOccupancyScope =
  | { calendarResourceColumn: CalendarResourceColumn; kind: "resource" }
  | { kind: "practitioner"; practitionerId: Id<"practitioners"> };

export interface CalendarReferenceMaps {
  appointmentTypeIdByLineageKey: ReadonlyMap<
    AppointmentTypeLineageKey,
    Id<"appointmentTypes">
  >;
  appointmentTypeLineageKeyById: ReadonlyMap<
    Id<"appointmentTypes">,
    AppointmentTypeLineageKey
  >;
  locationIdByLineageKey: ReadonlyMap<LocationLineageKey, Id<"locations">>;
  locationLineageKeyById: ReadonlyMap<Id<"locations">, LocationLineageKey>;
  practitionerIdByLineageKey: ReadonlyMap<
    PractitionerLineageKey,
    Id<"practitioners">
  >;
  practitionerLineageKeyById: ReadonlyMap<
    Id<"practitioners">,
    PractitionerLineageKey
  >;
}

export function resolveAppointmentDisplayRefs(
  args: {
    appointmentTypeLineageKey: AppointmentTypeLineageKey;
    placement: CalendarAppointmentPlacement;
  },
  maps: CalendarReferenceMaps,
): null | {
  appointmentTypeId: Id<"appointmentTypes">;
  locationId: Id<"locations">;
  occupancyScope: AppointmentDisplayOccupancyScope;
  practitionerId?: Id<"practitioners">;
} {
  const appointmentTypeId = maps.appointmentTypeIdByLineageKey.get(
    args.appointmentTypeLineageKey,
  );
  const placementRefs = resolveAppointmentPlacementDisplayRefs(
    args.placement,
    maps,
  );

  if (appointmentTypeId === undefined || placementRefs === null) {
    return null;
  }

  return {
    appointmentTypeId,
    locationId: placementRefs.locationId,
    occupancyScope: placementRefs.occupancyScope,
    ...(placementRefs.occupancyScope.kind === "practitioner"
      ? { practitionerId: placementRefs.occupancyScope.practitionerId }
      : {}),
  };
}

export function resolveAppointmentLineageRefs(
  args: {
    appointmentTypeId: Id<"appointmentTypes">;
    locationId: Id<"locations">;
    occupancyScope: AppointmentDisplayOccupancyScope;
  },
  maps: CalendarReferenceMaps,
): null | {
  appointmentTypeLineageKey: AppointmentTypeLineageKey;
  placement: CalendarAppointmentPlacement;
} {
  const appointmentTypeLineageKey = maps.appointmentTypeLineageKeyById.get(
    args.appointmentTypeId,
  );
  const placement = resolveAppointmentPlacementLineageRefs(
    {
      locationId: args.locationId,
      occupancyScope: args.occupancyScope,
    },
    maps,
  );

  if (appointmentTypeLineageKey === undefined || placement === null) {
    return null;
  }

  return {
    appointmentTypeLineageKey,
    placement,
  };
}

export function resolveAppointmentPlacementDisplayRefs(
  placement: CalendarAppointmentPlacement,
  maps: CalendarReferenceMaps,
): null | {
  locationId: Id<"locations">;
  occupancyScope: AppointmentDisplayOccupancyScope;
} {
  const locationId = maps.locationIdByLineageKey.get(
    placement.locationLineageKey,
  );
  if (locationId === undefined) {
    return null;
  }

  if (placement.occupancyScope.kind === "resource") {
    return {
      locationId,
      occupancyScope: placement.occupancyScope,
    };
  }

  const practitionerId = resolvePractitionerId(
    placement.occupancyScope.practitionerLineageKey,
    maps,
  );
  if (practitionerId === undefined) {
    return null;
  }

  return {
    locationId,
    occupancyScope: { kind: "practitioner", practitionerId },
  };
}

export function resolveAppointmentPlacementLineageRefs(
  args: {
    locationId: Id<"locations">;
    occupancyScope: AppointmentDisplayOccupancyScope;
  },
  maps: CalendarReferenceMaps,
): CalendarAppointmentPlacement | null {
  const locationLineageKey = maps.locationLineageKeyById.get(args.locationId);
  if (locationLineageKey === undefined) {
    return null;
  }

  if (args.occupancyScope.kind === "resource") {
    return {
      locationLineageKey,
      occupancyScope: args.occupancyScope,
    };
  }

  const practitionerLineageKey = resolvePractitionerLineageKey(
    args.occupancyScope.practitionerId,
    maps,
  );
  if (practitionerLineageKey === undefined) {
    return null;
  }

  return {
    locationLineageKey,
    occupancyScope: {
      kind: "practitioner",
      practitionerLineageKey,
    },
  };
}

export function resolveBlockedSlotDisplayRefs(
  placement: CalendarBlockedSlotPlacement,
  maps: CalendarReferenceMaps,
): null | {
  locationId: Id<"locations">;
  occupancyScope: BlockedSlotDisplayOccupancyScope;
  practitionerId?: Id<"practitioners">;
} {
  const displayRefs = resolveBlockedSlotPlacementDisplayRefs(placement, maps);
  if (!displayRefs) {
    return null;
  }

  return {
    locationId: displayRefs.locationId,
    occupancyScope: displayRefs.occupancyScope,
    ...(displayRefs.occupancyScope.kind === "practitioner"
      ? { practitionerId: displayRefs.occupancyScope.practitionerId }
      : {}),
  };
}

export function resolveBlockedSlotLineageRefs(
  args: {
    locationId: Id<"locations">;
    occupancyScope: BlockedSlotDisplayOccupancyScope;
  },
  maps: CalendarReferenceMaps,
): CalendarBlockedSlotPlacement | null {
  const placement = resolveBlockedSlotPlacementLineageRefs(
    {
      locationId: args.locationId,
      occupancyScope: args.occupancyScope,
    },
    maps,
  );
  return placement;
}

export function resolveBlockedSlotPlacementDisplayRefs(
  placement: CalendarBlockedSlotPlacement,
  maps: CalendarReferenceMaps,
): null | {
  locationId: Id<"locations">;
  occupancyScope: BlockedSlotDisplayOccupancyScope;
} {
  const locationId = maps.locationIdByLineageKey.get(
    placement.locationLineageKey,
  );
  if (locationId === undefined) {
    return null;
  }

  if (placement.occupancyScope.kind === "resource") {
    return {
      locationId,
      occupancyScope: placement.occupancyScope,
    };
  }

  const practitionerId = resolvePractitionerId(
    placement.occupancyScope.practitionerLineageKey,
    maps,
  );
  if (practitionerId === undefined) {
    return null;
  }

  return {
    locationId,
    occupancyScope: { kind: "practitioner", practitionerId },
  };
}

export function resolveBlockedSlotPlacementLineageRefs(
  args: {
    locationId: Id<"locations">;
    occupancyScope: BlockedSlotDisplayOccupancyScope;
  },
  maps: CalendarReferenceMaps,
): CalendarBlockedSlotPlacement | null {
  const locationLineageKey = maps.locationLineageKeyById.get(args.locationId);
  if (locationLineageKey === undefined) {
    return null;
  }

  if (args.occupancyScope.kind === "resource") {
    return {
      locationLineageKey,
      occupancyScope: args.occupancyScope,
    };
  }

  const practitionerLineageKey = resolvePractitionerLineageKey(
    args.occupancyScope.practitionerId,
    maps,
  );
  if (practitionerLineageKey === undefined) {
    return null;
  }

  return {
    locationLineageKey,
    occupancyScope: {
      kind: "practitioner",
      practitionerLineageKey,
    },
  };
}

export function toBlockedSlotEditorRecord(
  blockedSlot: CalendarBlockedSlotRecord,
  maps: CalendarReferenceMaps,
): CalendarBlockedSlotEditorRecord | null {
  const displayRefs = resolveBlockedSlotPlacementDisplayRefs(
    blockedSlot.placement,
    maps,
  );
  if (!displayRefs) {
    return null;
  }

  return {
    end: blockedSlot.end,
    locationId: displayRefs.locationId,
    occupancyScope: displayRefs.occupancyScope,
    practiceId: blockedSlot.practiceId,
    ...(displayRefs.occupancyScope.kind === "practitioner"
      ? { practitionerId: displayRefs.occupancyScope.practitionerId }
      : {}),
    start: blockedSlot.start,
    title: blockedSlot.title,
  };
}

function resolvePractitionerId(
  practitionerLineageKey: PractitionerLineageKey | undefined,
  maps: CalendarReferenceMaps,
): Id<"practitioners"> | undefined {
  return practitionerLineageKey === undefined
    ? undefined
    : maps.practitionerIdByLineageKey.get(practitionerLineageKey);
}

function resolvePractitionerLineageKey(
  practitionerId: Id<"practitioners"> | undefined,
  maps: CalendarReferenceMaps,
): PractitionerLineageKey | undefined {
  return practitionerId === undefined
    ? undefined
    : maps.practitionerLineageKeyById.get(practitionerId);
}
