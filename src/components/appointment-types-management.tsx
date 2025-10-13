import { useQuery } from "convex/react";
import { Package2 } from "lucide-react";

import type { Id } from "@/convex/_generated/dataModel";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";

type AppointmentType = AppointmentTypesResult[number];

interface AppointmentTypesManagementProps {
  ruleSetId: Id<"ruleSets">;
}

type AppointmentTypesResult =
  (typeof api.entities.getAppointmentTypes)["_returnType"];

export function AppointmentTypesManagement({
  ruleSetId,
}: AppointmentTypesManagementProps) {
  const appointmentTypesQuery = useQuery(api.entities.getAppointmentTypes, {
    ruleSetId,
  });

  const appointmentTypes: AppointmentType[] = appointmentTypesQuery ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-2">
          <Package2 className="h-5 w-5" />
          <div>
            <CardTitle>Terminarten</CardTitle>
          </div>
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
              {appointmentTypes.map((appointmentType) => (
                <div
                  className="border rounded-lg p-3"
                  key={appointmentType._id}
                >
                  <div className="font-medium mb-2">{appointmentType.name}</div>
                  <div className="text-sm text-muted-foreground">
                    Dauer: {appointmentType.duration} Minuten
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
