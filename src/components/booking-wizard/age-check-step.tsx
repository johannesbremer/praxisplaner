// Age check step component (New patient path A1)

import { useMutation } from "convex/react";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";

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

  useEffect(() => {
    let isMounted = true;

    const continueWithoutAgeQuestion = async () => {
      try {
        await confirmAgeCheck({ isOver40: false, sessionId });
      } catch (error) {
        if (!isMounted) {
          return;
        }
        console.error("Failed to confirm age check:", error);
        toast.error("Weiterleitung fehlgeschlagen", {
          description:
            error instanceof Error
              ? error.message
              : "Bitte versuchen Sie es erneut.",
        });
      }
    };

    void continueWithoutAgeQuestion();
    return () => {
      isMounted = false;
    };
  }, [confirmAgeCheck, sessionId]);

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Bitte warten...</CardTitle>
        <CardDescription>
          Wir leiten Sie automatisch zum nächsten Schritt weiter.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Weiterleitung läuft</span>
        </div>
      </CardContent>
    </Card>
  );
}
