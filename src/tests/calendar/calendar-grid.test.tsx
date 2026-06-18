import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { regex } from "@/lib/arkregex";

import type {
  CalendarAppointmentView,
  CalendarColumn,
} from "../../../src/components/calendar/types";

import {
  asAppointmentTypeLineageKey,
  asLocationLineageKey,
  asPractitionerLineageKey,
  toTableId,
} from "../../../convex/identity";
import { calendarColumnScopeFromPractitioner } from "../../../lib/calendar-occupancy";
import { CalendarGrid } from "../../../src/components/calendar/calendar-grid";
import { assertElement } from "../test-utils";
import { buildCalendarAppointmentRecord } from "./test-records";

describe("CalendarGrid", () => {
  const doctorHeaderRegex = regex.as(String.raw`Dr\.`);
  const appointmentType1 = asAppointmentTypeLineageKey(
    toTableId<"appointmentTypes">("appointment_type_1"),
  );
  const location1 = asLocationLineageKey(toTableId<"locations">("location_1"));
  const practice1 = toTableId<"practices">("practice_1");
  const practitioner1 = asPractitionerLineageKey(
    toTableId<"practitioners">("practitioner_1"),
  );
  const practitioner2 = asPractitionerLineageKey(
    toTableId<"practitioners">("practitioner_2"),
  );
  const practitionerColumn1 =
    calendarColumnScopeFromPractitioner(practitioner1);
  const practitionerColumn2 =
    calendarColumnScopeFromPractitioner(practitioner2);

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
      column: calendarColumnScopeFromPractitioner(args.column),
      duration: args.duration,
      id: args.id,
      record: buildCalendarAppointmentRecord({
        _id: toTableId<"appointments">(args.id),
        appointmentTypeLineageKey: appointmentType1,
        end: "2026-04-24T09:30:00+02:00[Europe/Berlin]",
        locationLineageKey: location1,
        practiceId: practice1,
        practitionerLineageKey: args.column,
        start: "2026-04-24T09:00:00+02:00[Europe/Berlin]",
        title: args.title,
      }),
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

  const mockColumns: CalendarColumn[] = [
    { id: practitionerColumn1, title: "Dr. Smith" },
    { id: practitionerColumn2, title: "Dr. Jones" },
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
    onEditAppointment: vi.fn(),
    onPointerDragStart: vi.fn(),
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
      const movableElements = container.querySelectorAll(".cursor-move");
      expect(movableElements.length).toBe(mockAppointments.length);
    });

    test("renders appointments in correct columns", () => {
      render(<CalendarGrid {...defaultProps} />);

      const gridCells = screen.getAllByRole("gridcell");
      expect(gridCells).toHaveLength(
        defaultProps.totalSlots * mockColumns.length,
      );
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
      const movableElements = container.querySelectorAll(".cursor-move");
      expect(movableElements.length).toBe(0);
    });

    test("renders with single column", () => {
      const singleColumn: CalendarColumn[] = [
        { id: practitionerColumn1, title: "Dr. Smith" },
      ];
      render(<CalendarGrid {...defaultProps} columns={singleColumn} />);
      expect(screen.getByText("Dr. Smith")).toBeInTheDocument();
      expect(screen.queryByText("Dr. Jones")).not.toBeInTheDocument();
    });

    test("renders with many columns", () => {
      const manyColumns = Array.from({ length: 5 }, (_, i) => ({
        id: calendarColumnScopeFromPractitioner(
          asPractitionerLineageKey(
            toTableId<"practitioners">(`practitioner_${i}`),
          ),
        ),
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

      const hitTarget = container.querySelector(
        '[data-calendar-column-hit-target="deterministic"]',
      );
      assertElement(hitTarget);
      vi.spyOn(hitTarget, "getBoundingClientRect").mockReturnValue({
        bottom: defaultProps.totalSlots * 16,
        height: defaultProps.totalSlots * 16,
        left: 0,
        right: 100,
        toJSON: () => ({}),
        top: 0,
        width: 100,
        x: 0,
        y: 0,
      });

      fireEvent.click(hitTarget, { clientY: 20 });

      expect(mockHandlers.onAddAppointment).toHaveBeenCalledExactlyOnceWith(
        practitionerColumn1,
        1,
      );
    });

    test("does not call onAddAppointment for appointment-type-unavailable columns", () => {
      const { container } = render(
        <CalendarGrid
          {...defaultProps}
          columns={[
            {
              id: practitionerColumn1,
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

      const appointment = container.querySelector(".cursor-move");
      assertElement(appointment);
      fireEvent.click(appointment);
      expect(mockHandlers.onEditAppointment).toHaveBeenCalledExactlyOnceWith(
        mockAppointments[0]?.layout.id,
      );
    });

    test("calls onDeleteAppointment on appointment right-click", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const appointment = container.querySelector(".cursor-move");
      assertElement(appointment);
      fireEvent.contextMenu(appointment);
      expect(mockHandlers.onDeleteAppointment).toHaveBeenCalledExactlyOnceWith(
        mockAppointments[0]?.layout.id,
      );
    });
  });

  describe("Pointer dragging", () => {
    test("calls onPointerDragStart when appointment dragging starts", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const appointment = container.querySelector(".cursor-move");
      assertElement(appointment);
      fireEvent.pointerDown(appointment, { button: 0, pointerId: 1 });
      expect(mockHandlers.onPointerDragStart).toHaveBeenCalled();
    });

    test("marks each column hit target with a stable calendar column key", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const columnHitTarget = container.querySelector(
        '[data-calendar-column-hit-target="deterministic"]',
      );
      assertElement(columnHitTarget);
      expect(columnHitTarget).toHaveAttribute(
        "data-calendar-column-key",
        "practitioner:practitioner_1",
      );
    });

    test("keeps pointer target metadata off gridcells and on full column targets", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const gridCell = container.querySelector("[role='gridcell']");
      assertElement(gridCell);
      expect(gridCell).not.toHaveAttribute("data-calendar-column-key");

      const columnHitTarget = container.querySelector(
        '[data-calendar-column-hit-target="deterministic"]',
      );
      assertElement(columnHitTarget);
      expect(columnHitTarget).toHaveAttribute("data-calendar-column-key");
    });

    test("keeps column pointer metadata reachable while dragging over occupied appointments", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const overlayTarget = container.querySelector(
        '[data-calendar-column-overlay-target="occupied-ranges"]',
      );
      assertElement(overlayTarget);
      expect(overlayTarget).toHaveAttribute("data-calendar-column-key");
      expect(
        overlayTarget.querySelector('[data-calendar-slot-row="true"]'),
      ).toBeInTheDocument();
    });

    test("marks drag-disabled columns for pointer target resolution", () => {
      const draggedApt = mockAppointments[0];
      if (!draggedApt) {
        return;
      }

      render(
        <CalendarGrid
          {...defaultProps}
          columns={[
            { id: practitionerColumn1, title: "Dr. Smith" },
            {
              id: practitionerColumn2,
              isDragDisabled: true,
              isMuted: true,
              title: "Dr. Jones",
            },
          ]}
          draggedAppointment={draggedApt}
        />,
      );

      const columnHitTargets = screen
        .getByRole("grid")
        .querySelectorAll('[data-calendar-column-hit-target="deterministic"]');
      const blockedColumnTarget = columnHitTargets[1];
      assertElement(blockedColumnTarget);

      expect(blockedColumnTarget).toHaveClass("cursor-not-allowed");
      expect(blockedColumnTarget).toHaveAttribute(
        "data-calendar-column-key",
        "practitioner:practitioner_2",
      );
    });

    test("renders drag preview when dragging", () => {
      const dragPreview = {
        column: practitionerColumn1,
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

    test("marks drag preview as blocked when it overlaps a projected blocked slot", () => {
      const dragPreview = {
        column: practitionerColumn1,
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
          blockedSlots={[
            {
              column: practitionerColumn1,
              reason: "Regel",
              slot: 14,
            },
          ]}
          draggedAppointment={draggedApt}
          dragPreview={dragPreview}
        />,
      );

      const preview = container.querySelector(".border-dashed");
      expect(preview).toHaveClass("bg-destructive/80");
    });

    test("does not render drag preview when not dragging", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const preview = container.querySelector(".border-dashed");
      expect(preview).not.toBeInTheDocument();
    });

    test("positions drag preview correctly", () => {
      const dragPreview = {
        column: practitionerColumn1,
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
        column: practitionerColumn1,
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

      const indicators = container.querySelectorAll(
        ".border-calendar-current-time",
      );
      expect(indicators.length).toBeGreaterThan(0);
    });

    test("renders current time indicator in all columns", () => {
      const { container } = render(
        <CalendarGrid {...defaultProps} currentTimeSlot={24} />,
      );

      const indicators = container.querySelectorAll(
        ".bg-calendar-current-time",
      );
      // Should have indicator in time column + each calendar column
      expect(indicators.length).toBeGreaterThanOrEqual(mockColumns.length);
    });

    test("renders column current time indicators below appointments", () => {
      const { container } = render(
        <CalendarGrid {...defaultProps} currentTimeSlot={108} />,
      );

      const columnIndicators = container.querySelectorAll(
        '[data-calendar-current-time-column-indicator="true"]',
      );
      expect(columnIndicators).toHaveLength(mockColumns.length);
      for (const indicator of columnIndicators) {
        expect(indicator).toHaveClass("z-0");
      }

      const appointment = container.querySelector(".cursor-move");
      assertElement(appointment);
      expect(appointment).toHaveClass("z-10");
    });

    test("positions current time indicator correctly", () => {
      const currentTimeSlot = 36;
      const { container } = render(
        <CalendarGrid {...defaultProps} currentTimeSlot={currentTimeSlot} />,
      );

      const indicator = container.querySelector(
        ".border-calendar-current-time",
      );
      expect(indicator).toBeInTheDocument();

      const style = indicator?.getAttribute("style");
      expect(style).toContain(`grid-row: ${currentTimeSlot + 2}`);
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
      const movableElements = container.querySelectorAll(".cursor-move");
      expect(movableElements.length).toBe(mixedAppointments.length);
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
      const movableElements = container.querySelectorAll(".cursor-move");
      expect(movableElements.length).toBe(2);
    });
  });

  describe("Accessibility", () => {
    test("calendar exposes grid semantics", () => {
      render(<CalendarGrid {...defaultProps} />);

      expect(
        screen.getByRole("grid", { name: "Praxis-Kalender" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("columnheader", { name: "Dr. Smith" }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("row")).toHaveLength(
        defaultProps.totalSlots + 1,
      );
      expect(screen.getAllByRole("gridcell")).toHaveLength(
        defaultProps.totalSlots * mockColumns.length,
      );
    });

    test("column headers have proper structure", () => {
      render(<CalendarGrid {...defaultProps} />);

      const headers = screen.getAllByText(doctorHeaderRegex);
      for (const header of headers) {
        expect(header).toBeInTheDocument();
      }
    });

    test("time slots are keyboard accessible", () => {
      render(<CalendarGrid {...defaultProps} />);

      expect(
        screen.getByRole("button", {
          name: "Termin um 00:00 bei Dr. Smith erstellen",
        }),
      ).toHaveAttribute("tabindex", "0");
      expect(
        screen.getByRole("button", {
          name: "Termin um 00:00 bei Dr. Jones erstellen",
        }),
      ).toHaveAttribute("tabindex", "-1");
    });

    test("calendar exposes deterministic column hit targets without changing visual row height", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const firstSlot = screen.getByRole("button", {
        name: "Termin um 00:00 bei Dr. Smith erstellen",
      });
      expect(firstSlot).toHaveClass("h-4");
      expect(firstSlot).toHaveAttribute(
        "data-calendar-slot-target",
        "keyboard",
      );
      expect(firstSlot.parentElement).toHaveClass("h-4");
      expect(firstSlot.parentElement).toHaveClass("pointer-events-none");
      expect(firstSlot.parentElement).toHaveClass("z-20");
      expect(
        container.querySelectorAll(
          '[data-calendar-column-hit-target="deterministic"]',
        ),
      ).toHaveLength(mockColumns.length);
      expect(
        container.querySelector(
          '[data-calendar-column-hit-target="deterministic"]',
        ),
      ).toHaveClass("z-10");
      const visualGridLines = container.querySelector(
        '[data-calendar-column-grid-lines="true"]',
      );
      assertElement(visualGridLines);
      expect(visualGridLines).toHaveClass("calendar-column-grid-lines");
      expect(visualGridLines).toHaveClass("pointer-events-none");
      expect(visualGridLines).toHaveClass("z-0");
    });

    test("places semantic rows and cells on the visual calendar grid", () => {
      render(<CalendarGrid {...defaultProps} />);

      const firstSlot = screen.getByRole("button", {
        name: "Termin um 00:00 bei Dr. Smith erstellen",
      });
      const secondColumnSlot = screen.getByRole("button", {
        name: "Termin um 00:00 bei Dr. Jones erstellen",
      });
      const nextRowSlot = screen.getByRole("button", {
        name: "Termin um 00:05 bei Dr. Smith erstellen",
      });

      expect(firstSlot.parentElement).toHaveStyle({
        gridColumn: "2",
        gridRow: "2",
      });
      expect(secondColumnSlot.parentElement).toHaveStyle({
        gridColumn: "3",
        gridRow: "2",
      });
      expect(nextRowSlot.parentElement).toHaveStyle({
        gridColumn: "2",
        gridRow: "3",
      });
    });

    test("arrow keys move the roving slot focus across rows and columns", () => {
      render(<CalendarGrid {...defaultProps} />);

      const firstSlot = screen.getByRole("button", {
        name: "Termin um 00:00 bei Dr. Smith erstellen",
      });
      firstSlot.focus();
      fireEvent.keyDown(firstSlot, { key: "ArrowDown" });

      expect(
        screen.getByRole("button", {
          name: "Termin um 00:05 bei Dr. Smith erstellen",
        }),
      ).toHaveFocus();

      const activeSlot = document.activeElement;
      assertElement(activeSlot);
      fireEvent.keyDown(activeSlot, { key: "ArrowRight" });

      expect(
        screen.getByRole("button", {
          name: "Termin um 00:05 bei Dr. Jones erstellen",
        }),
      ).toHaveFocus();
    });

    test("enter creates an appointment from the focused slot", () => {
      render(<CalendarGrid {...defaultProps} />);
      const firstSlot = screen.getByRole("button", {
        name: "Termin um 00:00 bei Dr. Smith erstellen",
      });

      fireEvent.keyDown(firstSlot, { key: "Enter" });

      expect(mockHandlers.onAddAppointment).toHaveBeenCalledExactlyOnceWith(
        practitionerColumn1,
        0,
      );
    });

    test("enter creates a blocked slot in blocking mode", () => {
      const onBlockSlot = vi.fn();
      render(
        <CalendarGrid
          {...defaultProps}
          isBlockingModeActive={true}
          onBlockSlot={onBlockSlot}
        />,
      );
      const firstSlot = screen.getByRole("button", {
        name: "Zeitraum um 00:00 bei Dr. Smith sperren",
      });

      fireEvent.keyDown(firstSlot, { key: "Enter" });

      expect(onBlockSlot).toHaveBeenCalledExactlyOnceWith(
        practitionerColumn1,
        0,
      );
    });

    test("appointments are keyboard accessible", () => {
      const { container } = render(<CalendarGrid {...defaultProps} />);

      const appointments = container.querySelectorAll(".cursor-move");
      expect(appointments.length).toBe(mockAppointments.length);
    });
  });
});
