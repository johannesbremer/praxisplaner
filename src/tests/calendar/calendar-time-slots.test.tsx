import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { CalendarTimeSlots } from "../../../src/components/calendar/calendar-time-slots";

describe("CalendarTimeSlots", () => {
  const mockSlotToTime = vi.fn((slot: number) => {
    const hours = Math.floor(slot / 12);
    const minutes = (slot % 12) * 5;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  });

  const defaultProps = {
    currentTimeSlot: -1,
    slotToTime: mockSlotToTime,
    totalSlots: 144, // 12 hours * 12 slots per hour
  };

  test("renders without crashing", () => {
    const { container } = render(<CalendarTimeSlots {...defaultProps} />);
    expect(container).toBeTruthy();
  });

  test("renders header with 'Zeit' label", () => {
    render(<CalendarTimeSlots {...defaultProps} />);
    expect(screen.getByText("Zeit")).toBeInTheDocument();
  });

  test("renders correct number of time slots", () => {
    const { container } = render(<CalendarTimeSlots {...defaultProps} />);
    // Select slots from the relative div, excluding the header
    const timeColumn = container.querySelector(".relative");
    const slots = timeColumn?.querySelectorAll(".border-b");
    expect(slots?.length).toBe(defaultProps.totalSlots);
  });

  test("displays hour labels at correct intervals", () => {
    render(<CalendarTimeSlots {...defaultProps} />);

    // Hours should be displayed at every 12th slot (0, 12, 24, etc.)
    expect(screen.getByText("00:00")).toBeInTheDocument();
    expect(screen.getByText("01:00")).toBeInTheDocument();
    expect(screen.getByText("02:00")).toBeInTheDocument();
  });

  test("does not display time labels for non-hour slots", () => {
    render(<CalendarTimeSlots {...defaultProps} />);

    // Non-hour slots should not display time labels
    expect(screen.queryByText("00:05")).not.toBeInTheDocument();
    expect(screen.queryByText("00:10")).not.toBeInTheDocument();
  });

  test("applies stronger border to hour slots", () => {
    const { container } = render(<CalendarTimeSlots {...defaultProps} />);

    // First slot (hour marker) should have border-border class
    const slots = container.querySelectorAll(".border-b");
    const firstSlot = slots[0];
    expect(firstSlot).toHaveClass("border-border");

    // Non-hour slot should have border-border/30 class
    const secondSlot = slots[1];
    expect(secondSlot).toHaveClass("border-border/30");
  });

  test("renders current time indicator when currentTimeSlot is valid", () => {
    const { container } = render(
      <CalendarTimeSlots {...defaultProps} currentTimeSlot={24} />,
    );

    const indicator = container.querySelector(".border-red-500");
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveClass("border-t-2");
  });

  test("does not render current time indicator when currentTimeSlot is negative", () => {
    const { container } = render(
      <CalendarTimeSlots {...defaultProps} currentTimeSlot={-1} />,
    );

    const indicator = container.querySelector(".border-red-500");
    expect(indicator).not.toBeInTheDocument();
  });

  test("positions current time indicator correctly", () => {
    const currentTimeSlot = 36; // 3 hours
    const { container } = render(
      <CalendarTimeSlots {...defaultProps} currentTimeSlot={currentTimeSlot} />,
    );

    const indicator = container.querySelector(".border-red-500");
    expect(indicator).toBeInTheDocument();

    // Check CSS custom property
    if (indicator) {
      const computedStyle = globalThis.getComputedStyle(indicator);
      const expectedTop = `${currentTimeSlot * 16}px`;
      expect(
        computedStyle.getPropertyValue("--calendar-current-time-top"),
      ).toBe(expectedTop);
    }
  });

  test("renders red dot on current time indicator", () => {
    const { container } = render(
      <CalendarTimeSlots {...defaultProps} currentTimeSlot={24} />,
    );

    const redDot = container.querySelector(".bg-red-500.rounded-full");
    expect(redDot).toBeInTheDocument();
  });

  test("has sticky positioning for time column", () => {
    const { container } = render(<CalendarTimeSlots {...defaultProps} />);

    const timeColumn = container.querySelector(".sticky");
    expect(timeColumn).toHaveClass("sticky", "left-0");
  });

  test("calls slotToTime for each hour slot", () => {
    mockSlotToTime.mockClear();
    render(<CalendarTimeSlots {...defaultProps} />);

    // Should be called for every slot to determine the time
    expect(mockSlotToTime).toHaveBeenCalledTimes(defaultProps.totalSlots);
  });

  test("handles zero totalSlots gracefully", () => {
    const { container } = render(
      <CalendarTimeSlots {...defaultProps} totalSlots={0} />,
    );

    // Header still exists with border-b, so check slots in the relative container
    const timeColumn = container.querySelector(".relative");
    const slots = timeColumn?.querySelectorAll(".border-b");
    expect(slots?.length).toBe(0);
  });

  test("handles large totalSlots value", () => {
    const { container } = render(
      <CalendarTimeSlots {...defaultProps} totalSlots={288} />,
    ); // 24 hours

    const timeColumn = container.querySelector(".relative");
    const slots = timeColumn?.querySelectorAll(".border-b");
    expect(slots?.length).toBe(288);
  });

  test("maintains consistent height for each slot", () => {
    const { container } = render(<CalendarTimeSlots {...defaultProps} />);

    const slots = container.querySelectorAll(".h-4");
    expect(slots.length).toBe(defaultProps.totalSlots);
  });

  test("applies correct z-index layers", () => {
    const { container } = render(
      <CalendarTimeSlots {...defaultProps} currentTimeSlot={24} />,
    );

    // Time column should be z-10
    const timeColumn = container.querySelector(".z-10");
    expect(timeColumn).toBeInTheDocument();

    // Header should be z-30
    const header = container.querySelector(".z-30");
    expect(header).toBeInTheDocument();

    // Current time indicator should be z-30
    const indicator = container.querySelector(".border-red-500");
    expect(indicator).toHaveClass("z-30");
  });
});
