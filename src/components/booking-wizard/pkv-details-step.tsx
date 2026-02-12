// PKV details step component (New patient path - optional PKV details after PVS consent)

import { useForm } from "@tanstack/react-form";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";

import type { StepComponentProps } from "./types";

const pkvFormSchema = z.object({
  beihilfeStatus: z.enum(["yes", "no", ""]).transform((v) => v || undefined),
  pkvInsuranceType: z
    .enum(["postb", "kvb", "other", ""])
    .transform((v) => v || undefined),
  pkvTariff: z
    .enum(["basis", "standard", "premium", ""])
    .transform((v) => v || undefined),
});

export function PkvDetailsStep({ sessionId, state }: StepComponentProps) {
  const confirmPkvDetails = useMutation(api.bookingSessions.confirmPkvDetails);

  const initialBeihilfeStatus =
    state.step === "new-pkv-details-complete"
      ? state.beihilfeStatus
      : undefined;
  const initialPkvInsuranceType =
    state.step === "new-pkv-details-complete"
      ? state.pkvInsuranceType
      : undefined;
  const initialPkvTariff =
    state.step === "new-pkv-details-complete" ? state.pkvTariff : undefined;

  const form = useForm({
    defaultValues: {
      beihilfeStatus: initialBeihilfeStatus ?? "",
      pkvInsuranceType: initialPkvInsuranceType ?? "",
      pkvTariff: initialPkvTariff ?? "",
    },
    onSubmit: async ({ value }) => {
      try {
        const payload: {
          beihilfeStatus?: "no" | "yes";
          pkvInsuranceType?: "kvb" | "other" | "postb";
          pkvTariff?: "basis" | "premium" | "standard";
          pvsConsent: true;
          sessionId: typeof sessionId;
        } = {
          pvsConsent: true, // Already consented in previous step
          sessionId,
        };

        if (value.beihilfeStatus === "no" || value.beihilfeStatus === "yes") {
          payload.beihilfeStatus = value.beihilfeStatus;
        }
        if (
          value.pkvInsuranceType === "kvb" ||
          value.pkvInsuranceType === "other" ||
          value.pkvInsuranceType === "postb"
        ) {
          payload.pkvInsuranceType = value.pkvInsuranceType;
        }
        if (
          value.pkvTariff === "basis" ||
          value.pkvTariff === "premium" ||
          value.pkvTariff === "standard"
        ) {
          payload.pkvTariff = value.pkvTariff;
        }

        await confirmPkvDetails(payload);
      } catch (error) {
        console.error("Failed to confirm PKV details:", error);
        toast.error("PKV-Details konnten nicht gespeichert werden", {
          description:
            error instanceof Error
              ? error.message
              : "Bitte versuchen Sie es erneut.",
        });
      }
    },
    validators: {
      onSubmit: pkvFormSchema,
    },
  });

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Angaben zur Privatversicherung</CardTitle>
        <CardDescription>
          Diese Angaben sind optional und helfen uns, Ihre
          Versicherungssituation besser zu verstehen.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.Field name="beihilfeStatus">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>
                    Beihilfeberechtigt?
                  </FieldLabel>
                  <Select
                    onValueChange={(value) => {
                      field.handleChange(value as "" | "no" | "yes");
                    }}
                    value={field.state.value}
                  >
                    <SelectTrigger id={field.name}>
                      <SelectValue placeholder="Bitte auswählen (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">
                        Ja, ich bin beihilfeberechtigt
                      </SelectItem>
                      <SelectItem value="no">
                        Nein, ich bin nicht beihilfeberechtigt
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    z.B. Beamte, Richter, Soldaten
                  </FieldDescription>
                </Field>
              )}
            </form.Field>

            <form.Field name="pkvInsuranceType">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>
                    Art der Versicherung
                  </FieldLabel>
                  <Select
                    onValueChange={(value) => {
                      field.handleChange(
                        value as "" | "kvb" | "other" | "postb",
                      );
                    }}
                    value={field.state.value}
                  >
                    <SelectTrigger id={field.name}>
                      <SelectValue placeholder="Bitte auswählen (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="postb">Postbeamtenkasse</SelectItem>
                      <SelectItem value="kvb">
                        Krankenversorgung der Bundesbahnbeamten
                      </SelectItem>
                      <SelectItem value="other">Andere</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </form.Field>

            <form.Field name="pkvTariff">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Tarif</FieldLabel>
                  <Select
                    onValueChange={(value) => {
                      field.handleChange(
                        value as "" | "basis" | "premium" | "standard",
                      );
                    }}
                    value={field.state.value}
                  >
                    <SelectTrigger id={field.name}>
                      <SelectValue placeholder="Bitte auswählen (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="basis">Basistarif</SelectItem>
                      <SelectItem value="standard">Standardtarif</SelectItem>
                      <SelectItem value="premium">Premiumtarif</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </form.Field>

            <div className="mt-6">
              <Button
                className="w-full h-auto whitespace-normal py-3"
                size="lg"
                type="submit"
              >
                Weiter
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
