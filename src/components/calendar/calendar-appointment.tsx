import type React from "react";

import type { Appointment } from "./types";

import { CalendarItemContent } from "./calendar-item-content";

interface CalendarAppointmentProps {
  appointment: Appointment;
  isDragging: boolean;
  isRelatedToSelectedPatient?: boolean | undefined;
  isSelected?: boolean | undefined;
  onDelete: (appointment: Appointment) => void;
  onDragEnd: () => void;
  onDragStart: (e: React.DragEvent, appointment: Appointment) => void;
  onEdit: (appointment: Appointment) => void;
  onResizeStart: (
    e: React.MouseEvent,
    appointmentId: string,
    currentDuration: number,
  ) => void;
  onSelect?: ((appointment: Appointment) => void) | undefined;
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
  const startSlot = timeToSlot(appointment.startTime);
  const height = (appointment.duration / slotDuration) * 16;
  const top = startSlot * 16;
  const slotCount = appointment.duration / slotDuration;

  // Determine border styling based on selection state
  const borderClass = isSelected
    ? "ring-2 ring-blue-400 ring-offset-1 ring-offset-white"
    : isRelatedToSelectedPatient
      ? "ring-2 ring-blue-300/70 ring-offset-1 ring-offset-white"
      : "";

  return (
    <div
      className={`absolute left-1 right-1 ${appointment.color} text-white text-xs rounded shadow-sm hover:shadow-md transition-all z-10 cursor-move ${
        isDragging ? "opacity-50" : "opacity-100"
      } ${borderClass} h-(--calendar-appointment-height) min-h-4 top-(--calendar-appointment-top)`}
      draggable
      onClick={() => {
        onSelect?.(appointment);
        onEdit(appointment);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onDelete(appointment);
      }}
      onDragEnd={onDragEnd}
      onDragStart={(e) => {
        onDragStart(e, appointment);
      }}
      style={
        {
          "--calendar-appointment-height": `${height}px`,
          "--calendar-appointment-top": `${top}px`,
        } as React.CSSProperties
      }
    >
      <CalendarItemContent
        appointmentTypeTitle={appointment.appointmentTypeTitle}
        patientName={appointment.patientName}
        slotCount={slotCount}
        startTime={appointment.startTime}
        title={appointment.title}
      />

      <div
        className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-white/20 flex items-center justify-center"
        onMouseDown={(e) => {
          e.stopPropagation();
          onResizeStart(e, appointment.id, appointment.duration);
        }}
      >
        <div className="w-8 h-0.5 bg-white/60 rounded" />
      </div>
    </div>
  );
}
