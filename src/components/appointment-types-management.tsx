import { useMutation, useQuery } from "convex/react";
import { CheckIcon, Package2 } from "lucide-react";
import { useState } from "react";

import type { Id } from "@/convex/_generated/dataModel";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "@/convex/_generated/api";

import { CsvImport } from "./csv-import";
import {
  Tags,
  TagsContent,
  TagsEmpty,
  TagsGroup,
  TagsInput,
  TagsItem,
  TagsList,
  TagsTrigger,
  TagsValue,
} from "./ui/kibo-ui/tags/index";

interface AppointmentTypesManagementProps {
  practiceId: Id<"practices">;
}

interface PractitionerTagsProps {
  appointmentTypeId: Id<"appointmentTypes">;
  currentPractitionerIds: Id<"practitioners">[];
  duration: number;
  practitionersQuery: undefined | { _id: Id<"practitioners">; name: string }[];
}

export function AppointmentTypesManagement({
  practiceId,
}: AppointmentTypesManagementProps) {
  const appointmentTypesQuery = useQuery(
    api.appointmentTypes.getAppointmentTypes,
    {
      practiceId,
    },
  );
  const practitionersQuery = useQuery(api.practitioners.getPractitioners, {
    practiceId,
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Package2 className="h-5 w-5" />
            <div>
              <CardTitle>Terminarten</CardTitle>
              <CardDescription>
                Verwalten Sie Terminarten und deren Dauern für verschiedene
                Ärzte und Standorte
              </CardDescription>
            </div>
          </div>
          <CsvImport practiceId={practiceId} />
        </div>
      </CardHeader>
      <CardContent>
        {appointmentTypesQuery === undefined ? (
          <div className="text-center py-4 text-muted-foreground">
            Lade Terminarten...
          </div>
        ) : appointmentTypesQuery.length === 0 ? (
          <div className="text-center py-8">
            <Package2 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <div className="text-muted-foreground">
              Noch keine Terminarten vorhanden
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              Nutzen Sie den CSV-Import, um Terminarten zu importieren
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              {appointmentTypesQuery.length} Terminarten verfügbar
            </div>

            <div className="grid gap-3">
              {appointmentTypesQuery.map((appointmentType) => (
                <div
                  className="border rounded-lg p-3"
                  key={appointmentType._id}
                >
                  <div className="font-medium mb-2">{appointmentType.name}</div>

                  {appointmentType.durations &&
                  Object.keys(appointmentType.durations).length > 0 ? (
                    <div className="space-y-3">
                      {Object.entries(appointmentType.durations)
                        .toSorted(
                          ([a], [b]) => Number.parseInt(a) - Number.parseInt(b),
                        ) // Sort by duration
                        .map(([durationStr, practitionerIds]) => (
                          <div className="space-y-2" key={durationStr}>
                            <div className="text-sm font-medium text-muted-foreground">
                              {durationStr} Minuten
                            </div>
                            <PractitionerTags
                              appointmentTypeId={appointmentType._id}
                              currentPractitionerIds={practitionerIds}
                              duration={Number.parseInt(durationStr)}
                              practitionersQuery={practitionersQuery}
                            />
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      Keine Dauern definiert
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PractitionerTags({
  appointmentTypeId,
  currentPractitionerIds,
  duration,
  practitionersQuery,
}: PractitionerTagsProps) {
  const [selectedPractitioners, setSelectedPractitioners] = useState<
    Id<"practitioners">[]
  >(currentPractitionerIds);

  const updateAppointmentTypeMutation = useMutation(
    api.appointmentTypes.updateAppointmentType,
  );

  const allPractitioners = practitionersQuery ?? [];

  const updateDurations = async (newSelectedIds: Id<"practitioners">[]) => {
    await updateAppointmentTypeMutation({
      appointmentTypeId,
      durations: newSelectedIds.map((id) => ({
        duration,
        practitionerId: id,
      })),
    });
  };

  const handleRemove = (practitionerId: Id<"practitioners">) => {
    if (!selectedPractitioners.includes(practitionerId)) {
      return;
    }

    const newSelected = selectedPractitioners.filter(
      (id) => id !== practitionerId,
    );
    setSelectedPractitioners(newSelected);
    void updateDurations(newSelected);
  };

  const handleSelect = (practitionerId: Id<"practitioners">) => {
    if (selectedPractitioners.includes(practitionerId)) {
      handleRemove(practitionerId);
      return;
    }

    const newSelected = [...selectedPractitioners, practitionerId];
    setSelectedPractitioners(newSelected);
    void updateDurations(newSelected);
  };

  return (
    <Tags className="max-w-[400px]">
      <TagsTrigger>
        {selectedPractitioners.map((practitionerId) => {
          const practitioner = allPractitioners.find(
            (p) => p._id === practitionerId,
          );
          const practitionerName = practitioner?.name ?? "Unbekannt";

          return (
            <TagsValue
              key={practitionerId}
              onRemove={() => {
                handleRemove(practitionerId);
              }}
            >
              {practitionerName}
            </TagsValue>
          );
        })}
      </TagsTrigger>
      <TagsContent>
        <TagsInput placeholder="Arzt suchen..." />
        <TagsList>
          <TagsEmpty>Keine Ärzte gefunden.</TagsEmpty>
          <TagsGroup>
            {allPractitioners.map((practitioner) => (
              <TagsItem
                key={practitioner._id}
                onSelect={() => {
                  handleSelect(practitioner._id);
                }}
                value={practitioner._id}
              >
                {practitioner.name}
                {selectedPractitioners.includes(practitioner._id) && (
                  <CheckIcon className="text-muted-foreground" size={14} />
                )}
              </TagsItem>
            ))}
          </TagsGroup>
        </TagsList>
      </TagsContent>
    </Tags>
  );
}
