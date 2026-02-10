// Patient status selection step component

import { useMutation } from "convex/react";
import { UserCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "@/convex/_generated/api";

import type { StepComponentProps } from "./types";

export function PatientStatusStep({ sessionId }: StepComponentProps) {
  const selectNewPatient = useMutation(api.bookingSessions.selectNewPatient);
  const selectExistingPatient = useMutation(
    api.bookingSessions.selectExistingPatient,
  );

  const handleNewPatient = async () => {
    try {
      await selectNewPatient({ sessionId });
    } catch (error) {
      console.error("Failed to select new patient:", error);
      toast.error("Auswahl fehlgeschlagen", {
        description:
          error instanceof Error
            ? error.message
            : "Bitte versuchen Sie es erneut.",
      });
    }
  };

  const handleExistingPatient = async () => {
    try {
      await selectExistingPatient({ sessionId });
    } catch (error) {
      console.error("Failed to select existing patient:", error);
      toast.error("Auswahl fehlgeschlagen", {
        description:
          error instanceof Error
            ? error.message
            : "Bitte versuchen Sie es erneut.",
      });
    }
  };

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Sind Sie bereits Patient bei uns?</CardTitle>
        <CardDescription>
          Bitte wählen Sie aus, ob Sie bereits Patient in unserer Praxis sind.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          <Button
            className="h-auto p-6 flex-col gap-3"
            onClick={() => void handleNewPatient()}
            variant="outline"
          >
            <UserPlus className="h-8 w-8" />
            <div className="text-center">
              <div className="font-medium">Ich bin neu</div>
              <div className="text-xs text-muted-foreground mt-1">
                Ich war noch nie in dieser Praxis
              </div>
            </div>
          </Button>

          <Button
            className="h-auto p-6 flex-col gap-3"
            onClick={() => void handleExistingPatient()}
            variant="outline"
          >
            <UserCheck className="h-8 w-8" />
            <div className="text-center">
              <div className="font-medium">Ich bin bereits Patient</div>
              <div className="text-xs text-muted-foreground mt-1">
                Ich war schon einmal hier
              </div>
            </div>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
