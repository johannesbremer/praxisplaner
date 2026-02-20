import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import { Edit2, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

import type { LocalHistoryAction } from "../hooks/use-local-history";

import { useErrorTracking } from "../utils/error-tracking";

interface LocationsManagementProps {
  onRegisterHistoryAction?: (action: LocalHistoryAction) => void;
  onRuleSetCreated?: (ruleSetId: Id<"ruleSets">) => void;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
}

export function LocationsManagement({
  onRegisterHistoryAction,
  onRuleSetCreated,
  practiceId,
  ruleSetId,
}: LocationsManagementProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<null | {
    _id: Id<"locations">;
    name: string;
  }>(null);

  const { captureError } = useErrorTracking();
  const locationsQuery = useQuery(api.entities.getLocations, { ruleSetId });
  const createLocationMutation = useMutation(api.entities.createLocation);
  const updateLocationMutation = useMutation(api.entities.updateLocation);
  const deleteLocationMutation = useMutation(api.entities.deleteLocation);
  const locationsRef = useRef(locationsQuery ?? []);
  useEffect(() => {
    locationsRef.current = locationsQuery ?? [];
  }, [locationsQuery]);

  const form = useForm({
    defaultValues: {
      name: "",
    },
    onSubmit: async ({ value }) => {
      try {
        const trimmedName = value.name.trim();

        if (editingLocation) {
          const previousName = editingLocation.name;

          await updateLocationMutation({
            locationId: editingLocation._id,
            name: trimmedName,
            practiceId,
            sourceRuleSetId: ruleSetId,
          });

          onRegisterHistoryAction?.({
            label: "Standort aktualisiert",
            redo: async () => {
              const current = locationsRef.current.find(
                (location) => location._id === editingLocation._id,
              );
              if (current?.name !== previousName) {
                return {
                  message:
                    "Der Standort wurde zwischenzeitlich geändert und kann nicht erneut aktualisiert werden.",
                  status: "conflict" as const,
                };
              }

              await updateLocationMutation({
                locationId: editingLocation._id,
                name: trimmedName,
                practiceId,
                sourceRuleSetId: ruleSetId,
              });
              return { status: "applied" as const };
            },
            undo: async () => {
              const current = locationsRef.current.find(
                (location) => location._id === editingLocation._id,
              );
              if (current?.name !== trimmedName) {
                return {
                  message:
                    "Der Standort wurde zwischenzeitlich geändert und kann nicht zurückgesetzt werden.",
                  status: "conflict" as const,
                };
              }

              await updateLocationMutation({
                locationId: editingLocation._id,
                name: previousName,
                practiceId,
                sourceRuleSetId: ruleSetId,
              });
              return { status: "applied" as const };
            },
          });

          toast.success("Standort aktualisiert", {
            description: `Standort "${value.name}" wurde erfolgreich aktualisiert.`,
          });
          setEditingLocation(null);
        } else {
          const { entityId, ruleSetId: newRuleSetId } =
            await createLocationMutation({
              name: trimmedName,
              practiceId,
              sourceRuleSetId: ruleSetId,
            });

          let currentLocationId = entityId as Id<"locations">;
          onRegisterHistoryAction?.({
            label: "Standort erstellt",
            redo: async () => {
              const duplicate = locationsRef.current.find(
                (location) => location.name === trimmedName,
              );
              if (duplicate) {
                return {
                  message:
                    "Der Standort existiert bereits und kann nicht erneut erstellt werden.",
                  status: "conflict" as const,
                };
              }

              const recreateResult = await createLocationMutation({
                name: trimmedName,
                practiceId,
                sourceRuleSetId: newRuleSetId,
              });
              currentLocationId = recreateResult.entityId as Id<"locations">;
              return { status: "applied" as const };
            },
            undo: async () => {
              const current = locationsRef.current.find(
                (location) => location._id === currentLocationId,
              );
              if (!current) {
                return {
                  message: "Der Standort wurde bereits gelöscht.",
                  status: "conflict" as const,
                };
              }

              await deleteLocationMutation({
                locationId: currentLocationId,
                practiceId,
                sourceRuleSetId: newRuleSetId,
              });
              return { status: "applied" as const };
            },
          });

          toast.success("Standort erstellt", {
            description: `Standort "${value.name}" wurde erfolgreich erstellt.`,
          });
          setIsCreateDialogOpen(false);

          // Notify parent if rule set changed (new unsaved rule set was created)
          if (onRuleSetCreated && newRuleSetId !== ruleSetId) {
            onRuleSetCreated(newRuleSetId);
          }
        }

        form.reset();
      } catch (error: unknown) {
        const action = editingLocation ? "Aktualisieren" : "Erstellen";
        captureError(error, {
          context: `LocationsManagement - ${action} location`,
          editingLocation: Boolean(editingLocation),
          locationName: value.name,
          practiceId,
        });
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
      const deletedSnapshot = locationsRef.current.find(
        (location) => location._id === locationId,
      );

      const { ruleSetId: newRuleSetId } = await deleteLocationMutation({
        locationId,
        practiceId,
        sourceRuleSetId: ruleSetId,
      });

      if (deletedSnapshot) {
        let currentLocationId = locationId;
        onRegisterHistoryAction?.({
          label: "Standort gelöscht",
          redo: async () => {
            const current = locationsRef.current.find(
              (location) => location._id === currentLocationId,
            );
            if (!current) {
              return {
                message: "Der Standort ist bereits gelöscht.",
                status: "conflict" as const,
              };
            }

            await deleteLocationMutation({
              locationId: currentLocationId,
              practiceId,
              sourceRuleSetId: newRuleSetId,
            });
            return { status: "applied" as const };
          },
          undo: async () => {
            const duplicate = locationsRef.current.find(
              (location) => location.name === deletedSnapshot.name,
            );
            if (duplicate) {
              return {
                message:
                  "Der Standort kann nicht wiederhergestellt werden, weil bereits ein Standort mit diesem Namen existiert.",
                status: "conflict" as const,
              };
            }

            const recreateResult = await createLocationMutation({
              name: deletedSnapshot.name,
              practiceId,
              sourceRuleSetId: newRuleSetId,
            });
            currentLocationId = recreateResult.entityId as Id<"locations">;
            return { status: "applied" as const };
          },
        });
      }

      toast.success("Standort gelöscht", {
        description: `Standort "${name}" wurde erfolgreich gelöscht.`,
      });

      // Notify parent if rule set changed (new unsaved rule set was created)
      if (onRuleSetCreated && newRuleSetId !== ruleSetId) {
        onRuleSetCreated(newRuleSetId);
      }
    } catch (error: unknown) {
      captureError(error, {
        context: "LocationsManagement - Delete location",
        locationId,
        locationName: name,
        practiceId,
      });
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
