import type React from "react";

import type { Appointment } from "./types";

interface CalendarAppointmentProps {
  appointment: Appointment;
  isDragging: boolean;
  onDelete: (appointment: Appointment) => void;
  onDragEnd: () => void;
  onDragStart: (e: React.DragEvent, appointment: Appointment) => void;
  onEdit: (appointment: Appointment) => void;
  onResizeStart: (
    e: React.MouseEvent,
    appointmentId: string,
    currentDuration: number,
  ) => void;
  slotDuration: number;
  timeToSlot: (time: string) => number;
}

export function CalendarAppointment({
  appointment,
  isDragging,
  onDelete,
  onDragEnd,
  onDragStart,
  onEdit,
  onResizeStart,
  slotDuration,
  timeToSlot,
}: CalendarAppointmentProps) {
  const startSlot = timeToSlot(appointment.startTime);
  const height = (appointment.duration / slotDuration) * 16;
  const top = startSlot * 16;

  return (
    <div
      className={`absolute left-1 right-1 ${appointment.color} text-white text-xs rounded shadow-sm hover:shadow-md transition-all z-10 cursor-move ${
        isDragging ? "opacity-50" : "opacity-100"
      } h-[var(--calendar-appointment-height)] min-h-4 top-[var(--calendar-appointment-top)]`}
      draggable
      onClick={() => {
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
      <div className="p-1 h-full flex flex-col justify-between pb-2">
        <div>
          <div className="font-medium truncate">{appointment.title}</div>
          <div className="text-xs opacity-90">{appointment.startTime}</div>
        </div>
      </div>

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
