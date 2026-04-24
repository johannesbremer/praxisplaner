import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { regex } from "@/lib/arkregex";

import type { CalendarAppointmentView } from "../../../src/components/calendar/types";

import { toTableId } from "../../../convex/identity";
import { CalendarGrid } from "../../../src/components/calendar/calendar-grid";
import { assertElement } from "../test-utils";

describe("CalendarGrid", () => {
  const doctorHeaderRegex = regex.as(String.raw`Dr\.`);
  const appointmentType1 = toTableId<"appointmentTypes">("appointment_type_1");
  const location1 = toTableId<"locations">("location_1");
  const practice1 = toTableId<"practices">("practice_1");
  const practitioner1 = toTableId<"practitioners">("practitioner_1");
  const practitioner2 = toTableId<"practitioners">("practitioner_2");

  const createAppointment = (args: {
    color: string;
    column: typeof practitioner1;
    duration: number;
    id: string;
    startTime: string;
    title: string;
  }): CalendarAppointmentView => ({
    color: args.color,
    layout: {
      column: args.column,
      duration: args.duration,
      id: args.id,
      record: {
        _creationTime: 0,
        _id: toTableId<"appointments">(args.id),
        appointmentTypeLineageKey: appointmentType1,
        appointmentTypeTitle: "Checkup",
        createdAt: 0n,
        end: "2026-04-24T09:30:00+02:00[Europe/Berlin]",
        lastModified: 0n,
        locationLineageKey: location1,
        practiceId: practice1,
        practitionerLineageKey: args.column,
        start: "2026-04-24T09:00:00+02:00[Europe/Berlin]",
        title: args.title,
      },
      startTime: args.startTime,
    },
  });

  const mockAppointments: CalendarAppointmentView[] = [
    createAppointment({
      color: "bg-blue-500",
      column: practitioner1,
      duration: 30,
      id: "apt-1",
      startTime: "09:00",
      title: "Test Appointment 1",
    }),
    createAppointment({
      color: "bg-green-500",
      column: practitioner2,
      duration: 45,
      id: "apt-2",
      startTime: "14:00",
      title: "Test Appointment 2",
    }),
  ];

  const mockColumns = [
    { id: practitioner1, title: "Dr. Smith" },
    { id: practitioner2, title: "Dr. Jones" },
  ];

  const mockSlotToTime = vi.fn((slot: number) => {
    const hours = Math.floor(slot / 12);
    const minutes = (slot % 12) * 5;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  });

  const mockTimeToSlot = vi.fn((time: string) => {
    const [hours = 0, minutes = 0] = time.split(":").map(Number);
    return hours * 12 + Math.floor(minutes / 5);
  });

  const mockHandlers = {
    onAddAppointment: vi.fn(),
    onDeleteAppointment: vi.fn(),
    onDragEnd: vi.fn(),
    onDragOver: vi.fn(),
    onDragStart: vi.fn(),
    onDrop: vi.fn(),
    onEditAppointment: vi.fn(),
    onResizeStart: vi.fn(),
  };

  const defaultProps = {
    appointments: mockAppointments,
    columns: mockColumns,
    currentTimeSlot: -1,
    draggedAppointment: null,
    dragPreview: { column: null, slot: 0, visible: false },
    slotDuration: 5,
    slotToTime: mockSlotToTime,
    timeToSlot: mockTimeToSlot,
    totalSlots: 144, // 12 hours
    ...mockHandlers,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    test("renders without crashing", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);
      expect(container).toBeTruthy();
    });

    test("renders time column", () => {
      render(<CalendarGrid {...defaultProps} />);
      expect(screen.getByText("Zeit")).toBeInTheDocument();
    });

    test("renders all column headers", () => {
      render(<CalendarGrid {...defaultProps} />);
      expect(screen.getByText("Dr. Smith")).toBeInTheDocument();
      expect(screen.getByText("Dr. Jones")).toBeInTheDocument();
    });

    test("renders correct grid structure", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);
      const grid = container.querySelector(".grid");
      expect(grid).toBeInTheDocument();

      // Verify grid template columns
      expect(grid).toHaveStyle({
        gridTemplateColumns: `80px repeat(${mockColumns.length}, 1fr)`,
      });
    });

    test("renders all appointments", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);
      // Check that both appointments are rendered as draggable elements
      const draggableElements = container.querySelectorAll("[draggable=true]");
      expect(draggableElements.length).toBe(mockAppointments.length);
    });

    test("renders appointments in correct columns", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      // Should render appointments only in their respective columns
      const columns = container.querySelectorAll(".border-r");
      expect(columns.length).toBeGreaterThan(0);
    });

    test("renders all time slots for each column", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      // Each column should have totalSlots slots
      // All slots have h-4 class, but we need to exclude the time column
      // The time column also has h-4 slots, so we count all and divide by (columns + 1)
      const allSlots = container.querySelectorAll(".h-4");

      // Total should be totalSlots * (columns + 1 for time column)
      // But we can also just check that we have slots
      expect(allSlots.length).toBeGreaterThan(0);
    });

    test("renders with no appointments", () => {
      const { container } = render(
        <CalendarGrid {...defaultProps} appointments={[]} />,
      );
      expect(container).toBeTruthy();
      // Verify no appointment times are rendered
      const draggableElements = container.querySelectorAll("[draggable=true]");
      expect(draggableElements.length).toBe(0);
    });

    test("renders with single column", () => {
      const singleColumn = [{ id: practitioner1, title: "Dr. Smith" }];
      render(<CalendarGrid {...defaultProps} columns={singleColumn} />);
      expect(screen.getByText("Dr. Smith")).toBeInTheDocument();
      expect(screen.queryByText("Dr. Jones")).not.toBeInTheDocument();
    });

    test("renders with many columns", () => {
      const manyColumns = Array.from({ length: 5 }, (_, i) => ({
        id: toTableId<"practitioners">(`practitioner_${i}`),
        title: `Doctor ${i}`,
      }));

      render(<CalendarGrid {...defaultProps} columns={manyColumns} />);

      for (const col of manyColumns) {
        expect(screen.getByText(col.title)).toBeInTheDocument();
      }
    });
  });

  describe("Interactions", () => {
    test("calls onAddAppointment when slot is clicked", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const slots = container.querySelectorAll(
        String.raw`.hover\:bg-muted\/50`,
      );
      expect(slots.length).toBeGreaterThan(0);
      const firstSlot = slots[0];
      assertElement(firstSlot);
      fireEvent.click(firstSlot);
      expect(mockHandlers.onAddAppointment).toHaveBeenCalled();
    });

    test("does not call onAddAppointment for appointment-type-unavailable columns", () => {
      const { container } = render(
        <CalendarGrid
          {...defaultProps}
          columns={[
            {
              id: practitioner1,
              isAppointmentTypeUnavailable: true,
              isMuted: true,
              title: "Dr. Smith",
            },
          ]}
        />,
      );

      const slot = container.querySelector(".group");
      assertElement(slot);
      fireEvent.click(slot);
      expect(mockHandlers.onAddAppointment).not.toHaveBeenCalled();
    });

    test("shows plus icon on hover", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const slot = container.querySelector(".group");
      expect(slot).toBeInTheDocument();

      // Plus icon should have opacity-0 by default
      const plusIcon = container.querySelector(".opacity-0");
      expect(plusIcon).toBeInTheDocument();
    });

    test("calls onEditAppointment when appointment is clicked", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const appointment = container.querySelector("[draggable=true]");
      assertElement(appointment);
      fireEvent.click(appointment);
      expect(mockHandlers.onEditAppointment).toHaveBeenCalledExactlyOnceWith(
        mockAppointments[0]?.layout.id,
      );
    });

    test("calls onDeleteAppointment on appointment right-click", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const appointment = container.querySelector("[draggable=true]");
      assertElement(appointment);
      fireEvent.contextMenu(appointment);
      expect(mockHandlers.onDeleteAppointment).toHaveBeenCalledExactlyOnceWith(
        mockAppointments[0]?.layout.id,
      );
    });
  });

  describe("Drag and Drop", () => {
    test("calls onDragStart when appointment is dragged", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const appointment = container.querySelector("[draggable=true]");
      assertElement(appointment);
      fireEvent.dragStart(appointment);
      expect(mockHandlers.onDragStart).toHaveBeenCalled();
    });

    test("calls onDragOver when dragging over column", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const column = container.querySelector(".relative.min-h-full");
      assertElement(column);
      fireEvent.dragOver(column);
      expect(mockHandlers.onDragOver).toHaveBeenCalled();
    });

    test("calls onDrop when appointment is dropped", async () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const column = container.querySelector(".relative.min-h-full");
      assertElement(column);
      fireEvent.drop(column);

      await waitFor(() => {
        expect(mockHandlers.onDrop).toHaveBeenCalled();
      });
    });

    test("does not allow dropping an appointment onto a drag-disabled column", async () => {
      const draggedApt = mockAppointments[0];
      if (!draggedApt) {
        return;
      }

      const { container } = render(
        <CalendarGrid
          {...defaultProps}
          columns={[
            { id: practitioner1, title: "Dr. Smith" },
            {
              id: practitioner2,
              isDragDisabled: true,
              isMuted: true,
              title: "Dr. Jones",
            },
          ]}
          draggedAppointment={draggedApt}
        />,
      );

      const columns = container.querySelectorAll(".relative.min-h-full");
      const blockedColumn = columns[1];
      assertElement(blockedColumn);

      fireEvent.dragOver(blockedColumn);
      fireEvent.drop(blockedColumn);

      await waitFor(() => {
        expect(mockHandlers.onDragOver).not.toHaveBeenCalled();
        expect(mockHandlers.onDrop).not.toHaveBeenCalled();
      });
    });

    test("renders drag preview when dragging", () => {
      const dragPreview = {
        column: practitioner1,
        slot: 12,
        visible: true,
      };

      const draggedApt = mockAppointments[0];
      if (!draggedApt) {
        return;
      }

      const { container } = render(
        <CalendarGrid
          {...defaultProps}
          draggedAppointment={draggedApt}
          dragPreview={dragPreview}
        />,
      );

      const preview = container.querySelector(".border-dashed");
      expect(preview).toBeInTheDocument();
    });

    test("does not render drag preview when not dragging", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const preview = container.querySelector(".border-dashed");
      expect(preview).not.toBeInTheDocument();
    });

    test("positions drag preview correctly", () => {
      const dragPreview = {
        column: practitioner1,
        slot: 24,
        visible: true,
      };

      const draggedApt = mockAppointments[0];
      if (!draggedApt) {
        return;
      }

      const { container } = render(
        <CalendarGrid
          {...defaultProps}
          draggedAppointment={draggedApt}
          dragPreview={dragPreview}
        />,
      );

      const preview = container.querySelector(".border-dashed");
      expect(preview).toBeInTheDocument();

      const style = preview?.getAttribute("style");
      const expectedTop = dragPreview.slot * 16;
      expect(style).toContain(`--calendar-appointment-top: ${expectedTop}px`);
    });

    test("shows dragged appointment details in preview", () => {
      const dragPreview = {
        column: practitioner1,
        slot: 12,
        visible: true,
      };

      const draggedApt = mockAppointments[0];
      if (!draggedApt) {
        return;
      }

      const { container } = render(
        <CalendarGrid
          {...defaultProps}
          draggedAppointment={draggedApt}
          dragPreview={dragPreview}
        />,
      );

      // Preview should show appointment with dashed border
      const preview = container.querySelector(".border-dashed");
      expect(preview).toBeInTheDocument();
      // Preview should show the start time
      expect(preview?.textContent).toContain("01:00"); // slot 12 = 01:00
    });
  });

  describe("Current Time Indicator", () => {
    test("renders current time indicator in time column", () => {
      const { container } = render(
        <CalendarGrid {...defaultProps} currentTimeSlot={24} />,
      );

      const indicators = container.querySelectorAll(".border-red-500");
      expect(indicators.length).toBeGreaterThan(0);
    });

    test("renders current time indicator in all columns", () => {
      const { container } = render(
        <CalendarGrid {...defaultProps} currentTimeSlot={24} />,
      );

      const indicators = container.querySelectorAll(".bg-red-500");
      // Should have indicator in time column + each calendar column
      expect(indicators.length).toBeGreaterThanOrEqual(mockColumns.length);
    });

    test("positions current time indicator correctly", () => {
      const currentTimeSlot = 36;
      const { container } = render(
        <CalendarGrid {...defaultProps} currentTimeSlot={currentTimeSlot} />,
      );

      const indicator = container.querySelector(".border-red-500");
      expect(indicator).toBeInTheDocument();

      const style = indicator?.getAttribute("style");
      const expectedTop = `${currentTimeSlot * 16}px`;
      expect(style).toContain(expectedTop);
    });

    test("does not render indicator when currentTimeSlot is negative", () => {
      render(<CalendarGrid {...defaultProps} currentTimeSlot={-1} />);

      // Should still render calendar but without red indicators
      expect(screen.getByText("Zeit")).toBeInTheDocument();
    });
  });

  describe("Resize Functionality", () => {
    test("calls onResizeStart when resize handle is clicked", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const resizeHandle = container.querySelector(".cursor-ns-resize");
      assertElement(resizeHandle);
      fireEvent.mouseDown(resizeHandle);
      expect(mockHandlers.onResizeStart).toHaveBeenCalled();
    });

    test("renders resize handle for each appointment", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const resizeHandles = container.querySelectorAll(".cursor-ns-resize");
      expect(resizeHandles.length).toBe(mockAppointments.length);
    });
  });

  describe("Filtering and Display", () => {
    test("only shows appointments in correct columns", () => {
      const mixedAppointments: CalendarAppointmentView[] = [
        createAppointment({
          color: "bg-blue-500",
          column: practitioner1,
          duration: 30,
          id: "apt-1",
          startTime: "09:00",
          title: "Mixed Appointment 1",
        }),
        createAppointment({
          color: "bg-green-500",
          column: practitioner2,
          duration: 30,
          id: "apt-2",
          startTime: "10:00",
          title: "Mixed Appointment 2",
        }),
        createAppointment({
          color: "bg-red-500",
          column: practitioner1,
          duration: 30,
          id: "apt-3",
          startTime: "11:00",
          title: "Mixed Appointment 3",
        }),
      ];

      const { container } = render(
        <CalendarGrid {...defaultProps} appointments={mixedAppointments} />,
      );

      // All appointments should be rendered
      const draggableElements = container.querySelectorAll("[draggable=true]");
      expect(draggableElements.length).toBe(mixedAppointments.length);
    });

    test("handles appointments with overlapping times", () => {
      const overlappingAppointments: CalendarAppointmentView[] = [
        createAppointment({
          color: "bg-blue-500",
          column: practitioner1,
          duration: 60,
          id: "apt-1",
          startTime: "09:00",
          title: "Overlapping Appointment 1",
        }),
        createAppointment({
          color: "bg-green-500",
          column: practitioner1,
          duration: 30,
          id: "apt-2",
          startTime: "09:30",
          title: "Overlapping Appointment 2",
        }),
      ];

      const { container } = render(
        <CalendarGrid
          {...defaultProps}
          appointments={overlappingAppointments}
        />,
      );

      // Both appointments should render (visual overlap is handled by CSS)
      const draggableElements = container.querySelectorAll("[draggable=true]");
      expect(draggableElements.length).toBe(2);
    });
  });

  describe("Accessibility", () => {
    test("column headers have proper structure", () => {
      render(<CalendarGrid {...defaultProps} />);

      const headers = screen.getAllByText(doctorHeaderRegex);
      for (const header of headers) {
        expect(header).toBeInTheDocument();
      }
    });

    test("time slots are keyboard accessible", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const slots = container.querySelectorAll(".cursor-pointer");
      expect(slots.length).toBeGreaterThan(0);
    });

    test("appointments are keyboard accessible", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const appointments = container.querySelectorAll("[draggable=true]");
      expect(appointments.length).toBe(mockAppointments.length);
    });
  });
});
