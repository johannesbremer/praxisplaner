import { useCallback, useMemo } from "react";

import type { Id } from "../../../convex/_generated/dataModel";
import type {
  AppointmentTypeLineageKey,
  LocationLineageKey,
  PractitionerLineageKey,
} from "../../../convex/identity";
import type {
  CalendarBlockedSlotEditorRecord,
  CalendarBlockedSlotRecord,
} from "./types";

import {
  type CalendarReferenceMaps,
  resolveAppointmentDisplayRefs,
  resolveAppointmentLineageRefs,
  resolveBlockedSlotDisplayRefs,
  resolveBlockedSlotLineageRefs,
  toBlockedSlotEditorRecord,
} from "./calendar-reference-adapters";

interface CalendarReferenceResolverArgs {
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

export function useCalendarReferenceResolver({
  appointmentTypeIdByLineageKey,
  appointmentTypeLineageKeyById,
  locationIdByLineageKey,
  locationLineageKeyById,
  practitionerIdByLineageKey,
  practitionerLineageKeyById,
}: CalendarReferenceResolverArgs) {
  const referenceMaps: CalendarReferenceMaps = useMemo(
    () => ({
      appointmentTypeIdByLineageKey,
      appointmentTypeLineageKeyById,
      locationIdByLineageKey,
      locationLineageKeyById,
      practitionerIdByLineageKey,
      practitionerLineageKeyById,
    }),
    [
      appointmentTypeIdByLineageKey,
      appointmentTypeLineageKeyById,
      locationIdByLineageKey,
      locationLineageKeyById,
      practitionerIdByLineageKey,
      practitionerLineageKeyById,
    ],
  );

  const getAppointmentTypeIdForLineageKey = useCallback(
    (appointmentTypeLineageKey: AppointmentTypeLineageKey) =>
      referenceMaps.appointmentTypeIdByLineageKey.get(
        appointmentTypeLineageKey,
      ),
    [referenceMaps],
  );

  const getLocationLineageKeyForDisplayId = useCallback(
    (locationId: Id<"locations">) =>
      referenceMaps.locationLineageKeyById.get(locationId),
    [referenceMaps],
  );

  const getLocationIdForLineageKey = useCallback(
    (locationLineageKey: LocationLineageKey) =>
      referenceMaps.locationIdByLineageKey.get(locationLineageKey),
    [referenceMaps],
  );

  const getPractitionerLineageKeyForDisplayId = useCallback(
    (practitionerId: Id<"practitioners">) =>
      referenceMaps.practitionerLineageKeyById.get(practitionerId),
    [referenceMaps],
  );

  const getPractitionerIdForLineageKey = useCallback(
    (practitionerLineageKey: PractitionerLineageKey) =>
      referenceMaps.practitionerIdByLineageKey.get(practitionerLineageKey),
    [referenceMaps],
  );

  const resolveAppointmentReferenceLineageKeys = useCallback(
    (args: {
      appointmentTypeId: Id<"appointmentTypes">;
      locationId: Id<"locations">;
      practitionerId?: Id<"practitioners">;
    }) => resolveAppointmentLineageRefs(args, referenceMaps),
    [referenceMaps],
  );

  const resolveAppointmentReferenceDisplayIds = useCallback(
    (args: {
      appointmentTypeLineageKey: AppointmentTypeLineageKey;
      locationLineageKey: LocationLineageKey;
      practitionerLineageKey?: PractitionerLineageKey;
    }) => resolveAppointmentDisplayRefs(args, referenceMaps),
    [referenceMaps],
  );

  const resolveBlockedSlotReferenceLineageKeys = useCallback(
    (args: {
      locationId: Id<"locations">;
      practitionerId?: Id<"practitioners">;
    }) => resolveBlockedSlotLineageRefs(args, referenceMaps),
    [referenceMaps],
  );

  const resolveBlockedSlotReferenceDisplayIds = useCallback(
    (args: {
      locationLineageKey: LocationLineageKey;
      practitionerLineageKey?: PractitionerLineageKey;
    }) => resolveBlockedSlotDisplayRefs(args, referenceMaps),
    [referenceMaps],
  );

  const toBlockedSlotEditorData = useCallback(
    (
      blockedSlot: CalendarBlockedSlotRecord,
    ): CalendarBlockedSlotEditorRecord | null =>
      toBlockedSlotEditorRecord(blockedSlot, referenceMaps),
    [referenceMaps],
  );

  return {
    getAppointmentTypeIdForLineageKey,
    getLocationIdForLineageKey,
    getLocationLineageKeyForDisplayId,
    getPractitionerIdForLineageKey,
    getPractitionerLineageKeyForDisplayId,
    referenceMaps,
    resolveAppointmentReferenceDisplayIds,
    resolveAppointmentReferenceLineageKeys,
    resolveBlockedSlotReferenceDisplayIds,
    resolveBlockedSlotReferenceLineageKeys,
    toBlockedSlotEditorData,
  };
}
