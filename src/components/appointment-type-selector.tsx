import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const appointmentTypes = [
  "Erstberatung",
  "Kontrolltermin",
  "Behandlung",
  "Nachsorge",
  "Notfall",
];

interface AppointmentTypeSelectorProps {
  onTypeSelect: (type: string) => void;
  selectedType: string;
}

export function AppointmentTypeSelector({
  onTypeSelect,
  selectedType,
}: AppointmentTypeSelectorProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Terminart wählen</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-2">
          {appointmentTypes.map((type) => {
            const isSelected = selectedType === type;
            return (
              <Button
                className="justify-start text-left h-auto p-3"
                disabled={isSelected}
                key={type}
                onClick={() => {
                  onTypeSelect(type);
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
                {type}
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
