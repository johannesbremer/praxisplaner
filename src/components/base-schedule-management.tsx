// src/components/base-schedule-management.tsx
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import { Calendar, Clock, Edit, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
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
  { label: "Samstag", value: 6 },
  { label: "Sonntag", value: 0 },
];

const SLOT_DURATIONS = [
  { label: "15 Minuten", value: 15 },
  { label: "20 Minuten", value: 20 },
  { label: "30 Minuten", value: 30 },
  { label: "45 Minuten", value: 45 },
  { label: "60 Minuten", value: 60 },
];

interface BaseScheduleDialogProps {
  isOpen: boolean;
  onClose: () => void;
  practiceId: Id<"practices">;
  schedule?:
    | undefined
    | {
        _id: Id<"baseSchedules">;
        breakTimes?: { end: string; start: string }[];
        dayOfWeek: number;
        endTime: string;
        practitionerId: Id<"practitioners">;
        slotDuration: number;
        startTime: string;
      };
}

interface BaseScheduleManagementProps {
  practiceId: Id<"practices">;
}

// Helper functions
export default function BaseScheduleManagement({
  practiceId,
}: BaseScheduleManagementProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<
    | undefined
    | {
        _id: Id<"baseSchedules">;
        breakTimes?: { end: string; start: string }[];
        dayOfWeek: number;
        endTime: string;
        practitionerId: Id<"practitioners">;
        slotDuration: number;
        startTime: string;
      }
  >();

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

  const handleEdit = (schedule: {
    _id: Id<"baseSchedules">;
    breakTimes?: { end: string; start: string }[];
    dayOfWeek: number;
    endTime: string;
    practitionerId: Id<"practitioners">;
    slotDuration: number;
    startTime: string;
  }) => {
    setEditingSchedule(schedule);
    setIsDialogOpen(true);
  };

  const handleDelete = async (scheduleId: Id<"baseSchedules">) => {
    if (
      !confirm("Sind Sie sicher, dass Sie diese Arbeitszeit löschen möchten?")
    ) {
      return;
    }

    try {
      await deleteScheduleMutation({ scheduleId });
      toast.success("Arbeitszeit erfolgreich gelöscht");
    } catch (error: unknown) {
      captureError(error, {
        context: "base_schedule_delete",
        practiceId,
        scheduleId,
      });

      toast.error("Fehler beim Löschen der Arbeitszeit");
    }
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingSchedule(undefined);
  };

  // Group schedules by practitioner
  const schedulesByPractitioner =
    schedulesQuery?.reduce(
      (acc: Record<string, typeof schedulesQuery>, schedule) => {
        const practitionerName = schedule.practitionerName;
        acc[practitionerName] ??= [];
        acc[practitionerName].push(schedule);
        return acc;
      },
      {} as Record<string, typeof schedulesQuery>,
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
              ([practitionerName, schedules]) => (
                <div className="space-y-2" key={practitionerName}>
                  <h4 className="font-medium text-lg">{practitionerName}</h4>
                  <div className="grid gap-2">
                    {schedules.map((schedule) => (
                      <div
                        className="flex items-center justify-between p-3 border rounded-lg"
                        key={schedule._id}
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline">
                              {getDayName(schedule.dayOfWeek)}
                            </Badge>
                            <span className="font-medium">
                              {schedule.startTime} - {schedule.endTime}
                            </span>
                            <Badge variant="secondary">
                              {schedule.slotDuration} Min.
                            </Badge>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            Pausen: {formatBreakTimes(schedule.breakTimes)}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={() => {
                              handleEdit(schedule);
                            }}
                            size="sm"
                            variant="ghost"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            onClick={() => {
                              void handleDelete(schedule._id);
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
  const updateScheduleMutation = useMutation(
    api.baseSchedules.updateBaseSchedule,
  );

  const form = useForm({
    defaultValues: {
      breakTimes: schedule?.breakTimes ?? [],
      dayOfWeek: schedule?.dayOfWeek ?? 1,
      endTime: schedule?.endTime ?? "17:00",
      practitionerId: schedule?.practitionerId ?? "",
      slotDuration: schedule?.slotDuration ?? 30,
      startTime: schedule?.startTime ?? "08:00",
    },
    onSubmit: async ({ value }) => {
      try {
        if (schedule) {
          // Update existing schedule
          const updateData: {
            breakTimes?: { end: string; start: string }[];
            endTime: string;
            scheduleId: Id<"baseSchedules">;
            slotDuration: number;
            startTime: string;
          } = {
            endTime: value.endTime,
            scheduleId: schedule._id,
            slotDuration: value.slotDuration,
            startTime: value.startTime,
          };

          if (value.breakTimes.length > 0) {
            updateData.breakTimes = value.breakTimes;
          }

          await updateScheduleMutation(updateData);
          toast.success("Arbeitszeit erfolgreich aktualisiert");
        } else {
          // Create new schedule
          if (!value.practitionerId) {
            throw new Error("Bitte wählen Sie einen Arzt aus");
          }

          const createData: {
            breakTimes?: { end: string; start: string }[];
            dayOfWeek: number;
            endTime: string;
            practitionerId: Id<"practitioners">;
            slotDuration: number;
            startTime: string;
          } = {
            dayOfWeek: value.dayOfWeek,
            endTime: value.endTime,
            practitionerId: value.practitionerId as Id<"practitioners">,
            slotDuration: value.slotDuration,
            startTime: value.startTime,
          };

          if (value.breakTimes.length > 0) {
            createData.breakTimes = value.breakTimes;
          }

          await createScheduleMutation(createData);
          toast.success("Arbeitszeit erfolgreich erstellt");
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
          {!schedule && (
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
                </div>
              )}
            </form.Field>
          )}

          {!schedule && (
            <form.Field name="dayOfWeek">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="dayOfWeek">Wochentag</Label>
                  <Select
                    onValueChange={(value) => {
                      field.handleChange(Number.parseInt(value));
                    }}
                    value={field.state.value.toString()}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Wochentag auswählen" />
                    </SelectTrigger>
                    <SelectContent>
                      {DAYS_OF_WEEK.map((day) => (
                        <SelectItem
                          key={day.value}
                          value={day.value.toString()}
                        >
                          {day.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </form.Field>
          )}

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

          <form.Field name="slotDuration">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="slotDuration">Terminlänge</Label>
                <Select
                  onValueChange={(value) => {
                    field.handleChange(Number.parseInt(value));
                  }}
                  value={field.state.value.toString()}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Terminlänge auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {SLOT_DURATIONS.map((duration) => (
                      <SelectItem
                        key={duration.value}
                        value={duration.value.toString()}
                      >
                        {duration.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>

          <form.Field name="breakTimes">
            {(field) => (
              <BreakTimesField
                onBreakTimesChange={field.handleChange}
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
  value,
}: {
  onBreakTimesChange: (breakTimes: { end: string; start: string }[]) => void;
  value: { end: string; start: string }[];
}) {
  const [newBreakStart, setNewBreakStart] = useState("");
  const [newBreakEnd, setNewBreakEnd] = useState("");

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
