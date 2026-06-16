import type React from "react";

import type { CalendarAppointmentView } from "./types";

import { CalendarItemContent } from "./calendar-item-content";

interface CalendarAppointmentProps {
  appointment: CalendarAppointmentView;
  isDragging: boolean;
  isRelatedToSelectedPatient?: boolean | undefined;
  isSelected?: boolean | undefined;
  onDelete: (appointmentId: string) => void;
  onDragEnd: () => void;
  onDragStart: (e: React.DragEvent, appointmentId: string) => void;
  onEdit: (appointmentId: string) => void;
  onResizeStart: (
    e: React.MouseEvent,
    appointmentId: string,
    currentDuration: number,
  ) => void;
  onSelect?: ((appointment: CalendarAppointmentView) => void) | undefined;
  slotDuration: number;
  timeToSlot: (time: string) => number;
}

export function CalendarAppointment({
  appointment,
  isDragging,
  isRelatedToSelectedPatient = false,
  isSelected = false,
  onDelete,
  onDragEnd,
  onDragStart,
  onEdit,
  onResizeStart,
  onSelect,
  slotDuration,
  timeToSlot,
}: CalendarAppointmentProps) {
  const startSlot = timeToSlot(appointment.layout.startTime);
  const height = (appointment.layout.duration / slotDuration) * 16;
  const top = startSlot * 16;
  const slotCount = appointment.layout.duration / slotDuration;
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
      className={`pointer-events-auto absolute left-1 right-1 ${appointment.color} border-0 p-0 text-left text-white text-xs rounded shadow-sm hover:shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background transition-[opacity,box-shadow] z-10 cursor-move ${
        isDragging ? "opacity-0" : "opacity-100"
      } ${borderClass} h-(--calendar-appointment-height) min-h-4 before:absolute before:inset-x-0 before:top-1/2 before:min-h-6 before:-translate-y-1/2 before:content-[''] top-(--calendar-appointment-top)`}
      draggable
      onClick={() => {
        onSelect?.(appointment);
        onEdit(appointment.layout.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onDelete(appointment.layout.id);
      }}
      onDragEnd={onDragEnd}
      onDragStart={(e) => {
        onDragStart(e, appointment.layout.id);
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
      style={
        {
          "--calendar-appointment-height": `${height}px`,
          "--calendar-appointment-top": `${top}px`,
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

      <div
        className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-white/20 flex items-center justify-center"
        onMouseDown={(e) => {
          e.stopPropagation();
          onResizeStart(e, appointment.layout.id, appointment.layout.duration);
        }}
      >
        <div className="w-8 h-0.5 bg-white/60 rounded" />
      </div>
    </button>
  );
}
