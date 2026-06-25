import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type {
  CalendarAppointmentLayout,
  CalendarAppointmentView,
} from "../../../src/components/calendar/types";

import {
  asAppointmentTypeLineageKey,
  asLocationLineageKey,
  asPractitionerLineageKey,
  toTableId,
} from "../../../convex/identity";
import { calendarColumnScopeFromPractitioner } from "../../../lib/calendar-occupancy";
import { CalendarAppointment } from "../../../src/components/calendar/calendar-appointment";
import { assertElement } from "../test-utils";
import { buildCalendarAppointmentRecord } from "./test-records";

describe("CalendarAppointment", () => {
  const practitioner1 = asPractitionerLineageKey(
    toTableId<"practitioners">("practitioner_1"),
  );
  const mockLayout: CalendarAppointmentLayout = {
    column: calendarColumnScopeFromPractitioner(practitioner1),
    duration: 30,
    id: "apt-1",
    record: buildCalendarAppointmentRecord({
      _id: toTableId<"appointments">("apt-1"),
      appointmentTypeLineageKey: asAppointmentTypeLineageKey(
        toTableId<"appointmentTypes">("appointment_type_1"),
      ),
      end: "2026-04-24T09:30:00+02:00[Europe/Berlin]",
      locationLineageKey: asLocationLineageKey(
        toTableId<"locations">("location_1"),
      ),
      practiceId: toTableId<"practices">("practice_1"),
      practitionerLineageKey: practitioner1,
      start: "2026-04-24T09:00:00+02:00[Europe/Berlin]",
      title: "Test Appointment",
    }),
    startTime: "09:00",
  };
  const mockAppointment: CalendarAppointmentView = {
    color: "bg-blue-500",
    layout: mockLayout,
  };

  const mockTimeToSlot = vi.fn((time: string) => {
    const [hours = 0, minutes = 0] = time.split(":").map(Number);
    return hours * 12 + Math.floor(minutes / 5);
  });

  const mockHandlers = {
    onDelete: vi.fn(),
    onEdit: vi.fn(),
    onPointerDragStart: vi.fn(),
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
    render(<CalendarAppointment {...defaultProps} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Termin Test Appointment, 09:00. Bearbeiten",
      }),
    );
    expect(mockHandlers.onEdit).toHaveBeenCalledExactlyOnceWith(mockLayout.id);
  });

  test("exposes an accessible edit button name", () => {
    render(<CalendarAppointment {...defaultProps} />);
    expect(
      screen.getByRole("button", {
        name: "Termin Test Appointment, 09:00. Bearbeiten",
      }),
    ).toBeInTheDocument();
  });

  test("calls onEdit from keyboard activation", () => {
    render(<CalendarAppointment {...defaultProps} />);
    const appointmentButton = screen.getByRole("button", {
      name: "Termin Test Appointment, 09:00. Bearbeiten",
    });

    fireEvent.keyDown(appointmentButton, { key: "Enter" });
    fireEvent.keyDown(appointmentButton, { key: " " });

    expect(mockHandlers.onEdit).toHaveBeenCalledTimes(2);
    expect(mockHandlers.onEdit).toHaveBeenCalledWith(mockLayout.id);
  });

  test("calls onDelete from keyboard delete shortcuts", () => {
    render(<CalendarAppointment {...defaultProps} />);
    const appointmentButton = screen.getByRole("button", {
      name: "Termin Test Appointment, 09:00. Bearbeiten",
    });

    fireEvent.keyDown(appointmentButton, { key: "Delete" });
    fireEvent.keyDown(appointmentButton, { key: "Backspace" });

    expect(mockHandlers.onDelete).toHaveBeenCalledTimes(2);
    expect(mockHandlers.onDelete).toHaveBeenCalledWith(mockLayout.id);
  });

  test("calls onDelete on right-click", () => {
    const { container } = render(<CalendarAppointment {...defaultProps} />);
    const appointmentElement = container.querySelector(".cursor-move");

    assertElement(appointmentElement);
    fireEvent.contextMenu(appointmentElement);
    expect(mockHandlers.onDelete).toHaveBeenCalledExactlyOnceWith(
      mockLayout.id,
    );
  });

  test("does not opt into native HTML dragging", () => {
    const { container } = render(<CalendarAppointment {...defaultProps} />);
    const appointmentElement = container.querySelector("[draggable]");
    expect(appointmentElement).not.toBeInTheDocument();
  });

  test("calls onPointerDragStart when pointer dragging starts", () => {
    const { container } = render(<CalendarAppointment {...defaultProps} />);
    const appointmentElement = container.querySelector(".cursor-move");

    assertElement(appointmentElement);
    fireEvent.pointerDown(appointmentElement, { button: 0, pointerId: 1 });
    expect(mockHandlers.onPointerDragStart).toHaveBeenCalled();
  });

  test("suppresses the synthesized click after pointer dragging moves", () => {
    const { container } = render(<CalendarAppointment {...defaultProps} />);
    const appointmentElement = container.querySelector(".cursor-move");

    assertElement(appointmentElement);
    fireEvent.pointerDown(appointmentElement, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerId: 1,
    });
    fireEvent.pointerMove(appointmentElement, {
      clientX: 14,
      clientY: 10,
      pointerId: 1,
    });
    fireEvent.pointerUp(appointmentElement, { pointerId: 1 });
    fireEvent.click(appointmentElement);

    expect(mockHandlers.onEdit).not.toHaveBeenCalled();
  });

  test("does not start pointer dragging from the resize handle", () => {
    const { container } = render(<CalendarAppointment {...defaultProps} />);
    const resizeHandle = container.querySelector(".cursor-ns-resize");

    assertElement(resizeHandle);
    fireEvent.pointerDown(resizeHandle, { button: 0, pointerId: 1 });

    expect(mockHandlers.onPointerDragStart).not.toHaveBeenCalled();
  });

  test("visually hides the source appointment while dragging", () => {
    const { container } = render(
      <CalendarAppointment {...defaultProps} isDragging={true} />,
    );
    const appointmentElement = container.querySelector(".opacity-0");
    expect(appointmentElement).toBeInTheDocument();
    expect(appointmentElement).not.toHaveClass("pointer-events-none");
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

  test("clips overflowing content inside the appointment height", () => {
    render(<CalendarAppointment {...defaultProps} />);

    const contentElement = screen.getByText("09:00").closest(".h-full");

    assertElement(contentElement);
    expect(contentElement).toHaveClass("overflow-hidden");
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
      mockLayout.id,
      mockLayout.duration,
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

  test("handles short appointments with an expanded hit target", () => {
    const shortAppointment = {
      ...mockAppointment,
      layout: {
        ...mockAppointment.layout,
        duration: 5,
      },
    };

    const { container } = render(
      <CalendarAppointment {...defaultProps} appointment={shortAppointment} />,
    );

    const appointmentElement = container.querySelector(".min-h-4");
    expect(appointmentElement).toBeInTheDocument();
    expect(appointmentElement).toHaveClass("before:min-h-6");
    expect(appointmentElement).toHaveClass("before:content-['']");
  });

  test("handles long appointments", () => {
    const longAppointment = {
      ...mockAppointment,
      layout: {
        ...mockAppointment.layout,
        duration: 120,
      },
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
      String.raw`.hover\:shadow`,
    );
    expect(appointmentElement).toBeInTheDocument();
  });

  test("applies transition classes", () => {
    const { container } = render(<CalendarAppointment {...defaultProps} />);
    const appointmentElement = container.querySelector(
      String.raw`.transition-\[opacity\,box-shadow\]`,
    );
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
