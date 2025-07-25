// src/components/base-schedule-management.tsx
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import { Calendar, Clock, Edit, Plus, Trash2 } from "lucide-react";
import React, { useState } from "react";
import { toast } from "sonner";

import type { Id } from "@/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";

import { useErrorTracking } from "../utils/error-tracking";

const DAYS_OF_WEEK = [
  { label: "Montag", value: 1 },
  { label: "Dienstag", value: 2 },
  { label: "Mittwoch", value: 3 },
  { label: "Donnerstag", value: 4 },
  { label: "Freitag", value: 5 },
];

interface BaseScheduleDialogProps {
  isOpen: boolean;
  onClose: () => void;
  practiceId: Id<"practices">;
  schedule?: ExtendedSchedule | undefined;
}

interface BaseScheduleManagementProps {
  practiceId: Id<"practices">;
}

interface ExtendedSchedule {
  _id: Id<"baseSchedules">;
  breakTimes?: { end: string; start: string }[];
  dayOfWeek: number;
  endTime: string;
  practitionerId: Id<"practitioners">;
  startTime: string;
  // Group editing metadata
  _groupDaysOfWeek?: number[];
  _groupScheduleIds?: Id<"baseSchedules">[];
  _isGroup?: boolean;
}

// Helper functions
export default function BaseScheduleManagement({
  practiceId,
}: BaseScheduleManagementProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ExtendedSchedule>();

  const { captureError } = useErrorTracking();

  const practitionersQuery = useQuery(api.practitioners.getPractitioners, {
    practiceId,
  });
  const schedulesQuery = useQuery(api.baseSchedules.getAllBaseSchedules, {
    practiceId,
  });

  const deleteScheduleMutation = useMutation(
    api.baseSchedules.deleteBaseSchedule,
  );

  const handleEditGroup = (scheduleGroup: {
    breakTimes?: { end: string; start: string }[];
    daysOfWeek: number[];
    endTime: string;
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
      practitionerId: scheduleGroup.practitionerId,
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
      for (const scheduleId of scheduleIds) {
        await deleteScheduleMutation({ scheduleId });
      }
      toast.success(
        `${scheduleIds.length > 1 ? "Arbeitszeiten" : "Arbeitszeit"} erfolgreich gelöscht`,
      );
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

  // Group schedules by practitioner and then by schedule "signature" (time + breaks)
  const schedulesByPractitioner =
    schedulesQuery?.reduce(
      (
        acc: Record<
          string,
          {
            practitionerName: string;
            scheduleGroup: {
              breakTimes?: { end: string; start: string }[];
              daysOfWeek: number[];
              endTime: string;
              practitionerId: Id<"practitioners">;
              scheduleIds: Id<"baseSchedules">[];
              startTime: string;
            };
          }[]
        >,
        schedule,
      ) => {
        const practitionerName = schedule.practitionerName;
        acc[practitionerName] ??= [];

        // Look for existing group with same times and breaks
        const existingGroup = acc[practitionerName].find(
          (item) =>
            item.scheduleGroup.startTime === schedule.startTime &&
            item.scheduleGroup.endTime === schedule.endTime &&
            JSON.stringify(item.scheduleGroup.breakTimes ?? []) ===
              JSON.stringify(schedule.breakTimes ?? []),
        );

        if (existingGroup) {
          // Add this day to existing group
          existingGroup.scheduleGroup.daysOfWeek.push(schedule.dayOfWeek);
          existingGroup.scheduleGroup.scheduleIds.push(schedule._id);
          existingGroup.scheduleGroup.daysOfWeek.sort();
        } else {
          // Create new group
          acc[practitionerName].push({
            practitionerName,
            scheduleGroup: {
              ...(schedule.breakTimes && { breakTimes: schedule.breakTimes }),
              daysOfWeek: [schedule.dayOfWeek],
              endTime: schedule.endTime,
              practitionerId: schedule.practitionerId,
              scheduleIds: [schedule._id],
              startTime: schedule.startTime,
            },
          });
        }

        return acc;
      },
      {} as Record<
        string,
        {
          practitionerName: string;
          scheduleGroup: {
            breakTimes?: { end: string; start: string }[];
            daysOfWeek: number[];
            endTime: string;
            practitionerId: Id<"practitioners">;
            scheduleIds: Id<"baseSchedules">[];
            startTime: string;
          };
        }[]
      >,
    ) ?? {};

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Arbeitszeiten
            </CardTitle>
            <CardDescription>
              Definieren Sie die Arbeitszeiten und Pausenzeiten für jeden Arzt
            </CardDescription>
          </div>
          <Button
            onClick={() => {
              setIsDialogOpen(true);
            }}
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
                          <div className="flex items-center gap-2 mb-1">
                            <div className="flex gap-1">
                              {scheduleGroup.scheduleGroup.daysOfWeek.map(
                                (day) => (
                                  <Badge key={day} variant="outline">
                                    {getDayName(day)}
                                  </Badge>
                                ),
                              )}
                            </div>
                            <span className="font-medium">
                              {scheduleGroup.scheduleGroup.startTime} -{" "}
                              {scheduleGroup.scheduleGroup.endTime}
                            </span>
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
        schedule={editingSchedule}
      />
    </Card>
  );
}

function BaseScheduleDialog({
  isOpen,
  onClose,
  practiceId,
  schedule,
}: BaseScheduleDialogProps) {
  const { captureError } = useErrorTracking();

  const practitionersQuery = useQuery(api.practitioners.getPractitioners, {
    practiceId,
  });

  const createScheduleMutation = useMutation(
    api.baseSchedules.createBaseSchedule,
  );
  const deleteScheduleMutation = useMutation(
    api.baseSchedules.deleteBaseSchedule,
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
      practitionerId: schedule?.practitionerId ?? "",
      startTime: schedule?.startTime ?? "08:00",
    },
    onSubmit: async ({ value }) => {
      try {
        if (schedule) {
          // When editing, check if it's a group edit
          const isGroupEdit = schedule._isGroup ?? false;
          const scheduleIdsToDelete = isGroupEdit
            ? (schedule._groupScheduleIds ?? [])
            : [schedule._id];

          const selectedDays = value.daysOfWeek;

          if (selectedDays.length === 0) {
            const error = new Error("Bitte wählen Sie mindestens einen Wochentag aus");
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
            await deleteScheduleMutation({ scheduleId });
          }

          // Create new schedules for each selected day
          for (const dayOfWeek of selectedDays) {
            const createData: {
              breakTimes?: { end: string; start: string }[];
              dayOfWeek: number;
              endTime: string;
              practitionerId: Id<"practitioners">;
              startTime: string;
            } = {
              dayOfWeek,
              endTime: value.endTime,
              practitionerId: schedule.practitionerId,
              startTime: value.startTime,
            };

            if (value.breakTimes.length > 0) {
              createData.breakTimes = value.breakTimes;
            }

            await createScheduleMutation(createData);
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

          if (value.daysOfWeek.length === 0) {
            const error = new Error("Bitte wählen Sie mindestens einen Wochentag aus");
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
              practitionerId: Id<"practitioners">;
              startTime: string;
            } = {
              dayOfWeek,
              endTime: value.endTime,
              practitionerId: value.practitionerId as Id<"practitioners">,
              startTime: value.startTime,
            };

            if (value.breakTimes.length > 0) {
              createData.breakTimes = value.breakTimes;
            }

            await createScheduleMutation(createData);
          }

          toast.success(
            `Arbeitszeit${value.daysOfWeek.length > 1 ? "en" : ""} erfolgreich erstellt`,
          );
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
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field
            name="practitionerId"
            validators={{
              onChange: ({ value }) =>
                value ? undefined : "Bitte wählen Sie einen Arzt aus",
            }}
          >
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="practitioner">Arzt</Label>
                <Select
                  disabled={!!schedule}
                  onValueChange={field.handleChange}
                  value={field.state.value}
                >
                  <SelectTrigger>
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
                {field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-red-500">
                    {field.state.meta.errors[0]}
                  </p>
                )}
                {schedule && (
                  <p className="text-xs text-muted-foreground">
                    Arzt kann bei der Bearbeitung nicht geändert werden
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <form.Field
            name="daysOfWeek"
            validators={{
              onChange: ({ value }) => {
                return value.length > 0
                  ? undefined
                  : "Bitte wählen Sie mindestens einen Wochentag aus";
              },
            }}
          >
            {(field) => (
              <div className="space-y-2">
                <Label>Wochentage</Label>
                <div className="grid grid-cols-2 gap-2">
                  {DAYS_OF_WEEK.map((day) => (
                    <label
                      className="flex items-center space-x-2"
                      key={day.value}
                    >
                      <input
                        checked={field.state.value.includes(day.value)}
                        onChange={(e) => {
                          const currentDays = field.state.value;
                          if (e.target.checked) {
                            field.handleChange([...currentDays, day.value]);
                          } else {
                            field.handleChange(
                              currentDays.filter(
                                (d: number) => d !== day.value,
                              ),
                            );
                          }
                        }}
                        type="checkbox"
                      />
                      <span className="text-sm">{day.label}</span>
                    </label>
                  ))}
                </div>
                {field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-red-500">
                    {field.state.meta.errors[0]}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <div className="grid grid-cols-2 gap-4">
            <form.Field
              name="startTime"
              validators={{
                onChange: ({ value }) =>
                  value ? undefined : "Arbeitsbeginn ist erforderlich",
              }}
            >
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="startTime">Arbeitsbeginn</Label>
                  <Input
                    id="startTime"
                    onBlur={field.handleBlur}
                    onChange={(e) => {
                      field.handleChange(e.target.value);
                    }}
                    required
                    type="time"
                    value={field.state.value}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm text-red-500">
                      {field.state.meta.errors[0]}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            <form.Field
              name="endTime"
              validators={{
                onChange: ({ value }) =>
                  value ? undefined : "Arbeitsende ist erforderlich",
              }}
            >
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="endTime">Arbeitsende</Label>
                  <Input
                    id="endTime"
                    onBlur={field.handleBlur}
                    onChange={(e) => {
                      field.handleChange(e.target.value);
                    }}
                    required
                    type="time"
                    value={field.state.value}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm text-red-500">
                      {field.state.meta.errors[0]}
                    </p>
                  )}
                </div>
              )}
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
      <Label>Pausenzeiten</Label>

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
