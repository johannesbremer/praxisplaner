// PKV details step component (New patient path - optional PKV details after PVS consent)

import { useForm } from "@tanstack/react-form";
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
import {
  pkvDetailsFormSchema,
  type PkvDetailsFormValue,
} from "@/lib/booking-schemas";

import type { StepComponentProps } from "./types";

export function PkvDetailsStep({ sessionId, state }: StepComponentProps) {
  const confirmPkvDetails = useMutation(api.bookingSessions.confirmPkvDetails);
  const completedState =
    state.step === "new-pkv-details-complete" ? state : null;

  const form = useForm({
    defaultValues: {
      beihilfeStatus: completedState?.beihilfeStatus ?? "",
      pkvInsuranceType: completedState?.pkvInsuranceType ?? "",
      pkvTariff: completedState?.pkvTariff ?? "",
    } satisfies PkvDetailsFormValue,
    onSubmit: async ({ value }) => {
      try {
        const parsed = pkvDetailsFormSchema.parse(value);
        const payload = {
          pvsConsent: true as const, // Already consented in previous step
          sessionId,
          ...(parsed.beihilfeStatus === undefined
            ? {}
            : { beihilfeStatus: parsed.beihilfeStatus }),
          ...(parsed.pkvInsuranceType === undefined
            ? {}
            : { pkvInsuranceType: parsed.pkvInsuranceType }),
          ...(parsed.pkvTariff === undefined
            ? {}
            : { pkvTariff: parsed.pkvTariff }),
        };
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
      onSubmit: pkvDetailsFormSchema,
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
                      if (value === "" || value === "no" || value === "yes") {
                        field.handleChange(value);
                      }
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
                      if (
                        value === "" ||
                        value === "kvb" ||
                        value === "other" ||
                        value === "postb"
                      ) {
                        field.handleChange(value);
                      }
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
                      if (
                        value === "" ||
                        value === "basis" ||
                        value === "premium" ||
                        value === "standard"
                      ) {
                        field.handleChange(value);
                      }
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
