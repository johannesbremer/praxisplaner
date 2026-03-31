import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";

import { AppointmentTypeSelector } from "../components/appointment-type-selector";

const useQueryMock =
  vi.fn<() => { _id: Id<"appointmentTypes">; name: string }[]>();

vi.mock("convex/react", () => ({
  useQuery: () => useQueryMock(),
}));

describe("AppointmentTypeSelector", () => {
  const ruleSetId = "rule-set-1" as Id<"ruleSets">;
  const selectedTypeId = "appointment-type-1" as Id<"appointmentTypes">;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useQueryMock.mockReturnValue([
      {
        _id: selectedTypeId,
        name: "Akut",
      },
      {
        _id: "appointment-type-2" as Id<"appointmentTypes">,
        name: "Check-up",
      },
    ]);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  test("selects an appointment type", () => {
    const onTypeSelect = vi.fn();

    render(
      <AppointmentTypeSelector
        onTypeSelect={onTypeSelect}
        ruleSetId={ruleSetId}
        selectedType={undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Akut" }));

    expect(onTypeSelect).toHaveBeenCalledExactlyOnceWith(selectedTypeId);
  });

  test("auto-deselects on outside click when enabled", () => {
    const onTypeDeselect = vi.fn();

    render(
      <AppointmentTypeSelector
        onTypeDeselect={onTypeDeselect}
        onTypeSelect={vi.fn()}
        ruleSetId={ruleSetId}
        selectedType={selectedTypeId}
      />,
    );

    vi.runAllTimers();
    fireEvent.click(document.body);

    expect(onTypeDeselect).toHaveBeenCalledTimes(1);
  });

  test("does not auto-deselect on outside click while modal flow is open", () => {
    const onTypeDeselect = vi.fn();

    render(
      <AppointmentTypeSelector
        disableAutoDeselect={true}
        onTypeDeselect={onTypeDeselect}
        onTypeSelect={vi.fn()}
        ruleSetId={ruleSetId}
        selectedType={selectedTypeId}
      />,
    );

    vi.runAllTimers();
    fireEvent.click(document.body);

    expect(onTypeDeselect).not.toHaveBeenCalled();
  });

  test("does not auto-deselect on escape while modal flow is open", () => {
    const onTypeDeselect = vi.fn();

    render(
      <AppointmentTypeSelector
        disableAutoDeselect={true}
        onTypeDeselect={onTypeDeselect}
        onTypeSelect={vi.fn()}
        ruleSetId={ruleSetId}
        selectedType={selectedTypeId}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onTypeDeselect).not.toHaveBeenCalled();
  });
});
