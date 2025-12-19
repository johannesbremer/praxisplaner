import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Appointment } from "../../../src/components/calendar/types";

import { CalendarAppointment } from "../../../src/components/calendar/calendar-appointment";
import { assertElement } from "../test-utils";

describe("CalendarAppointment", () => {
  const mockAppointment: Appointment = {
    color: "bg-blue-500",
    column: "practitioner-1",
    duration: 30,
    id: "apt-1",
    isSimulation: false,
    startTime: "09:00",
    title: "Test Appointment",
  };

  const mockTimeToSlot = vi.fn((time: string) => {
    const [hours = 0, minutes = 0] = time.split(":").map(Number);
    return hours * 12 + Math.floor(minutes / 5);
  });

  const mockHandlers = {
    onDelete: vi.fn(),
    onDragEnd: vi.fn(),
    onDragStart: vi.fn(),
    onEdit: vi.fn(),
    onResizeStart: vi.fn(),
  };

  const defaultProps = {
    appointment: mockAppointment,
    isDragging: false,
    slotDuration: 5,
    timeToSlot: mockTimeToSlot,
    ...mockHandlers,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("renders without crashing", () => {
    const { container } = render(<CalendarAppointment {...defaultProps} />);
    expect(container).toBeTruthy();
  });

  test("displays appointment start time", () => {
    render(<CalendarAppointment {...defaultProps} />);
    expect(screen.getByText("09:00")).toBeInTheDocument();
  });

  test("applies correct color class", () => {
    const { container } = render(<CalendarAppointment {...defaultProps} />);
    const appointmentElement = container.querySelector(".bg-blue-500");
    expect(appointmentElement).toBeInTheDocument();
  });

  test("calls onEdit when clicked", () => {
    const { container } = render(<CalendarAppointment {...defaultProps} />);
    const appointmentElement = container.querySelector(".cursor-move");

    assertElement(appointmentElement);
    fireEvent.click(appointmentElement);
    expect(mockHandlers.onEdit).toHaveBeenCalledExactlyOnceWith(
      mockAppointment,
    );
  });

  test("calls onDelete on right-click", () => {
    const { container } = render(<CalendarAppointment {...defaultProps} />);
    const appointmentElement = container.querySelector(".cursor-move");

    assertElement(appointmentElement);
    fireEvent.contextMenu(appointmentElement);
    expect(mockHandlers.onDelete).toHaveBeenCalledExactlyOnceWith(
      mockAppointment,
    );
  });

  test("is draggable", () => {
    const { container } = render(<CalendarAppointment {...defaultProps} />);
    const appointmentElement = container.querySelector("[draggable]");
    expect(appointmentElement).toBeInTheDocument();
    expect(appointmentElement?.getAttribute("draggable")).toBe("true");
  });

  test("calls onDragStart when drag starts", () => {
    const { container } = render(<CalendarAppointment {...defaultProps} />);
    const appointmentElement = container.querySelector("[draggable]");

    assertElement(appointmentElement);
    fireEvent.dragStart(appointmentElement);
    expect(mockHandlers.onDragStart).toHaveBeenCalled();
  });

  test("calls onDragEnd when drag ends", () => {
    const { container } = render(<CalendarAppointment {...defaultProps} />);
    const appointmentElement = container.querySelector("[draggable]");

    assertElement(appointmentElement);
    fireEvent.dragEnd(appointmentElement);
    expect(mockHandlers.onDragEnd).toHaveBeenCalled();
  });

  test("applies opacity when dragging", () => {
    const { container } = render(
      <CalendarAppointment {...defaultProps} isDragging={true} />,
    );
    const appointmentElement = container.querySelector(".opacity-50");
    expect(appointmentElement).toBeInTheDocument();
  });

  test("applies full opacity when not dragging", () => {
    const { container } = render(
      <CalendarAppointment {...defaultProps} isDragging={false} />,
    );
    const appointmentElement = container.querySelector(".opacity-100");
    expect(appointmentElement).toBeInTheDocument();
  });

  test("calculates correct height based on duration", () => {
    const { container } = render(<CalendarAppointment {...defaultProps} />);
    const appointmentElement = container.querySelector("[style]");

    // Duration 30 minutes, slotDuration 5 minutes = 6 slots * 16px = 96px
    const expectedHeight = (30 / 5) * 16;

    expect(appointmentElement).toBeInTheDocument();
    const style = appointmentElement?.getAttribute("style");
    expect(style).toContain(
      `--calendar-appointment-height: ${expectedHeight}px`,
    );
  });

  test("calculates correct top position based on start time", () => {
    const { container } = render(<CalendarAppointment {...defaultProps} />);
    const appointmentElement = container.querySelector("[style]");

    // 09:00 = 9 * 12 = 108 slots * 16px = 1728px
    const expectedTop = mockTimeToSlot("09:00") * 16;

    expect(appointmentElement).toBeInTheDocument();
    const style = appointmentElement?.getAttribute("style");
    expect(style).toContain(`--calendar-appointment-top: ${expectedTop}px`);
  });

  test("renders resize handle", () => {
    const { container } = render(<CalendarAppointment {...defaultProps} />);
    const resizeHandle = container.querySelector(".cursor-ns-resize");
    expect(resizeHandle).toBeInTheDocument();
  });

  test("calls onResizeStart when resize handle is clicked", () => {
    const { container } = render(<CalendarAppointment {...defaultProps} />);
    const resizeHandle = container.querySelector(".cursor-ns-resize");

    assertElement(resizeHandle);
    fireEvent.mouseDown(resizeHandle);
    expect(mockHandlers.onResizeStart).toHaveBeenCalledExactlyOnceWith(
      expect.any(Object),
      mockAppointment.id,
      mockAppointment.duration,
    );
  });

  test("prevents context menu default behavior", () => {
    const { container } = render(<CalendarAppointment {...defaultProps} />);
    const appointmentElement = container.querySelector(".cursor-move");

    assertElement(appointmentElement);
    const event = new MouseEvent("contextmenu", { bubbles: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    fireEvent(appointmentElement, event);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  test("stops propagation on resize handle mousedown", () => {
    const { container } = render(<CalendarAppointment {...defaultProps} />);
    const resizeHandle = container.querySelector(".cursor-ns-resize");

    assertElement(resizeHandle);
    const event = new MouseEvent("mousedown", { bubbles: true });
    const stopPropagationSpy = vi.spyOn(event, "stopPropagation");
    fireEvent(resizeHandle, event);
    expect(stopPropagationSpy).toHaveBeenCalled();
  });

  test("handles short appointments with minimum height", () => {
    const shortAppointment = {
      ...mockAppointment,
      duration: 5, // 5 minutes
    };

    const { container } = render(
      <CalendarAppointment {...defaultProps} appointment={shortAppointment} />,
    );

    const appointmentElement = container.querySelector(".min-h-4");
    expect(appointmentElement).toBeInTheDocument();
  });

  test("handles long appointments", () => {
    const longAppointment = {
      ...mockAppointment,
      duration: 120, // 2 hours
    };

    const { container } = render(
      <CalendarAppointment {...defaultProps} appointment={longAppointment} />,
    );

    const appointmentElement = container.querySelector("[style]");
    const expectedHeight = (120 / 5) * 16; // 384px

    const style = appointmentElement?.getAttribute("style");
    expect(style).toContain(
      `--calendar-appointment-height: ${expectedHeight}px`,
    );
  });

  test("applies hover styles", () => {
    const { container } = render(<CalendarAppointment {...defaultProps} />);
    const appointmentElement = container.querySelector(
      String.raw`.hover\:shadow-md`,
    );
    expect(appointmentElement).toBeInTheDocument();
  });

  test("applies transition classes", () => {
    const { container } = render(<CalendarAppointment {...defaultProps} />);
    const appointmentElement = container.querySelector(".transition-all");
    expect(appointmentElement).toBeInTheDocument();
  });

  test("renders with different colors", () => {
    const colors = ["bg-blue-500", "bg-green-500", "bg-red-500"];

    for (const color of colors) {
      const { container } = render(
        <CalendarAppointment
          {...defaultProps}
          appointment={{ ...mockAppointment, color }}
        />,
      );

      const appointmentElement = container.querySelector(`.${color}`);
      expect(appointmentElement).toBeInTheDocument();
    }
  });

  test("has proper z-index", () => {
    const { container } = render(<CalendarAppointment {...defaultProps} />);
    const appointmentElement = container.querySelector(".z-10");
    expect(appointmentElement).toBeInTheDocument();
  });

  test("renders resize handle indicator", () => {
    const { container } = render(<CalendarAppointment {...defaultProps} />);
    const indicator = container.querySelector(String.raw`.w-8.h-0\.5`);
    expect(indicator).toBeInTheDocument();
  });
});
