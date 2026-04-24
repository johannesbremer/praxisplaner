// src/components/base-schedule-management.tsx
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import { Calendar, Clock, Edit, Plus, Trash2 } from "lucide-react";
import { Result } from "neverthrow";
import React, { useState } from "react";
import { toast } from "sonner";
import * as z from "zod";

import type { Id } from "@/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import { asBaseScheduleId, asBaseScheduleLineageKey } from "@/convex/identity";

import type { DraftMutationResult } from "../utils/cow-history";

import {
  ruleSetIdFromReplayTarget,
  toCowMutationArgs,
  updateRuleSetReplayTarget,
} from "../utils/cow-history";
import { useErrorTracking } from "../utils/error-tracking";
import { captureFrontendError } from "../utils/frontend-errors";
import { requireFrontendLineageEntities } from "../utils/frontend-lineage";
import {
  applyBatchCreateResultToRef,
  applyReplaceResultToRef,
  type BaseScheduleDialogProps,
  type BaseScheduleManagementProps,
  type BatchCreateScheduleInput,
  buildLocationLineageByIdMap,
  buildPractitionerLineageByIdMap,
  type ExtendedSchedule,
  getAbsentLineageKeysForReplacement,
  isBaseScheduleMissingError,
  type LocationMatchEntity,
  matchesSchedulePayload,
  type MaterializedSchedule,
  type PractitionerMatchEntity,
  removeSchedulesFromRef,
  type SchedulePayload,
  toBatchCreateScheduleInput,
  toCreatedSchedulePayload,
  toMutationSchedulePayload,
  toSchedulePayload,
  toSchedulePayloadFromAppliedSchedule,
  toSchedulePayloadFromLineageSnapshot,
} from "./base-schedule-management-shared";

const useIsomorphicLayoutEffect = React.useEffect;

const DAYS_OF_WEEK = [
  { label: "Montag", value: 1 },
  { label: "Dienstag", value: 2 },
  { label: "Mittwoch", value: 3 },
  { label: "Donnerstag", value: 4 },
  { label: "Freitag", value: 5 },
];

// Form schema using Zod
const formSchema = z.object({
  breakTimes: z.array(
    z.object({
      end: z.string(),
      start: z.string(),
    }),
  ),
  daysOfWeek: z
    .array(z.number())
    .min(1, "Bitte wählen Sie mindestens einen Wochentag aus"),
  endTime: z.string().min(1, "Arbeitsende ist erforderlich"),
  locationId: z.string().min(1, "Bitte wählen Sie einen Standort aus"),
  practitionerId: z.string().min(1, "Bitte wählen Sie einen Arzt aus"),
  startTime: z.string().min(1, "Arbeitsbeginn ist erforderlich"),
});
export default function BaseScheduleManagement({
  onDraftMutation,
  onRegisterHistoryAction,
  onRuleSetCreated,
  practiceId,
  ruleSetReplayTarget,
}: BaseScheduleManagementProps) {
  const ruleSetId = ruleSetIdFromReplayTarget(ruleSetReplayTarget);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ExtendedSchedule>();

  const { captureError } = useErrorTracking();

  const practitionersQuery = useQuery(api.entities.getPractitioners, {
    ruleSetId,
  });
  const locationsQuery = useQuery(api.entities.getLocations, {
    ruleSetId,
  });
  const schedulesQuery = useQuery(api.entities.getBaseSchedules, {
    ruleSetId,
  });
  const practitioners: PractitionerMatchEntity[] = React.useMemo(() => {
    if (!practitionersQuery) {
      return [];
    }

    return requireFrontendLineageEntities<
      "practitioners",
      (typeof api.entities.getPractitioners)["_returnType"][number]
    >({
      entities: practitionersQuery,
      entityType: "practitioner",
      source: "BaseScheduleManagement",
    });
  }, [practitionersQuery]);
  const locations: LocationMatchEntity[] = React.useMemo(() => {
    if (!locationsQuery) {
      return [];
    }

    return requireFrontendLineageEntities<
      "locations",
      (typeof api.entities.getLocations)["_returnType"][number]
    >({
      entities: locationsQuery,
      entityType: "location",
      source: "BaseScheduleManagement",
    });
  }, [locationsQuery]);
  const schedules: MaterializedSchedule[] = React.useMemo(() => {
    if (!schedulesQuery) {
      return [];
    }

    return requireFrontendLineageEntities<
      "baseSchedules",
      (typeof api.entities.getBaseSchedules)["_returnType"][number]
    >({
      entities: schedulesQuery,
      entityType: "base schedule",
      source: "BaseScheduleManagement",
    });
  }, [schedulesQuery]);

  const createScheduleBatchMutation = useMutation(
    api.entities.createBaseScheduleBatch,
  );
  const replaceScheduleSetMutation = useMutation(
    api.entities.replaceBaseScheduleSet,
  );
  const practitionersRef = React.useRef(practitioners);
  useIsomorphicLayoutEffect(() => {
    practitionersRef.current = practitioners;
  }, [practitioners]);
  const locationsRef = React.useRef(locations);
  useIsomorphicLayoutEffect(() => {
    locationsRef.current = locations;
  }, [locations]);
  const schedulesRef = React.useRef(schedules);
  useIsomorphicLayoutEffect(() => {
    schedulesRef.current = schedules;
  }, [schedules]);
  const ruleSetReplayTargetRef = React.useRef(ruleSetReplayTarget);
  useIsomorphicLayoutEffect(() => {
    ruleSetReplayTargetRef.current = ruleSetReplayTarget;
  }, [ruleSetReplayTarget]);
  const getCowMutationArgs = () =>
    toCowMutationArgs(ruleSetReplayTargetRef.current);
  const handleDraftMutationResult = (result: DraftMutationResult) => {
    ruleSetReplayTargetRef.current = updateRuleSetReplayTarget(
      ruleSetReplayTargetRef.current,
      result,
    );
    onDraftMutation?.(result);
    if (onRuleSetCreated && result.ruleSetId !== ruleSetId) {
      onRuleSetCreated(result.ruleSetId);
    }
  };

  const handleEditGroup = (scheduleGroup: {
    breakTimes?: { end: string; start: string }[];
    daysOfWeek: number[];
    endTime: string;
    locationLineageKey: Id<"locations">;
    locationName?: string;
    practitionerLineageKey: Id<"practitioners">;
    scheduleIds: Id<"baseSchedules">[];
    startTime: string;
  }) => {
    // Ensure we have valid data
    if (
      scheduleGroup.scheduleIds.length === 0 ||
      scheduleGroup.daysOfWeek.length === 0
    ) {
      toast.error("Fehler: Ungültige Zeitplan-Daten");
      return;
    }

    // Get the first schedule ID and day (we know they exist due to the check above)
    const firstScheduleId = scheduleGroup.scheduleIds[0];
    const firstDayOfWeek = scheduleGroup.daysOfWeek[0];

    if (!firstScheduleId || firstDayOfWeek === undefined) {
      toast.error("Fehler: Ungültige Zeitplan-Daten");
      return;
    }
    // Create a representative schedule object for editing
    const representativeSchedule: ExtendedSchedule = {
      _id: asBaseScheduleId(firstScheduleId), // Use first ID for form processing
      ...(scheduleGroup.breakTimes && { breakTimes: scheduleGroup.breakTimes }),
      dayOfWeek: firstDayOfWeek, // This will be overridden by the form
      endTime: scheduleGroup.endTime,
      lineageKey: asBaseScheduleLineageKey(firstScheduleId),
      locationLineageKey: scheduleGroup.locationLineageKey,
      practiceId,
      practitionerLineageKey: scheduleGroup.practitionerLineageKey,
      ruleSetId,
      startTime: scheduleGroup.startTime,
      // Add metadata to track the full group
      _groupDaysOfWeek: scheduleGroup.daysOfWeek,
      _groupScheduleIds: scheduleGroup.scheduleIds,
      _isGroup: true,
    };

    setEditingSchedule(representativeSchedule);
    setIsDialogOpen(true);
  };

  const handleDeleteGroup = async (scheduleIds: Id<"baseSchedules">[]) => {
    try {
      const deletedSchedules = schedulesRef.current.filter((schedule) =>
        scheduleIds.includes(schedule._id),
      );
      const deletedSchedulePayloads = Result.combine(
        deletedSchedules.map((schedule) => toSchedulePayload(schedule)),
      ).match(
        (value) => value,
        (error) => {
          captureFrontendError(error, {
            context: "base_schedule_group_delete_payload_resolution",
            practiceId,
            scheduleIds,
          });
          toast.error(error.message);
          return null;
        },
      );
      if (!deletedSchedulePayloads) {
        return;
      }

      const deletedLineageKeys = deletedSchedulePayloads.map(
        (payload) => payload.lineageKey,
      );
      const result = await replaceScheduleSetMutation({
        expectedPresentLineageKeys: deletedLineageKeys,
        practiceId,
        replacementSchedules: [],
        ...getCowMutationArgs(),
      });
      handleDraftMutationResult(result);
      removeSchedulesFromRef(schedulesRef, deletedLineageKeys);

      toast.success(
        `${scheduleIds.length > 1 ? "Arbeitszeiten" : "Arbeitszeit"} erfolgreich gelöscht`,
      );

      if (deletedSchedulePayloads.length > 0) {
        onRegisterHistoryAction?.({
          label: "Arbeitszeiten gelöscht",
          redo: async () => {
            const presentLineageKeys = deletedSchedulePayloads
              .filter((payload) =>
                schedulesRef.current.some((currentSchedule) =>
                  matchesSchedulePayload(currentSchedule, payload),
                ),
              )
              .map((payload) => payload.lineageKey);

            if (presentLineageKeys.length === 0) {
              return { status: "applied" as const };
            }

            try {
              const redoResult = await replaceScheduleSetMutation({
                expectedPresentLineageKeys: presentLineageKeys,
                practiceId,
                replacementSchedules: [],
                ...getCowMutationArgs(),
              });
              handleDraftMutationResult(redoResult);
              removeSchedulesFromRef(schedulesRef, presentLineageKeys);
            } catch (error: unknown) {
              if (isBaseScheduleMissingError(error)) {
                return { status: "applied" as const };
              }
              return {
                message:
                  error instanceof Error
                    ? error.message
                    : "Arbeitszeiten konnten nicht erneut gelöscht werden.",
                status: "conflict" as const,
              };
            }

            return { status: "applied" as const };
          },
          undo: async () => {
            const missingPayloads = deletedSchedulePayloads.filter(
              (payload) =>
                !schedulesRef.current.some((currentSchedule) =>
                  matchesSchedulePayload(currentSchedule, payload),
                ),
            );

            if (missingPayloads.length === 0) {
              return { status: "applied" as const };
            }

            const batchSchedules = Result.combine(
              missingPayloads.map((payload) =>
                toBatchCreateScheduleInput(payload),
              ),
            ).match(
              (value) => value,
              (error) => {
                captureFrontendError(error, {
                  context: "base_schedule_group_delete_undo_payload",
                  practiceId,
                });
                return null;
              },
            );
            if (!batchSchedules) {
              return {
                message:
                  "Arbeitszeiten konnten nicht wiederhergestellt werden.",
                status: "conflict" as const,
              };
            }
            const undoResult = await createScheduleBatchMutation({
              practiceId,
              schedules: batchSchedules,
              ...getCowMutationArgs(),
            });
            handleDraftMutationResult(undoResult);
            applyBatchCreateResultToRef({
              createdScheduleIds: undoResult.createdScheduleIds,
              practiceId,
              ruleSetId: undoResult.ruleSetId,
              schedules: batchSchedules,
              schedulesRef,
            });

            return { status: "applied" as const };
          },
        });
      }
    } catch (error: unknown) {
      captureError(error, {
        context: "base_schedule_group_delete",
        practiceId,
        scheduleIds,
      });

      toast.error("Fehler beim Löschen der Arbeitszeiten");
    }
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingSchedule(undefined);
  };

  // Group schedules by practitioner and then by schedule "signature" (time + breaks + location)
  const schedulesByPractitioner: Record<
    string,
    {
      practitionerName: string;
      scheduleGroup: {
        breakTimes?: { end: string; start: string }[];
        daysOfWeek: number[];
        endTime: string;
        locationLineageKey: Id<"locations">;
        locationName?: string;
        practitionerLineageKey: Id<"practitioners">;
        scheduleIds: Id<"baseSchedules">[];
        startTime: string;
      };
    }[]
  > = {};

  for (const schedule of schedules) {
    const practitioner = practitioners.find(
      (p) => p.lineageKey === schedule.practitionerLineageKey,
    );
    const practitionerName = practitioner?.name ?? "Unknown";
    const location = locations.find(
      (l) => l.lineageKey === schedule.locationLineageKey,
    );
    const locationName = location?.name;

    schedulesByPractitioner[practitionerName] ??= [];

    // Look for existing group with same times, breaks, and location
    const existingGroup = schedulesByPractitioner[practitionerName].find(
      (item) =>
        item.scheduleGroup.startTime === schedule.startTime &&
        item.scheduleGroup.endTime === schedule.endTime &&
        item.scheduleGroup.locationLineageKey === schedule.locationLineageKey &&
        JSON.stringify(item.scheduleGroup.breakTimes ?? []) ===
          JSON.stringify(schedule.breakTimes ?? []),
    );

    if (existingGroup) {
      // Add this day to existing group
      existingGroup.scheduleGroup.daysOfWeek.push(schedule.dayOfWeek);
      existingGroup.scheduleGroup.scheduleIds.push(schedule._id);
      existingGroup.scheduleGroup.daysOfWeek =
        existingGroup.scheduleGroup.daysOfWeek.toSorted();
    } else {
      // Create new group
      schedulesByPractitioner[practitionerName].push({
        practitionerName,
        scheduleGroup: {
          ...(schedule.breakTimes && { breakTimes: schedule.breakTimes }),
          daysOfWeek: [schedule.dayOfWeek],
          endTime: schedule.endTime,
          locationLineageKey: schedule.locationLineageKey,
          ...(locationName && { locationName }),
          practitionerLineageKey: schedule.practitionerLineageKey,
          scheduleIds: [schedule._id],
          startTime: schedule.startTime,
        },
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Arbeitszeiten
            </CardTitle>
          </div>
          <Button
            onClick={() => {
              setIsDialogOpen(true);
            }}
            size="sm"
            variant="outline"
          >
            <Plus className="h-4 w-4 mr-2" />
            Arbeitszeit hinzufügen
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {practitionersQuery === undefined ||
        locationsQuery === undefined ||
        schedulesQuery === undefined ? (
          <div className="text-center py-8 text-muted-foreground">
            Lade Arbeitszeiten...
          </div>
        ) : practitioners.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Bitte erstellen Sie zuerst einen Arzt, bevor Sie Arbeitszeiten
            definieren.
          </div>
        ) : Object.keys(schedulesByPractitioner).length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Noch keine Arbeitszeiten definiert.
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(schedulesByPractitioner).map(
              ([practitionerName, scheduleGroups]) => (
                <div className="space-y-2" key={practitionerName}>
                  <h4 className="font-medium text-lg">{practitionerName}</h4>
                  <div className="grid gap-2">
                    {scheduleGroups.map((scheduleGroup, index) => (
                      <div
                        className="flex items-center justify-between p-3 border rounded-lg"
                        key={`${practitionerName}-${index}`}
                      >
                        <div className="flex-1">
                          <div className="space-y-2 mb-1">
                            {/* Days row */}
                            <div className="flex gap-1 flex-wrap">
                              {scheduleGroup.scheduleGroup.daysOfWeek.map(
                                (day) => (
                                  <Badge key={day} variant="outline">
                                    {getDayName(day)}
                                  </Badge>
                                ),
                              )}
                            </div>
                            {/* Time and location row */}
                            <div className="flex items-center gap-2">
                              <span className="font-medium">
                                {scheduleGroup.scheduleGroup.startTime} -{" "}
                                {scheduleGroup.scheduleGroup.endTime}
                              </span>
                              {scheduleGroup.scheduleGroup.locationName && (
                                <Badge variant="secondary">
                                  {scheduleGroup.scheduleGroup.locationName}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            Pausen:{" "}
                            {formatBreakTimes(
                              scheduleGroup.scheduleGroup.breakTimes,
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={() => {
                              handleEditGroup(scheduleGroup.scheduleGroup);
                            }}
                            size="sm"
                            variant="ghost"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            onClick={() => {
                              void handleDeleteGroup(
                                scheduleGroup.scheduleGroup.scheduleIds,
                              );
                            }}
                            size="sm"
                            variant="ghost"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </CardContent>

      <BaseScheduleDialog
        isOpen={isDialogOpen}
        onClose={handleCloseDialog}
        practiceId={practiceId}
        ruleSetReplayTarget={ruleSetReplayTarget}
        schedule={editingSchedule}
        {...(onDraftMutation && { onDraftMutation })}
        {...(onRegisterHistoryAction && { onRegisterHistoryAction })}
        {...(onRuleSetCreated && { onRuleSetCreated })}
      />
    </Card>
  );
}

function BaseScheduleDialog({
  isOpen,
  onClose,
  onDraftMutation,
  onRegisterHistoryAction,
  onRuleSetCreated,
  practiceId,
  ruleSetReplayTarget,
  schedule,
}: BaseScheduleDialogProps) {
  const { captureError } = useErrorTracking();
  const ruleSetId = ruleSetIdFromReplayTarget(ruleSetReplayTarget);
  const resolveSelectedLocationId = (
    value: string,
    currentLocations: readonly LocationMatchEntity[],
  ): Id<"locations"> | null =>
    currentLocations.find((location) => location._id === value)?._id ?? null;
  const resolveSelectedLocationLineageId = (
    value: string,
    currentLocations: readonly LocationMatchEntity[],
  ): Id<"locations"> | null =>
    currentLocations.find((location) => location._id === value)?.lineageKey ??
    null;
  const resolveSelectedPractitionerId = (
    value: string,
    currentPractitioners: readonly PractitionerMatchEntity[],
  ): Id<"practitioners"> | null =>
    currentPractitioners.find((practitioner) => practitioner._id === value)
      ?._id ?? null;
  const resolveSelectedPractitionerLineageId = (
    value: string,
    currentPractitioners: readonly PractitionerMatchEntity[],
  ): Id<"practitioners"> | null =>
    currentPractitioners.find((practitioner) => practitioner._id === value)
      ?.lineageKey ?? null;

  const practitionersQuery = useQuery(api.entities.getPractitioners, {
    ruleSetId,
  });

  const locationsQuery = useQuery(api.entities.getLocations, {
    ruleSetId,
  });
  const schedulesQuery = useQuery(api.entities.getBaseSchedules, {
    ruleSetId,
  });
  const practitioners: PractitionerMatchEntity[] = React.useMemo(() => {
    if (!practitionersQuery) {
      return [];
    }

    return requireFrontendLineageEntities<
      "practitioners",
      (typeof api.entities.getPractitioners)["_returnType"][number]
    >({
      entities: practitionersQuery,
      entityType: "practitioner",
      source: "BaseScheduleDialog",
    });
  }, [practitionersQuery]);
  const locations: LocationMatchEntity[] = React.useMemo(() => {
    if (!locationsQuery) {
      return [];
    }

    return requireFrontendLineageEntities<
      "locations",
      (typeof api.entities.getLocations)["_returnType"][number]
    >({
      entities: locationsQuery,
      entityType: "location",
      source: "BaseScheduleDialog",
    });
  }, [locationsQuery]);
  const schedules: MaterializedSchedule[] = React.useMemo(() => {
    if (!schedulesQuery) {
      return [];
    }

    return requireFrontendLineageEntities<
      "baseSchedules",
      (typeof api.entities.getBaseSchedules)["_returnType"][number]
    >({
      entities: schedulesQuery,
      entityType: "base schedule",
      source: "BaseScheduleDialog",
    });
  }, [schedulesQuery]);
  const practitionersRef = React.useRef(practitioners);
  React.useLayoutEffect(() => {
    practitionersRef.current = practitioners;
  }, [practitioners]);
  const locationsRef = React.useRef(locations);
  React.useLayoutEffect(() => {
    locationsRef.current = locations;
  }, [locations]);
  const schedulesRef = React.useRef(schedules);
  useIsomorphicLayoutEffect(() => {
    schedulesRef.current = schedules;
  }, [schedules]);
  const ruleSetReplayTargetRef = React.useRef(ruleSetReplayTarget);
  useIsomorphicLayoutEffect(() => {
    ruleSetReplayTargetRef.current = ruleSetReplayTarget;
  }, [ruleSetReplayTarget]);
  const getLocalCowMutationArgs = () =>
    toCowMutationArgs(ruleSetReplayTargetRef.current);
  const handleDraftMutationResult = (result: DraftMutationResult) => {
    ruleSetReplayTargetRef.current = updateRuleSetReplayTarget(
      ruleSetReplayTargetRef.current,
      result,
    );
    onDraftMutation?.(result);
    if (onRuleSetCreated && result.ruleSetId !== ruleSetId) {
      onRuleSetCreated(result.ruleSetId);
    }
  };

  const createScheduleBatchMutation = useMutation(
    api.entities.createBaseScheduleBatch,
  );
  const updateScheduleSetMutation = useMutation(
    api.entities.updateBaseScheduleSet,
  );
  const replaceScheduleSetMutation = useMutation(
    api.entities.replaceBaseScheduleSet,
  );

  const runCreateScheduleBatch = React.useCallback(
    async (schedules: BatchCreateScheduleInput[]) =>
      await createScheduleBatchMutation({
        practiceId,
        schedules,
        ...getLocalCowMutationArgs(),
      }),
    [createScheduleBatchMutation, practiceId],
  );
  const form = useForm({
    defaultValues: {
      breakTimes: schedule?.breakTimes ?? [],
      daysOfWeek: schedule
        ? schedule._isGroup
          ? (schedule._groupDaysOfWeek ?? [])
          : [schedule.dayOfWeek]
        : [],
      endTime: schedule?.endTime ?? "17:00",
      locationId:
        (schedule
          ? locations.find(
              (location) => location.lineageKey === schedule.locationLineageKey,
            )?._id
          : undefined) ??
        locations[0]?._id ??
        "",
      practitionerId:
        (schedule
          ? practitioners.find(
              (practitioner) =>
                practitioner.lineageKey === schedule.practitionerLineageKey,
            )?._id
          : undefined) ?? "",
      startTime: schedule?.startTime ?? "08:00",
    },
    onSubmit: async ({ value }) => {
      try {
        const createdScheduleIds: Id<"baseSchedules">[] = [];
        const createdSchedulePayloads: SchedulePayload[] = [];
        const deletedScheduleSnapshots: MaterializedSchedule[] = [];
        let oldSchedulePayloads: SchedulePayload[] = [];
        const practitionerLineageByIdAtSubmitStart =
          buildPractitionerLineageByIdMap(practitionersRef.current).match(
            (value) => value,
            (error) => {
              captureFrontendError(error, {
                context: "base_schedule_practitioner_lineage_snapshot",
                practiceId,
              });
              toast.error(error.message);
              return null;
            },
          );
        const locationLineageByIdAtSubmitStart = buildLocationLineageByIdMap(
          locationsRef.current,
        ).match(
          (value) => value,
          (error) => {
            captureFrontendError(error, {
              context: "base_schedule_location_lineage_snapshot",
              practiceId,
            });
            toast.error(error.message);
            return null;
          },
        );
        if (
          !practitionerLineageByIdAtSubmitStart ||
          !locationLineageByIdAtSubmitStart
        ) {
          return;
        }

        const selectedLocationId = resolveSelectedLocationId(
          value.locationId,
          locationsRef.current,
        );
        const selectedLocationLineageId = resolveSelectedLocationLineageId(
          value.locationId,
          locationsRef.current,
        );
        const selectedPractitionerId = resolveSelectedPractitionerId(
          value.practitionerId,
          practitionersRef.current,
        );

        if (schedule) {
          // When editing, check if it's a group edit
          const isGroupEdit = schedule._isGroup ?? false;
          const scheduleIdsToDelete = isGroupEdit
            ? (schedule._groupScheduleIds ?? [])
            : [schedule._id];
          for (const scheduleId of scheduleIdsToDelete) {
            const snapshot = schedulesRef.current.find(
              (s) => s._id === scheduleId,
            );
            if (snapshot) {
              deletedScheduleSnapshots.push(snapshot);
            }
          }

          const selectedDays = value.daysOfWeek;

          if (!selectedLocationId || !selectedLocationLineageId) {
            toast.error("Bitte wählen Sie einen Standort aus");
            return;
          }

          if (!selectedPractitionerId) {
            toast.error("Bitte wählen Sie einen Arzt aus");
            return;
          }

          if (selectedDays.length === 0) {
            const error = new Error(
              "Bitte wählen Sie mindestens einen Wochentag aus",
            );
            captureError(error, {
              context: "base_schedule_validation",
              formData: value,
              isUpdate: true,
              practiceId,
              scheduleId: schedule._id,
              validationField: "daysOfWeek",
            });
            toast.error(error.message);
            return;
          }

          const resolvedOldSchedulePayloads = Result.combine(
            deletedScheduleSnapshots.map((previous) =>
              toSchedulePayloadFromLineageSnapshot(previous),
            ),
          ).match<null | SchedulePayload[]>(
            (value) => value,
            (error) => {
              captureFrontendError(error, {
                context: "base_schedule_old_payloads",
                practiceId,
              });
              toast.error(error.message);
              return null;
            },
          );
          if (resolvedOldSchedulePayloads === null) {
            return;
          }
          oldSchedulePayloads = resolvedOldSchedulePayloads;

          const existingPayloadByDay = new Map(
            oldSchedulePayloads.map((payload) => [payload.dayOfWeek, payload]),
          );
          const selectedPractitionerLineageId =
            resolveSelectedPractitionerLineageId(
              value.practitionerId,
              practitionersRef.current,
            );
          if (!selectedPractitionerLineageId) {
            const error = new Error("Bitte wählen Sie einen Arzt aus");
            captureError(error, {
              context: "base_schedule_validation",
              formData: value,
              isUpdate: true,
              practiceId,
              scheduleId: schedule._id,
              validationField: "practitionerId",
            });
            toast.error(error.message);
            return;
          }
          const nextSchedules: BatchCreateScheduleInput[] = selectedDays
            .toSorted()
            .map((dayOfWeek) => {
              const existingPayload = existingPayloadByDay.get(dayOfWeek);
              return {
                ...(value.breakTimes.length > 0
                  ? { breakTimes: value.breakTimes }
                  : {}),
                dayOfWeek,
                endTime: value.endTime,
                ...(existingPayload
                  ? { lineageKey: existingPayload.lineageKey }
                  : {}),
                locationLineageId: selectedLocationLineageId,
                practitionerLineageId: selectedPractitionerLineageId,
                startTime: value.startTime,
              };
            });

          const updateResult = await updateScheduleSetMutation({
            expectedPresentLineageKeys: oldSchedulePayloads.map(
              (payload) => payload.lineageKey,
            ),
            practiceId,
            schedules: nextSchedules,
            ...getLocalCowMutationArgs(),
          });
          handleDraftMutationResult(updateResult);
          removeSchedulesFromRef(
            schedulesRef,
            oldSchedulePayloads.map((payload) => payload.lineageKey),
          );
          applyReplaceResultToRef({
            appliedSchedules: updateResult.appliedSchedules,
            practiceId,
            ruleSetId: updateResult.ruleSetId,
            schedulesRef,
          });

          const updatedSchedulePayloads = updateResult.appliedSchedules.map(
            (appliedSchedule) =>
              toSchedulePayloadFromAppliedSchedule(appliedSchedule),
          );

          createdSchedulePayloads.push(...updatedSchedulePayloads);

          toast.success(
            `Arbeitszeit${selectedDays.length > 1 ? "en" : ""} erfolgreich aktualisiert`,
          );
        } else {
          // Create new schedule(s) - one for each selected day
          const selectedPractitionerId = resolveSelectedPractitionerId(
            value.practitionerId,
            practitionersRef.current,
          );
          const selectedPractitionerLineageId =
            resolveSelectedPractitionerLineageId(
              value.practitionerId,
              practitionersRef.current,
            );

          if (!selectedPractitionerId || !selectedPractitionerLineageId) {
            const error = new Error("Bitte wählen Sie einen Arzt aus");
            captureError(error, {
              context: "base_schedule_validation",
              formData: value,
              isUpdate: false,
              practiceId,
              validationField: "practitionerId",
            });
            toast.error(error.message);
            return;
          }

          if (!selectedLocationId || !selectedLocationLineageId) {
            const error = new Error("Bitte wählen Sie einen Standort aus");
            captureError(error, {
              context: "base_schedule_validation",
              formData: value,
              isUpdate: false,
              practiceId,
              validationField: "locationId",
            });
            toast.error(error.message);
            return;
          }

          if (value.daysOfWeek.length === 0) {
            const error = new Error(
              "Bitte wählen Sie mindestens einen Wochentag aus",
            );
            captureError(error, {
              context: "base_schedule_validation",
              formData: value,
              isUpdate: false,
              practiceId,
              validationField: "daysOfWeek",
            });
            toast.error(error.message);
            return;
          }

          const batchSchedules = value.daysOfWeek.map((dayOfWeek) => ({
            ...(value.breakTimes.length > 0
              ? { breakTimes: value.breakTimes }
              : {}),
            dayOfWeek,
            endTime: value.endTime,
            locationLineageId: selectedLocationLineageId,
            practitionerLineageId: selectedPractitionerLineageId,
            startTime: value.startTime,
          }));
          const batchResult = await createScheduleBatchMutation({
            practiceId,
            schedules: batchSchedules,
            ...getLocalCowMutationArgs(),
          });
          handleDraftMutationResult(batchResult);
          applyBatchCreateResultToRef({
            createdScheduleIds: batchResult.createdScheduleIds,
            practiceId,
            ruleSetId: batchResult.ruleSetId,
            schedules: batchSchedules,
            schedulesRef,
          });

          if (batchResult.createdScheduleIds.length !== batchSchedules.length) {
            const error = new Error(
              "Erstellte Arbeitszeiten konnten nicht vollständig zugeordnet werden.",
            );
            captureError(error, {
              context: "base_schedule_batch_create_mapping_count_mismatch",
              createdScheduleCount: batchResult.createdScheduleIds.length,
              practiceId,
              requestedScheduleCount: batchSchedules.length,
            });
            toast.error(error.message);
            return;
          }

          for (const [index, createData] of batchSchedules.entries()) {
            const createdEntityId = batchResult.createdScheduleIds[index];
            if (!createdEntityId) {
              const error = new Error(
                "Erstellte Arbeitszeiten konnten nicht vollständig zugeordnet werden.",
              );
              captureError(error, {
                context: "base_schedule_batch_create_mapping",
                createdScheduleCount: batchResult.createdScheduleIds.length,
                practiceId,
                requestedScheduleCount: batchSchedules.length,
              });
              toast.error(error.message);
              return;
            }

            const createdPayload = toCreatedSchedulePayload(
              createData,
              createdEntityId,
            ).match(
              (value) => value,
              (error) => {
                captureFrontendError(error, {
                  context: "base_schedule_created_payload",
                  practiceId,
                });
                toast.error(error.message);
                return null;
              },
            );
            if (!createdPayload) {
              return;
            }
            createdSchedulePayloads.push(createdPayload);
            createdScheduleIds.push(createdEntityId);
          }

          toast.success(
            `Arbeitszeit${value.daysOfWeek.length > 1 ? "en" : ""} erfolgreich erstellt`,
          );
        }

        if (!schedule && createdSchedulePayloads.length > 0) {
          onRegisterHistoryAction?.({
            label: "Arbeitszeiten erstellt",
            redo: async () => {
              const missingPayloads = createdSchedulePayloads.filter(
                (payload) =>
                  !schedulesRef.current.some((scheduleItem) =>
                    matchesSchedulePayload(scheduleItem, payload),
                  ),
              );

              if (missingPayloads.length === 0) {
                return { status: "applied" as const };
              }

              const batchSchedules = Result.combine(
                missingPayloads.map((payload) =>
                  toBatchCreateScheduleInput(payload),
                ),
              ).match(
                (value) => value,
                (error) => {
                  captureFrontendError(error, {
                    context: "base_schedule_create_redo_payload",
                    practiceId,
                  });
                  return null;
                },
              );
              if (!batchSchedules) {
                return {
                  message:
                    "Arbeitszeiten konnten nicht erneut erstellt werden.",
                  status: "conflict" as const,
                };
              }
              const redoResult = await runCreateScheduleBatch(batchSchedules);
              handleDraftMutationResult(redoResult);
              applyBatchCreateResultToRef({
                createdScheduleIds: redoResult.createdScheduleIds,
                practiceId,
                ruleSetId: redoResult.ruleSetId,
                schedules: batchSchedules,
                schedulesRef,
              });
              return { status: "applied" as const };
            },
            undo: async () => {
              const presentLineageKeys = createdSchedulePayloads
                .filter((payload) =>
                  schedulesRef.current.some((scheduleItem) =>
                    matchesSchedulePayload(scheduleItem, payload),
                  ),
                )
                .map((payload) => payload.lineageKey);

              if (presentLineageKeys.length === 0) {
                return { status: "applied" as const };
              }

              try {
                const undoResult = await replaceScheduleSetMutation({
                  expectedPresentLineageKeys: presentLineageKeys,
                  practiceId,
                  replacementSchedules: [],
                  ...getLocalCowMutationArgs(),
                });
                handleDraftMutationResult(undoResult);
                removeSchedulesFromRef(schedulesRef, presentLineageKeys);
              } catch (error: unknown) {
                if (!isBaseScheduleMissingError(error)) {
                  return {
                    message:
                      error instanceof Error
                        ? error.message
                        : "Arbeitszeiten konnten nicht rückgängig gemacht werden.",
                    status: "conflict" as const,
                  };
                }
              }
              return { status: "applied" as const };
            },
          });
        }

        if (schedule && createdSchedulePayloads.length > 0) {
          const newLineageKeys = createdSchedulePayloads.map(
            (payload) => payload.lineageKey,
          );
          const oldLineageKeys = oldSchedulePayloads.map(
            (payload) => payload.lineageKey,
          );
          const redoExpectedAbsentLineageKeys =
            getAbsentLineageKeysForReplacement(oldLineageKeys, newLineageKeys);
          const undoExpectedAbsentLineageKeys =
            getAbsentLineageKeysForReplacement(newLineageKeys, oldLineageKeys);

          onRegisterHistoryAction?.({
            label: "Arbeitszeiten aktualisiert",
            redo: async () => {
              const replacementSchedules = Result.combine(
                createdSchedulePayloads.map((payload) =>
                  toMutationSchedulePayload(payload),
                ),
              ).match(
                (value) => value,
                () => null,
              );
              if (!replacementSchedules) {
                return {
                  message:
                    "Arbeitszeiten konnten nicht erneut angewendet werden.",
                  status: "conflict" as const,
                };
              }
              const redoResult = await replaceScheduleSetMutation({
                expectedAbsentLineageKeys: redoExpectedAbsentLineageKeys,
                expectedPresentLineageKeys: oldLineageKeys,
                practiceId,
                replacementSchedules,
                ...getLocalCowMutationArgs(),
              });
              handleDraftMutationResult(redoResult);
              removeSchedulesFromRef(schedulesRef, oldLineageKeys);
              applyReplaceResultToRef({
                appliedSchedules: redoResult.appliedSchedules,
                practiceId,
                ruleSetId: redoResult.ruleSetId,
                schedulesRef,
              });
              return { status: "applied" as const };
            },
            undo: async () => {
              const replacementSchedules = Result.combine(
                oldSchedulePayloads.map((payload) =>
                  toMutationSchedulePayload(payload),
                ),
              ).match(
                (value) => value,
                () => null,
              );
              if (!replacementSchedules) {
                return {
                  message:
                    "Arbeitszeiten konnten nicht wiederhergestellt werden.",
                  status: "conflict" as const,
                };
              }
              const undoResult = await replaceScheduleSetMutation({
                expectedAbsentLineageKeys: undoExpectedAbsentLineageKeys,
                expectedPresentLineageKeys: newLineageKeys,
                practiceId,
                replacementSchedules,
                ...getLocalCowMutationArgs(),
              });
              handleDraftMutationResult(undoResult);
              removeSchedulesFromRef(schedulesRef, newLineageKeys);
              applyReplaceResultToRef({
                appliedSchedules: undoResult.appliedSchedules,
                practiceId,
                ruleSetId: undoResult.ruleSetId,
                schedulesRef,
              });
              return { status: "applied" as const };
            },
          });
        }
        onClose();
      } catch (error: unknown) {
        captureError(error, {
          context: "base_schedule_save",
          formData: value,
          isUpdate: !!schedule,
          practiceId,
          scheduleId: schedule?._id,
        });

        toast.error(
          error instanceof Error
            ? error.message
            : "Fehler beim Speichern der Arbeitszeit",
        );
      }
    },
    validators: {
      onSubmit: formSchema,
    },
  });

  const dialogInitializationKeyRef = React.useRef<null | string>(null);
  React.useEffect(() => {
    if (!isOpen) {
      dialogInitializationKeyRef.current = null;
      return;
    }

    if (
      schedule &&
      (practitionersQuery === undefined || locationsQuery === undefined)
    ) {
      return;
    }

    const initializationKey = `${ruleSetId}:${schedule?._id ?? "new"}:${schedule?._groupScheduleIds?.join(",") ?? ""}`;
    if (dialogInitializationKeyRef.current === initializationKey) {
      return;
    }

    const practitionerExists =
      !!schedule &&
      practitioners.some(
        (practitioner) =>
          practitioner.lineageKey === schedule.practitionerLineageKey,
      );
    const locationExists =
      !!schedule &&
      locations.some(
        (location) => location.lineageKey === schedule.locationLineageKey,
      );

    const selectedPractitionerId = practitionerExists
      ? (practitioners.find(
          (practitioner) =>
            practitioner.lineageKey === schedule.practitionerLineageKey,
        )?._id ?? "")
      : "";
    const selectedLocationId =
      (locationExists
        ? locations.find(
            (location) => location.lineageKey === schedule.locationLineageKey,
          )?._id
        : undefined) ??
      locations[0]?._id ??
      "";

    form.reset({
      breakTimes: schedule?.breakTimes ?? [],
      daysOfWeek: schedule
        ? schedule._isGroup
          ? (schedule._groupDaysOfWeek ?? [])
          : [schedule.dayOfWeek]
        : [],
      endTime: schedule?.endTime ?? "17:00",
      locationId: selectedLocationId,
      practitionerId: selectedPractitionerId,
      startTime: schedule?.startTime ?? "08:00",
    });

    dialogInitializationKeyRef.current = initializationKey;
  }, [
    form,
    isOpen,
    locations,
    locationsQuery,
    practitioners,
    practitionersQuery,
    ruleSetId,
    schedule,
  ]);

  return (
    <Dialog onOpenChange={onClose} open={isOpen}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {schedule
              ? "Arbeitszeit bearbeiten"
              : "Neue Arbeitszeit hinzufügen"}
          </DialogTitle>
          <DialogDescription>
            Definieren Sie die Arbeitszeiten und Pausenzeiten für einen Arzt.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-6"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.Field name="practitionerId">
              {(field) => {
                const isInvalid =
                  field.state.meta.isTouched && !field.state.meta.isValid;

                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor="practitioner">Arzt</FieldLabel>
                    <Select
                      disabled={!!schedule}
                      onValueChange={field.handleChange}
                      value={field.state.value}
                    >
                      <SelectTrigger aria-invalid={isInvalid}>
                        <SelectValue placeholder="Arzt auswählen" />
                      </SelectTrigger>
                      <SelectContent>
                        {practitioners.map((practitioner) => (
                          <SelectItem
                            key={practitioner._id}
                            value={practitioner._id}
                          >
                            {practitioner.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {schedule && (
                      <FieldDescription>
                        Arzt kann bei der Bearbeitung nicht geändert werden
                      </FieldDescription>
                    )}
                    <FieldError>
                      {field.state.meta.errors
                        .map((error) =>
                          typeof error === "string"
                            ? error
                            : (error?.message ?? ""),
                        )
                        .join(", ")}
                    </FieldError>
                  </Field>
                );
              }}
            </form.Field>

            <form.Field name="locationId">
              {(field) => {
                const isInvalid =
                  field.state.meta.isTouched && !field.state.meta.isValid;

                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor="location">Standort</FieldLabel>
                    <Select
                      onValueChange={field.handleChange}
                      value={field.state.value}
                    >
                      <SelectTrigger aria-invalid={isInvalid}>
                        <SelectValue placeholder="Standort auswählen" />
                      </SelectTrigger>
                      <SelectContent>
                        {locations.map((location) => (
                          <SelectItem key={location._id} value={location._id}>
                            {location.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError>
                      {field.state.meta.errors
                        .map((error) =>
                          typeof error === "string"
                            ? error
                            : (error?.message ?? ""),
                        )
                        .join(", ")}
                    </FieldError>
                  </Field>
                );
              }}
            </form.Field>

            <form.Field mode="array" name="daysOfWeek">
              {(field) => {
                const isInvalid =
                  field.state.meta.isTouched && !field.state.meta.isValid;

                return (
                  <FieldSet>
                    <FieldLegend variant="label">Wochentage</FieldLegend>
                    <FieldDescription>
                      Wählen Sie die Wochentage, an denen die Arbeitszeit gilt.
                    </FieldDescription>
                    <FieldGroup className="gap-3" data-invalid={isInvalid}>
                      {DAYS_OF_WEEK.map((day) => (
                        <Field key={day.value} orientation="horizontal">
                          <Checkbox
                            aria-invalid={isInvalid}
                            checked={field.state.value.includes(day.value)}
                            id={`day-${day.value}`}
                            onBlur={field.handleBlur}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                field.pushValue(day.value);
                              } else {
                                const index = field.state.value.indexOf(
                                  day.value,
                                );
                                if (index !== -1) {
                                  field.removeValue(index);
                                }
                              }
                            }}
                          />
                          <FieldLabel
                            className="font-normal"
                            htmlFor={`day-${day.value}`}
                          >
                            {day.label}
                          </FieldLabel>
                        </Field>
                      ))}
                    </FieldGroup>
                    <FieldError>
                      {field.state.meta.errors
                        .map((error) =>
                          typeof error === "string"
                            ? error
                            : (error?.message ?? ""),
                        )
                        .join(", ")}
                    </FieldError>
                  </FieldSet>
                );
              }}
            </form.Field>

            <div className="grid grid-cols-2 gap-4">
              <form.Field name="startTime">
                {(field) => {
                  const isInvalid =
                    field.state.meta.isTouched && !field.state.meta.isValid;

                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor="startTime">Arbeitsbeginn</FieldLabel>
                      <Input
                        aria-invalid={isInvalid}
                        id="startTime"
                        onBlur={field.handleBlur}
                        onChange={(e) => {
                          field.handleChange(e.target.value);
                        }}
                        type="time"
                        value={field.state.value}
                      />
                      <FieldError>
                        {field.state.meta.errors
                          .map((error) =>
                            typeof error === "string"
                              ? error
                              : (error?.message ?? ""),
                          )
                          .join(", ")}
                      </FieldError>
                    </Field>
                  );
                }}
              </form.Field>

              <form.Field name="endTime">
                {(field) => {
                  const isInvalid =
                    field.state.meta.isTouched && !field.state.meta.isValid;

                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor="endTime">Arbeitsende</FieldLabel>
                      <Input
                        aria-invalid={isInvalid}
                        id="endTime"
                        onBlur={field.handleBlur}
                        onChange={(e) => {
                          field.handleChange(e.target.value);
                        }}
                        type="time"
                        value={field.state.value}
                      />
                      <FieldError>
                        {field.state.meta.errors
                          .map((error) =>
                            typeof error === "string"
                              ? error
                              : (error?.message ?? ""),
                          )
                          .join(", ")}
                      </FieldError>
                    </Field>
                  );
                }}
              </form.Field>
            </div>

            <form.Field name="breakTimes">
              {(field) => (
                <BreakTimesField
                  onBreakTimesChange={field.handleChange}
                  onValidationError={() => {
                    // Could store validation error state if needed for warnings
                  }}
                  value={field.state.value}
                />
              )}
            </form.Field>
          </FieldGroup>

          <div className="flex justify-end gap-2">
            <Button onClick={onClose} type="button" variant="outline">
              Abbrechen
            </Button>
            <Button type="submit">
              {schedule ? "Aktualisieren" : "Erstellen"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Separate component for managing break times within TanStack Form
function BreakTimesField({
  onBreakTimesChange,
  onValidationError,
  value,
}: {
  onBreakTimesChange: (breakTimes: { end: string; start: string }[]) => void;
  onValidationError?: (hasError: boolean) => void;
  value: { end: string; start: string }[];
}) {
  const [newBreakStart, setNewBreakStart] = useState("");
  const [newBreakEnd, setNewBreakEnd] = useState("");
  const updateValidationError = (start: string, end: string) => {
    const hasPartialInput = Boolean(start) !== Boolean(end);
    const hasInvalidRange = Boolean(start && end) && start >= end;
    onValidationError?.(hasPartialInput || hasInvalidRange);
  };

  const addBreakTime = () => {
    if (!newBreakStart || !newBreakEnd) {
      updateValidationError(newBreakStart, newBreakEnd);
      toast.error("Bitte füllen Sie beide Pausenzeiten aus");
      return;
    }

    if (newBreakStart >= newBreakEnd) {
      updateValidationError(newBreakStart, newBreakEnd);
      toast.error("Die Pausenstart-Zeit muss vor der Pausenend-Zeit liegen");
      return;
    }

    const newBreak = { end: newBreakEnd, start: newBreakStart };
    const alreadyExists = value.some(
      (breakTime) =>
        breakTime.start === newBreakStart && breakTime.end === newBreakEnd,
    );
    if (alreadyExists) {
      toast.error("Diese Pausenzeit existiert bereits");
      return;
    }
    onBreakTimesChange([...value, newBreak]);

    setNewBreakStart("");
    setNewBreakEnd("");
    onValidationError?.(false);
  };

  const removeBreakTime = (index: number) => {
    onBreakTimesChange(value.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <FieldLabel>Pausenzeiten</FieldLabel>

      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((breakTime, index) => (
            <div
              className="flex items-center gap-2 p-2 border rounded"
              key={index}
            >
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1">
                {breakTime.start} - {breakTime.end}
              </span>
              <Button
                onClick={() => {
                  removeBreakTime(index);
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Input
          onChange={(e) => {
            const start = e.target.value;
            setNewBreakStart(start);
            updateValidationError(start, newBreakEnd);
          }}
          placeholder="Pausenbeginn"
          type="time"
          value={newBreakStart}
        />
        <Input
          onChange={(e) => {
            const end = e.target.value;
            setNewBreakEnd(end);
            updateValidationError(newBreakStart, end);
          }}
          placeholder="Pausenende"
          type="time"
          value={newBreakEnd}
        />
        <Button onClick={addBreakTime} type="button" variant="outline">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function formatBreakTimes(
  breakTimes?: { end: string; start: string }[],
): string {
  if (!breakTimes || breakTimes.length === 0) {
    return "Keine Pausen";
  }
  return breakTimes.map((bt) => `${bt.start}-${bt.end}`).join(", ");
}

function getDayName(dayOfWeek: number): string {
  return DAYS_OF_WEEK.find((d) => d.value === dayOfWeek)?.label ?? "Unbekannt";
}
