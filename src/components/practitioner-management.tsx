// src/components/practitioner-management.tsx
import { useMutation, useQuery } from "convex/react";
import { Edit, Plus, Trash2, User } from "lucide-react";
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
import { api } from "@/convex/_generated/api";

interface PractitionerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  practiceId: Id<"practices">;
  practitioner?:
    | undefined
    | {
        _id: Id<"practitioners">;
        name: string;
        tags?: string[];
      };
}

interface PractitionerFormData {
  name: string;
  tags: string[];
}

interface PractitionerManagementProps {
  practiceId: Id<"practices">;
}

export default function PractitionerManagement({
  practiceId,
}: PractitionerManagementProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPractitioner, setEditingPractitioner] = useState<
    | undefined
    | {
        _id: Id<"practitioners">;
        name: string;
        tags?: string[];
      }
  >();

  const practitionersQuery = useQuery(api.practitioners.getPractitioners, {
    practiceId,
  });
  const deleteMutation = useMutation(api.practitioners.deletePractitioner);

  const handleEdit = (practitioner: {
    _id: Id<"practitioners">;
    name: string;
    tags?: string[];
  }) => {
    setEditingPractitioner(practitioner);
    setIsDialogOpen(true);
  };

  const handleDelete = async (practitionerId: Id<"practitioners">) => {
    if (!confirm("Sind Sie sicher, dass Sie diesen Arzt löschen möchten?")) {
      return;
    }

    try {
      await deleteMutation({ practitionerId });
      toast.success("Arzt gelöscht");
    } catch (error) {
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
            <CardDescription>
              Verwalten Sie die Ärzte in Ihrer Praxis. Diese können in Regeln
              referenziert werden.
            </CardDescription>
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
                      {practitioner.tags && practitioner.tags.length > 0 && (
                        <div className="flex gap-1 mt-2">
                          {practitioner.tags.map((tag) => (
                            <Badge
                              className="text-xs"
                              key={tag}
                              variant="secondary"
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
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
      />
    </Card>
  );
}

function PractitionerDialog({
  isOpen,
  onClose,
  practiceId,
  practitioner,
}: PractitionerDialogProps) {
  const [formData, setFormData] = useState<PractitionerFormData>({
    name: practitioner?.name ?? "",
    tags: practitioner?.tags ?? [],
  });
  const [isSaving, setIsSaving] = useState(false);

  const createMutation = useMutation(api.practitioners.createPractitioner);
  const updateMutation = useMutation(api.practitioners.updatePractitioner);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast.error("Name ist erforderlich");
      return;
    }

    try {
      setIsSaving(true);

      if (practitioner) {
        // Update existing practitioner
        await updateMutation({
          practitionerId: practitioner._id,
          updates: {
            name: formData.name,
            tags: formData.tags.length > 0 ? formData.tags : undefined,
          },
        });
        toast.success("Arzt aktualisiert");
      } else {
        // Create new practitioner
        const createData = {
          name: formData.name,
          practiceId,
          ...(formData.tags.length > 0 && { tags: formData.tags }),
        };
        await createMutation(createData);
        toast.success("Arzt erstellt");
      }

      onClose();
      setFormData({ name: "", tags: [] });
    } catch (error) {
      toast.error("Fehler beim Speichern", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    } finally {
      setIsSaving(false);
    }
  };

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
            void handleSubmit(e);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              onChange={(e) => {
                setFormData({ ...formData, name: e.target.value });
              }}
              placeholder="Dr. Max Mustermann"
              required
              value={formData.name}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">Tags (kommagetrennt)</Label>
            <Input
              id="tags"
              onChange={(e) => {
                setFormData({
                  ...formData,
                  tags: e.target.value
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                });
              }}
              placeholder="z.B. Spezialist, Senior, Chirurg"
              value={formData.tags.join(", ")}
            />
            <div className="text-sm text-muted-foreground">
              Tags helfen bei der Kategorisierung und können in Regeln verwendet
              werden.
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button
              disabled={isSaving}
              onClick={onClose}
              type="button"
              variant="outline"
            >
              Abbrechen
            </Button>
            <Button disabled={isSaving} type="submit">
              {isSaving
                ? "Speichere..."
                : practitioner
                  ? "Speichern"
                  : "Erstellen"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
