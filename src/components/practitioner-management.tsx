// src/components/practitioner-management.tsx
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import { Edit, Plus, Trash2, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { Doc, Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";

import type { LocalHistoryAction } from "../hooks/use-local-history";

import { useErrorTracking } from "../utils/error-tracking";

interface PractitionerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onRegisterHistoryAction?: (action: LocalHistoryAction) => void;
  onRuleSetCreated?: (ruleSetId: Id<"ruleSets">) => void;
  practiceId: Id<"practices">;
  practitioner?: Doc<"practitioners"> | undefined;
  ruleSetId: Id<"ruleSets">;
}

interface PractitionerManagementProps {
  onRegisterHistoryAction?: (action: LocalHistoryAction) => void;
  onRuleSetCreated?: (ruleSetId: Id<"ruleSets">) => void;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
}

export default function PractitionerManagement({
  onRegisterHistoryAction,
  onRuleSetCreated,
  practiceId,
  ruleSetId,
}: PractitionerManagementProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPractitioner, setEditingPractitioner] = useState<
    Doc<"practitioners"> | undefined
  >();

  const { captureError } = useErrorTracking();

  const practitionersQuery = useQuery(api.entities.getPractitioners, {
    ruleSetId,
  });
  const practitionersRef = useRef<Doc<"practitioners">[]>(
    practitionersQuery ?? [],
  );
  useEffect(() => {
    practitionersRef.current = practitionersQuery ?? [];
  }, [practitionersQuery]);
  const createMutation = useMutation(api.entities.createPractitioner);
  const deleteMutation = useMutation(api.entities.deletePractitioner);

  const handleEdit = (practitioner: Doc<"practitioners">) => {
    setEditingPractitioner(practitioner);
    setIsDialogOpen(true);
  };

  const handleDelete = async (practitionerId: Id<"practitioners">) => {
    if (!confirm("Sind Sie sicher, dass Sie diesen Arzt löschen möchten?")) {
      return;
    }

    try {
      const deletedPractitioner = practitionersRef.current.find(
        (practitioner) => practitioner._id === practitionerId,
      );

      const { ruleSetId: newRuleSetId } = await deleteMutation({
        practiceId,
        practitionerId,
        sourceRuleSetId: ruleSetId,
      });

      if (deletedPractitioner) {
        let currentPractitionerId = deletedPractitioner._id;
        onRegisterHistoryAction?.({
          label: "Arzt gelöscht",
          redo: async () => {
            const existing = practitionersRef.current.find(
              (practitioner) => practitioner._id === currentPractitionerId,
            );
            if (!existing) {
              return {
                message: "Der Arzt ist bereits gelöscht.",
                status: "conflict" as const,
              };
            }

            await deleteMutation({
              practiceId,
              practitionerId: currentPractitionerId,
              sourceRuleSetId: newRuleSetId,
            });
            return { status: "applied" as const };
          },
          undo: async () => {
            const duplicate = practitionersRef.current.find(
              (practitioner) => practitioner.name === deletedPractitioner.name,
            );
            if (duplicate) {
              return {
                message:
                  "Der Arzt kann nicht wiederhergestellt werden, weil bereits ein Arzt mit diesem Namen existiert.",
                status: "conflict" as const,
              };
            }

            const recreateResult = await createMutation({
              name: deletedPractitioner.name,
              practiceId,
              sourceRuleSetId: newRuleSetId,
              ...(deletedPractitioner.tags && {
                tags: deletedPractitioner.tags,
              }),
            });
            currentPractitionerId =
              recreateResult.entityId as Id<"practitioners">;
            return { status: "applied" as const };
          },
        });
      }
      toast.success("Arzt gelöscht");

      // Notify parent if rule set changed (new unsaved rule set was created)
      if (onRuleSetCreated && newRuleSetId !== ruleSetId) {
        onRuleSetCreated(newRuleSetId);
      }
    } catch (error: unknown) {
      captureError(error, {
        context: "practitioner_delete",
        practiceId,
        practitionerId,
      });

      toast.error("Fehler beim Löschen", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    }
  };

  const handleDialogClose = () => {
    setIsDialogOpen(false);
    setEditingPractitioner(undefined);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Ärzte verwalten
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
            Arzt hinzufügen
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {practitionersQuery ? (
          practitionersQuery.length === 0 ? (
            <div className="text-center py-8">
              <User className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <div className="text-muted-foreground mb-4">
                Noch keine Ärzte angelegt.
              </div>
              <Button
                onClick={() => {
                  setIsDialogOpen(true);
                }}
                variant="outline"
              >
                <Plus className="h-4 w-4 mr-2" />
                Ersten Arzt hinzufügen
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {practitionersQuery.map((practitioner) => (
                <div
                  className="p-4 border rounded-lg hover:bg-accent transition-colors"
                  key={practitioner._id}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="font-medium">{practitioner.name}</div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => {
                          handleEdit(practitioner);
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        onClick={() => {
                          void handleDelete(practitioner._id);
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            Lade Ärzte...
          </div>
        )}
      </CardContent>

      <PractitionerDialog
        isOpen={isDialogOpen}
        onClose={handleDialogClose}
        practiceId={practiceId}
        practitioner={editingPractitioner}
        ruleSetId={ruleSetId}
        {...(onRegisterHistoryAction && { onRegisterHistoryAction })}
        {...(onRuleSetCreated && { onRuleSetCreated })}
      />
    </Card>
  );
}

function PractitionerDialog({
  isOpen,
  onClose,
  onRegisterHistoryAction,
  onRuleSetCreated,
  practiceId,
  practitioner,
  ruleSetId,
}: PractitionerDialogProps) {
  const { captureError } = useErrorTracking();

  const practitionersQuery = useQuery(api.entities.getPractitioners, {
    ruleSetId,
  });
  const practitionersRef = useRef<Doc<"practitioners">[]>(
    practitionersQuery ?? [],
  );
  useEffect(() => {
    practitionersRef.current = practitionersQuery ?? [];
  }, [practitionersQuery]);

  const createMutation = useMutation(api.entities.createPractitioner);
  const deleteMutation = useMutation(api.entities.deletePractitioner);
  const updateMutation = useMutation(api.entities.updatePractitioner);

  const form = useForm({
    defaultValues: {
      name: practitioner?.name ?? "",
    },
    onSubmit: async ({ value }) => {
      try {
        const trimmedName = value.name.trim();

        if (practitioner) {
          const beforeName = practitioner.name;
          // Update existing practitioner - extract ruleSetId
          const { ruleSetId: newRuleSetId } = await updateMutation({
            name: trimmedName,
            practiceId,
            practitionerId: practitioner._id,
            sourceRuleSetId: ruleSetId,
          });

          onRegisterHistoryAction?.({
            label: "Arzt aktualisiert",
            redo: async () => {
              const current = practitionersRef.current.find(
                (entry) => entry._id === practitioner._id,
              );
              if (current?.name !== beforeName) {
                return {
                  message:
                    "Der Arzt wurde zwischenzeitlich geändert und kann nicht erneut aktualisiert werden.",
                  status: "conflict" as const,
                };
              }

              await updateMutation({
                name: trimmedName,
                practiceId,
                practitionerId: practitioner._id,
                sourceRuleSetId: newRuleSetId,
              });
              return { status: "applied" as const };
            },
            undo: async () => {
              const current = practitionersRef.current.find(
                (entry) => entry._id === practitioner._id,
              );
              if (current?.name !== trimmedName) {
                return {
                  message:
                    "Der Arzt wurde zwischenzeitlich geändert und kann nicht zurückgesetzt werden.",
                  status: "conflict" as const,
                };
              }

              await updateMutation({
                name: beforeName,
                practiceId,
                practitionerId: practitioner._id,
                sourceRuleSetId: newRuleSetId,
              });
              return { status: "applied" as const };
            },
          });

          toast.success("Arzt aktualisiert");

          // Notify parent if rule set changed (new unsaved rule set was created)
          if (onRuleSetCreated && newRuleSetId !== ruleSetId) {
            onRuleSetCreated(newRuleSetId);
          }
        } else {
          // Create new practitioner - extract both entityId and ruleSetId
          const { entityId, ruleSetId: newRuleSetId } = await createMutation({
            name: trimmedName,
            practiceId,
            sourceRuleSetId: ruleSetId,
          });

          let currentPractitionerId = entityId as Id<"practitioners">;
          onRegisterHistoryAction?.({
            label: "Arzt erstellt",
            redo: async () => {
              const duplicate = practitionersRef.current.find(
                (entry) => entry.name === trimmedName,
              );
              if (duplicate) {
                return {
                  message:
                    "Der Arzt existiert bereits und kann nicht erneut erstellt werden.",
                  status: "conflict" as const,
                };
              }

              const recreateResult = await createMutation({
                name: trimmedName,
                practiceId,
                sourceRuleSetId: newRuleSetId,
              });
              currentPractitionerId =
                recreateResult.entityId as Id<"practitioners">;
              return { status: "applied" as const };
            },
            undo: async () => {
              const existing = practitionersRef.current.find(
                (entry) => entry._id === currentPractitionerId,
              );
              if (!existing) {
                return {
                  message: "Der Arzt wurde bereits gelöscht.",
                  status: "conflict" as const,
                };
              }

              await deleteMutation({
                practiceId,
                practitionerId: currentPractitionerId,
                sourceRuleSetId: newRuleSetId,
              });
              return { status: "applied" as const };
            },
          });
          toast.success("Arzt erstellt");

          // Notify parent if rule set changed (new unsaved rule set was created)
          if (onRuleSetCreated && newRuleSetId !== ruleSetId) {
            onRuleSetCreated(newRuleSetId);
          }
        }

        onClose();
        form.reset();
      } catch (error: unknown) {
        captureError(error, {
          context: "practitioner_save",
          formData: value,
          isUpdate: !!practitioner,
          practiceId,
          practitionerId: practitioner?._id,
        });

        toast.error("Fehler beim Speichern", {
          description:
            error instanceof Error ? error.message : "Unbekannter Fehler",
        });
      }
    },
  });

  return (
    <Dialog onOpenChange={onClose} open={isOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {practitioner ? "Arzt bearbeiten" : "Neuen Arzt hinzufügen"}
          </DialogTitle>
          <DialogDescription>
            {practitioner
              ? "Bearbeiten Sie die Daten des Arztes."
              : "Fügen Sie einen neuen Arzt zu Ihrer Praxis hinzu."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field
            name="name"
            validators={{
              onChange: ({ value }) =>
                value.trim() ? undefined : "Name ist erforderlich",
            }}
          >
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  onBlur={field.handleBlur}
                  onChange={(e) => {
                    field.handleChange(e.target.value);
                  }}
                  placeholder="Dr. Max Mustermann"
                  required
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

          <div className="flex justify-end space-x-2 pt-4">
            <Button onClick={onClose} type="button" variant="outline">
              Abbrechen
            </Button>
            <Button type="submit">
              {practitioner ? "Speichern" : "Erstellen"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
