// Insurance type selection step component (New patient path A2)

import { useMutation } from "convex/react";
import { Building2, Shield } from "lucide-react";
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

export function InsuranceTypeStep({ sessionId }: StepComponentProps) {
  const selectInsuranceType = useMutation(
    api.bookingSessions.selectInsuranceType,
  );

  const handleInsuranceSelection = async (insuranceType: "gkv" | "pkv") => {
    try {
      await selectInsuranceType({ insuranceType, sessionId });
    } catch (error) {
      console.error("Failed to select insurance type:", error);
      toast.error("Versicherungsart konnte nicht ausgewählt werden", {
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
        <CardTitle>Wie sind Sie versichert?</CardTitle>
        <CardDescription>
          Bitte wählen Sie Ihre Versicherungsart.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          <Button
            className="h-auto p-6 flex-col gap-3"
            onClick={() => void handleInsuranceSelection("gkv")}
            variant="outline"
          >
            <Building2 className="h-8 w-8" />
            <div className="text-center">
              <div className="font-medium">Gesetzlich versichert</div>
              <div className="text-xs text-muted-foreground mt-1">GKV</div>
            </div>
          </Button>

          <Button
            className="h-auto p-6 flex-col gap-3"
            onClick={() => void handleInsuranceSelection("pkv")}
            variant="outline"
          >
            <Shield className="h-8 w-8" />
            <div className="text-center">
              <div className="font-medium">Privat versichert</div>
              <div className="text-xs text-muted-foreground mt-1">PKV</div>
            </div>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
