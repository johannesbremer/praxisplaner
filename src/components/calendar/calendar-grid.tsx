import type React from "react";

import { Plus } from "lucide-react";

import type { Appointment } from "./types";

import { CalendarAppointment } from "./calendar-appointment";
import { CalendarTimeSlots } from "./calendar-time-slots";

interface CalendarGridProps {
  appointments: Appointment[];
  columns: { id: string; title: string }[];
  currentTimeSlot: number;
  draggedAppointment: Appointment | null;
  dragPreview: {
    column: string;
    slot: number;
    visible: boolean;
  };
  onAddAppointment: (column: string, slot: number) => void;
  onDeleteAppointment: (appointment: Appointment) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, column: string) => void;
  onDragStart: (e: React.DragEvent, appointment: Appointment) => void;
  onDrop: (e: React.DragEvent, column: string) => Promise<void>;
  onEditAppointment: (appointment: Appointment) => void;
  onResizeStart: (
    e: React.MouseEvent,
    appointmentId: string,
    currentDuration: number,
  ) => void;
  slotDuration: number;
  slotToTime: (slot: number) => string;
  timeToSlot: (time: string) => number;
  totalSlots: number;
}

export function CalendarGrid({
  appointments,
  columns,
  currentTimeSlot,
  draggedAppointment,
  dragPreview,
  onAddAppointment,
  onDeleteAppointment,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onEditAppointment,
  onResizeStart,
  slotDuration,
  slotToTime,
  timeToSlot,
  totalSlots,
}: CalendarGridProps) {
  const renderAppointments = (column: string) => {
    return appointments
      .filter((apt) => apt.column === column)
      .map((appointment) => {
        const isDragging = draggedAppointment?.id === appointment.id;

        return (
          <CalendarAppointment
            appointment={appointment}
            isDragging={isDragging}
            key={appointment.id}
            onDelete={onDeleteAppointment}
            onDragEnd={onDragEnd}
            onDragStart={onDragStart}
            onEdit={onEditAppointment}
            onResizeStart={onResizeStart}
            slotDuration={slotDuration}
            timeToSlot={timeToSlot}
          />
        );
      });
  };

  const renderDragPreview = (column: string) => {
    if (
      !dragPreview.visible ||
      dragPreview.column !== column ||
      !draggedAppointment
    ) {
      return null;
    }

    const height = (draggedAppointment.duration / slotDuration) * 16;
    const top = dragPreview.slot * 16;

    return (
      <div
        className={`absolute left-1 right-1 ${draggedAppointment.color} opacity-50 border-2 border-white border-dashed rounded z-20 h-[var(--calendar-appointment-height)] min-h-4 top-[var(--calendar-appointment-top)]`}
        style={
          {
            "--calendar-appointment-height": `${height}px`,
            "--calendar-appointment-top": `${top}px`,
          } as React.CSSProperties
        }
      >
        <div className="p-1 text-white text-xs">
          <div className="font-medium truncate">{draggedAppointment.title}</div>
          <div className="text-xs opacity-90">
            {slotToTime(dragPreview.slot)}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className="grid min-h-full"
      style={{
        gridTemplateColumns: `80px repeat(${columns.length}, 1fr)`,
      }}
    >
      {/* Time column */}
      <CalendarTimeSlots
        currentTimeSlot={currentTimeSlot}
        slotToTime={slotToTime}
        totalSlots={totalSlots}
      />

      {/* Calendar columns */}
      {columns.map((column) => (
        <div className="border-r border-border last:border-r-0" key={column.id}>
          <div className="h-12 border-b border-border bg-card flex items-center justify-center sticky top-0 z-30">
            <span className="font-medium">{column.title}</span>
          </div>
          <div
            className="relative min-h-full"
            onDragLeave={() => {
              if (dragPreview.column === column.id) {
                // User left this column while dragging
              }
            }}
            onDragOver={(e) => {
              onDragOver(e, column.id);
            }}
            onDrop={(e) => {
              void onDrop(e, column.id);
            }}
          >
            {Array.from({ length: totalSlots }, (_, i) => (
              <div
                className="h-4 border-b border-border/30 hover:bg-muted/50 cursor-pointer group"
                key={i}
                onClick={() => {
                  onAddAppointment(column.id, i);
                }}
              >
                <div className="opacity-0 group-hover:opacity-100 flex items-center justify-center h-full">
                  <Plus className="h-3 w-3 text-muted-foreground" />
                </div>
              </div>
            ))}

            {currentTimeSlot >= 0 && (
              <div
                className="absolute left-0 right-0 h-0.5 bg-red-500 z-20 pointer-events-none top-[var(--calendar-current-time-top)]"
                style={
                  {
                    "--calendar-current-time-top": `${currentTimeSlot * 16}px`,
                  } as React.CSSProperties
                }
              >
                <div className="absolute -left-1 -top-1 w-2 h-2 bg-red-500 rounded-full" />
              </div>
            )}

            {renderDragPreview(column.id)}
            {renderAppointments(column.id)}
          </div>
        </div>
      ))}
    </div>
  );
}
