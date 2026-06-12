import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { StepComponentProps } from "@/src/components/booking-wizard/types";

import { toTableId } from "@/convex/identity";
import { CalendarSelectionStep } from "@/src/components/booking-wizard/calendar-selection-step";

const useMutationMock = vi.fn((mutationRef: unknown) => {
  void mutationRef;
  return vi.fn();
});
const useQueryMock = vi.fn((_, args: unknown) => {
  if (args === "skip") {
    return;
  }
  return [
    {
      _id: toTableId<"appointmentTypes">("appointment-type-1"),
      duration: 30,
      lineageKey: toTableId<"appointmentTypes">("appointment-type-lineage-1"),
      name: "Akutsprechstunde",
    },
  ];
});

vi.mock("convex/react", () => ({
  useMutation: (mutationRef: unknown) => useMutationMock(mutationRef),
  useQuery: (queryRef: unknown, args: unknown) => useQueryMock(queryRef, args),
}));

describe("CalendarSelectionStep accessibility", () => {
  const props = {
    practiceId: toTableId<"practices">("practice-1"),
    ruleSetId: toTableId<"ruleSets">("rule-set-1"),
    state: {
      isNewPatient: false,
      locationLineageKey: toTableId<"locations">("location-lineage-1"),
      locationName: "Hauptstandort",
      personalData: {
        city: "Berlin",
        dateOfBirth: "1980-01-01",
        email: "patient@example.com",
        firstName: "Erika",
        gender: "female",
        lastName: "Mustermann",
        phoneNumber: "+491701234567",
        postalCode: "10115",
        street: "Musterstrasse 1",
      },
      practitionerLineageKey: toTableId<"practitioners">(
        "practitioner-lineage-1",
      ),
      practitionerName: "Dr. Smith",
      step: "existing-calendar-selection",
    },
  } satisfies StepComponentProps;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("associates the appointment type select with its visible label", () => {
    render(<CalendarSelectionStep {...props} />);

    expect(
      screen.getByRole("combobox", { name: "Terminart *" }),
    ).toHaveAttribute("id", "booking-appointment-type");
  });

  test("connects reason validation errors to the input", () => {
    render(<CalendarSelectionStep {...props} />);
    const reasonInput = screen.getByLabelText("Termingrund *");

    fireEvent.blur(reasonInput);

    expect(reasonInput).toHaveAttribute("aria-invalid", "true");
    expect(reasonInput).toHaveAccessibleDescription(
      "Bitte geben Sie einen Termingrund ein.",
    );
  });
});
