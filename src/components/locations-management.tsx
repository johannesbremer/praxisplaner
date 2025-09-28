import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import { Edit2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";

interface LocationsManagementProps {
  onNeedRuleSet?:
    | (() => Promise<Id<"ruleSets"> | null | undefined>)
    | undefined;
  practiceId: Id<"practices">;
}

export function LocationsManagement({
  onNeedRuleSet,
  practiceId,
}: LocationsManagementProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<null | {
    _id: Id<"locations">;
    name: string;
  }>(null);

  const locationsQuery = useQuery(api.locations.getLocations, { practiceId });
  const createLocationMutation = useMutation(api.locations.createLocation);
  const updateLocationMutation = useMutation(api.locations.updateLocation);
  const deleteLocationMutation = useMutation(api.locations.deleteLocation);

  const form = useForm({
    defaultValues: {
      name: "",
    },
    onSubmit: async ({ value }) => {
      try {
        if (onNeedRuleSet) {
          await onNeedRuleSet();
        }

        if (editingLocation) {
          await updateLocationMutation({
            locationId: editingLocation._id,
            name: value.name.trim(),
          });
          toast.success("Standort aktualisiert", {
            description: `Standort "${value.name}" wurde erfolgreich aktualisiert.`,
          });
          setEditingLocation(null);
        } else {
          await createLocationMutation({
            name: value.name.trim(),
            practiceId,
          });
          toast.success("Standort erstellt", {
            description: `Standort "${value.name}" wurde erfolgreich erstellt.`,
          });
          setIsCreateDialogOpen(false);
        }

        form.reset();
      } catch (error) {
        const action = editingLocation ? "Aktualisieren" : "Erstellen";
        toast.error(`Fehler beim ${action}`, {
          description:
            error instanceof Error ? error.message : "Unbekannter Fehler",
        });
      }
    },
  });

  const openEditDialog = (location: { _id: Id<"locations">; name: string }) => {
    setEditingLocation(location);
    form.setFieldValue("name", location.name);
  };

  const closeDialogs = () => {
    setIsCreateDialogOpen(false);
    setEditingLocation(null);
    form.reset();
  };

  const handleDeleteLocation = async (
    locationId: Id<"locations">,
    name: string,
  ) => {
    try {
      // Ensure we have an unsaved rule set before making changes
      if (onNeedRuleSet) {
        await onNeedRuleSet();
      }

      await deleteLocationMutation({ locationId });
      toast.success("Standort gelöscht", {
        description: `Standort "${name}" wurde erfolgreich gelöscht.`,
      });
    } catch (error) {
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
          <div>
            <CardTitle>Standorte</CardTitle>
          </div>
          <Dialog
            onOpenChange={setIsCreateDialogOpen}
            open={isCreateDialogOpen}
          >
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                Standort hinzufügen
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Neuen Standort hinzufügen</DialogTitle>
                <DialogDescription>
                  Erstellen Sie einen neuen Standort für Ihre Praxis.
                </DialogDescription>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void form.handleSubmit();
                }}
              >
                <div className="space-y-4">
                  <form.Field
                    name="name"
                    validators={{
                      onChange: ({ value }) =>
                        value.trim()
                          ? undefined
                          : "Standortname ist erforderlich",
                    }}
                  >
                    {(field) => (
                      <div className="space-y-2">
                        <Label htmlFor="location-name">Standortname</Label>
                        <Input
                          id="location-name"
                          onBlur={field.handleBlur}
                          onChange={(e) => {
                            field.handleChange(e.target.value);
                          }}
                          placeholder="z.B. Hauptstandort, Zweigstelle Nord"
                          required
                          value={field.state.value}
                        />
                        {field.state.meta.errors.length > 0 && (
                          <p className="text-sm text-red-600">
                            {field.state.meta.errors[0]}
                          </p>
                        )}
                      </div>
                    )}
                  </form.Field>
                </div>
                <DialogFooter className="mt-6">
                  <Button
                    onClick={closeDialogs}
                    type="button"
                    variant="outline"
                  >
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
                        {isSubmitting ? "Erstelle..." : "Erstellen"}
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
        {locationsQuery === undefined ? (
          <div className="text-center py-4 text-muted-foreground">
            Lade Standorte...
          </div>
        ) : locationsQuery.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="mb-2">Noch keine Standorte erstellt</p>
            <p className="text-sm">
              Fügen Sie Ihren ersten Standort hinzu, um die Terminplanung zu
              organisieren.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {locationsQuery.map(
              (location: {
                _id: Id<"locations">;
                name: string;
                practiceId: Id<"practices">;
              }) => (
                <div
                  className="flex items-center justify-between p-3 border rounded-lg"
                  key={location._id}
                >
                  <div>
                    <div className="font-medium">{location.name}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => {
                        openEditDialog(location);
                      }}
                      size="sm"
                      variant="outline"
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      onClick={() => {
                        void handleDeleteLocation(location._id, location.name);
                      }}
                      size="sm"
                      variant="outline"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ),
            )}
          </div>
        )}

        {/* Edit Dialog */}
        <Dialog
          onOpenChange={(open) => {
            if (!open) {
              closeDialogs();
            }
          }}
          open={!!editingLocation}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Standort bearbeiten</DialogTitle>
              <DialogDescription>
                Bearbeiten Sie die Details des Standorts.
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void form.handleSubmit();
              }}
            >
              <div className="space-y-4">
                <form.Field
                  name="name"
                  validators={{
                    onChange: ({ value }) =>
                      value.trim()
                        ? undefined
                        : "Standortname ist erforderlich",
                  }}
                >
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor="edit-location-name">Standortname</Label>
                      <Input
                        id="edit-location-name"
                        onBlur={field.handleBlur}
                        onChange={(e) => {
                          field.handleChange(e.target.value);
                        }}
                        placeholder="z.B. Hauptstandort, Zweigstelle Nord"
                        required
                        value={field.state.value}
                      />
                      {field.state.meta.errors.length > 0 && (
                        <p className="text-sm text-red-600">
                          {field.state.meta.errors[0]}
                        </p>
                      )}
                    </div>
                  )}
                </form.Field>
              </div>
              <DialogFooter className="mt-6">
                <Button onClick={closeDialogs} type="button" variant="outline">
                  Abbrechen
                </Button>
                <form.Subscribe
                  selector={(state) => [state.canSubmit, state.isSubmitting]}
                >
                  {([canSubmit, isSubmitting]) => (
                    <Button disabled={!canSubmit || isSubmitting} type="submit">
                      {isSubmitting ? "Speichere..." : "Speichern"}
                    </Button>
                  )}
                </form.Subscribe>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
