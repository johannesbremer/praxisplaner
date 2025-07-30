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
  const locationsQuery = useQuery(api.locations.getLocations, {
    practiceId,
  });

  // Generate consistent colors for locations
  const getLocationColor = (locationName: string) => {
    const colors = [
      { bg: 'bg-blue-50', text: 'text-blue-700' },
      { bg: 'bg-green-50', text: 'text-green-700' },
      { bg: 'bg-purple-50', text: 'text-purple-700' },
      { bg: 'bg-orange-50', text: 'text-orange-700' },
      { bg: 'bg-pink-50', text: 'text-pink-700' },
      { bg: 'bg-indigo-50', text: 'text-indigo-700' },
      { bg: 'bg-cyan-50', text: 'text-cyan-700' },
      { bg: 'bg-teal-50', text: 'text-teal-700' },
      { bg: 'bg-lime-50', text: 'text-lime-700' },
      { bg: 'bg-amber-50', text: 'text-amber-700' },
    ];
    
    // Use a simple hash function to consistently assign colors
    let hash = 0;
    for (let i = 0; i < locationName.length; i++) {
      hash = ((hash << 5) - hash + locationName.charCodeAt(i)) & 0xffffffff;
    }
    return colors[Math.abs(hash) % colors.length];
  };

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
                        .map(([durationStr, locationGroups]) => (
                          <div className="space-y-2" key={durationStr}>
                            <div className="text-sm font-medium text-muted-foreground">
                              {durationStr} Minuten
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {(() => {
                                // First, collect all practitioners for this duration
                                const practitionerLocationMap = new Map<
                                  string,
                                  string[]
                                >();

                                for (const [
                                  locationId,
                                  practitionerIds,
                                ] of Object.entries(locationGroups)) {
                                  const location = locationsQuery?.find(
                                    (l) => l._id === locationId,
                                  );
                                  const locationName =
                                    location?.name || "Unbekannt";

                                  for (const practitionerId of practitionerIds) {
                                    if (
                                      !practitionerLocationMap.has(
                                        practitionerId,
                                      )
                                    ) {
                                      practitionerLocationMap.set(
                                        practitionerId,
                                        [],
                                      );
                                    }
                                    const practitionerLocations =
                                      practitionerLocationMap.get(
                                        practitionerId,
                                      );
                                    if (practitionerLocations) {
                                      practitionerLocations.push(locationName);
                                    }
                                  }
                                }

                                // Get all available locations for comparison
                                const allLocationNames =
                                  locationsQuery?.map((l) => l.name).sort() ??
                                  [];

                                return [
                                  ...practitionerLocationMap.entries(),
                                ].map(([practitionerId, locationNames]) => {
                                  const practitioner = practitionersQuery?.find(
                                    (p) => p._id === practitionerId,
                                  );
                                  const practitionerName =
                                    practitioner?.name || "Unbekannt";

                                  // Sort location names for comparison
                                  const sortedLocationNames = [
                                    ...locationNames,
                                  ].sort();

                                  // Check if practitioner is available at all locations
                                  const isAvailableAtAllLocations =
                                    allLocationNames.length > 0 &&
                                    sortedLocationNames.length ===
                                      allLocationNames.length &&
                                    sortedLocationNames.every(
                                      (name, index) =>
                                        name === allLocationNames[index],
                                    );

                                  if (isAvailableAtAllLocations) {
                                    // Show single badge without location when available everywhere
                                    return (
                                      <span
                                        className="inline-flex items-center px-2 py-1 text-xs font-medium bg-gray-50 text-gray-700 border border-gray-700 rounded-full"
                                        key={practitionerId}
                                      >
                                        {practitionerName}
                                      </span>
                                    );
                                  } else {
                                    // Show separate colored badge for each location
                                    return locationNames.map((locationName) => {
                                      const colors = getLocationColor(locationName);
                                      if (!colors) return null;
                                      
                                      return (
                                        <span
                                          className={`inline-flex items-center px-2 py-1 text-xs font-medium ${colors.bg} ${colors.text} border ${colors.text.replace('text-', 'border-')} rounded-full`}
                                          key={`${practitionerId}-${locationName}`}
                                        >
                                          {practitionerName} in {locationName}
                                        </span>
                                      );
                                    }).filter(Boolean);
                                  }
                                }).flat();
                              })()}
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
