// src/components/base-schedule-management.tsx
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import { Calendar, Clock, Edit, Plus, Trash2 } from "lucide-react";
import React, { useState } from "react";
import { toast } from "sonner";
import * as z from "zod";

import type { Doc, Id } from "@/convex/_generated/dataModel";

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

import type { LocalHistoryAction } from "../hooks/use-local-history";

import { useErrorTracking } from "../utils/error-tracking";

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

interface BaseScheduleDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onRegisterHistoryAction?: (action: LocalHistoryAction) => void;
  onRuleSetCreated?: (ruleSetId: Id<"ruleSets">) => void;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
  schedule?: ExtendedSchedule | undefined;
}

interface BaseScheduleManagementProps {
  onRegisterHistoryAction?: (action: LocalHistoryAction) => void;
  onRuleSetCreated?: (ruleSetId: Id<"ruleSets">) => void;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
}

interface ExtendedSchedule extends Omit<Doc<"baseSchedules">, "_creationTime"> {
  _creationTime?: number; // Optional for synthetic objects
  // Group editing metadata - computed fields not in schema
  _groupDaysOfWeek?: number[];
  _groupScheduleIds?: Id<"baseSchedules">[];
  _isGroup?: boolean;
}

// Helper functions
export default function BaseScheduleManagement({
  onRegisterHistoryAction,
  onRuleSetCreated,
  practiceId,
  ruleSetId,
}: BaseScheduleManagementProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ExtendedSchedule>();

  const { captureError } = useErrorTracking();

  const practitionersQuery = useQuery(api.entities.getPractitioners, {
    ruleSetId,
  });
  const schedulesQuery = useQuery(api.entities.getBaseSchedules, {
    ruleSetId,
  });

  const createScheduleMutation = useMutation(api.entities.createBaseSchedule);
  const deleteScheduleMutation = useMutation(api.entities.deleteBaseSchedule);
  const schedulesRef = React.useRef(schedulesQuery ?? []);
  React.useEffect(() => {
    schedulesRef.current = schedulesQuery ?? [];
  }, [schedulesQuery]);

  const handleEditGroup = (scheduleGroup: {
    breakTimes?: { end: string; start: string }[];
    daysOfWeek: number[];
    endTime: string;
    locationId?: Id<"locations">;
    locationName?: string;
    practitionerId: Id<"practitioners">;
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
      _id: firstScheduleId, // Use first ID for form processing
      ...(scheduleGroup.breakTimes && { breakTimes: scheduleGroup.breakTimes }),
      dayOfWeek: firstDayOfWeek, // This will be overridden by the form
      endTime: scheduleGroup.endTime,
      locationId: scheduleGroup.locationId || ("" as Id<"locations">),
      practiceId,
      practitionerId: scheduleGroup.practitionerId,
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
    if (
      !confirm(
        `Sind Sie sicher, dass Sie diese ${scheduleIds.length > 1 ? "Arbeitszeiten" : "Arbeitszeit"} löschen möchten?`,
      )
    ) {
      return;
    }

    try {
      const deletedSchedules = schedulesRef.current.filter((schedule) =>
        scheduleIds.includes(schedule._id),
      );

      // Track if rule set changed
      let newRuleSetId: Id<"ruleSets"> | undefined;

      for (const scheduleId of scheduleIds) {
        const result = await deleteScheduleMutation({
          baseScheduleId: scheduleId,
          practiceId,
          sourceRuleSetId: ruleSetId,
        });
        // All deletes should return the same ruleSetId, but we'll use the last one
        newRuleSetId = result.ruleSetId;
      }

      toast.success(
        `${scheduleIds.length > 1 ? "Arbeitszeiten" : "Arbeitszeit"} erfolgreich gelöscht`,
      );

      if (deletedSchedules.length > 0 && newRuleSetId) {
        let currentScheduleIds: Id<"baseSchedules">[] = [...scheduleIds];

        onRegisterHistoryAction?.({
          label: "Arbeitszeiten gelöscht",
          redo: async () => {
            const existingIds = new Set(
              schedulesRef.current.map((schedule) => schedule._id),
            );
            const idsToDelete = currentScheduleIds.filter((id) =>
              existingIds.has(id),
            );
            if (idsToDelete.length === 0) {
              return {
                message: "Die Arbeitszeiten sind bereits gelöscht.",
                status: "conflict" as const,
              };
            }

            for (const scheduleId of idsToDelete) {
              await deleteScheduleMutation({
                baseScheduleId: scheduleId,
                practiceId,
                sourceRuleSetId: newRuleSetId,
              });
            }

            return { status: "applied" as const };
          },
          undo: async () => {
            const recreatedIds: Id<"baseSchedules">[] = [];
            for (const schedule of deletedSchedules) {
              const result = await createScheduleMutation({
                dayOfWeek: schedule.dayOfWeek,
                endTime: schedule.endTime,
                locationId: schedule.locationId,
                practiceId,
                practitionerId: schedule.practitionerId,
                sourceRuleSetId: newRuleSetId,
                startTime: schedule.startTime,
                ...(schedule.breakTimes && { breakTimes: schedule.breakTimes }),
              });
              recreatedIds.push(result.entityId as Id<"baseSchedules">);
            }

            currentScheduleIds = recreatedIds;
            return { status: "applied" as const };
          },
        });
      }

      // Notify parent if rule set changed (new unsaved rule set was created)
      if (onRuleSetCreated && newRuleSetId && newRuleSetId !== ruleSetId) {
        onRuleSetCreated(newRuleSetId);
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
        locationId?: Id<"locations">;
        locationName?: string;
        practitionerId: Id<"practitioners">;
        scheduleIds: Id<"baseSchedules">[];
        startTime: string;
      };
    }[]
  > = {};

  if (schedulesQuery) {
    for (const schedule of schedulesQuery) {
      // Look up practitioner name from ID
      const practitioner = practitionersQuery?.find(
        (p) => p._id === schedule.practitionerId,
      );
      const practitionerName = practitioner?.name ?? "Unknown";

      schedulesByPractitioner[practitionerName] ??= [];

      // Look for existing group with same times, breaks, and location
      const existingGroup = schedulesByPractitioner[practitionerName].find(
        (item) =>
          item.scheduleGroup.startTime === schedule.startTime &&
          item.scheduleGroup.endTime === schedule.endTime &&
          item.scheduleGroup.locationId === schedule.locationId &&
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
            ...(schedule.locationId && { locationId: schedule.locationId }),
            practitionerId: schedule.practitionerId,
            scheduleIds: [schedule._id],
            startTime: schedule.startTime,
          },
        });
      }
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
        {practitionersQuery === undefined || schedulesQuery === undefined ? (
          <div className="text-center py-8 text-muted-foreground">
            Lade Arbeitszeiten...
          </div>
        ) : practitionersQuery.length === 0 ? (
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
        ruleSetId={ruleSetId}
        schedule={editingSchedule}
        {...(onRegisterHistoryAction && { onRegisterHistoryAction })}
        {...(onRuleSetCreated && { onRuleSetCreated })}
      />
    </Card>
  );
}

function BaseScheduleDialog({
  isOpen,
  onClose,
  onRegisterHistoryAction,
  onRuleSetCreated,
  practiceId,
  ruleSetId,
  schedule,
}: BaseScheduleDialogProps) {
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
  const schedulesRef = React.useRef(schedulesQuery ?? []);
  React.useEffect(() => {
    schedulesRef.current = schedulesQuery ?? [];
  }, [schedulesQuery]);

  const createScheduleMutation = useMutation(api.entities.createBaseSchedule);
  const deleteScheduleMutation = useMutation(api.entities.deleteBaseSchedule);

  const form = useForm({
    defaultValues: {
      breakTimes: schedule?.breakTimes ?? [],
      daysOfWeek: schedule
        ? schedule._isGroup
          ? (schedule._groupDaysOfWeek ?? [])
          : [schedule.dayOfWeek]
        : [],
      endTime: schedule?.endTime ?? "17:00",
      locationId: schedule?.locationId ?? locationsQuery?.[0]?._id ?? "",
      practitionerId: schedule?.practitionerId ?? "",
      startTime: schedule?.startTime ?? "08:00",
    },
    onSubmit: async ({ value }) => {
      try {
        // Track if a new rule set is created during this operation
        let newRuleSetId: Id<"ruleSets"> | undefined;
        const createdScheduleIds: Id<"baseSchedules">[] = [];
        const createdSchedulePayloads: {
          breakTimes?: { end: string; start: string }[];
          dayOfWeek: number;
          endTime: string;
          locationId: Id<"locations">;
          practitionerId: Id<"practitioners">;
          startTime: string;
        }[] = [];
        const deletedScheduleSnapshots: Doc<"baseSchedules">[] = [];

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

          // Delete all existing schedules in the group
          for (const scheduleId of scheduleIdsToDelete) {
            const deleteResult = await deleteScheduleMutation({
              baseScheduleId: scheduleId,
              practiceId,
              sourceRuleSetId: ruleSetId,
            });
            // Capture the rule set ID from the delete (all should be the same)
            newRuleSetId ||= deleteResult.ruleSetId;
          }

          // Create new schedules for each selected day
          for (const dayOfWeek of selectedDays) {
            const createData: {
              breakTimes?: { end: string; start: string }[];
              dayOfWeek: number;
              endTime: string;
              locationId: Id<"locations">;
              practiceId: Id<"practices">;
              practitionerId: Id<"practitioners">;
              sourceRuleSetId: Id<"ruleSets">;
              startTime: string;
            } = {
              dayOfWeek,
              endTime: value.endTime,
              locationId: value.locationId as Id<"locations">,
              practiceId,
              practitionerId: schedule.practitionerId,
              sourceRuleSetId: ruleSetId,
              startTime: value.startTime,
            };

            if (value.breakTimes.length > 0) {
              createData.breakTimes = value.breakTimes;
            }

            const result = await createScheduleMutation(createData);
            createdSchedulePayloads.push({
              ...(createData.breakTimes && {
                breakTimes: createData.breakTimes,
              }),
              dayOfWeek: createData.dayOfWeek,
              endTime: createData.endTime,
              locationId: createData.locationId,
              practitionerId: createData.practitionerId,
              startTime: createData.startTime,
            });
            createdScheduleIds.push(result.entityId as Id<"baseSchedules">);
            // Capture the rule set ID from the first created schedule
            newRuleSetId ||= result.ruleSetId;
          }

          // Notify parent if rule set changed (new unsaved rule set was created)
          if (onRuleSetCreated && newRuleSetId && newRuleSetId !== ruleSetId) {
            onRuleSetCreated(newRuleSetId);
          }

          toast.success(
            `Arbeitszeit${selectedDays.length > 1 ? "en" : ""} erfolgreich aktualisiert`,
          );
        } else {
          // Create new schedule(s) - one for each selected day
          if (!value.practitionerId) {
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

          if (!value.locationId) {
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

          for (const dayOfWeek of value.daysOfWeek) {
            const createData: {
              breakTimes?: { end: string; start: string }[];
              dayOfWeek: number;
              endTime: string;
              locationId: Id<"locations">;
              practiceId: Id<"practices">;
              practitionerId: Id<"practitioners">;
              sourceRuleSetId: Id<"ruleSets">;
              startTime: string;
            } = {
              dayOfWeek,
              endTime: value.endTime,
              locationId: value.locationId as Id<"locations">,
              practiceId,
              practitionerId: value.practitionerId as Id<"practitioners">,
              sourceRuleSetId: ruleSetId,
              startTime: value.startTime,
            };

            if (value.breakTimes.length > 0) {
              createData.breakTimes = value.breakTimes;
            }

            const result = await createScheduleMutation(createData);
            createdSchedulePayloads.push({
              ...(createData.breakTimes && {
                breakTimes: createData.breakTimes,
              }),
              dayOfWeek: createData.dayOfWeek,
              endTime: createData.endTime,
              locationId: createData.locationId,
              practitionerId: createData.practitionerId,
              startTime: createData.startTime,
            });
            createdScheduleIds.push(result.entityId as Id<"baseSchedules">);
            // Capture the rule set ID from the first created schedule
            newRuleSetId ||= result.ruleSetId;
          }

          // Notify parent if rule set changed (new unsaved rule set was created)
          if (onRuleSetCreated && newRuleSetId && newRuleSetId !== ruleSetId) {
            onRuleSetCreated(newRuleSetId);
          }

          toast.success(
            `Arbeitszeit${value.daysOfWeek.length > 1 ? "en" : ""} erfolgreich erstellt`,
          );
        }

        if (newRuleSetId) {
          if (!schedule && createdSchedulePayloads.length > 0) {
            let currentCreatedIds = [...createdScheduleIds];
            onRegisterHistoryAction?.({
              label: "Arbeitszeiten erstellt",
              redo: async () => {
                const recreatedIds: Id<"baseSchedules">[] = [];
                for (const payload of createdSchedulePayloads) {
                  const result = await createScheduleMutation({
                    ...payload,
                    practiceId,
                    sourceRuleSetId: newRuleSetId,
                  });
                  recreatedIds.push(result.entityId as Id<"baseSchedules">);
                }
                currentCreatedIds = recreatedIds;
                return { status: "applied" as const };
              },
              undo: async () => {
                for (const id of currentCreatedIds) {
                  const exists = schedulesRef.current.some((s) => s._id === id);
                  if (exists) {
                    await deleteScheduleMutation({
                      baseScheduleId: id,
                      practiceId,
                      sourceRuleSetId: newRuleSetId,
                    });
                  }
                }
                return { status: "applied" as const };
              },
            });
          }

          if (schedule && createdSchedulePayloads.length > 0) {
            let mode: "new" | "old" = "new";
            let currentNewIds = [...createdScheduleIds];
            let currentOldIds: Id<"baseSchedules">[] = [];

            onRegisterHistoryAction?.({
              label: "Arbeitszeiten aktualisiert",
              redo: async () => {
                if (mode !== "old") {
                  return { status: "noop" as const };
                }

                for (const id of currentOldIds) {
                  const exists = schedulesRef.current.some((s) => s._id === id);
                  if (exists) {
                    await deleteScheduleMutation({
                      baseScheduleId: id,
                      practiceId,
                      sourceRuleSetId: newRuleSetId,
                    });
                  }
                }

                const recreatedIds: Id<"baseSchedules">[] = [];
                for (const payload of createdSchedulePayloads) {
                  const result = await createScheduleMutation({
                    ...payload,
                    practiceId,
                    sourceRuleSetId: newRuleSetId,
                  });
                  recreatedIds.push(result.entityId as Id<"baseSchedules">);
                }

                currentNewIds = recreatedIds;
                mode = "new";
                return { status: "applied" as const };
              },
              undo: async () => {
                if (mode !== "new") {
                  return { status: "noop" as const };
                }

                for (const id of currentNewIds) {
                  const exists = schedulesRef.current.some((s) => s._id === id);
                  if (exists) {
                    await deleteScheduleMutation({
                      baseScheduleId: id,
                      practiceId,
                      sourceRuleSetId: newRuleSetId,
                    });
                  }
                }

                const restoredOldIds: Id<"baseSchedules">[] = [];
                for (const previous of deletedScheduleSnapshots) {
                  const result = await createScheduleMutation({
                    dayOfWeek: previous.dayOfWeek,
                    endTime: previous.endTime,
                    locationId: previous.locationId,
                    practiceId,
                    practitionerId: previous.practitionerId,
                    sourceRuleSetId: newRuleSetId,
                    startTime: previous.startTime,
                    ...(previous.breakTimes && {
                      breakTimes: previous.breakTimes,
                    }),
                  });
                  restoredOldIds.push(result.entityId as Id<"baseSchedules">);
                }

                currentOldIds = restoredOldIds;
                mode = "old";
                return { status: "applied" as const };
              },
            });
          }
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
                        {practitionersQuery?.map((practitioner) => (
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
                        {locationsQuery?.map((location) => (
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

  // Auto-save partial break time when form is submitted
  React.useEffect(() => {
    if (newBreakStart && newBreakEnd) {
      if (newBreakStart < newBreakEnd) {
        const newBreak = { end: newBreakEnd, start: newBreakStart };
        if (
          !value.some(
            (bt) => bt.start === newBreakStart && bt.end === newBreakEnd,
          )
        ) {
          onBreakTimesChange([...value, newBreak]);
          setNewBreakStart("");
          setNewBreakEnd("");
        }
      } else {
        onValidationError?.(true);
      }
    } else if (
      (newBreakStart || newBreakEnd) &&
      !(newBreakStart && newBreakEnd)
    ) {
      onValidationError?.(true); // Incomplete break time
    } else {
      onValidationError?.(false);
    }
  }, [
    newBreakStart,
    newBreakEnd,
    value,
    onBreakTimesChange,
    onValidationError,
  ]);

  const addBreakTime = () => {
    if (!newBreakStart || !newBreakEnd) {
      toast.error("Bitte füllen Sie beide Pausenzeiten aus");
      return;
    }

    if (newBreakStart >= newBreakEnd) {
      toast.error("Die Pausenstart-Zeit muss vor der Pausenend-Zeit liegen");
      return;
    }

    const newBreak = { end: newBreakEnd, start: newBreakStart };
    onBreakTimesChange([...value, newBreak]);

    setNewBreakStart("");
    setNewBreakEnd("");
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
            setNewBreakStart(e.target.value);
          }}
          placeholder="Pausenbeginn"
          type="time"
          value={newBreakStart}
        />
        <Input
          onChange={(e) => {
            setNewBreakEnd(e.target.value);
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
