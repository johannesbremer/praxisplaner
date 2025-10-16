import { useQuery } from "convex/react";

import type { Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";

interface AppointmentTypeSelectorProps {
  onTypeSelect: (typeId: Id<"appointmentTypes">) => void;
  ruleSetId: Id<"ruleSets"> | undefined;
  selectedTypeId: Id<"appointmentTypes"> | undefined;
}

export function AppointmentTypeSelector({
  onTypeSelect,
  ruleSetId,
  selectedTypeId,
}: AppointmentTypeSelectorProps) {
  const appointmentTypes = useQuery(
    api.entities.getAppointmentTypes,
    ruleSetId ? { ruleSetId } : "skip",
  );

  if (!appointmentTypes) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Terminart wählen</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            Terminarten werden geladen...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (appointmentTypes.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Terminart wählen</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            Keine Terminarten verfügbar. Bitte konfigurieren Sie zuerst
            Terminarten im Regelwerk.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Terminart wählen</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-2">
          {appointmentTypes.map((type) => {
            const isSelected = selectedTypeId === type._id;
            return (
              <Button
                className="justify-start text-left h-auto p-3"
                disabled={isSelected}
                key={type._id}
                onClick={() => {
                  onTypeSelect(type._id);
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
                {type.name}
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
