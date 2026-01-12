// Age check step component (New patient path A1)

import { useMutation } from "convex/react";
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

export function AgeCheckStep({ sessionId }: StepComponentProps) {
  const confirmAgeCheck = useMutation(api.bookingSessions.confirmAgeCheck);

  const handleAgeSelection = async (isOver40: boolean) => {
    try {
      await confirmAgeCheck({ isOver40, sessionId });
    } catch (error) {
      console.error("Failed to confirm age check:", error);
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
        <CardTitle>Sind Sie 40 Jahre oder älter?</CardTitle>
        <CardDescription>
          Diese Information hilft uns, den passenden Termin für Sie zu finden.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          <Button
            className="h-auto p-6"
            onClick={() => void handleAgeSelection(false)}
            variant="outline"
          >
            <div className="text-center">
              <div className="font-medium">Unter 40 Jahre</div>
            </div>
          </Button>

          <Button
            className="h-auto p-6"
            onClick={() => void handleAgeSelection(true)}
            variant="outline"
          >
            <div className="text-center">
              <div className="font-medium">40 Jahre oder älter</div>
            </div>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
