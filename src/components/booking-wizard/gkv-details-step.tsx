// GKV details step component (New patient path A3a)

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

type HzvStatus = "has-contract" | "interested" | "no-interest";

const hzvOptions: { description: string; label: string; value: HzvStatus }[] = [
  {
    description: "Ich bin bereits im Hausarztvertrag eingeschrieben",
    label: "Ich habe bereits einen Hausarztvertrag",
    value: "has-contract",
  },
  {
    description: "Ich möchte mich gerne informieren und einschreiben",
    label: "Ich bin interessiert",
    value: "interested",
  },
  {
    description: "Ich möchte keinen Hausarztvertrag abschließen",
    label: "Kein Interesse",
    value: "no-interest",
  },
];

export function GkvDetailsStep({ sessionId, state }: StepComponentProps) {
  const confirmGkvDetails = useMutation(api.bookingSessions.confirmGkvDetails);

  const selectedHzvStatus =
    state.step === "new-gkv-details" && "hzvStatus" in state
      ? (state.hzvStatus as HzvStatus | undefined)
      : undefined;

  const handleHzvSelection = async (hzvStatus: HzvStatus) => {
    try {
      await confirmGkvDetails({ hzvStatus, sessionId });
    } catch (error) {
      console.error("Failed to confirm GKV details:", error);
      toast.error("GKV-Details konnten nicht gespeichert werden", {
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
        <CardTitle>Hausarztvertrag (HZV)</CardTitle>
        <CardDescription>
          Der Hausarztvertrag bietet Ihnen besondere Vorteile bei der
          hausärztlichen Versorgung. Bitte geben Sie Ihren Status an.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {hzvOptions.map((option) => (
            <Button
              className="h-auto p-4 justify-start w-full text-left"
              data-selected={selectedHzvStatus === option.value}
              key={option.value}
              onClick={() => void handleHzvSelection(option.value)}
              variant={
                selectedHzvStatus === option.value ? "default" : "outline"
              }
            >
              <div>
                <div className="font-medium">{option.label}</div>
                <div
                  className={`text-xs mt-1 ${
                    selectedHzvStatus === option.value
                      ? "text-primary-foreground/70"
                      : "text-muted-foreground"
                  }`}
                >
                  {option.description}
                </div>
              </div>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
