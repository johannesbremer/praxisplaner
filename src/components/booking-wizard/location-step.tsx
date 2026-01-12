// Location selection step component

import { useMutation, useQuery } from "convex/react";
import { MapPin } from "lucide-react";
import { toast } from "sonner";

import type { Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";

import type { StepComponentProps } from "./types";

export function LocationStep({ ruleSetId, sessionId }: StepComponentProps) {
  const locations = useQuery(api.entities.getLocations, { ruleSetId });
  const selectLocation = useMutation(api.bookingSessions.selectLocation);

  const handleSelectLocation = async (locationId: Id<"locations">) => {
    try {
      await selectLocation({ locationId, sessionId });
    } catch (error) {
      console.error("Failed to select location:", error);
      toast.error("Standort konnte nicht ausgewählt werden", {
        description:
          error instanceof Error
            ? error.message
            : "Bitte versuchen Sie es erneut.",
      });
    }
  };

  if (!locations) {
    return (
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Wo möchten Sie behandelt werden?</CardTitle>
        <CardDescription>
          Bitte wählen Sie den Standort für Ihren Termin.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3">
          {locations.map((location) => (
            <Button
              className="h-auto p-4 justify-start"
              key={location._id}
              onClick={() => void handleSelectLocation(location._id)}
              variant="outline"
            >
              <MapPin className="h-5 w-5 mr-3 shrink-0" />
              <span className="text-left font-medium">{location.name}</span>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
