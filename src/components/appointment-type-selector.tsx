import { useQuery } from "convex/react";

import type { Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";

interface AppointmentTypeSelectorProps {
  onTypeSelect: (type: string) => void;
  ruleSetId: Id<"ruleSets">;
  selectedType: string;
}

export function AppointmentTypeSelector({
  onTypeSelect,
  ruleSetId,
  selectedType,
}: AppointmentTypeSelectorProps) {
  const appointmentTypesQuery = useQuery(api.entities.getAppointmentTypes, {
    ruleSetId,
  });

  const appointmentTypes = appointmentTypesQuery ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Terminart wählen</CardTitle>
      </CardHeader>
      <CardContent>
        {appointmentTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Keine Terminarten verfügbar
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {appointmentTypes.map((appointmentType) => {
              const isSelected = selectedType === appointmentType.name;
              return (
                <Button
                  className="justify-start text-left h-auto p-3"
                  disabled={isSelected}
                  key={appointmentType._id}
                  onClick={() => {
                    onTypeSelect(appointmentType.name);
                  }}
                  size="sm"
                  style={
                    isSelected
                      ? {
                          backgroundColor: "primary",
                        }
                      : {}
                  }
                  variant={isSelected ? "default" : "outline"}
                >
                  {appointmentType.name}
                </Button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
