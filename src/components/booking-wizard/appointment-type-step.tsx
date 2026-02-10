// Appointment type selection step component (Path A5 for new patients, Path B2 for existing patients)

import { useMutation, useQuery } from "convex/react";
import { Calendar } from "lucide-react";
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

export function AppointmentTypeStep({
  ruleSetId,
  sessionId,
  state,
}: StepComponentProps) {
  const appointmentTypes = useQuery(api.entities.getAppointmentTypes, {
    ruleSetId,
  });

  const selectNewPatientAppointmentType = useMutation(
    api.bookingSessions.selectNewPatientAppointmentType,
  );
  const selectExistingPatientAppointmentType = useMutation(
    api.bookingSessions.selectExistingPatientAppointmentType,
  );

  const handleSelectAppointmentType = async (
    appointmentTypeId: Id<"appointmentTypes">,
  ) => {
    try {
      if (state.step === "new-appointment-type") {
        await selectNewPatientAppointmentType({ appointmentTypeId, sessionId });
      } else if (state.step === "existing-appointment-type") {
        await selectExistingPatientAppointmentType({
          appointmentTypeId,
          sessionId,
        });
      }
    } catch (error) {
      console.error("Failed to select appointment type:", error);
      toast.error("Terminart konnte nicht ausgewählt werden", {
        description:
          error instanceof Error
            ? error.message
            : "Bitte versuchen Sie es erneut.",
      });
    }
  };

  if (!appointmentTypes) {
    return (
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  // All appointment types are available for now (allowOnlineBooking filter can be added later if needed)
  const availableTypes = appointmentTypes;

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Was ist der Anlass Ihres Besuchs?</CardTitle>
        <CardDescription>
          Bitte wählen Sie den Grund für Ihren Termin. Dies hilft uns, die
          richtige Zeit für Sie einzuplanen.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {availableTypes.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            Aktuell sind keine Online-Termine verfügbar. Bitte rufen Sie uns an,
            um einen Termin zu vereinbaren.
          </p>
        ) : (
          <div className="grid gap-3">
            {availableTypes.map((type) => (
              <Button
                className="h-auto p-4 justify-start text-left"
                key={type._id}
                onClick={() => void handleSelectAppointmentType(type._id)}
                variant="outline"
              >
                <Calendar className="h-5 w-5 mr-3 shrink-0" />
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{type.name}</span>
                  <span className="text-xs text-muted-foreground">
                    ca. {type.duration} Minuten
                  </span>
                </div>
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
