// Doctor selection step component (Existing patient path B1)

import { useMutation, useQuery } from "convex/react";
import { User } from "lucide-react";
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

export function DoctorSelectionStep({
  ruleSetId,
  sessionId,
}: StepComponentProps) {
  const practitioners = useQuery(api.entities.getPractitioners, { ruleSetId });
  const selectDoctor = useMutation(api.bookingSessions.selectDoctor);

  const handleSelectDoctor = async (practitionerId: Id<"practitioners">) => {
    try {
      await selectDoctor({ practitionerId, sessionId });
    } catch (error) {
      console.error("Failed to select doctor:", error);
      toast.error("Ärztin konnte nicht ausgewählt werden", {
        description:
          error instanceof Error
            ? error.message
            : "Bitte versuchen Sie es erneut.",
      });
    }
  };

  if (!practitioners) {
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

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Wer ist zur Zeit Ihre Hausärztin?</CardTitle>
        <CardDescription>
          Bitte wählen Sie Ihre behandelnde Ärztin bzw. Ihren behandelnden Arzt.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3">
          {practitioners.map((practitioner) => (
            <Button
              className="h-auto p-4 justify-start"
              key={practitioner._id}
              onClick={() => void handleSelectDoctor(practitioner._id)}
              variant="outline"
            >
              <User className="h-5 w-5 mr-3 shrink-0" />
              <span className="text-left font-medium">{practitioner.name}</span>
            </Button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground mt-4 text-center">
          Hinweis: Nach der Arztauswahl können Sie nicht mehr zu diesem Schritt
          zurückkehren.
        </p>
      </CardContent>
    </Card>
  );
}
