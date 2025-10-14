import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import { Package2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { api } from "@/convex/_generated/api";

type AppointmentType = AppointmentTypesResult[number];

interface AppointmentTypesManagementProps {
  onRuleSetCreated?: (ruleSetId: Id<"ruleSets">) => void;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
}

type AppointmentTypesResult =
  (typeof api.entities.getAppointmentTypes)["_returnType"];

// Form schema using Zod
const formSchema = z.object({
  duration: z
    .number()
    .min(5, "Dauer muss mindestens 5 Minuten betragen")
    .max(480, "Dauer darf maximal 480 Minuten (8 Stunden) betragen")
    .refine((val) => val % 5 === 0, {
      message: "Dauer muss in 5-Minuten-Schritten angegeben werden",
    }),
  name: z
    .string()
    .min(2, "Name muss mindestens 2 Zeichen lang sein")
    .max(50, "Name darf maximal 50 Zeichen lang sein"),
  practitionerIds: z
    .array(z.string())
    .min(1, "Mindestens ein Behandler muss ausgewählt werden"),
});

export function AppointmentTypesManagement({
  onRuleSetCreated,
  practiceId,
  ruleSetId,
}: AppointmentTypesManagementProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAppointmentType, setEditingAppointmentType] =
    useState<AppointmentType | null>(null);

  const appointmentTypesQuery = useQuery(api.entities.getAppointmentTypes, {
    ruleSetId,
  });
  const practitionersQuery = useQuery(api.entities.getPractitioners, {
    ruleSetId,
  });
  const createAppointmentTypeMutation = useMutation(
    api.entities.createAppointmentType,
  );
  const updateAppointmentTypeMutation = useMutation(
    api.entities.updateAppointmentType,
  );
  const deleteAppointmentTypeMutation = useMutation(
    api.entities.deleteAppointmentType,
  );

  const appointmentTypes: AppointmentType[] = appointmentTypesQuery ?? [];
  const practitioners = practitionersQuery ?? [];

  const form = useForm({
    defaultValues: {
      duration: 30,
      name: "",
      practitionerIds: [] as string[],
    },
    onSubmit: async ({ value }) => {
      try {
        if (editingAppointmentType) {
          // Update existing appointment type
          const { ruleSetId: newRuleSetId } =
            await updateAppointmentTypeMutation({
              appointmentTypeId: editingAppointmentType._id,
              duration: value.duration,
              name: value.name.trim(),
              practiceId,
              practitionerIds: value.practitionerIds as Id<"practitioners">[],
              sourceRuleSetId: ruleSetId,
            });

          toast.success("Terminart aktualisiert", {
            description: `Terminart "${value.name}" wurde erfolgreich aktualisiert.`,
          });

          setIsDialogOpen(false);
          setEditingAppointmentType(null);
          form.reset();

          // Notify parent if rule set changed (new unsaved rule set was created)
          if (onRuleSetCreated && newRuleSetId !== ruleSetId) {
            onRuleSetCreated(newRuleSetId);
          }
        } else {
          // Create new appointment type
          const { ruleSetId: newRuleSetId } =
            await createAppointmentTypeMutation({
              duration: value.duration,
              name: value.name.trim(),
              practiceId,
              practitionerIds: value.practitionerIds as Id<"practitioners">[],
              sourceRuleSetId: ruleSetId,
            });

          toast.success("Terminart erstellt", {
            description: `Terminart "${value.name}" wurde erfolgreich erstellt.`,
          });

          setIsDialogOpen(false);
          form.reset();

          // Notify parent if rule set changed (new unsaved rule set was created)
          if (onRuleSetCreated && newRuleSetId !== ruleSetId) {
            onRuleSetCreated(newRuleSetId);
          }
        }
      } catch (error: unknown) {
        toast.error(
          editingAppointmentType
            ? "Fehler beim Aktualisieren"
            : "Fehler beim Erstellen",
          {
            description:
              error instanceof Error ? error.message : "Unbekannter Fehler",
          },
        );
      }
    },
    validators: {
      onSubmit: formSchema,
    },
  });

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingAppointmentType(null);
    form.reset();
  };

  const openCreateDialog = () => {
    setEditingAppointmentType(null);
    form.reset();
    setIsDialogOpen(true);
  };

  const openEditDialog = (appointmentType: AppointmentType) => {
    setEditingAppointmentType(appointmentType);
    form.setFieldValue("name", appointmentType.name);
    form.setFieldValue("duration", appointmentType.duration);
    form.setFieldValue(
      "practitionerIds",
      appointmentType.allowedPractitionerIds,
    );
    setIsDialogOpen(true);
  };

  const handleDelete = async (appointmentType: AppointmentType) => {
    try {
      const { ruleSetId: newRuleSetId } = await deleteAppointmentTypeMutation({
        appointmentTypeId: appointmentType._id,
        practiceId,
        sourceRuleSetId: ruleSetId,
      });

      toast.success("Terminart gelöscht", {
        description: `Terminart "${appointmentType.name}" wurde erfolgreich gelöscht.`,
      });

      // Notify parent if rule set changed (new unsaved rule set was created)
      if (onRuleSetCreated && newRuleSetId !== ruleSetId) {
        onRuleSetCreated(newRuleSetId);
      }
    } catch (error: unknown) {
      toast.error("Fehler beim Löschen", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Package2 className="h-5 w-5" />
            <div>
              <CardTitle>Terminarten</CardTitle>
            </div>
          </div>
          <Dialog onOpenChange={setIsDialogOpen} open={isDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog} size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                Terminart hinzufügen
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingAppointmentType
                    ? "Terminart bearbeiten"
                    : "Neue Terminart hinzufügen"}
                </DialogTitle>
                <DialogDescription>
                  {editingAppointmentType
                    ? "Bearbeiten Sie die Terminart."
                    : "Erstellen Sie eine neue Terminart mit Namen und Dauer."}
                </DialogDescription>
              </DialogHeader>
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void form.handleSubmit();
                }}
              >
                <FieldGroup>
                  <form.Field name="name">
                    {(field) => {
                      const isInvalid =
                        field.state.meta.isTouched && !field.state.meta.isValid;

                      return (
                        <Field data-invalid={isInvalid}>
                          <FieldLabel htmlFor="appointment-type-name">
                            Name der Terminart
                          </FieldLabel>
                          <Input
                            aria-invalid={isInvalid}
                            id="appointment-type-name"
                            onBlur={field.handleBlur}
                            onChange={(e) => {
                              field.handleChange(e.target.value);
                            }}
                            placeholder="z.B. Erstgespräch, Kontrolltermin"
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

                  <form.Field name="duration">
                    {(field) => {
                      const isInvalid =
                        field.state.meta.isTouched && !field.state.meta.isValid;

                      return (
                        <Field data-invalid={isInvalid}>
                          <FieldLabel htmlFor="appointment-type-duration">
                            Dauer (in Minuten)
                          </FieldLabel>
                          <Input
                            aria-invalid={isInvalid}
                            id="appointment-type-duration"
                            max={480}
                            min={5}
                            onBlur={field.handleBlur}
                            onChange={(e) => {
                              field.handleChange(Number(e.target.value));
                            }}
                            placeholder="30"
                            step={5}
                            type="number"
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

                  <form.Field mode="array" name="practitionerIds">
                    {(field) => {
                      const isInvalid =
                        field.state.meta.isTouched && !field.state.meta.isValid;

                      return (
                        <FieldSet>
                          <FieldLegend variant="label">
                            Behandler auswählen
                          </FieldLegend>
                          <FieldDescription>
                            Wählen Sie mindestens einen Behandler für diese
                            Terminart aus.
                          </FieldDescription>
                          <FieldGroup
                            className="gap-3"
                            data-invalid={isInvalid}
                          >
                            {practitionersQuery === undefined ? (
                              <div className="text-sm text-muted-foreground">
                                Lade Behandler...
                              </div>
                            ) : practitioners.length === 0 ? (
                              <div className="text-sm text-muted-foreground">
                                Keine Behandler verfügbar. Bitte erstellen Sie
                                zuerst Behandler.
                              </div>
                            ) : (
                              practitioners.map((practitioner) => (
                                <Field
                                  key={practitioner._id}
                                  orientation="horizontal"
                                >
                                  <Checkbox
                                    aria-invalid={isInvalid}
                                    checked={field.state.value.includes(
                                      practitioner._id,
                                    )}
                                    id={`practitioner-${practitioner._id}`}
                                    onBlur={field.handleBlur}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        field.pushValue(practitioner._id);
                                      } else {
                                        const index = field.state.value.indexOf(
                                          practitioner._id,
                                        );
                                        if (index !== -1) {
                                          field.removeValue(index);
                                        }
                                      }
                                    }}
                                  />
                                  <FieldLabel
                                    className="font-normal"
                                    htmlFor={`practitioner-${practitioner._id}`}
                                  >
                                    {practitioner.name}
                                  </FieldLabel>
                                </Field>
                              ))
                            )}
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
                </FieldGroup>

                <DialogFooter className="mt-6">
                  <Button onClick={closeDialog} type="button" variant="outline">
                    Abbrechen
                  </Button>
                  <form.Subscribe
                    selector={(state) => [state.canSubmit, state.isSubmitting]}
                  >
                    {([canSubmit, isSubmitting]) => (
                      <Button
                        disabled={!canSubmit || isSubmitting}
                        type="submit"
                      >
                        {isSubmitting
                          ? editingAppointmentType
                            ? "Aktualisiere..."
                            : "Erstelle..."
                          : editingAppointmentType
                            ? "Aktualisieren"
                            : "Erstellen"}
                      </Button>
                    )}
                  </form.Subscribe>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {appointmentTypesQuery === undefined ? (
          <div className="text-center py-4 text-muted-foreground">
            Lade Terminarten...
          </div>
        ) : appointmentTypes.length === 0 ? (
          <div className="text-center py-8">
            <Package2 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <div className="text-muted-foreground">
              Noch keine Terminarten vorhanden
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              {appointmentTypes.length} Terminarten verfügbar
            </div>

            <div className="grid gap-3">
              {appointmentTypes.map((appointmentType) => {
                // Get practitioner names for this appointment type
                const appointmentTypePractitioners =
                  appointmentType.allowedPractitionerIds
                    .map((practId) =>
                      practitioners.find((p) => p._id === practId),
                    )
                    .filter((p): p is NonNullable<typeof p> => p !== undefined);

                return (
                  <div
                    className="border rounded-lg p-3 flex items-start justify-between"
                    key={appointmentType._id}
                  >
                    <div className="flex-1">
                      <div className="font-medium mb-2">
                        {appointmentType.name}
                      </div>
                      <div className="text-sm text-muted-foreground mb-2">
                        Dauer: {appointmentType.duration} Minuten
                      </div>
                      {appointmentTypePractitioners.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {appointmentTypePractitioners.map((practitioner) => (
                            <Badge key={practitioner._id} variant="secondary">
                              {practitioner.name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        onClick={() => {
                          openEditDialog(appointmentType);
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        onClick={() => {
                          void handleDelete(appointmentType);
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
