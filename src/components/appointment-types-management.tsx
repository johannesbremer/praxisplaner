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
                Ärzte
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
                  appointmentType.durations.length > 0 ? (
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-muted-foreground">
                        Dauern je Arzt:
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {appointmentType.durations.map((duration) => {
                          const practitioner = practitionersQuery?.find(
                            (p) => p._id === duration.practitionerId,
                          );
                          return (
                            <div
                              className="text-xs bg-muted px-2 py-1 rounded"
                              key={duration.practitionerId}
                            >
                              {practitioner?.name || "Unbekannt"}:{" "}
                              {duration.duration}min
                            </div>
                          );
                        })}
                      </div>
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
