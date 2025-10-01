import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useState,
} from "react";

import type { Id } from "../../convex/_generated/dataModel";

/**
 * Represents an appointment in the calendar
 */
export interface Appointment {
  color: string;
  column: string; // Resource ID (practitioner ID or "ekg" / "labor")
  convexId?: Id<"appointments">; // Original Convex ID for real appointments
  duration: number; // in minutes
  id: string;
  isSimulation: boolean;
  replacesAppointmentId?: Id<"appointments"> | null;
  resource?: {
    appointmentType?: string;
    isSimulation?: boolean;
    locationId?: Id<"locations">;
    patientId?: Id<"patients">;
    practitionerId?: Id<"practitioners">;
  };
  startTime: string;
  title: string;
}

/**
 * Drag preview state
 */
interface DragPreview {
  column: string;
  slot: number;
  visible: boolean;
}

/**
 * Tracks information about an appointment currently being resized by the user.
 */
interface ResizeState {
  appointmentId: string;
  originalDuration: number;
  startY: number;
}

/**
 * State and methods for managing calendar functionality.
 * Includes appointments, drag/drop state, resize state, and date selection.
 */
export interface CalendarState {
  appointments: Appointment[];
  currentTime: Date;
  draggedAppointment: Appointment | null;
  dragPreview: DragPreview;
  resizing: null | ResizeState;
  selectedDate: Date;
  selectedLocationId: Id<"locations"> | undefined;
  setAppointments: Dispatch<SetStateAction<Appointment[]>>;
  setCurrentTime: Dispatch<SetStateAction<Date>>;
  setDraggedAppointment: Dispatch<SetStateAction<Appointment | null>>;
  setDragPreview: Dispatch<SetStateAction<DragPreview>>;
  setResizing: Dispatch<SetStateAction<null | ResizeState>>;
  setSelectedDate: Dispatch<SetStateAction<Date>>;
  setSelectedLocationId: Dispatch<SetStateAction<Id<"locations"> | undefined>>;

  // Helper methods
  resetDragState: () => void;
  resetResizeState: () => void;
}

/**
 * Props for useCalendarState hook
 */
export interface UseCalendarStateProps {
  initialDate?: Date;
  initialLocationId?: Id<"locations"> | undefined;
}

/**
 * Custom hook for managing calendar state.
 * Extracts state management logic from the main calendar component.
 * @example
 * ```tsx
 * const calendarState = useCalendarState({
 *   initialDate: new Date(),
 *   initialLocationId: locationId,
 * });
 * ```
 */
export function useCalendarState({
  initialDate,
  initialLocationId,
}: UseCalendarStateProps = {}): CalendarState {
  // Core state
  const [selectedDate, setSelectedDate] = useState<Date>(
    initialDate ?? new Date(),
  );
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<
    Id<"locations"> | undefined
  >(initialLocationId);

  // Drag & Drop state
  const [draggedAppointment, setDraggedAppointment] =
    useState<Appointment | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview>({
    column: "",
    slot: 0,
    visible: false,
  });

  // Resize state
  const [resizing, setResizing] = useState<null | ResizeState>(null);

  // Helper methods
  const resetDragState = useCallback(() => {
    setDraggedAppointment(null);
    setDragPreview({ column: "", slot: 0, visible: false });
  }, []);

  const resetResizeState = useCallback(() => {
    setResizing(null);
  }, []);

  return {
    // State values
    appointments,
    currentTime,
    draggedAppointment,
    dragPreview,
    resizing,
    selectedDate,
    selectedLocationId,

    // Setters
    setAppointments,
    setCurrentTime,
    setDraggedAppointment,
    setDragPreview,
    setResizing,
    setSelectedDate,
    setSelectedLocationId,

    // Helper methods
    resetDragState,
    resetResizeState,
  };
}
