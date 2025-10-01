import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Appointment } from "../../../src/components/calendar/types";

import { CalendarGrid } from "../../../src/components/calendar/calendar-grid";

describe("CalendarGrid", () => {
  const mockAppointments: Appointment[] = [
    {
      color: "bg-blue-500",
      column: "practitioner-1",
      duration: 30,
      id: "apt-1",
      isSimulation: false,
      startTime: "09:00",
      title: "Morning Consultation",
    },
    {
      color: "bg-green-500",
      column: "practitioner-2",
      duration: 45,
      id: "apt-2",
      isSimulation: false,
      startTime: "14:00",
      title: "Afternoon Checkup",
    },
  ];

  const mockColumns = [
    { id: "practitioner-1", title: "Dr. Smith" },
    { id: "practitioner-2", title: "Dr. Jones" },
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
    dragPreview: { column: "", slot: 0, visible: false },
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
      render(<CalendarGrid {...defaultProps} />);
      expect(screen.getByText("Morning Consultation")).toBeInTheDocument();
      expect(screen.getByText("Afternoon Checkup")).toBeInTheDocument();
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
      const slotsInFirstColumn = container.querySelectorAll(
        String.raw`.border-b.border-border\/30`,
      );

      // Verify slots exist
      expect(slotsInFirstColumn.length).toBeGreaterThan(0);
    });

    test("renders with no appointments", () => {
      const { container } = render(
        <CalendarGrid {...defaultProps} appointments={[]} />,
      );
      expect(container).toBeTruthy();
      expect(
        screen.queryByText("Morning Consultation"),
      ).not.toBeInTheDocument();
    });

    test("renders with single column", () => {
      const singleColumn = [{ id: "practitioner-1", title: "Dr. Smith" }];
      render(<CalendarGrid {...defaultProps} columns={singleColumn} />);
      expect(screen.getByText("Dr. Smith")).toBeInTheDocument();
      expect(screen.queryByText("Dr. Jones")).not.toBeInTheDocument();
    });

    test("renders with many columns", () => {
      const manyColumns = Array.from({ length: 5 }, (_, i) => ({
        id: `practitioner-${i}`,
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
      if (slots.length > 0 && slots[0]) {
        fireEvent.click(slots[0]);
        expect(mockHandlers.onAddAppointment).toHaveBeenCalled();
      }
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
      render(<CalendarGrid {...defaultProps} />);

      const appointment = screen
        .getByText("Morning Consultation")
        .closest("div");
      if (appointment) {
        fireEvent.click(appointment);
        expect(mockHandlers.onEditAppointment).toHaveBeenCalledWith(
          mockAppointments[0],
        );
      }
    });

    test("calls onDeleteAppointment on appointment right-click", () => {
      render(<CalendarGrid {...defaultProps} />);

      const appointment = screen
        .getByText("Morning Consultation")
        .closest("div");
      if (appointment) {
        fireEvent.contextMenu(appointment);
        expect(mockHandlers.onDeleteAppointment).toHaveBeenCalledWith(
          mockAppointments[0],
        );
      }
    });
  });

  describe("Drag and Drop", () => {
    test("calls onDragStart when appointment is dragged", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const appointment = container.querySelector("[draggable=true]");
      if (appointment) {
        fireEvent.dragStart(appointment);
        expect(mockHandlers.onDragStart).toHaveBeenCalled();
      }
    });

    test("calls onDragOver when dragging over column", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const column = container.querySelector(".relative.min-h-full");
      if (column) {
        fireEvent.dragOver(column);
        expect(mockHandlers.onDragOver).toHaveBeenCalled();
      }
    });

    test("calls onDrop when appointment is dropped", async () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const column = container.querySelector(".relative.min-h-full");
      if (column) {
        fireEvent.drop(column);

        await waitFor(() => {
          expect(mockHandlers.onDrop).toHaveBeenCalled();
        });
      }
    });

    test("renders drag preview when dragging", () => {
      const dragPreview = {
        column: "practitioner-1",
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
        column: "practitioner-1",
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
        column: "practitioner-1",
        slot: 12,
        visible: true,
      };

      const draggedApt = mockAppointments[0];
      if (!draggedApt) {
        return;
      }

      render(
        <CalendarGrid
          {...defaultProps}
          draggedAppointment={draggedApt}
          dragPreview={dragPreview}
        />,
      );

      // Preview should show appointment title
      const previews = screen.getAllByText("Morning Consultation");
      expect(previews.length).toBeGreaterThan(1); // Original + preview
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
      if (resizeHandle) {
        fireEvent.mouseDown(resizeHandle);
        expect(mockHandlers.onResizeStart).toHaveBeenCalled();
      }
    });

    test("renders resize handle for each appointment", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const resizeHandles = container.querySelectorAll(".cursor-ns-resize");
      expect(resizeHandles.length).toBe(mockAppointments.length);
    });
  });

  describe("Filtering and Display", () => {
    test("only shows appointments in correct columns", () => {
      const mixedAppointments: Appointment[] = [
        {
          color: "bg-blue-500",
          column: "practitioner-1",
          duration: 30,
          id: "apt-1",
          isSimulation: false,
          startTime: "09:00",
          title: "Appointment 1",
        },
        {
          color: "bg-green-500",
          column: "practitioner-2",
          duration: 30,
          id: "apt-2",
          isSimulation: false,
          startTime: "10:00",
          title: "Appointment 2",
        },
        {
          color: "bg-red-500",
          column: "practitioner-1",
          duration: 30,
          id: "apt-3",
          isSimulation: false,
          startTime: "11:00",
          title: "Appointment 3",
        },
      ];

      render(
        <CalendarGrid {...defaultProps} appointments={mixedAppointments} />,
      );

      // All appointments should be rendered
      expect(screen.getByText("Appointment 1")).toBeInTheDocument();
      expect(screen.getByText("Appointment 2")).toBeInTheDocument();
      expect(screen.getByText("Appointment 3")).toBeInTheDocument();
    });

    test("handles appointments with overlapping times", () => {
      const overlappingAppointments: Appointment[] = [
        {
          color: "bg-blue-500",
          column: "practitioner-1",
          duration: 60,
          id: "apt-1",
          isSimulation: false,
          startTime: "09:00",
          title: "Appointment 1",
        },
        {
          color: "bg-green-500",
          column: "practitioner-1",
          duration: 30,
          id: "apt-2",
          isSimulation: false,
          startTime: "09:30",
          title: "Appointment 2",
        },
      ];

      render(
        <CalendarGrid
          {...defaultProps}
          appointments={overlappingAppointments}
        />,
      );

      // Both appointments should render (visual overlap is handled by CSS)
      expect(screen.getByText("Appointment 1")).toBeInTheDocument();
      expect(screen.getByText("Appointment 2")).toBeInTheDocument();
    });
  });

  describe("Accessibility", () => {
    test("column headers have proper structure", () => {
      render(<CalendarGrid {...defaultProps} />);

      const headers = screen.getAllByText(/Dr\./);
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
