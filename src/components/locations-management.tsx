import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import { Edit2, Plus, Trash2 } from "lucide-react";
import { err, ok, Result } from "neverthrow";
import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  asLocationId,
  asLocationLineageKey,
  asPractitionerId,
} from "@/convex/identity";
import { LOCATION_MISSING_ENTITY_REGEX } from "@/lib/typed-regex";

import type {
  DraftMutationResult,
  RuleSetReplayTarget,
} from "../utils/cow-history";
import type { FrontendLineageEntity } from "../utils/frontend-lineage";
import type { RecordRuleSetCommand } from "../utils/rule-set-replay";

import {
  ruleSetIdFromReplayTarget,
  useRuleSetReplayTargetController,
} from "../utils/cow-history";
import { isMissingRuleSetEntityError } from "../utils/error-matching";
import { useErrorTracking } from "../utils/error-tracking";
import {
  captureFrontendError,
  invalidStateError,
} from "../utils/frontend-errors";
import {
  findFrontendEntityByEntityId,
  findFrontendEntityByLineageKey,
  requireFrontendLineageEntities,
} from "../utils/frontend-lineage";
import {
  createLocationDependencyDeleteReplayAdapter,
  recordLocationDependencyDeleteReplayCommand,
} from "../utils/location-dependency-delete-replay";
import {
  createNamedLineageCreateReplayAdapter,
  createNamedLineageUpdateReplayAdapter,
  recordNamedLineageReplayCommand,
} from "../utils/rule-set-named-lineage-replay";
import {
  createRuleSetNamedLineageCommand,
  createRuleSetSnapshotCommand,
} from "../utils/rule-set-replay";
import { encodeRuleSetSnapshot } from "../utils/rule-set-snapshot-codecs";

const isMissingEntityError = (error: unknown) =>
  isMissingRuleSetEntityError(error, LOCATION_MISSING_ENTITY_REGEX);

type BaseScheduleRow = FrontendLineageEntity<
  "baseSchedules",
  BaseSchedulesQueryResult[number]
>;

type BaseSchedulesQueryResult =
  (typeof api.entities.getBaseSchedules)["_returnType"];
type LocationRow = FrontendLineageEntity<
  "locations",
  LocationsQueryResult[number]
>;
interface LocationsManagementProps {
  onDraftMutation?: (result: DraftMutationResult) => void;
  onRecordCommand?: RecordRuleSetCommand;
  onRuleSetCreated?: (ruleSetId: Id<"ruleSets">) => void;
  practiceId: Id<"practices">;
  ruleSetReplayTarget: RuleSetReplayTarget;
}
type LocationsQueryResult = (typeof api.entities.getLocations)["_returnType"];
type PractitionerRow = FrontendLineageEntity<
  "practitioners",
  PractitionersQueryResult[number]
>;
type PractitionersQueryResult =
  (typeof api.entities.getPractitioners)["_returnType"];

export function LocationsManagement({
  onDraftMutation,
  onRecordCommand,
  onRuleSetCreated,
  practiceId,
  ruleSetReplayTarget,
}: LocationsManagementProps) {
  const ruleSetId = ruleSetIdFromReplayTarget(ruleSetReplayTarget);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<LocationRow | null>(
    null,
  );

  const { captureError } = useErrorTracking();
  const locationsQuery = useQuery(api.entities.getLocations, { ruleSetId });
  const practitionersQuery = useQuery(api.entities.getPractitioners, {
    ruleSetId,
  });
  const baseSchedulesQuery = useQuery(api.entities.getBaseSchedules, {
    ruleSetId,
  });
  const locations: LocationRow[] = useMemo(() => {
    if (!locationsQuery) {
      return [];
    }

    return requireFrontendLineageEntities<
      "locations",
      LocationsQueryResult[number]
    >({
      entities: locationsQuery,
      entityType: "location",
      source: "LocationsManagement",
    });
  }, [locationsQuery]);
  const practitioners: PractitionerRow[] = useMemo(() => {
    if (!practitionersQuery) {
      return [];
    }

    return requireFrontendLineageEntities<
      "practitioners",
      PractitionersQueryResult[number]
    >({
      entities: practitionersQuery,
      entityType: "practitioner",
      source: "LocationsManagement",
    });
  }, [practitionersQuery]);
  const baseSchedules: BaseScheduleRow[] = useMemo(() => {
    if (!baseSchedulesQuery) {
      return [];
    }

    return requireFrontendLineageEntities<
      "baseSchedules",
      BaseSchedulesQueryResult[number]
    >({
      entities: baseSchedulesQuery,
      entityType: "base schedule",
      source: "LocationsManagement",
    });
  }, [baseSchedulesQuery]);
  const createLocationMutation = useMutation(api.entities.createLocation);
  const updateLocationMutation = useMutation(api.entities.updateLocation);
  const deleteLocationMutation = useMutation(api.entities.deleteLocation);
  const createBaseScheduleBatchMutation = useMutation(
    api.entities.createBaseScheduleBatch,
  );
  const locationsRef = useRef(locations);
  useEffect(() => {
    locationsRef.current = locations;
  }, [locations]);
  const practitionersRef = useRef(practitioners);
  useEffect(() => {
    practitionersRef.current = practitioners;
  }, [practitioners]);
  const baseSchedulesRef = useRef(baseSchedules);
  useEffect(() => {
    baseSchedulesRef.current = baseSchedules;
  }, [baseSchedules]);
  const { getCowMutationArgs, handleDraftMutationResult } =
    useRuleSetReplayTargetController({
      ...(onDraftMutation && { onDraftMutation }),
      ...(onRuleSetCreated && { onRuleSetCreated }),
      ruleSetId,
      ruleSetReplayTarget,
    });

  const form = useForm({
    defaultValues: {
      name: "",
    },
    onSubmit: async ({ value }) => {
      try {
        const trimmedName = value.name.trim();

        if (editingLocation) {
          const previousName = editingLocation.name;

          const updateResult = await updateLocationMutation({
            locationId: editingLocation._id,
            name: trimmedName,
            practiceId,
            ...getCowMutationArgs(),
          });
          handleDraftMutationResult(updateResult);
          const command = createRuleSetNamedLineageCommand({
            kind: "location.update",
            label: "Standort aktualisiert",
            payload: {
              after: { name: trimmedName },
              before: { name: previousName },
              kind: "location.update",
              lineageKey: editingLocation.lineageKey,
            },
            snapshots: {
              after: encodeRuleSetSnapshot({
                lineageKey: editingLocation.lineageKey,
                name: trimmedName,
              }),
              before: encodeRuleSetSnapshot({
                lineageKey: editingLocation.lineageKey,
                name: previousName,
              }),
            },
            target: {
              entityId: updateResult.entityId,
              lineageKey: editingLocation.lineageKey,
            },
          });
          const replay = createNamedLineageUpdateReplayAdapter({
            command,
            entitiesRef: locationsRef,
            initialEntityId: asLocationId(updateResult.entityId),
            lineageKey: editingLocation.lineageKey,
            payload: {
              after: { name: trimmedName },
              before: { name: previousName },
              kind: "location.update",
              lineageKey: editingLocation.lineageKey,
            },
            redoMissingMessage:
              "Der Standort wurde bereits gelöscht und kann nicht erneut aktualisiert werden.",
            runRedo: async (currentLocationId) => {
              const redoResult = await updateLocationMutation({
                locationId: currentLocationId,
                name: trimmedName,
                practiceId,
                ...getCowMutationArgs(),
              });
              handleDraftMutationResult(redoResult);
              return { entityId: asLocationId(redoResult.entityId) };
            },
            runUndo: async (currentLocationId) => {
              const undoResult = await updateLocationMutation({
                locationId: currentLocationId,
                name: previousName,
                practiceId,
                ...getCowMutationArgs(),
              });
              handleDraftMutationResult(undoResult);
              return { entityId: asLocationId(undoResult.entityId) };
            },
            undoMissingMessage:
              "Der Standort wurde bereits gelöscht und kann nicht zurückgesetzt werden.",
          });
          recordNamedLineageReplayCommand(onRecordCommand, command, replay);

          toast.success("Standort aktualisiert", {
            description: `Standort "${value.name}" wurde erfolgreich aktualisiert.`,
          });
          setEditingLocation(null);
        } else {
          const createResult = await createLocationMutation({
            name: trimmedName,
            practiceId,
            ...getCowMutationArgs(),
          });
          handleDraftMutationResult(createResult);
          const entityId = asLocationId(createResult.entityId);
          const locationLineageKey = asLocationLineageKey(
            createResult.entityId,
          );
          const command = createRuleSetNamedLineageCommand({
            kind: "location.create",
            label: "Standort erstellt",
            payload: {
              kind: "location.create",
              lineageKey: locationLineageKey,
              name: trimmedName,
            },
            snapshots: {
              after: encodeRuleSetSnapshot({
                lineageKey: locationLineageKey,
                name: trimmedName,
              }),
            },
            target: {
              entityId,
              lineageKey: locationLineageKey,
            },
          });
          const replay = createNamedLineageCreateReplayAdapter({
            command,
            entitiesRef: locationsRef,
            initialEntityId: entityId,
            isMissingEntityError,
            lineageKey: locationLineageKey,
            payload: {
              kind: "location.create",
              lineageKey: locationLineageKey,
              name: trimmedName,
            },
            runCreate: async () => {
              const recreateResult = await createLocationMutation({
                lineageKey: locationLineageKey,
                name: trimmedName,
                practiceId,
                ...getCowMutationArgs(),
              });
              handleDraftMutationResult(recreateResult);
              return { entityId: asLocationId(recreateResult.entityId) };
            },
            runDelete: async (currentLocationId) => {
              const undoResult = await deleteLocationMutation({
                locationId: currentLocationId,
                locationLineageKey,
                practiceId,
                ...getCowMutationArgs(),
              });
              handleDraftMutationResult(undoResult);
              return { entityId: asLocationId(undoResult.entityId) };
            },
          });
          recordNamedLineageReplayCommand(onRecordCommand, command, replay);

          toast.success("Standort erstellt", {
            description: `Standort "${value.name}" wurde erfolgreich erstellt.`,
          });
          setIsCreateDialogOpen(false);
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

  const openEditDialog = (location: LocationRow) => {
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
      const deletedSnapshot = findFrontendEntityByEntityId(
        locationsRef.current,
        asLocationId(locationId),
      );
      const deletedScheduleSnapshotsResult = Result.combine(
        baseSchedulesRef.current
          .filter((schedule) => schedule.locationId === locationId)
          .map((schedule) => {
            const practitioner = findFrontendEntityByEntityId(
              practitionersRef.current,
              asPractitionerId(schedule.practitionerId),
            );
            if (!practitioner) {
              return err(
                invalidStateError(
                  `[HISTORY:LOCATION_DELETE_PRACTITIONER_MISSING] Behandler ${schedule.practitionerId} der Arbeitszeit ${schedule._id} konnte nicht geladen werden.`,
                  "handleDeleteLocation",
                ),
              );
            }
            return ok({
              ...(schedule.breakTimes && { breakTimes: schedule.breakTimes }),
              dayOfWeek: schedule.dayOfWeek,
              endTime: schedule.endTime,
              lineageKey: schedule.lineageKey,
              practitionerLineageKey: practitioner.lineageKey,
              startTime: schedule.startTime,
            });
          }),
      );
      const deletedScheduleSnapshots = deletedScheduleSnapshotsResult.match(
        (value) => value,
        (error) => {
          captureFrontendError(error, {
            context: "location_delete_practitioner_resolution",
            locationId,
            practiceId,
            ruleSetId,
          });
          toast.error("Standort konnte nicht gelöscht werden", {
            description: error.message,
          });
          return null;
        },
      );
      if (!deletedScheduleSnapshots) {
        return;
      }

      const deleteArgs: ReturnType<typeof getCowMutationArgs> & {
        locationId: Id<"locations">;
        locationLineageKey?: Id<"locations">;
        practiceId: Id<"practices">;
      } = {
        ...getCowMutationArgs(),
        locationId,
        practiceId,
      };
      if (deletedSnapshot?.lineageKey) {
        deleteArgs.locationLineageKey = deletedSnapshot.lineageKey;
      }

      const deleteResult = await deleteLocationMutation(deleteArgs);
      handleDraftMutationResult(deleteResult);

      if (deletedSnapshot) {
        const deletedLocationSnapshot = encodeRuleSetSnapshot({
          baseSchedules: deletedScheduleSnapshots,
          location: deletedSnapshot,
        });
        const command = createRuleSetSnapshotCommand({
          kind: "location.deleteWithDependencies",
          label: "Standort gelöscht",
          snapshots: {
            before: deletedLocationSnapshot,
          },
          target: {
            entityId: locationId,
            lineageKey: deletedSnapshot.lineageKey,
          },
        });
        const replay = createLocationDependencyDeleteReplayAdapter({
          createBaseSchedules: async (
            schedules: Parameters<
              typeof createBaseScheduleBatchMutation
            >[0]["schedules"],
          ) => {
            const scheduleResult = await createBaseScheduleBatchMutation({
              practiceId,
              schedules,
              ...getCowMutationArgs(),
            });
            handleDraftMutationResult(scheduleResult);
          },
          createLocation: async (snapshot) => {
            const recreateResult = await createLocationMutation({
              lineageKey: snapshot.lineageKey,
              name: snapshot.name,
              practiceId,
              ...getCowMutationArgs(),
            });
            handleDraftMutationResult(recreateResult);
            return asLocationId(recreateResult.entityId);
          },
          deleteLocation: async (args) => {
            const redoResult = await deleteLocationMutation({
              locationId: args.locationId,
              locationLineageKey: args.locationLineageKey,
              practiceId,
              ...getCowMutationArgs(),
            });
            handleDraftMutationResult(redoResult);
          },
          findLocationByLineage: (lineageKey) =>
            findFrontendEntityByLineageKey(locationsRef.current, lineageKey),
          findPractitionerByLineage: (lineageKey) =>
            findFrontendEntityByLineageKey(
              practitionersRef.current,
              lineageKey,
            ),
          hasBaseScheduleLineage: (lineageKey) =>
            baseSchedulesRef.current.some(
              (entry) => entry.lineageKey === lineageKey,
            ),
          hasLocationName: (locationName) =>
            locationsRef.current.some(
              (location) => location.name === locationName,
            ),
          initialEntityId: asLocationId(locationId),
          isMissingEntityError,
          snapshot: {
            baseSchedules: deletedScheduleSnapshots,
            location: deletedSnapshot,
          },
          toSchedulePayload: ({
            locationId: restoredLocationId,
            locationLineageKey,
            practitionerId,
            schedule,
          }) => ({
            ...(schedule.breakTimes && {
              breakTimes: schedule.breakTimes,
            }),
            dayOfWeek: schedule.dayOfWeek,
            endTime: schedule.endTime,
            lineageKey: schedule.lineageKey,
            locationId: restoredLocationId,
            locationLineageId: locationLineageKey,
            practitionerId,
            practitionerLineageId: schedule.practitionerLineageKey,
            startTime: schedule.startTime,
          }),
        });
        recordLocationDependencyDeleteReplayCommand(
          onRecordCommand,
          command,
          replay,
        );
      }

      toast.success("Standort gelöscht", {
        description: `Standort "${name}" wurde erfolgreich gelöscht.`,
      });
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
                          <p className="text-sm text-destructive">
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
        ) : locations.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="mb-2">Noch keine Standorte erstellt</p>
            <p className="text-sm">
              Fügen Sie Ihren ersten Standort hinzu, um die Terminplanung zu
              organisieren.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {locations.map((location) => (
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
            ))}
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
                        <p className="text-sm text-destructive">
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
