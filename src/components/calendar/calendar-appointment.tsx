import type React from "react";

import { useRef } from "react";

import type { CalendarAppointmentView } from "./types";

import { APPOINTMENT_COLOR_BY_VALUE } from "../../../lib/appointment-colors";
import { CalendarItemContent } from "./calendar-item-content";

const DRAG_CLICK_SUPPRESSION_THRESHOLD_PX = 3;

interface CalendarAppointmentProps {
  appointment: CalendarAppointmentView;
  canDrag?: boolean | undefined;
  isDragging: boolean;
  isRelatedToSelectedPatient?: boolean | undefined;
  isSelected?: boolean | undefined;
  onDelete: (appointmentId: string) => void;
  onEdit: (appointmentId: string) => void;
  onPointerDragStart?:
    | ((e: React.PointerEvent, appointmentId: string) => void)
    | undefined;
  onResizeStart?:
    | ((
        e: React.MouseEvent,
        appointmentId: string,
        currentDuration: number,
      ) => void)
    | undefined;
  onSelect?: ((appointment: CalendarAppointmentView) => void) | undefined;
  slotDuration: number;
  timeToSlot: (time: string) => number;
}

interface PointerDragClickState {
  moved: boolean;
  pointerId: number;
  startClientX: number;
  startClientY: number;
}

export function CalendarAppointment({
  appointment,
  canDrag = true,
  isDragging,
  isRelatedToSelectedPatient = false,
  isSelected = false,
  onDelete,
  onEdit,
  onPointerDragStart,
  onResizeStart,
  onSelect,
  slotDuration,
  timeToSlot,
}: CalendarAppointmentProps) {
  const startSlot = timeToSlot(appointment.layout.startTime);
  const height = (appointment.layout.duration / slotDuration) * 16;
  const top = startSlot * 16;
  const slotCount = appointment.layout.duration / slotDuration;
  const pointerDragClickStateRef = useRef<null | PointerDragClickState>(null);
  const suppressNextClickRef = useRef(false);
  const color = APPOINTMENT_COLOR_BY_VALUE[appointment.color];
  const appointmentLabel = [
    `Termin ${appointment.layout.record.title}`,
    appointment.layout.startTime,
    appointment.patientName,
  ]
    .filter(Boolean)
    .join(", ");

  // Determine border styling based on selection state
  const borderClass = isSelected
    ? "ring-2 ring-selection-ring ring-offset-1 ring-offset-background"
    : isRelatedToSelectedPatient
      ? "ring-2 ring-selection-ring/70 ring-offset-1 ring-offset-background"
      : "";

  return (
    <button
      aria-label={`${appointmentLabel}. Bearbeiten`}
      className={`pointer-events-auto absolute left-1 right-1 border p-0 text-left text-xs rounded shadow-sm hover:shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background transition-[opacity,box-shadow] z-10 ${canDrag ? "cursor-move" : "cursor-pointer"} ${
        isDragging ? "opacity-0" : "opacity-100"
      } ${borderClass} h-(--calendar-appointment-height) min-h-4 before:absolute before:inset-x-0 before:top-1/2 before:min-h-6 before:-translate-y-1/2 before:content-[''] top-(--calendar-appointment-top)`}
      onClick={(e) => {
        if (suppressNextClickRef.current) {
          suppressNextClickRef.current = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onSelect?.(appointment);
        onEdit(appointment.layout.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onDelete(appointment.layout.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.(appointment);
          onEdit(appointment.layout.id);
        } else if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onDelete(appointment.layout.id);
        }
      }}
      onPointerCancel={(e) => {
        if (pointerDragClickStateRef.current?.pointerId === e.pointerId) {
          pointerDragClickStateRef.current = null;
        }
      }}
      onPointerDown={(e) => {
        if (!canDrag || onPointerDragStart === undefined) {
          pointerDragClickStateRef.current = null;
          return;
        }
        pointerDragClickStateRef.current = {
          moved: false,
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startClientY: e.clientY,
        };
        onPointerDragStart(e, appointment.layout.id);
      }}
      onPointerMove={(e) => {
        const state = pointerDragClickStateRef.current;
        if (state?.pointerId !== e.pointerId || state.moved) {
          return;
        }
        const deltaX = e.clientX - state.startClientX;
        const deltaY = e.clientY - state.startClientY;
        if (Math.hypot(deltaX, deltaY) >= DRAG_CLICK_SUPPRESSION_THRESHOLD_PX) {
          state.moved = true;
          suppressNextClickRef.current = true;
        }
      }}
      onPointerUp={(e) => {
        if (pointerDragClickStateRef.current?.pointerId === e.pointerId) {
          pointerDragClickStateRef.current = null;
        }
      }}
      style={
        {
          "--calendar-appointment-height": `${height}px`,
          "--calendar-appointment-top": `${top}px`,
          backgroundColor: color.background,
          borderColor: color.border,
          color: color.foreground,
        } as React.CSSProperties
      }
      type="button"
    >
      <CalendarItemContent
        appointmentTypeTitle={appointment.layout.record.appointmentTypeTitle}
        patientName={appointment.patientName}
        slotCount={slotCount}
        smiley={appointment.layout.record.smiley}
        startTime={appointment.layout.startTime}
        title={appointment.layout.record.title}
      />

      {onResizeStart && (
        <div
          className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-current/20 flex items-center justify-center"
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeStart(
              e,
              appointment.layout.id,
              appointment.layout.duration,
            );
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
        >
          <div className="w-8 h-0.5 rounded bg-current/60" />
        </div>
      )}
    </button>
  );
}
