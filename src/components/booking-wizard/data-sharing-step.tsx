import { useMutation } from "convex/react";
import { Plus, Trash2 } from "lucide-react";
import { type SyntheticEvent, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import type { Doc } from "@/convex/_generated/dataModel";

import { PhoneInput } from "@/components/phone-input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

type ContactField = keyof DataSharingContact;
type ContactFormValue = Omit<DataSharingContact, "gender"> & {
  gender: "" | DataSharingContact["gender"];
};
type DataSharingContact =
  Doc<"bookingNewDataSharingSteps">["dataSharingContacts"][number];

function createEmptyContact(): ContactFormValue {
  return {
    city: "",
    dateOfBirth: "",
    email: "",
    firstName: "",
    gender: "",
    lastName: "",
    phoneNumber: "",
    postalCode: "",
    street: "",
    title: "",
  };
}

const dataSharingPersonSchema = z.object({
  city: z.string().trim().min(1, "Ort ist erforderlich"),
  dateOfBirth: z.string().min(1, "Geburtsdatum ist erforderlich"),
  email: z.string().trim().min(1, "E-Mail ist erforderlich"),
  firstName: z.string().trim().min(1, "Vorname ist erforderlich"),
  gender: z.enum(["male", "female", "diverse"], {
    error: "Geschlecht ist erforderlich",
  }),
  lastName: z.string().trim().min(1, "Nachname ist erforderlich"),
  phoneNumber: z.e164("Bitte gültige Telefonnummer im Format +49... eingeben"),
  postalCode: z.string().trim().min(1, "PLZ ist erforderlich"),
  street: z.string().trim().min(1, "Straße ist erforderlich"),
  title: z.string().trim().min(1, "Titel ist erforderlich"),
});

const dataSharingContactsSchema = z
  .array(dataSharingPersonSchema)
  .min(1, "Mindestens eine Person ist erforderlich");

export function DataSharingStep({ sessionId, state }: StepComponentProps) {
  const submitNewDataSharing = useMutation(
    api.bookingSessions.submitNewDataSharing,
  );
  const submitExistingDataSharing = useMutation(
    api.bookingSessions.submitExistingDataSharing,
  );

  const isNewPatient = state.step === "new-data-sharing";

  const initialContacts =
    "dataSharingContacts" in state ? state.dataSharingContacts : undefined;

  const [contacts, setContacts] = useState<ContactFormValue[]>(() =>
    initialContacts && initialContacts.length > 0
      ? initialContacts.map((contact) => ({
          city: contact.city,
          dateOfBirth: contact.dateOfBirth,
          email: contact.email,
          firstName: contact.firstName,
          gender: contact.gender,
          lastName: contact.lastName,
          phoneNumber: contact.phoneNumber,
          postalCode: contact.postalCode,
          street: contact.street,
          title: contact.title,
        }))
      : [createEmptyContact()],
  );

  const [errors, setErrors] = useState<
    Record<number, Partial<Record<ContactField, string>>>
  >({});
  const [formError, setFormError] = useState<null | string>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canRemove = contacts.length > 1;

  const updateContactField = (
    index: number,
    field: ContactField,
    value: string,
  ) => {
    setContacts((prev) =>
      prev.map((contact, contactIndex) =>
        contactIndex === index ? { ...contact, [field]: value } : contact,
      ),
    );

    setErrors((prev) => {
      if (!prev[index]?.[field]) {
        return prev;
      }
      const next = { ...prev };
      next[index] = { ...next[index], [field]: undefined };
      return next;
    });

    if (formError) {
      setFormError(null);
    }
  };

  const addContact = () => {
    setContacts((prev) => [...prev, createEmptyContact()]);
  };

  const removeContact = (index: number) => {
    if (!canRemove) {
      return;
    }

    setContacts((prev) =>
      prev.filter((_, contactIndex) => contactIndex !== index),
    );
    setErrors((prev) => {
      const next: Record<number, Partial<Record<ContactField, string>>> = {};
      for (const [key, value] of Object.entries(prev)) {
        const numericKey = Number(key);
        if (numericKey < index) {
          next[numericKey] = value;
        } else if (numericKey > index) {
          next[numericKey - 1] = value;
        }
      }
      return next;
    });
  };

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();

    const parsed = dataSharingContactsSchema.safeParse(contacts);
    if (!parsed.success) {
      const nextErrors: Record<
        number,
        Partial<Record<ContactField, string>>
      > = {};
      let nextFormError: null | string = null;

      for (const issue of parsed.error.issues) {
        const [index, field] = issue.path;
        if (typeof index === "number" && typeof field === "string") {
          const typedField = field as ContactField;
          const existing = nextErrors[index] ?? {};
          nextErrors[index] = { ...existing, [typedField]: issue.message };
        } else {
          nextFormError ||= issue.message;
        }
      }

      setErrors(nextErrors);
      setFormError(nextFormError);
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    setErrors({});

    try {
      const dataSharingContacts: DataSharingContact[] = parsed.data;
      if (isNewPatient) {
        await submitNewDataSharing({
          dataSharingContacts,
          sessionId,
        });
      } else {
        await submitExistingDataSharing({
          dataSharingContacts,
          sessionId,
        });
      }
    } catch (error) {
      console.error("Failed to submit data sharing contacts:", error);
      toast.error("Datenweitergabe konnte nicht gespeichert werden", {
        description:
          error instanceof Error
            ? error.message
            : "Bitte versuchen Sie es erneut.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Datenweitergabe</CardTitle>
        <CardDescription>
          An die folgenden Personen darf diese Praxis Ihre persönlichen und
          medizinischen Daten aushändigen. Wir empfehlen mindestens eine Person
          anzugeben, damit diese z.B. Ihr Rezept abholen kann, solange Sie
          krankheitsbedingt nicht persönlich die Praxis aufsuchen können.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-6"
          onSubmit={(event) => void handleSubmit(event)}
        >
          {contacts.map((contact, index) => (
            <div className="rounded-lg border p-4 space-y-4" key={index}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-medium">Person {index + 1}</h3>
                <Button
                  disabled={!canRemove}
                  onClick={() => {
                    removeContact(index);
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Entfernen
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label
                    className="text-sm font-medium"
                    htmlFor={`title-${index}`}
                  >
                    Titel *
                  </label>
                  <Input
                    id={`title-${index}`}
                    onChange={(event) => {
                      updateContactField(index, "title", event.target.value);
                    }}
                    placeholder="Dr., Prof., etc."
                    value={contact.title}
                  />
                  {errors[index]?.title && (
                    <p className="text-sm text-destructive">
                      {errors[index].title}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <label
                    className="text-sm font-medium"
                    htmlFor={`gender-${index}`}
                  >
                    Geschlecht *
                  </label>
                  <Select
                    onValueChange={(value) => {
                      updateContactField(index, "gender", value);
                    }}
                    value={contact.gender}
                  >
                    <SelectTrigger id={`gender-${index}`}>
                      <SelectValue placeholder="Bitte wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">Männlich</SelectItem>
                      <SelectItem value="female">Weiblich</SelectItem>
                      <SelectItem value="diverse">Divers</SelectItem>
                    </SelectContent>
                  </Select>
                  {errors[index]?.gender && (
                    <p className="text-sm text-destructive">
                      {errors[index].gender}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label
                    className="text-sm font-medium"
                    htmlFor={`lastName-${index}`}
                  >
                    Nachname *
                  </label>
                  <Input
                    id={`lastName-${index}`}
                    onChange={(event) => {
                      updateContactField(index, "lastName", event.target.value);
                    }}
                    placeholder="Mustermann"
                    value={contact.lastName}
                  />
                  {errors[index]?.lastName && (
                    <p className="text-sm text-destructive">
                      {errors[index].lastName}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <label
                    className="text-sm font-medium"
                    htmlFor={`firstName-${index}`}
                  >
                    Vorname *
                  </label>
                  <Input
                    id={`firstName-${index}`}
                    onChange={(event) => {
                      updateContactField(
                        index,
                        "firstName",
                        event.target.value,
                      );
                    }}
                    placeholder="Max"
                    value={contact.firstName}
                  />
                  {errors[index]?.firstName && (
                    <p className="text-sm text-destructive">
                      {errors[index].firstName}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label
                    className="text-sm font-medium"
                    htmlFor={`dateOfBirth-${index}`}
                  >
                    Geburtsdatum *
                  </label>
                  <Input
                    id={`dateOfBirth-${index}`}
                    onChange={(event) => {
                      updateContactField(
                        index,
                        "dateOfBirth",
                        event.target.value,
                      );
                    }}
                    type="date"
                    value={contact.dateOfBirth}
                  />
                  {errors[index]?.dateOfBirth && (
                    <p className="text-sm text-destructive">
                      {errors[index].dateOfBirth}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <label
                    className="text-sm font-medium"
                    htmlFor={`phoneNumber-${index}`}
                  >
                    Telefonnummer *
                  </label>
                  <PhoneInput
                    id={`phoneNumber-${index}`}
                    onChange={(value) => {
                      updateContactField(index, "phoneNumber", value);
                    }}
                    value={contact.phoneNumber}
                  />
                  {errors[index]?.phoneNumber && (
                    <p className="text-sm text-destructive">
                      {errors[index].phoneNumber}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <label
                  className="text-sm font-medium"
                  htmlFor={`email-${index}`}
                >
                  E-Mail *
                </label>
                <Input
                  id={`email-${index}`}
                  onChange={(event) => {
                    updateContactField(index, "email", event.target.value);
                  }}
                  placeholder="max@beispiel.de"
                  type="email"
                  value={contact.email}
                />
                {errors[index]?.email && (
                  <p className="text-sm text-destructive">
                    {errors[index].email}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label
                  className="text-sm font-medium"
                  htmlFor={`street-${index}`}
                >
                  Straße *
                </label>
                <Input
                  id={`street-${index}`}
                  onChange={(event) => {
                    updateContactField(index, "street", event.target.value);
                  }}
                  placeholder="Musterstraße 1"
                  value={contact.street}
                />
                {errors[index]?.street && (
                  <p className="text-sm text-destructive">
                    {errors[index].street}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label
                    className="text-sm font-medium"
                    htmlFor={`postalCode-${index}`}
                  >
                    PLZ *
                  </label>
                  <Input
                    id={`postalCode-${index}`}
                    onChange={(event) => {
                      updateContactField(
                        index,
                        "postalCode",
                        event.target.value,
                      );
                    }}
                    placeholder="12345"
                    value={contact.postalCode}
                  />
                  {errors[index]?.postalCode && (
                    <p className="text-sm text-destructive">
                      {errors[index].postalCode}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <label
                    className="text-sm font-medium"
                    htmlFor={`city-${index}`}
                  >
                    Ort *
                  </label>
                  <Input
                    id={`city-${index}`}
                    onChange={(event) => {
                      updateContactField(index, "city", event.target.value);
                    }}
                    placeholder="Musterstadt"
                    value={contact.city}
                  />
                  {errors[index]?.city && (
                    <p className="text-sm text-destructive">
                      {errors[index].city}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}

          <Button onClick={addContact} type="button" variant="outline">
            <Plus className="h-4 w-4 mr-2" />
            Weitere Person hinzufügen
          </Button>

          {formError && <p className="text-sm text-destructive">{formError}</p>}

          <Button className="w-full" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Wird verarbeitet..." : "Weiter zur Terminauswahl"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
