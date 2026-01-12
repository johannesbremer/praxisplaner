// Data input step component (Path A6 for new patients, Path B3 for existing patients)

import { useForm } from "@tanstack/react-form";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { z } from "zod";

import { PhoneInput } from "@/components/phone-input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";

import type { StepComponentProps } from "./types";

// Schema for personal data validation
const personalDataSchema = z.object({
  city: z.string(),
  dateOfBirth: z.string().min(1, "Geburtsdatum ist erforderlich"),
  email: z.string(),
  firstName: z.string().min(1, "Vorname ist erforderlich"),
  gender: z
    .enum(["male", "female", "diverse", ""])
    .transform((v) => v || undefined),
  lastName: z.string().min(1, "Nachname ist erforderlich"),
  phoneNumber: z.e164("Bitte gültige Telefonnummer im Format +49... eingeben"),
  postalCode: z.string(),
  street: z.string(),
  title: z.string(),
});

// Medical history schema (new patients only)
const medicalHistorySchema = z.object({
  allergiesDescription: z.string(),
  currentMedications: z.string(),
  hasAllergies: z.boolean(),
  hasDiabetes: z.boolean(),
  hasHeartCondition: z.boolean(),
  hasLungCondition: z.boolean(),
  otherConditions: z.string(),
});

// Combined form schema that works for both paths
const formSchema = z.object({
  medicalHistory: medicalHistorySchema,
  personalData: personalDataSchema,
  reasonDescription: z.string().min(1, "Bitte geben Sie einen Grund an"),
});

export function DataInputStep({ sessionId, state }: StepComponentProps) {
  const isNewPatient = state.step === "new-data-input";

  const submitNewPatientData = useMutation(
    api.bookingSessions.submitNewPatientData,
  );
  const submitExistingPatientData = useMutation(
    api.bookingSessions.submitExistingPatientData,
  );

  const form = useForm({
    defaultValues: {
      medicalHistory: {
        allergiesDescription: "",
        currentMedications: "",
        hasAllergies: false,
        hasDiabetes: false,
        hasHeartCondition: false,
        hasLungCondition: false,
        otherConditions: "",
      },
      personalData: {
        city: "",
        dateOfBirth: "",
        email: "",
        firstName: "",
        gender: "" as "" | "diverse" | "female" | "male",
        lastName: "",
        phoneNumber: "",
        postalCode: "",
        street: "",
        title: "",
      },
      reasonDescription: "",
    },
    onSubmit: async ({ value }) => {
      // Build personal data, only including optional fields if they have values
      const personalData = {
        dateOfBirth: value.personalData.dateOfBirth,
        firstName: value.personalData.firstName,
        lastName: value.personalData.lastName,
        phoneNumber: value.personalData.phoneNumber,
        ...(value.personalData.city && { city: value.personalData.city }),
        ...(value.personalData.email && { email: value.personalData.email }),
        ...(value.personalData.gender && { gender: value.personalData.gender }),
        ...(value.personalData.postalCode && {
          postalCode: value.personalData.postalCode,
        }),
        ...(value.personalData.street && { street: value.personalData.street }),
        ...(value.personalData.title && { title: value.personalData.title }),
      };

      if (isNewPatient) {
        // Check if medical history has any filled values
        const hasMedicalHistory =
          value.medicalHistory.hasAllergies ||
          value.medicalHistory.hasDiabetes ||
          value.medicalHistory.hasHeartCondition ||
          value.medicalHistory.hasLungCondition ||
          value.medicalHistory.allergiesDescription ||
          value.medicalHistory.currentMedications ||
          value.medicalHistory.otherConditions;

        // Build medical history only including optional strings if they have values
        const medicalHistory = hasMedicalHistory
          ? {
              hasAllergies: value.medicalHistory.hasAllergies,
              hasDiabetes: value.medicalHistory.hasDiabetes,
              hasHeartCondition: value.medicalHistory.hasHeartCondition,
              hasLungCondition: value.medicalHistory.hasLungCondition,
              ...(value.medicalHistory.allergiesDescription && {
                allergiesDescription: value.medicalHistory.allergiesDescription,
              }),
              ...(value.medicalHistory.currentMedications && {
                currentMedications: value.medicalHistory.currentMedications,
              }),
              ...(value.medicalHistory.otherConditions && {
                otherConditions: value.medicalHistory.otherConditions,
              }),
            }
          : undefined;

        try {
          await submitNewPatientData({
            personalData,
            reasonDescription: value.reasonDescription,
            sessionId,
            ...(medicalHistory && { medicalHistory }),
          });
        } catch (error) {
          console.error("Failed to submit new patient data:", error);
          toast.error("Daten konnten nicht gespeichert werden", {
            description:
              error instanceof Error
                ? error.message
                : "Bitte versuchen Sie es erneut.",
          });
        }
      } else {
        try {
          await submitExistingPatientData({
            personalData,
            reasonDescription: value.reasonDescription,
            sessionId,
          });
        } catch (error) {
          console.error("Failed to submit existing patient data:", error);
          toast.error("Daten konnten nicht gespeichert werden", {
            description:
              error instanceof Error
                ? error.message
                : "Bitte versuchen Sie es erneut.",
          });
        }
      }
    },
    validators: {
      onSubmit: formSchema,
    },
  });

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Ihre Daten</CardTitle>
        <CardDescription>
          Bitte füllen Sie Ihre persönlichen Daten aus. Alle mit *
          gekennzeichneten Felder sind Pflichtfelder.
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
            {/* Personal Information Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Persönliche Daten</h3>

              <form.Field name="personalData.title">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>
                      Titel (optional)
                    </FieldLabel>
                    <Input
                      autoComplete="honorific-prefix"
                      id={field.name}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={(e) => {
                        field.handleChange(e.target.value);
                      }}
                      placeholder="Dr., Prof., etc."
                      value={field.state.value}
                    />
                  </Field>
                )}
              </form.Field>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <form.Field name="personalData.lastName">
                  {(field) => {
                    const isInvalid =
                      field.state.meta.isTouched && !field.state.meta.isValid;
                    return (
                      <Field data-invalid={isInvalid}>
                        <FieldLabel htmlFor={field.name}>Nachname *</FieldLabel>
                        <Input
                          aria-invalid={isInvalid}
                          autoComplete="family-name"
                          id={field.name}
                          name={field.name}
                          onBlur={field.handleBlur}
                          onChange={(e) => {
                            field.handleChange(e.target.value);
                          }}
                          placeholder="Mustermann"
                          value={field.state.value}
                        />
                        {isInvalid && (
                          <FieldError errors={field.state.meta.errors} />
                        )}
                      </Field>
                    );
                  }}
                </form.Field>

                <form.Field name="personalData.firstName">
                  {(field) => {
                    const isInvalid =
                      field.state.meta.isTouched && !field.state.meta.isValid;
                    return (
                      <Field data-invalid={isInvalid}>
                        <FieldLabel htmlFor={field.name}>Vorname *</FieldLabel>
                        <Input
                          aria-invalid={isInvalid}
                          autoComplete="given-name"
                          id={field.name}
                          name={field.name}
                          onBlur={field.handleBlur}
                          onChange={(e) => {
                            field.handleChange(e.target.value);
                          }}
                          placeholder="Max"
                          value={field.state.value}
                        />
                        {isInvalid && (
                          <FieldError errors={field.state.meta.errors} />
                        )}
                      </Field>
                    );
                  }}
                </form.Field>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <form.Field name="personalData.dateOfBirth">
                  {(field) => {
                    const isInvalid =
                      field.state.meta.isTouched && !field.state.meta.isValid;
                    return (
                      <Field data-invalid={isInvalid}>
                        <FieldLabel htmlFor={field.name}>
                          Geburtsdatum *
                        </FieldLabel>
                        <Input
                          aria-invalid={isInvalid}
                          autoComplete="bday"
                          id={field.name}
                          name={field.name}
                          onBlur={field.handleBlur}
                          onChange={(e) => {
                            field.handleChange(e.target.value);
                          }}
                          type="date"
                          value={field.state.value}
                        />
                        {isInvalid && (
                          <FieldError errors={field.state.meta.errors} />
                        )}
                      </Field>
                    );
                  }}
                </form.Field>

                <form.Field name="personalData.gender">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor={field.name}>
                        Geschlecht (optional)
                      </FieldLabel>
                      <Select
                        onValueChange={(value) => {
                          field.handleChange(
                            value as "" | "diverse" | "female" | "male",
                          );
                        }}
                        value={field.state.value}
                      >
                        <SelectTrigger id={field.name}>
                          <SelectValue placeholder="Bitte wählen" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="male">Männlich</SelectItem>
                          <SelectItem value="female">Weiblich</SelectItem>
                          <SelectItem value="diverse">Divers</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                </form.Field>
              </div>

              <form.Field name="personalData.phoneNumber">
                {(field) => {
                  const isInvalid =
                    field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor={field.name}>
                        Telefonnummer *
                      </FieldLabel>
                      <PhoneInput
                        aria-invalid={isInvalid}
                        id={field.name}
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={(value) => {
                          field.handleChange(value);
                        }}
                        value={field.state.value}
                      />
                      <FieldDescription>
                        Für Terminbestätigungen und Rückfragen
                      </FieldDescription>
                      {isInvalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  );
                }}
              </form.Field>

              <form.Field name="personalData.email">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>
                      E-Mail (optional)
                    </FieldLabel>
                    <Input
                      autoComplete="email"
                      id={field.name}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={(e) => {
                        field.handleChange(e.target.value);
                      }}
                      placeholder="max@beispiel.de"
                      type="email"
                      value={field.state.value}
                    />
                    <FieldDescription>
                      Für Terminbestätigungen per E-Mail
                    </FieldDescription>
                  </Field>
                )}
              </form.Field>

              {/* Address fields */}
              <form.Field name="personalData.street">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>
                      Straße (optional)
                    </FieldLabel>
                    <Input
                      autoComplete="street-address"
                      id={field.name}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={(e) => {
                        field.handleChange(e.target.value);
                      }}
                      placeholder="Musterstraße 1"
                      value={field.state.value}
                    />
                  </Field>
                )}
              </form.Field>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <form.Field name="personalData.postalCode">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor={field.name}>
                        PLZ (optional)
                      </FieldLabel>
                      <Input
                        autoComplete="postal-code"
                        id={field.name}
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={(e) => {
                          field.handleChange(e.target.value);
                        }}
                        placeholder="12345"
                        value={field.state.value}
                      />
                    </Field>
                  )}
                </form.Field>

                <form.Field name="personalData.city">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor={field.name}>
                        Ort (optional)
                      </FieldLabel>
                      <Input
                        autoComplete="address-level2"
                        id={field.name}
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={(e) => {
                          field.handleChange(e.target.value);
                        }}
                        placeholder="Musterstadt"
                        value={field.state.value}
                      />
                    </Field>
                  )}
                </form.Field>
              </div>
            </div>

            {/* Reason for visit */}
            <div className="space-y-4 pt-4 border-t">
              <h3 className="text-lg font-medium">Termingrund</h3>

              <form.Field name="reasonDescription">
                {(field) => {
                  const isInvalid =
                    field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor={field.name}>
                        Beschreibung Ihres Anliegens *
                      </FieldLabel>
                      <Input
                        aria-invalid={isInvalid}
                        id={field.name}
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={(e) => {
                          field.handleChange(e.target.value);
                        }}
                        placeholder="z.B. Erkältungssymptome seit 3 Tagen"
                        value={field.state.value}
                      />
                      <FieldDescription>
                        Diese Information hilft uns, uns auf Ihren Termin
                        vorzubereiten.
                      </FieldDescription>
                      {isInvalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  );
                }}
              </form.Field>
            </div>

            {/* Medical History Section (new patients only) */}
            {isNewPatient && (
              <div className="space-y-4 pt-4 border-t">
                <h3 className="text-lg font-medium">
                  Gesundheitsinformationen (optional)
                </h3>
                <p className="text-sm text-muted-foreground">
                  Diese Informationen helfen uns, Sie besser zu versorgen.
                </p>

                <div className="space-y-3">
                  <form.Field name="medicalHistory.hasHeartCondition">
                    {(field) => (
                      <Field orientation="horizontal">
                        <Checkbox
                          checked={field.state.value}
                          id={field.name}
                          name={field.name}
                          onCheckedChange={(checked) => {
                            field.handleChange(checked === true);
                          }}
                        />
                        <FieldLabel
                          className="font-normal"
                          htmlFor={field.name}
                        >
                          Herzerkrankung
                        </FieldLabel>
                      </Field>
                    )}
                  </form.Field>

                  <form.Field name="medicalHistory.hasDiabetes">
                    {(field) => (
                      <Field orientation="horizontal">
                        <Checkbox
                          checked={field.state.value}
                          id={field.name}
                          name={field.name}
                          onCheckedChange={(checked) => {
                            field.handleChange(checked === true);
                          }}
                        />
                        <FieldLabel
                          className="font-normal"
                          htmlFor={field.name}
                        >
                          Diabetes
                        </FieldLabel>
                      </Field>
                    )}
                  </form.Field>

                  <form.Field name="medicalHistory.hasLungCondition">
                    {(field) => (
                      <Field orientation="horizontal">
                        <Checkbox
                          checked={field.state.value}
                          id={field.name}
                          name={field.name}
                          onCheckedChange={(checked) => {
                            field.handleChange(checked === true);
                          }}
                        />
                        <FieldLabel
                          className="font-normal"
                          htmlFor={field.name}
                        >
                          Lungenerkrankung
                        </FieldLabel>
                      </Field>
                    )}
                  </form.Field>

                  <form.Field name="medicalHistory.hasAllergies">
                    {(field) => (
                      <Field orientation="horizontal">
                        <Checkbox
                          checked={field.state.value}
                          id={field.name}
                          name={field.name}
                          onCheckedChange={(checked) => {
                            field.handleChange(checked === true);
                          }}
                        />
                        <FieldLabel
                          className="font-normal"
                          htmlFor={field.name}
                        >
                          Allergien
                        </FieldLabel>
                      </Field>
                    )}
                  </form.Field>
                </div>

                <form.Subscribe selector={(s) => s.values.medicalHistory}>
                  {(medicalHistory) =>
                    medicalHistory.hasAllergies && (
                      <form.Field name="medicalHistory.allergiesDescription">
                        {(field) => (
                          <Field>
                            <FieldLabel htmlFor={field.name}>
                              Allergien beschreiben
                            </FieldLabel>
                            <Input
                              id={field.name}
                              name={field.name}
                              onBlur={field.handleBlur}
                              onChange={(e) => {
                                field.handleChange(e.target.value);
                              }}
                              placeholder="z.B. Penicillin, Nüsse"
                              value={field.state.value}
                            />
                          </Field>
                        )}
                      </form.Field>
                    )
                  }
                </form.Subscribe>

                <form.Field name="medicalHistory.currentMedications">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor={field.name}>
                        Aktuelle Medikamente (optional)
                      </FieldLabel>
                      <Input
                        id={field.name}
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={(e) => {
                          field.handleChange(e.target.value);
                        }}
                        placeholder="z.B. Ibuprofen 400mg"
                        value={field.state.value}
                      />
                    </Field>
                  )}
                </form.Field>

                <form.Field name="medicalHistory.otherConditions">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor={field.name}>
                        Sonstige Erkrankungen (optional)
                      </FieldLabel>
                      <Input
                        id={field.name}
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={(e) => {
                          field.handleChange(e.target.value);
                        }}
                        placeholder="Weitere relevante Vorerkrankungen"
                        value={field.state.value}
                      />
                    </Field>
                  )}
                </form.Field>
              </div>
            )}

            {/* Submit Button */}
            <div className="pt-6">
              <form.Subscribe selector={(s) => s.isSubmitting}>
                {(isSubmitting) => (
                  <Button className="w-full" disabled={isSubmitting}>
                    {isSubmitting
                      ? "Wird verarbeitet..."
                      : "Weiter zur Terminauswahl"}
                  </Button>
                )}
              </form.Subscribe>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
