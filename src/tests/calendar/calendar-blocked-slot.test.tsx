import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { CalendarColumnId } from "../../../src/components/calendar/types";

import { asPractitionerLineageKey, toTableId } from "../../../convex/identity";
import { calendarColumnScopeFromPractitioner } from "../../../lib/calendar-occupancy";
import { CalendarBlockedSlot } from "../../../src/components/calendar/calendar-blocked-slot";

describe("CalendarBlockedSlot", () => {
  const practitioner = asPractitionerLineageKey(
    toTableId<"practitioners">("practitioner_1"),
  );
  const column: CalendarColumnId =
    calendarColumnScopeFromPractitioner(practitioner);
  const blockedSlot = {
    column,
    duration: 30,
    id: "blocked-slot-1",
    isManual: true,
    slot: 108,
    startSlot: 108,
    title: "Teammeeting",
  } as const;
  const handlers = {
    onDelete: vi.fn(),
    onDragEnd: vi.fn(),
    onDragStart: vi.fn(),
    onEdit: vi.fn(),
    onResizeStart: vi.fn(),
  };
  const defaultProps = {
    blockedSlot,
    isDragging: false,
    slotCount: 6,
    slotToTime: (slot: number) => (slot === 108 ? "09:00" : "00:00"),
    ...handlers,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("exposes an accessible edit button name", () => {
    render(<CalendarBlockedSlot {...defaultProps} />);

    expect(
      screen.getByRole("button", {
        name: "Gesperrter Zeitraum Teammeeting, 09:00. Bearbeiten",
      }),
    ).toBeInTheDocument();
  });

  test("calls onEdit from pointer and keyboard activation", () => {
    render(<CalendarBlockedSlot {...defaultProps} />);
    const blockedSlotButton = screen.getByRole("button", {
      name: "Gesperrter Zeitraum Teammeeting, 09:00. Bearbeiten",
    });

    fireEvent.click(blockedSlotButton);
    fireEvent.keyDown(blockedSlotButton, { key: "Enter" });
    fireEvent.keyDown(blockedSlotButton, { key: " " });

    expect(handlers.onEdit).toHaveBeenCalledTimes(3);
    expect(handlers.onEdit).toHaveBeenCalledWith(blockedSlot.id);
  });

  test("calls onDelete from keyboard delete shortcuts", () => {
    render(<CalendarBlockedSlot {...defaultProps} />);
    const blockedSlotButton = screen.getByRole("button", {
      name: "Gesperrter Zeitraum Teammeeting, 09:00. Bearbeiten",
    });

    fireEvent.keyDown(blockedSlotButton, { key: "Delete" });
    fireEvent.keyDown(blockedSlotButton, { key: "Backspace" });

    expect(handlers.onDelete).toHaveBeenCalledTimes(2);
    expect(handlers.onDelete).toHaveBeenCalledWith(blockedSlot.id);
  });

  test("short blocked slots expose an expanded hit target", () => {
    render(<CalendarBlockedSlot {...defaultProps} slotCount={1} />);
    const blockedSlotButton = screen.getByRole("button", {
      name: "Gesperrter Zeitraum Teammeeting, 09:00. Bearbeiten",
    });

    expect(blockedSlotButton).toHaveClass("min-h-4");
    expect(blockedSlotButton).toHaveClass("before:min-h-6");
    expect(blockedSlotButton).toHaveClass("before:content-['']");
  });
});
