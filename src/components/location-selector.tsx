import type { Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";

interface Location {
  _id: Id<"locations">;
  name: string;
}

interface LocationSelectorProps {
  locations: Location[];
  onLocationSelect: (locationId: Id<"locations">) => void;
  selectedLocationId?: Id<"locations"> | undefined;
}

export function LocationSelector({
  locations,
  onLocationSelect,
  selectedLocationId,
}: LocationSelectorProps) {
  return (
    <div className="space-y-2 p-2">
      {locations.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground">
          <p>Keine Standorte verfügbar.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {locations.map((location) => {
            const isSelected = selectedLocationId === location._id;
            return (
              <Button
                className="justify-start text-left h-auto p-3"
                disabled={isSelected}
                key={location._id}
                onClick={() => {
                  onLocationSelect(location._id);
                }}
                size="sm"
                style={{
                  backgroundColor: isSelected ? "primary" : undefined,
                }}
                variant={isSelected ? "default" : "outline"}
              >
                {location.name}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}
