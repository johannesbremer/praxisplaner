import { useQuery } from "convex/react";
import { Package2 } from "lucide-react";

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

interface AppointmentTypesManagementProps {
  practiceId: Id<"practices">;
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
                        .sort(
                          ([a], [b]) => Number.parseInt(a) - Number.parseInt(b),
                        ) // Sort by duration
                        .map(([durationStr, practitionerIds]) => (
                          <div className="space-y-2" key={durationStr}>
                            <div className="text-sm font-medium text-muted-foreground">
                              {durationStr} Minuten
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {practitionerIds.map((practitionerId) => {
                                const practitioner = practitionersQuery?.find(
                                  (p) => p._id === practitionerId,
                                );
                                const practitionerName =
                                  practitioner?.name || "Unbekannt";

                                return (
                                  <span
                                    className="inline-flex items-center px-2 py-1 text-xs font-medium bg-gray-50 text-gray-700 border border-gray-700 rounded-full"
                                    key={practitionerId}
                                  >
                                    {practitionerName}
                                  </span>
                                );
                              })}
                            </div>
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
