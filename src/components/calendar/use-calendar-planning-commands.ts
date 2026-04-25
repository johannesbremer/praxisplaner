import { useMutation } from "convex/react";
import { useCallback } from "react";
import { toast } from "sonner";

import type { Id } from "../../../convex/_generated/dataModel";
import type {
  AppointmentTypeLineageKey,
  LocationLineageKey,
  PractitionerLineageKey,
} from "../../../convex/identity";
import type { ZonedDateTimeString } from "../../../convex/typedDtos";
import type { CalendarDayQueryArgs } from "./calendar-query-args";
import type {
  CalendarAppointmentRecord,
  CalendarBlockedSlotRecord,
} from "./types";

import { api } from "../../../convex/_generated/api";
import { createOptimisticId } from "../../utils/convex-ids";
import {
  matchesCalendarDayQueryEntity,
  shouldCollapseOptimisticReplacementInDayQuery,
} from "./calendar-day-query-membership";
import {
  toCalendarAppointmentRecord,
  toCalendarAppointmentResult,
  toCalendarBlockedSlotRecord,
  toCalendarBlockedSlotResult,
} from "./calendar-view-models";

const appointmentQueryRef = api.appointments.getCalendarDayAppointments;
const blockedSlotQueryRef = api.appointments.getCalendarDayBlockedSlots;

interface AppointmentDisplayRefs {
  appointmentTypeId: Id<"appointmentTypes">;
  locationId: Id<"locations">;
  practitionerId?: Id<"practitioners">;
}

interface AppointmentLineageRefs {
  appointmentTypeLineageKey: AppointmentTypeLineageKey;
  locationLineageKey: LocationLineageKey;
  practitionerLineageKey?: PractitionerLineageKey;
}

interface AppointmentTypeInfo {
  duration: number;
  hasFollowUpPlan: boolean;
  name: string;
}

interface BlockedSlotDisplayRefs {
  locationId: Id<"locations">;
  practitionerId?: Id<"practitioners">;
}

interface BlockedSlotLineageRefs {
  locationLineageKey: LocationLineageKey;
  practitionerLineageKey?: PractitionerLineageKey;
}

interface UseCalendarPlanningCommandsArgs {
  blockedSlotsQueryArgs: CalendarDayQueryArgs | null;
  calendarDayQueryArgs: CalendarDayQueryArgs | null;
  forgetAppointmentHistoryDoc: (id: Id<"appointments">) => void;
  forgetBlockedSlotHistoryDoc: (id: Id<"blockedSlots">) => void;
  getAppointmentCreationEnd: (args: {
    durationMinutes: number;
    start: string;
  }) => string;
  getAppointmentHistoryDoc: (
    id: Id<"appointments">,
  ) => CalendarAppointmentRecord | undefined;
  getAppointmentUpdateMutationHistoryDoc: (
    id: Id<"appointments">,
  ) => CalendarAppointmentRecord | undefined;
  getBlockedSlotHistoryDoc: (
    id: Id<"blockedSlots">,
  ) => CalendarBlockedSlotRecord | undefined;
  getCurrentAppointmentDoc: (
    id: Id<"appointments">,
  ) => CalendarAppointmentRecord | undefined;
  getCurrentBlockedSlotDoc: (
    id: Id<"blockedSlots">,
  ) => CalendarBlockedSlotRecord | undefined;
  getLocationLineageKeyForDisplayId: (
    locationId: Id<"locations">,
  ) => LocationLineageKey | undefined;
  getPractitionerLineageKeyForDisplayId: (
    practitionerId: Id<"practitioners">,
  ) => PractitionerLineageKey | undefined;
  getRequiredAppointmentTypeInfo: (
    appointmentTypeId: Id<"appointmentTypes">,
    source: string,
  ) => AppointmentTypeInfo | null;
  hasAppointmentConflict: (
    candidate: {
      end: string;
      isSimulation: boolean;
      locationLineageKey: LocationLineageKey;
      practitionerLineageKey?: PractitionerLineageKey;
      replacesAppointmentId?: Id<"appointments">;
      start: string;
    },
    excludedId?: Id<"appointments">,
  ) => boolean;
  hasBlockedSlotConflict: (
    candidate: {
      end: string;
      isSimulation: boolean;
      locationLineageKey: LocationLineageKey;
      practitionerLineageKey?: PractitionerLineageKey;
      start: string;
    },
    excludedId?: Id<"blockedSlots">,
  ) => boolean;
  parseZonedDateTime: (
    value: string,
    source: string,
  ) => null | ZonedDateTimeString;
  pushHistoryAction: ReturnType<
    typeof import("../../hooks/use-local-history").useLocalHistory
  >["pushAction"];
  refreshAllPracticeConflictData: () => Promise<void>;
  rememberAppointmentHistoryDoc: (
    appointment: CalendarAppointmentRecord,
  ) => void;
  rememberBlockedSlotHistoryDoc: (
    blockedSlot: CalendarBlockedSlotRecord,
  ) => void;
  rememberCreatedAppointmentFromStrings: (args: {
    appointmentTypeLineageKey: AppointmentTypeLineageKey;
    appointmentTypeTitle: string;
    createdId: Id<"appointments">;
    createEnd: string;
    createStart: string;
    isSimulation: boolean;
    locationLineageKey: LocationLineageKey;
    patientId?: Id<"patients">;
    practiceId: Id<"practices">;
    practitionerLineageKey?: PractitionerLineageKey;
    replacesAppointmentId?: Id<"appointments">;
    title: string;
    userId?: Id<"users">;
  }) => boolean;
  rememberCreatedBlockedSlotHistoryDoc: (args: {
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
  }) => void;
  resolveAppointmentReferenceDisplayIds: (args: {
    appointmentTypeLineageKey: AppointmentTypeLineageKey;
    locationLineageKey: LocationLineageKey;
    practitionerLineageKey?: PractitionerLineageKey;
  }) => AppointmentDisplayRefs | null;
  resolveAppointmentReferenceLineageKeys: (args: {
    appointmentTypeId: Id<"appointmentTypes">;
    locationId: Id<"locations">;
    practitionerId?: Id<"practitioners">;
  }) => AppointmentLineageRefs | null;
  resolveBlockedSlotReferenceDisplayIds: (args: {
    locationLineageKey: LocationLineageKey;
    practitionerLineageKey?: PractitionerLineageKey;
  }) => BlockedSlotDisplayRefs | null;
  resolveBlockedSlotReferenceLineageKeys: (args: {
    locationId: Id<"locations">;
    practitionerId?: Id<"practitioners">;
  }) => BlockedSlotLineageRefs | null;
}

export function useCalendarPlanningCommands({
  blockedSlotsQueryArgs,
  calendarDayQueryArgs,
  forgetAppointmentHistoryDoc,
  forgetBlockedSlotHistoryDoc,
  getAppointmentCreationEnd,
  getAppointmentHistoryDoc,
  getAppointmentUpdateMutationHistoryDoc,
  getBlockedSlotHistoryDoc,
  getCurrentAppointmentDoc,
  getCurrentBlockedSlotDoc,
  getLocationLineageKeyForDisplayId,
  getPractitionerLineageKeyForDisplayId,
  getRequiredAppointmentTypeInfo,
  hasAppointmentConflict,
  hasBlockedSlotConflict,
  parseZonedDateTime,
  pushHistoryAction,
  refreshAllPracticeConflictData,
  rememberAppointmentHistoryDoc,
  rememberBlockedSlotHistoryDoc,
  rememberCreatedAppointmentFromStrings,
  rememberCreatedBlockedSlotHistoryDoc,
  resolveAppointmentReferenceDisplayIds,
  resolveAppointmentReferenceLineageKeys,
  resolveBlockedSlotReferenceDisplayIds,
  resolveBlockedSlotReferenceLineageKeys,
}: UseCalendarPlanningCommandsArgs) {
  const ensureLatestConflictData = useCallback(async () => {
    await refreshAllPracticeConflictData();
  }, [refreshAllPracticeConflictData]);

  // Mutations
  const createAppointmentMutation = useMutation(
    api.appointments.createAppointment,
  );
  const updateAppointmentMutation = useMutation(
    api.appointments.updateAppointment,
  );
  const updateSimulationAppointmentMutation = useMutation(
    api.appointments.updateSimulationAppointment,
  );
  const updateVacationReassignmentAppointmentMutation = useMutation(
    api.appointments.updateVacationReassignmentAppointment,
  );
  const deleteAppointmentMutation = useMutation(
    api.appointments.deleteAppointment,
  );
  const createBlockedSlotMutation = useMutation(
    api.appointments.createBlockedSlot,
  );
  const deleteBlockedSlotMutation = useMutation(
    api.appointments.deleteBlockedSlot,
  );
  const updateBlockedSlotMutation = useMutation(
    api.appointments.updateBlockedSlot,
  );

  const runCreateAppointmentInternal = useCallback(
    async (args: Parameters<typeof createAppointmentMutation>[0]) => {
      return await createAppointmentMutation.withOptimisticUpdate(
        (localStore, optimisticArgs) => {
          if (!calendarDayQueryArgs) {
            return;
          }
          const existingAppointments = localStore.getQuery(
            appointmentQueryRef,
            calendarDayQueryArgs,
          );

          if (!existingAppointments) {
            return;
          }

          const now = Date.now();
          const tempId = createOptimisticId<"appointments">();

          const appointmentTypeInfo = getRequiredAppointmentTypeInfo(
            optimisticArgs.appointmentTypeId,
            "useCalendarPlanningCommands.optimisticCreate",
          );
          if (!appointmentTypeInfo) {
            return;
          }
          const lineageRefs = resolveAppointmentReferenceLineageKeys({
            appointmentTypeId: optimisticArgs.appointmentTypeId,
            locationId: optimisticArgs.locationId,
            ...(optimisticArgs.practitionerId === undefined
              ? {}
              : { practitionerId: optimisticArgs.practitionerId }),
          });
          if (!lineageRefs) {
            return;
          }
          const optimisticEnd = getAppointmentCreationEnd({
            durationMinutes: appointmentTypeInfo.duration,
            start: optimisticArgs.start,
          });
          const typedStart = parseZonedDateTime(
            optimisticArgs.start,
            "useCalendarPlanningCommands.optimisticCreate.start",
          );
          const typedEnd = parseZonedDateTime(
            optimisticEnd,
            "useCalendarPlanningCommands.optimisticCreate.end",
          );
          if (!typedStart || !typedEnd) {
            return;
          }

          const newAppointmentRecord: CalendarAppointmentRecord = {
            _creationTime: now,
            _id: tempId,
            appointmentTypeLineageKey: lineageRefs.appointmentTypeLineageKey,
            appointmentTypeTitle: appointmentTypeInfo.name,
            createdAt: BigInt(now),
            end: typedEnd,
            isSimulation: optimisticArgs.isSimulation ?? false,
            lastModified: BigInt(now),
            locationLineageKey: lineageRefs.locationLineageKey,
            practiceId: optimisticArgs.practiceId,
            start: typedStart,
            title: optimisticArgs.title,
          };

          if (
            optimisticArgs.practitionerId !== undefined &&
            lineageRefs.practitionerLineageKey !== undefined
          ) {
            newAppointmentRecord.practitionerLineageKey =
              lineageRefs.practitionerLineageKey;
          }

          if (optimisticArgs.patientId !== undefined) {
            newAppointmentRecord.patientId = optimisticArgs.patientId;
          }

          if (optimisticArgs.userId !== undefined) {
            newAppointmentRecord.userId = optimisticArgs.userId;
          }

          if (optimisticArgs.replacesAppointmentId !== undefined) {
            newAppointmentRecord.replacesAppointmentId =
              optimisticArgs.replacesAppointmentId;
          }
          const newAppointment = toCalendarAppointmentResult({
            appointmentTypeId: optimisticArgs.appointmentTypeId,
            locationId: optimisticArgs.locationId,
            ...(optimisticArgs.practitionerId === undefined
              ? {}
              : { practitionerId: optimisticArgs.practitionerId }),
            record: newAppointmentRecord,
          });

          const shouldCollapseReplacement =
            optimisticArgs.replacesAppointmentId !== undefined &&
            shouldCollapseOptimisticReplacementInDayQuery({
              isSimulation: newAppointment.isSimulation === true,
              scope: calendarDayQueryArgs.scope,
            });
          const baseList = shouldCollapseReplacement
            ? existingAppointments.filter(
                (apt) => apt._id !== optimisticArgs.replacesAppointmentId,
              )
            : existingAppointments;
          const shouldAppend = matchesCalendarDayQueryEntity(
            calendarDayQueryArgs,
            newAppointment,
          );
          if (baseList === existingAppointments && !shouldAppend) {
            return;
          }

          localStore.setQuery(
            appointmentQueryRef,
            calendarDayQueryArgs,
            shouldAppend ? [...baseList, newAppointment] : baseList,
          );
        },
      )(args);
    },
    [
      calendarDayQueryArgs,
      createAppointmentMutation,
      getAppointmentCreationEnd,
      getRequiredAppointmentTypeInfo,
      parseZonedDateTime,
      resolveAppointmentReferenceLineageKeys,
    ],
  );

  const applyOptimisticAppointmentUpdate = useCallback(
    (
      localStore: Parameters<
        Parameters<typeof updateAppointmentMutation.withOptimisticUpdate>[0]
      >[0],
      optimisticArgs: Parameters<typeof updateAppointmentMutation>[0],
    ) => {
      if (!calendarDayQueryArgs) {
        return;
      }
      const existingAppointments = localStore.getQuery(
        appointmentQueryRef,
        calendarDayQueryArgs,
      );
      if (!existingAppointments) {
        return;
      }

      const now = Date.now();
      const updatedAppointments = existingAppointments.map((appointment) => {
        if (appointment._id !== optimisticArgs.id) {
          return appointment;
        }

        const currentRecord = toCalendarAppointmentRecord(appointment);

        const nextStart =
          optimisticArgs.start === undefined
            ? undefined
            : parseZonedDateTime(
                optimisticArgs.start,
                "useCalendarPlanningCommands.optimisticUpdate.start",
              );
        const nextEnd =
          optimisticArgs.end === undefined
            ? undefined
            : parseZonedDateTime(
                optimisticArgs.end,
                "useCalendarPlanningCommands.optimisticUpdate.end",
              );
        if (
          (optimisticArgs.start !== undefined && nextStart === null) ||
          (optimisticArgs.end !== undefined && nextEnd === null)
        ) {
          return appointment;
        }

        const timeUpdates: Partial<
          Pick<CalendarAppointmentRecord, "end" | "start">
        > = {};
        if (nextStart !== undefined && nextStart !== null) {
          timeUpdates.start = nextStart;
        }
        if (nextEnd !== undefined && nextEnd !== null) {
          timeUpdates.end = nextEnd;
        }

        const lineageRefs =
          optimisticArgs.locationId === undefined &&
          optimisticArgs.practitionerId === undefined
            ? null
            : resolveBlockedSlotReferenceLineageKeys({
                locationId: optimisticArgs.locationId ?? appointment.locationId,
                ...(optimisticArgs.practitionerId === undefined
                  ? appointment.practitionerId === undefined
                    ? {}
                    : { practitionerId: appointment.practitionerId }
                  : { practitionerId: optimisticArgs.practitionerId }),
              });

        const nextRecord: CalendarAppointmentRecord = {
          ...currentRecord,
          ...timeUpdates,
          ...(lineageRefs === null
            ? {}
            : {
                locationLineageKey: lineageRefs.locationLineageKey,
                ...(lineageRefs.practitionerLineageKey === undefined
                  ? {}
                  : {
                      practitionerLineageKey:
                        lineageRefs.practitionerLineageKey,
                    }),
              }),
          ...(optimisticArgs.title !== undefined && {
            title: optimisticArgs.title,
          }),
          lastModified: BigInt(now),
        };

        return toCalendarAppointmentResult({
          appointmentTypeId: appointment.appointmentTypeId,
          locationId: optimisticArgs.locationId ?? appointment.locationId,
          ...(optimisticArgs.practitionerId === undefined
            ? appointment.practitionerId === undefined
              ? {}
              : { practitionerId: appointment.practitionerId }
            : { practitionerId: optimisticArgs.practitionerId }),
          record: nextRecord,
        });
      });

      localStore.setQuery(
        appointmentQueryRef,
        calendarDayQueryArgs,
        updatedAppointments,
      );
    },
    [
      calendarDayQueryArgs,
      parseZonedDateTime,
      resolveBlockedSlotReferenceLineageKeys,
      updateAppointmentMutation,
    ],
  );

  const getAppointmentUpdateMutation = useCallback(
    (appointment?: CalendarAppointmentRecord) => {
      if (
        appointment?.isSimulation === true &&
        (appointment.simulationKind === "activation-reassignment" ||
          appointment.reassignmentSourceVacationLineageKey !== undefined)
      ) {
        return updateVacationReassignmentAppointmentMutation;
      }

      if (appointment?.isSimulation === true) {
        return updateSimulationAppointmentMutation;
      }

      return updateAppointmentMutation;
    },
    [
      updateAppointmentMutation,
      updateSimulationAppointmentMutation,
      updateVacationReassignmentAppointmentMutation,
    ],
  );

  const runUpdateAppointmentInternal = useCallback(
    async (args: Parameters<typeof updateAppointmentMutation>[0]) => {
      const mutation = getAppointmentUpdateMutation(
        getAppointmentUpdateMutationHistoryDoc(args.id),
      );

      return await mutation.withOptimisticUpdate(
        applyOptimisticAppointmentUpdate,
      )(args);
    },
    [
      applyOptimisticAppointmentUpdate,
      getAppointmentUpdateMutationHistoryDoc,
      getAppointmentUpdateMutation,
    ],
  );

  const runDeleteAppointmentInternal = useCallback(
    async (args: Parameters<typeof deleteAppointmentMutation>[0]) => {
      return await deleteAppointmentMutation.withOptimisticUpdate(
        (localStore, optimisticArgs) => {
          if (!calendarDayQueryArgs) {
            return;
          }
          const existingAppointments = localStore.getQuery(
            appointmentQueryRef,
            calendarDayQueryArgs,
          );
          if (!existingAppointments) {
            return;
          }

          const updatedAppointments = existingAppointments.filter(
            (appointment) => appointment._id !== optimisticArgs.id,
          );

          localStore.setQuery(
            appointmentQueryRef,
            calendarDayQueryArgs,
            updatedAppointments,
          );
        },
      )(args);
    },
    [calendarDayQueryArgs, deleteAppointmentMutation],
  );

  const runCreateBlockedSlotInternal = useCallback(
    async (args: Parameters<typeof createBlockedSlotMutation>[0]) => {
      return await createBlockedSlotMutation.withOptimisticUpdate(
        (localStore, optimisticArgs) => {
          if (!blockedSlotsQueryArgs) {
            return;
          }
          const existingBlockedSlots = localStore.getQuery(
            blockedSlotQueryRef,
            blockedSlotsQueryArgs,
          );

          if (!existingBlockedSlots) {
            return;
          }

          const now = Date.now();
          const tempId = createOptimisticId<"blockedSlots">();
          const lineageRefs = resolveBlockedSlotReferenceLineageKeys({
            locationId: optimisticArgs.locationId,
            ...(optimisticArgs.practitionerId === undefined
              ? {}
              : { practitionerId: optimisticArgs.practitionerId }),
          });
          if (!lineageRefs) {
            return;
          }

          const newBlockedSlotRecord: CalendarBlockedSlotRecord = {
            _creationTime: now,
            _id: tempId,
            createdAt: BigInt(now),
            end: optimisticArgs.end,
            isSimulation: optimisticArgs.isSimulation ?? false,
            lastModified: BigInt(now),
            locationLineageKey: lineageRefs.locationLineageKey,
            practiceId: optimisticArgs.practiceId,
            start: optimisticArgs.start,
            title: optimisticArgs.title,
          };

          if (
            optimisticArgs.practitionerId !== undefined &&
            lineageRefs.practitionerLineageKey !== undefined
          ) {
            newBlockedSlotRecord.practitionerLineageKey =
              lineageRefs.practitionerLineageKey;
          }

          if (optimisticArgs.replacesBlockedSlotId !== undefined) {
            newBlockedSlotRecord.replacesBlockedSlotId =
              optimisticArgs.replacesBlockedSlotId;
          }
          const newBlockedSlot = toCalendarBlockedSlotResult({
            locationId: optimisticArgs.locationId,
            ...(optimisticArgs.practitionerId === undefined
              ? {}
              : { practitionerId: optimisticArgs.practitionerId }),
            record: newBlockedSlotRecord,
          });

          const shouldCollapseReplacement =
            optimisticArgs.replacesBlockedSlotId !== undefined &&
            shouldCollapseOptimisticReplacementInDayQuery({
              isSimulation: newBlockedSlot.isSimulation === true,
              scope: blockedSlotsQueryArgs.scope,
            });
          const baseList = shouldCollapseReplacement
            ? existingBlockedSlots.filter(
                (slot) => slot._id !== optimisticArgs.replacesBlockedSlotId,
              )
            : existingBlockedSlots;
          const shouldAppend = matchesCalendarDayQueryEntity(
            blockedSlotsQueryArgs,
            newBlockedSlot,
          );
          if (baseList === existingBlockedSlots && !shouldAppend) {
            return;
          }

          localStore.setQuery(
            blockedSlotQueryRef,
            blockedSlotsQueryArgs,
            shouldAppend ? [...baseList, newBlockedSlot] : baseList,
          );
        },
      )(args);
    },
    [
      createBlockedSlotMutation,
      blockedSlotsQueryArgs,
      resolveBlockedSlotReferenceLineageKeys,
    ],
  );

  const runUpdateBlockedSlotInternal = useCallback(
    async (args: Parameters<typeof updateBlockedSlotMutation>[0]) => {
      return await updateBlockedSlotMutation.withOptimisticUpdate(
        (localStore, optimisticArgs) => {
          if (!blockedSlotsQueryArgs) {
            return;
          }
          const existingBlockedSlots = localStore.getQuery(
            blockedSlotQueryRef,
            blockedSlotsQueryArgs,
          );

          if (!existingBlockedSlots) {
            return;
          }

          const now = Date.now();

          const updatedBlockedSlots = existingBlockedSlots.map((slot) => {
            if (slot._id !== optimisticArgs.id) {
              return slot;
            }

            const currentRecord = toCalendarBlockedSlotRecord(slot);
            const lineageRefs =
              optimisticArgs.locationId === undefined &&
              optimisticArgs.practitionerId === undefined
                ? null
                : resolveBlockedSlotReferenceLineageKeys({
                    locationId: optimisticArgs.locationId ?? slot.locationId,
                    ...(optimisticArgs.practitionerId === undefined
                      ? slot.practitionerId === undefined
                        ? {}
                        : { practitionerId: slot.practitionerId }
                      : { practitionerId: optimisticArgs.practitionerId }),
                  });

            const nextRecord: CalendarBlockedSlotRecord = {
              ...currentRecord,
              ...(optimisticArgs.title !== undefined && {
                title: optimisticArgs.title,
              }),
              ...(optimisticArgs.start !== undefined && {
                start: optimisticArgs.start,
              }),
              ...(optimisticArgs.end !== undefined && {
                end: optimisticArgs.end,
              }),
              ...(lineageRefs === null
                ? {}
                : {
                    locationLineageKey: lineageRefs.locationLineageKey,
                    ...(lineageRefs.practitionerLineageKey === undefined
                      ? {}
                      : {
                          practitionerLineageKey:
                            lineageRefs.practitionerLineageKey,
                        }),
                  }),
              ...(optimisticArgs.replacesBlockedSlotId !== undefined && {
                replacesBlockedSlotId: optimisticArgs.replacesBlockedSlotId,
              }),
              ...(optimisticArgs.isSimulation !== undefined && {
                isSimulation: optimisticArgs.isSimulation,
              }),
              lastModified: BigInt(now),
            };

            return toCalendarBlockedSlotResult({
              locationId: optimisticArgs.locationId ?? slot.locationId,
              ...(optimisticArgs.practitionerId === undefined
                ? slot.practitionerId === undefined
                  ? {}
                  : { practitionerId: slot.practitionerId }
                : { practitionerId: optimisticArgs.practitionerId }),
              record: nextRecord,
            });
          });

          localStore.setQuery(
            blockedSlotQueryRef,
            blockedSlotsQueryArgs,
            updatedBlockedSlots,
          );
        },
      )(args);
    },
    [
      updateBlockedSlotMutation,
      blockedSlotsQueryArgs,
      resolveBlockedSlotReferenceLineageKeys,
    ],
  );

  const runDeleteBlockedSlotInternal = useCallback(
    async (args: Parameters<typeof deleteBlockedSlotMutation>[0]) => {
      return await deleteBlockedSlotMutation.withOptimisticUpdate(
        (localStore, optimisticArgs) => {
          if (!blockedSlotsQueryArgs) {
            return;
          }
          const existingBlockedSlots = localStore.getQuery(
            blockedSlotQueryRef,
            blockedSlotsQueryArgs,
          );

          if (!existingBlockedSlots) {
            return;
          }

          localStore.setQuery(
            blockedSlotQueryRef,
            blockedSlotsQueryArgs,
            existingBlockedSlots.filter(
              (slot) => slot._id !== optimisticArgs.id,
            ),
          );
        },
      )(args);
    },
    [blockedSlotsQueryArgs, deleteBlockedSlotMutation],
  );

  const runCreateAppointment = useCallback(
    async (args: Parameters<typeof createAppointmentMutation>[0]) => {
      const appointmentTypeInfo = getRequiredAppointmentTypeInfo(
        args.appointmentTypeId,
        "useCalendarPlanningCommands.runCreateAppointment",
      );
      if (!appointmentTypeInfo) {
        toast.error("Die Terminart konnte nicht geladen werden.");
        return;
      }
      if (appointmentTypeInfo.hasFollowUpPlan) {
        return await createAppointmentMutation(args);
      }

      const createdId = await runCreateAppointmentInternal(args);
      if (!createdId) {
        return createdId;
      }

      let currentAppointmentId: Id<"appointments"> = createdId;
      const createArgs = { ...args, isSimulation: args.isSimulation ?? false };
      const createEnd = getAppointmentCreationEnd({
        durationMinutes: appointmentTypeInfo.duration,
        start: createArgs.start,
      });
      const appointmentReferences = resolveAppointmentReferenceLineageKeys({
        appointmentTypeId: createArgs.appointmentTypeId,
        locationId: createArgs.locationId,
        ...(createArgs.practitionerId && {
          practitionerId: createArgs.practitionerId,
        }),
      });
      if (!appointmentReferences) {
        toast.error("Termin-Referenzen konnten nicht aufgelöst werden.");
        return createdId;
      }
      rememberCreatedAppointmentFromStrings({
        appointmentTypeLineageKey:
          appointmentReferences.appointmentTypeLineageKey,
        appointmentTypeTitle: appointmentTypeInfo.name,
        createdId,
        createEnd,
        createStart: createArgs.start,
        isSimulation: createArgs.isSimulation,
        locationLineageKey: appointmentReferences.locationLineageKey,
        ...(createArgs.patientId && { patientId: createArgs.patientId }),
        practiceId: createArgs.practiceId,
        ...(appointmentReferences.practitionerLineageKey && {
          practitionerLineageKey: appointmentReferences.practitionerLineageKey,
        }),
        ...(createArgs.replacesAppointmentId && {
          replacesAppointmentId: createArgs.replacesAppointmentId,
        }),
        title: createArgs.title,
        ...(createArgs.userId && { userId: createArgs.userId }),
      });

      pushHistoryAction({
        label: "Termin erstellt",
        redo: async () => {
          await ensureLatestConflictData();
          if (
            hasAppointmentConflict({
              end: createEnd,
              isSimulation: createArgs.isSimulation,
              locationLineageKey: appointmentReferences.locationLineageKey,
              ...(appointmentReferences.practitionerLineageKey && {
                practitionerLineageKey:
                  appointmentReferences.practitionerLineageKey,
              }),
              ...(createArgs.replacesAppointmentId && {
                replacesAppointmentId: createArgs.replacesAppointmentId,
              }),
              start: createArgs.start,
            })
          ) {
            return {
              message:
                "Der Termin kann nicht wiederhergestellt werden, weil der Zeitraum bereits belegt ist.",
              status: "conflict",
            };
          }

          const recreatedId = await runCreateAppointmentInternal(createArgs);
          if (!recreatedId) {
            return { status: "conflict" };
          }

          currentAppointmentId = recreatedId;
          rememberCreatedAppointmentFromStrings({
            appointmentTypeLineageKey:
              appointmentReferences.appointmentTypeLineageKey,
            appointmentTypeTitle: appointmentTypeInfo.name,
            createdId: recreatedId,
            createEnd,
            createStart: createArgs.start,
            isSimulation: createArgs.isSimulation,
            locationLineageKey: appointmentReferences.locationLineageKey,
            ...(createArgs.patientId && { patientId: createArgs.patientId }),
            practiceId: createArgs.practiceId,
            ...(appointmentReferences.practitionerLineageKey && {
              practitionerLineageKey:
                appointmentReferences.practitionerLineageKey,
            }),
            ...(createArgs.replacesAppointmentId && {
              replacesAppointmentId: createArgs.replacesAppointmentId,
            }),
            title: createArgs.title,
            ...(createArgs.userId && { userId: createArgs.userId }),
          });
          return { status: "applied" };
        },
        undo: async () => {
          try {
            await runDeleteAppointmentInternal({ id: currentAppointmentId });
            forgetAppointmentHistoryDoc(currentAppointmentId);
            return { status: "applied" };
          } catch {
            forgetAppointmentHistoryDoc(currentAppointmentId);
            return {
              message: "Der Termin wurde bereits entfernt.",
              status: "conflict",
            };
          }
        },
      });

      return createdId;
    },
    [
      createAppointmentMutation,
      ensureLatestConflictData,
      forgetAppointmentHistoryDoc,
      getAppointmentCreationEnd,
      getRequiredAppointmentTypeInfo,
      hasAppointmentConflict,
      pushHistoryAction,
      rememberCreatedAppointmentFromStrings,
      resolveAppointmentReferenceLineageKeys,
      runCreateAppointmentInternal,
      runDeleteAppointmentInternal,
    ],
  );

  const runUpdateAppointment = useCallback(
    async (args: Parameters<typeof updateAppointmentMutation>[0]) => {
      const before = getAppointmentHistoryDoc(args.id);
      if (before?.seriesId) {
        await getAppointmentUpdateMutation(before)(args);
        return;
      }

      const nextLocationLineageKey =
        args.locationId === undefined
          ? before?.locationLineageKey
          : getLocationLineageKeyForDisplayId(args.locationId);
      if (
        args.locationId !== undefined &&
        nextLocationLineageKey === undefined
      ) {
        toast.error("Standort konnte nicht aufgelöst werden.");
        return;
      }
      const nextPractitionerLineageKey =
        args.practitionerId === undefined
          ? before?.practitionerLineageKey
          : getPractitionerLineageKeyForDisplayId(args.practitionerId);
      if (
        args.practitionerId !== undefined &&
        nextPractitionerLineageKey === undefined
      ) {
        toast.error("Behandler konnte nicht aufgelöst werden.");
        return;
      }

      await runUpdateAppointmentInternal(args);

      if (!before) {
        return;
      }

      const beforeState = {
        end: before.end,
        locationLineageKey: before.locationLineageKey,
        practitionerLineageKey: before.practitionerLineageKey,
        start: before.start,
      };
      const typedEnd =
        args.end === undefined
          ? undefined
          : parseZonedDateTime(
              args.end,
              "useCalendarPlanningCommands.afterState.end",
            );
      const typedStart =
        args.start === undefined
          ? undefined
          : parseZonedDateTime(
              args.start,
              "useCalendarPlanningCommands.afterState.start",
            );
      if (
        (args.end !== undefined && typedEnd === null) ||
        (args.start !== undefined && typedStart === null)
      ) {
        return;
      }
      const afterState = {
        end: typedEnd ?? before.end,
        locationLineageKey: nextLocationLineageKey ?? before.locationLineageKey,
        practitionerLineageKey:
          nextPractitionerLineageKey ?? before.practitionerLineageKey,
        start: typedStart ?? before.start,
      };
      const afterSnapshot: CalendarAppointmentRecord = {
        ...before,
        end: afterState.end,
        locationLineageKey: afterState.locationLineageKey,
        ...(afterState.practitionerLineageKey === undefined
          ? {}
          : { practitionerLineageKey: afterState.practitionerLineageKey }),
        start: afterState.start,
      };
      rememberAppointmentHistoryDoc(afterSnapshot);

      const matchesState = (
        appointment: CalendarAppointmentRecord,
        expected: typeof beforeState,
      ) =>
        appointment.start === expected.start &&
        appointment.end === expected.end &&
        appointment.locationLineageKey === expected.locationLineageKey &&
        appointment.practitionerLineageKey === expected.practitionerLineageKey;

      const candidatePayload = (
        state: typeof beforeState,
      ): {
        end: CalendarAppointmentRecord["end"];
        isSimulation: boolean;
        locationLineageKey: LocationLineageKey;
        practitionerLineageKey?: PractitionerLineageKey;
        start: CalendarAppointmentRecord["start"];
      } => ({
        end: state.end,
        isSimulation: before.isSimulation ?? false,
        locationLineageKey: state.locationLineageKey,
        ...(state.practitionerLineageKey && {
          practitionerLineageKey: state.practitionerLineageKey,
        }),
        start: state.start,
      });

      pushHistoryAction({
        label: "Termin aktualisiert",
        redo: async () => {
          await ensureLatestConflictData();
          const current = getCurrentAppointmentDoc(args.id);
          if (!current || !matchesState(current, beforeState)) {
            return {
              message:
                "Der Termin wurde zwischenzeitlich geändert und kann nicht erneut angewendet werden.",
              status: "conflict",
            };
          }

          if (hasAppointmentConflict(candidatePayload(afterState), args.id)) {
            return {
              message:
                "Die Terminänderung kollidiert mit einer neueren Terminplanung.",
              status: "conflict",
            };
          }

          const displayRefs = resolveBlockedSlotReferenceDisplayIds({
            locationLineageKey: afterState.locationLineageKey,
            ...(afterState.practitionerLineageKey && {
              practitionerLineageKey: afterState.practitionerLineageKey,
            }),
          });
          if (!displayRefs) {
            return {
              message:
                "Die Terminänderung kann nicht erneut angewendet werden, weil die Referenzen nicht mehr aufgelöst werden konnten.",
              status: "conflict",
            };
          }

          await runUpdateAppointmentInternal({
            end: afterState.end,
            id: args.id,
            locationId: displayRefs.locationId,
            ...(displayRefs.practitionerId && {
              practitionerId: displayRefs.practitionerId,
            }),
            start: afterState.start,
          });
          rememberAppointmentHistoryDoc(afterSnapshot);
          return { status: "applied" };
        },
        undo: async () => {
          await ensureLatestConflictData();
          const current = getCurrentAppointmentDoc(args.id);
          if (!current || !matchesState(current, afterState)) {
            return {
              message:
                "Der Termin wurde zwischenzeitlich geändert und kann nicht zurückgesetzt werden.",
              status: "conflict",
            };
          }

          if (hasAppointmentConflict(candidatePayload(beforeState), args.id)) {
            return {
              message:
                "Der ursprüngliche Termin kollidiert mit einer neueren Terminplanung.",
              status: "conflict",
            };
          }

          const displayRefs = resolveBlockedSlotReferenceDisplayIds({
            locationLineageKey: beforeState.locationLineageKey,
            ...(beforeState.practitionerLineageKey && {
              practitionerLineageKey: beforeState.practitionerLineageKey,
            }),
          });
          if (!displayRefs) {
            return {
              message:
                "Der ursprüngliche Termin kann nicht wiederhergestellt werden, weil die Referenzen nicht mehr aufgelöst werden konnten.",
              status: "conflict",
            };
          }

          await runUpdateAppointmentInternal({
            end: beforeState.end,
            id: args.id,
            locationId: displayRefs.locationId,
            ...(displayRefs.practitionerId && {
              practitionerId: displayRefs.practitionerId,
            }),
            start: beforeState.start,
          });
          rememberAppointmentHistoryDoc(before);
          return { status: "applied" };
        },
      });
    },
    [
      ensureLatestConflictData,
      getAppointmentHistoryDoc,
      getCurrentAppointmentDoc,
      getAppointmentUpdateMutation,
      getLocationLineageKeyForDisplayId,
      getPractitionerLineageKeyForDisplayId,
      hasAppointmentConflict,
      parseZonedDateTime,
      pushHistoryAction,
      rememberAppointmentHistoryDoc,
      resolveBlockedSlotReferenceDisplayIds,
      runUpdateAppointmentInternal,
    ],
  );

  const runDeleteAppointment = useCallback(
    async (args: Parameters<typeof deleteAppointmentMutation>[0]) => {
      const deleted = getAppointmentHistoryDoc(args.id);
      if (deleted?.seriesId) {
        await deleteAppointmentMutation(args);
        return;
      }

      await runDeleteAppointmentInternal(args);
      forgetAppointmentHistoryDoc(args.id);

      if (!deleted) {
        return;
      }

      let currentAppointmentId: Id<"appointments"> = args.id;
      const recreatedDisplayRefs = resolveAppointmentReferenceDisplayIds({
        appointmentTypeLineageKey: deleted.appointmentTypeLineageKey,
        locationLineageKey: deleted.locationLineageKey,
        ...(deleted.practitionerLineageKey && {
          practitionerLineageKey: deleted.practitionerLineageKey,
        }),
      });
      if (!recreatedDisplayRefs) {
        toast.error("Termin-Referenzen konnten nicht aufgelöst werden.");
        return;
      }

      const createArgs: Parameters<typeof createAppointmentMutation>[0] = {
        appointmentTypeId: recreatedDisplayRefs.appointmentTypeId,
        isSimulation: deleted.isSimulation ?? false,
        locationId: recreatedDisplayRefs.locationId,
        ...(deleted.patientId && { patientId: deleted.patientId }),
        practiceId: deleted.practiceId,
        ...(recreatedDisplayRefs.practitionerId && {
          practitionerId: recreatedDisplayRefs.practitionerId,
        }),
        ...(deleted.replacesAppointmentId && {
          replacesAppointmentId: deleted.replacesAppointmentId,
        }),
        start: deleted.start,
        title: deleted.title,
        ...(deleted.userId && { userId: deleted.userId }),
      };
      const appointmentTypeInfo = getRequiredAppointmentTypeInfo(
        createArgs.appointmentTypeId,
        "useCalendarPlanningCommands.runDeleteAppointment",
      );
      if (!appointmentTypeInfo) {
        return;
      }
      const createEnd = getAppointmentCreationEnd({
        durationMinutes: appointmentTypeInfo.duration,
        start: createArgs.start,
      });

      pushHistoryAction({
        label: "Termin gelöscht",
        redo: async () => {
          try {
            await runDeleteAppointmentInternal({ id: currentAppointmentId });
            forgetAppointmentHistoryDoc(currentAppointmentId);
            return { status: "applied" };
          } catch {
            forgetAppointmentHistoryDoc(currentAppointmentId);
            return { status: "applied" };
          }
        },
        undo: async () => {
          await ensureLatestConflictData();
          if (
            hasAppointmentConflict({
              end: createEnd,
              isSimulation: createArgs.isSimulation ?? false,
              locationLineageKey: deleted.locationLineageKey,
              ...(deleted.practitionerLineageKey && {
                practitionerLineageKey: deleted.practitionerLineageKey,
              }),
              ...(createArgs.replacesAppointmentId && {
                replacesAppointmentId: createArgs.replacesAppointmentId,
              }),
              start: createArgs.start,
            })
          ) {
            return {
              message:
                "Der gelöschte Termin kann nicht wiederhergestellt werden, weil der Zeitraum inzwischen belegt ist.",
              status: "conflict",
            };
          }

          const recreatedId = await runCreateAppointmentInternal(createArgs);
          if (!recreatedId) {
            return { status: "conflict" };
          }

          currentAppointmentId = recreatedId;
          rememberAppointmentHistoryDoc({
            ...deleted,
            _id: recreatedId,
          });
          return { status: "applied" };
        },
      });
    },
    [
      deleteAppointmentMutation,
      ensureLatestConflictData,
      forgetAppointmentHistoryDoc,
      getAppointmentHistoryDoc,
      getAppointmentCreationEnd,
      getRequiredAppointmentTypeInfo,
      hasAppointmentConflict,
      pushHistoryAction,
      rememberAppointmentHistoryDoc,
      resolveAppointmentReferenceDisplayIds,
      runCreateAppointmentInternal,
      runDeleteAppointmentInternal,
    ],
  );

  const runCreateBlockedSlot = useCallback(
    async (args: Parameters<typeof createBlockedSlotMutation>[0]) => {
      const createdId = await runCreateBlockedSlotInternal(args);
      if (!createdId) {
        return createdId;
      }

      let currentBlockedSlotId: Id<"blockedSlots"> = createdId;
      const createArgs = { ...args, isSimulation: args.isSimulation ?? false };
      const now = Date.now();
      const blockedSlotReferences = resolveBlockedSlotReferenceLineageKeys({
        locationId: createArgs.locationId,
        ...(createArgs.practitionerId && {
          practitionerId: createArgs.practitionerId,
        }),
      });
      if (!blockedSlotReferences) {
        toast.error("Sperrungs-Referenzen konnten nicht aufgelöst werden.");
        return createdId;
      }
      rememberCreatedBlockedSlotHistoryDoc({
        blockedSlotId: createdId,
        end: createArgs.end,
        isSimulation: createArgs.isSimulation,
        locationLineageKey: blockedSlotReferences.locationLineageKey,
        now,
        practiceId: createArgs.practiceId,
        ...(blockedSlotReferences.practitionerLineageKey && {
          practitionerLineageKey: blockedSlotReferences.practitionerLineageKey,
        }),
        ...(createArgs.replacesBlockedSlotId && {
          replacesBlockedSlotId: createArgs.replacesBlockedSlotId,
        }),
        start: createArgs.start,
        title: createArgs.title,
      });

      pushHistoryAction({
        label: "Sperrung erstellt",
        redo: async () => {
          await ensureLatestConflictData();
          if (
            hasBlockedSlotConflict({
              end: createArgs.end,
              isSimulation: createArgs.isSimulation,
              locationLineageKey: blockedSlotReferences.locationLineageKey,
              ...(blockedSlotReferences.practitionerLineageKey && {
                practitionerLineageKey:
                  blockedSlotReferences.practitionerLineageKey,
              }),
              start: createArgs.start,
            })
          ) {
            return {
              message:
                "Die Sperrung kann nicht wiederhergestellt werden, weil der Zeitraum inzwischen belegt ist.",
              status: "conflict",
            };
          }

          const recreatedId = await runCreateBlockedSlotInternal(createArgs);
          if (!recreatedId) {
            return { status: "conflict" };
          }

          currentBlockedSlotId = recreatedId;
          rememberCreatedBlockedSlotHistoryDoc({
            blockedSlotId: recreatedId,
            end: createArgs.end,
            isSimulation: createArgs.isSimulation,
            locationLineageKey: blockedSlotReferences.locationLineageKey,
            now,
            practiceId: createArgs.practiceId,
            ...(blockedSlotReferences.practitionerLineageKey && {
              practitionerLineageKey:
                blockedSlotReferences.practitionerLineageKey,
            }),
            ...(createArgs.replacesBlockedSlotId && {
              replacesBlockedSlotId: createArgs.replacesBlockedSlotId,
            }),
            start: createArgs.start,
            title: createArgs.title,
          });
          return { status: "applied" };
        },
        undo: async () => {
          try {
            await runDeleteBlockedSlotInternal({ id: currentBlockedSlotId });
            forgetBlockedSlotHistoryDoc(currentBlockedSlotId);
            return { status: "applied" };
          } catch {
            forgetBlockedSlotHistoryDoc(currentBlockedSlotId);
            return {
              message: "Die Sperrung wurde bereits entfernt.",
              status: "conflict",
            };
          }
        },
      });

      return createdId;
    },
    [
      ensureLatestConflictData,
      forgetBlockedSlotHistoryDoc,
      hasBlockedSlotConflict,
      pushHistoryAction,
      rememberCreatedBlockedSlotHistoryDoc,
      resolveBlockedSlotReferenceLineageKeys,
      runCreateBlockedSlotInternal,
      runDeleteBlockedSlotInternal,
    ],
  );

  const runUpdateBlockedSlot = useCallback(
    async (args: Parameters<typeof updateBlockedSlotMutation>[0]) => {
      const before = getBlockedSlotHistoryDoc(args.id);
      const nextLocationLineageKey =
        args.locationId === undefined
          ? before?.locationLineageKey
          : getLocationLineageKeyForDisplayId(args.locationId);
      if (
        args.locationId !== undefined &&
        nextLocationLineageKey === undefined
      ) {
        toast.error("Standort konnte nicht aufgelöst werden.");
        return;
      }
      const nextPractitionerLineageKey =
        args.practitionerId === undefined
          ? before?.practitionerLineageKey
          : getPractitionerLineageKeyForDisplayId(args.practitionerId);
      if (
        args.practitionerId !== undefined &&
        nextPractitionerLineageKey === undefined
      ) {
        toast.error("Behandler konnte nicht aufgelöst werden.");
        return;
      }
      const mutationResult = await runUpdateBlockedSlotInternal(args);

      if (!before) {
        return mutationResult;
      }

      const beforeState = {
        end: before.end,
        locationLineageKey: before.locationLineageKey,
        practitionerLineageKey: before.practitionerLineageKey,
        start: before.start,
        title: before.title,
      };

      const afterState = {
        end: args.end ?? before.end,
        locationLineageKey: nextLocationLineageKey ?? before.locationLineageKey,
        practitionerLineageKey:
          nextPractitionerLineageKey ?? before.practitionerLineageKey,
        start: args.start ?? before.start,
        title: args.title ?? before.title,
      };
      const afterSnapshot: CalendarBlockedSlotRecord = {
        ...before,
        end: afterState.end,
        locationLineageKey: afterState.locationLineageKey,
        ...(afterState.practitionerLineageKey === undefined
          ? {}
          : { practitionerLineageKey: afterState.practitionerLineageKey }),
        start: afterState.start,
        title: afterState.title,
      };
      rememberBlockedSlotHistoryDoc(afterSnapshot);

      const matchesState = (
        slot: CalendarBlockedSlotRecord,
        expected: typeof beforeState,
      ) =>
        slot.start === expected.start &&
        slot.end === expected.end &&
        slot.locationLineageKey === expected.locationLineageKey &&
        slot.practitionerLineageKey === expected.practitionerLineageKey &&
        slot.title === expected.title;

      const candidatePayload = (
        state: typeof beforeState,
      ): {
        end: string;
        isSimulation: boolean;
        locationLineageKey: LocationLineageKey;
        practitionerLineageKey?: PractitionerLineageKey;
        start: string;
      } => ({
        end: state.end,
        isSimulation: before.isSimulation ?? false,
        locationLineageKey: state.locationLineageKey,
        ...(state.practitionerLineageKey && {
          practitionerLineageKey: state.practitionerLineageKey,
        }),
        start: state.start,
      });

      pushHistoryAction({
        label: "Sperrung aktualisiert",
        redo: async () => {
          await ensureLatestConflictData();
          const current = getCurrentBlockedSlotDoc(args.id);
          if (!current || !matchesState(current, beforeState)) {
            return {
              message:
                "Die Sperrung wurde zwischenzeitlich geändert und kann nicht erneut angewendet werden.",
              status: "conflict",
            };
          }

          if (hasBlockedSlotConflict(candidatePayload(afterState), args.id)) {
            return {
              message: "Die Sperrung kollidiert mit einer neueren Planung.",
              status: "conflict",
            };
          }

          const displayRefs = resolveBlockedSlotReferenceDisplayIds({
            locationLineageKey: afterState.locationLineageKey,
            ...(afterState.practitionerLineageKey && {
              practitionerLineageKey: afterState.practitionerLineageKey,
            }),
          });
          if (!displayRefs) {
            return {
              message:
                "Die Sperrung kann nicht erneut angewendet werden, weil die Referenzen nicht mehr aufgelöst werden konnten.",
              status: "conflict",
            };
          }

          await runUpdateBlockedSlotInternal({
            end: afterState.end,
            id: args.id,
            locationId: displayRefs.locationId,
            ...(displayRefs.practitionerId && {
              practitionerId: displayRefs.practitionerId,
            }),
            start: afterState.start,
            title: afterState.title,
          });
          rememberBlockedSlotHistoryDoc(afterSnapshot);
          return { status: "applied" };
        },
        undo: async () => {
          await ensureLatestConflictData();
          const current = getCurrentBlockedSlotDoc(args.id);
          if (!current || !matchesState(current, afterState)) {
            return {
              message:
                "Die Sperrung wurde zwischenzeitlich geändert und kann nicht zurückgesetzt werden.",
              status: "conflict",
            };
          }

          if (hasBlockedSlotConflict(candidatePayload(beforeState), args.id)) {
            return {
              message:
                "Die ursprüngliche Sperrung kollidiert mit einer neueren Planung.",
              status: "conflict",
            };
          }

          const displayRefs = resolveBlockedSlotReferenceDisplayIds({
            locationLineageKey: beforeState.locationLineageKey,
            ...(beforeState.practitionerLineageKey && {
              practitionerLineageKey: beforeState.practitionerLineageKey,
            }),
          });
          if (!displayRefs) {
            return {
              message:
                "Die ursprüngliche Sperrung kann nicht wiederhergestellt werden, weil die Referenzen nicht mehr aufgelöst werden konnten.",
              status: "conflict",
            };
          }

          await runUpdateBlockedSlotInternal({
            end: beforeState.end,
            id: args.id,
            locationId: displayRefs.locationId,
            ...(displayRefs.practitionerId && {
              practitionerId: displayRefs.practitionerId,
            }),
            start: beforeState.start,
            title: beforeState.title,
          });
          rememberBlockedSlotHistoryDoc(before);
          return { status: "applied" };
        },
      });

      return mutationResult;
    },
    [
      ensureLatestConflictData,
      getBlockedSlotHistoryDoc,
      getCurrentBlockedSlotDoc,
      getLocationLineageKeyForDisplayId,
      getPractitionerLineageKeyForDisplayId,
      hasBlockedSlotConflict,
      pushHistoryAction,
      rememberBlockedSlotHistoryDoc,
      resolveBlockedSlotReferenceDisplayIds,
      runUpdateBlockedSlotInternal,
    ],
  );

  const runDeleteBlockedSlot = useCallback(
    async (args: Parameters<typeof deleteBlockedSlotMutation>[0]) => {
      const deleted = getBlockedSlotHistoryDoc(args.id);
      const mutationResult = await runDeleteBlockedSlotInternal(args);
      forgetBlockedSlotHistoryDoc(args.id);

      if (!deleted) {
        return mutationResult;
      }

      let currentBlockedSlotId: Id<"blockedSlots"> = args.id;
      const recreatedDisplayRefs = resolveBlockedSlotReferenceDisplayIds({
        locationLineageKey: deleted.locationLineageKey,
        ...(deleted.practitionerLineageKey && {
          practitionerLineageKey: deleted.practitionerLineageKey,
        }),
      });
      if (!recreatedDisplayRefs) {
        toast.error("Sperrungs-Referenzen konnten nicht aufgelöst werden.");
        return mutationResult;
      }
      const createArgs: Parameters<typeof createBlockedSlotMutation>[0] = {
        end: deleted.end,
        isSimulation: deleted.isSimulation ?? false,
        locationId: recreatedDisplayRefs.locationId,
        practiceId: deleted.practiceId,
        ...(recreatedDisplayRefs.practitionerId && {
          practitionerId: recreatedDisplayRefs.practitionerId,
        }),
        ...(deleted.replacesBlockedSlotId && {
          replacesBlockedSlotId: deleted.replacesBlockedSlotId,
        }),
        start: deleted.start,
        title: deleted.title,
      };

      pushHistoryAction({
        label: "Sperrung gelöscht",
        redo: async () => {
          try {
            await runDeleteBlockedSlotInternal({ id: currentBlockedSlotId });
            forgetBlockedSlotHistoryDoc(currentBlockedSlotId);
            return { status: "applied" };
          } catch {
            forgetBlockedSlotHistoryDoc(currentBlockedSlotId);
            return { status: "applied" };
          }
        },
        undo: async () => {
          await ensureLatestConflictData();
          if (
            hasBlockedSlotConflict({
              end: createArgs.end,
              isSimulation: createArgs.isSimulation ?? false,
              locationLineageKey: deleted.locationLineageKey,
              ...(deleted.practitionerLineageKey && {
                practitionerLineageKey: deleted.practitionerLineageKey,
              }),
              start: createArgs.start,
            })
          ) {
            return {
              message:
                "Die gelöschte Sperrung kann nicht wiederhergestellt werden, weil der Zeitraum inzwischen belegt ist.",
              status: "conflict",
            };
          }

          const recreatedId = await runCreateBlockedSlotInternal(createArgs);
          if (!recreatedId) {
            return { status: "conflict" };
          }

          currentBlockedSlotId = recreatedId;
          rememberBlockedSlotHistoryDoc({
            ...deleted,
            _id: recreatedId,
          });
          return { status: "applied" };
        },
      });

      return mutationResult;
    },
    [
      ensureLatestConflictData,
      forgetBlockedSlotHistoryDoc,
      getBlockedSlotHistoryDoc,
      hasBlockedSlotConflict,
      pushHistoryAction,
      rememberBlockedSlotHistoryDoc,
      resolveBlockedSlotReferenceDisplayIds,
      runCreateBlockedSlotInternal,
      runDeleteBlockedSlotInternal,
    ],
  );

  return {
    createAppointment: runCreateAppointment,
    createBlockedSlot: runCreateBlockedSlot,
    deleteAppointment: runDeleteAppointment,
    deleteBlockedSlot: runDeleteBlockedSlot,
    updateAppointment: runUpdateAppointment,
    updateBlockedSlot: runUpdateBlockedSlot,
  };
}
