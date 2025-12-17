import type React from "react";

import { Plus } from "lucide-react";

import type { Id } from "../../../convex/_generated/dataModel";
import type { Appointment } from "./types";

import { BlockedSlotOverlay } from "./blocked-slot-overlay";
import { CalendarAppointment } from "./calendar-appointment";
import { CalendarBlockedSlot } from "./calendar-blocked-slot";
import { CalendarTimeSlots } from "./calendar-time-slots";

interface BlockedSlot {
  column: string;
  duration?: number;
  id?: string;
  isManual?: boolean;
  reason?: string;
  slot: number;
  startSlot?: number;
  title?: string;
}

interface CalendarGridProps {
  appointments: Appointment[];
  blockedSlots?: BlockedSlot[];
  columns: { id: string; title: string }[];
  currentTimeSlot: number;
  draggedAppointment: Appointment | null;
  draggedBlockedSlotId?: null | string;
  dragPreview: {
    column: string;
    slot: number;
    visible: boolean;
  };
  isBlockingModeActive?: boolean;
  onAddAppointment: (column: string, slot: number) => void;
  onBlockedSlotDragEnd?: () => void;
  onBlockSlot?: (column: string, slot: number) => void;
  onDeleteAppointment: (appointment: Appointment) => void;
  onDeleteBlockedSlot?: (id: string) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, column: string) => void;
  onDragStart: (e: React.DragEvent, appointment: Appointment) => void;
  onDragStartBlockedSlot?: (e: React.DragEvent, id: string) => void;
  onDrop: (e: React.DragEvent, column: string) => Promise<void>;
  onEditAppointment: (appointment: Appointment) => void;
  onEditBlockedSlot?: (id: string) => void;
  onResizeStart: (
    e: React.MouseEvent,
    appointmentId: string,
    currentDuration: number,
  ) => void;
  onResizeStartBlockedSlot?: (
    e: React.MouseEvent,
    id: string,
    currentDuration: number,
  ) => void;
  onSelectAppointment?: (appointment: Appointment) => void;
  selectedAppointmentId?: Id<"appointments"> | null;
  selectedPatientId?: Id<"patients"> | Id<"temporaryPatients"> | null;
  slotDuration: number;
  slotToTime: (slot: number) => string;
  timeToSlot: (time: string) => number;
  totalSlots: number;
}

export function CalendarGrid({
  appointments,
  blockedSlots = [],
  columns,
  currentTimeSlot,
  draggedAppointment,
  draggedBlockedSlotId = null,
  dragPreview,
  isBlockingModeActive = false,
  onAddAppointment,
  onBlockedSlotDragEnd,
  onBlockSlot,
  onDeleteAppointment,
  onDeleteBlockedSlot,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDragStartBlockedSlot,
  onDrop,
  onEditAppointment,
  onEditBlockedSlot,
  onResizeStart,
  onResizeStartBlockedSlot,
  onSelectAppointment,
  selectedAppointmentId,
  selectedPatientId,
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
        const isSelected = selectedAppointmentId === appointment.convexId;
        // Check if this appointment belongs to the selected patient
        // Supports both regular patients and temporary patients
        const appointmentPatientId =
          appointment.resource?.patientId ??
          appointment.resource?.temporaryPatientId;
        const isRelatedToSelectedPatient =
          selectedPatientId !== null &&
          selectedPatientId !== undefined &&
          appointmentPatientId === selectedPatientId;

        return (
          <CalendarAppointment
            appointment={appointment}
            isDragging={isDragging}
            isRelatedToSelectedPatient={isRelatedToSelectedPatient}
            isSelected={isSelected}
            key={appointment.id}
            onDelete={onDeleteAppointment}
            onDragEnd={onDragEnd}
            onDragStart={onDragStart}
            onEdit={onEditAppointment}
            onResizeStart={onResizeStart}
            onSelect={onSelectAppointment}
            slotDuration={slotDuration}
            timeToSlot={timeToSlot}
          />
        );
      });
  };

  const renderDragPreview = (column: string) => {
    if (!dragPreview.visible || dragPreview.column !== column) {
      return null;
    }

    // Handle appointment drag preview
    if (draggedAppointment) {
      const height = (draggedAppointment.duration / slotDuration) * 16;
      const top = dragPreview.slot * 16;

      return (
        <div
          className={`absolute left-1 right-1 ${draggedAppointment.color} opacity-50 border-2 border-white border-dashed rounded z-20 h-(--calendar-appointment-height) min-h-4 top-(--calendar-appointment-top)`}
          style={
            {
              "--calendar-appointment-height": `${height}px`,
              "--calendar-appointment-top": `${top}px`,
            } as React.CSSProperties
          }
        >
          <div className="p-1 text-white text-xs">
            <div className="text-xs opacity-90">
              {slotToTime(dragPreview.slot)}
            </div>
          </div>
        </div>
      );
    }

    // Handle blocked slot drag preview
    if (draggedBlockedSlotId) {
      const draggedBlockedSlot = blockedSlots.find(
        (slot) => slot.id === draggedBlockedSlotId && slot.isManual,
      );
      if (!draggedBlockedSlot) {
        return null;
      }

      const duration = draggedBlockedSlot.duration ?? 30;
      const height = (duration / slotDuration) * 16;
      const top = dragPreview.slot * 16;

      return (
        <div
          className="absolute left-1 right-1 bg-gray-500 opacity-50 border-2 border-white border-dashed rounded z-20 h-(--calendar-appointment-height) min-h-4 top-(--calendar-appointment-top)"
          style={
            {
              "--calendar-appointment-height": `${height}px`,
              "--calendar-appointment-top": `${top}px`,
            } as React.CSSProperties
          }
        >
          <div className="p-1 text-white text-xs">
            <div className="text-xs opacity-90">
              {slotToTime(dragPreview.slot)}
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  const renderBlockedSlots = (column: string) => {
    // Separate manual blocked slots (from database) from rule-based blocked slots
    const manualBlocked = blockedSlots.filter(
      (slot) => slot.column === column && slot.isManual,
    );
    const ruleBasedBlocked = blockedSlots.filter(
      (slot) => slot.column === column && !slot.isManual,
    );

    // Group consecutive rule-based blocked slots together for overlay rendering
    const groupedSlots: { count: number; start: number }[] = [];
    const sortedSlots = ruleBasedBlocked.toSorted((a, b) => a.slot - b.slot);

    for (const slot of sortedSlots) {
      const lastGroup = groupedSlots[groupedSlots.length - 1];
      if (lastGroup && slot.slot === lastGroup.start + lastGroup.count) {
        // Consecutive slot, extend the group
        lastGroup.count++;
      } else {
        // New group
        groupedSlots.push({ count: 1, start: slot.slot });
      }
    }

    // Render rule-based blocked slots as overlays
    const ruleBasedOverlays = groupedSlots.map((group) => (
      <BlockedSlotOverlay
        key={`blocked-${column}-${group.start}`}
        slot={group.start}
        slotCount={group.count}
      />
    ));

    // Group manual blocked slots by id to render as single appointment-like blocks
    const manualBlocksById = new Map<string, BlockedSlot[]>();
    for (const slot of manualBlocked) {
      if (slot.id) {
        if (!manualBlocksById.has(slot.id)) {
          manualBlocksById.set(slot.id, []);
        }
        const existingSlots = manualBlocksById.get(slot.id);
        if (existingSlots) {
          existingSlots.push(slot);
        }
      }
    }

    // Render manual blocked slots as appointment-like components
    const manualBlockComponents = [...manualBlocksById.entries()].map(
      ([id, slots]) => {
        const firstSlot = slots[0];
        if (!firstSlot) {
          return null;
        }

        const isDragging = draggedBlockedSlotId === id;

        return (
          <CalendarBlockedSlot
            blockedSlot={firstSlot}
            isDragging={isDragging}
            key={`manual-blocked-${id}`}
            onDelete={(blockId) => {
              if (onDeleteBlockedSlot) {
                onDeleteBlockedSlot(blockId);
              }
            }}
            onDragEnd={() => {
              if (onBlockedSlotDragEnd) {
                onBlockedSlotDragEnd();
              }
            }}
            onDragStart={(e, blockId) => {
              if (onDragStartBlockedSlot) {
                onDragStartBlockedSlot(e, blockId);
              }
            }}
            onEdit={(blockId) => {
              if (onEditBlockedSlot) {
                onEditBlockedSlot(blockId);
              }
            }}
            onResizeStart={(e, blockId, duration) => {
              if (onResizeStartBlockedSlot) {
                onResizeStartBlockedSlot(e, blockId, duration);
              }
            }}
            slotCount={slots.length}
            slotToTime={slotToTime}
          />
        );
      },
    );

    return (
      <>
        {ruleBasedOverlays}
        {manualBlockComponents}
      </>
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
            {Array.from({ length: totalSlots }, (_, i) => {
              const isHour = i % 12 === 0;
              const isHalfHour = i % 6 === 0 && !isHour;
              return (
                <div
                  className={`h-4 hover:bg-muted/50 cursor-pointer group ${isHour ? "border-t-2 border-t-border border-b border-b-border/30" : isHalfHour ? "border-t border-t-border/80 border-b border-b-border/30" : "border-b border-b-border/30"}`}
                  key={i}
                  onClick={() => {
                    if (isBlockingModeActive && onBlockSlot) {
                      onBlockSlot(column.id, i);
                    } else {
                      onAddAppointment(column.id, i);
                    }
                  }}
                >
                  <div className="opacity-0 group-hover:opacity-100 flex items-center justify-center h-full">
                    <Plus className="h-3 w-3 text-muted-foreground" />
                  </div>
                </div>
              );
            })}

            {currentTimeSlot >= 0 && (
              <div
                className="absolute left-0 right-0 h-0.5 bg-red-500 z-20 pointer-events-none top-(--calendar-current-time-top)"
                style={
                  {
                    "--calendar-current-time-top": `${currentTimeSlot * 16}px`,
                  } as React.CSSProperties
                }
              >
                <div className="absolute -left-1 -top-1 w-2 h-2 bg-red-500 rounded-full" />
              </div>
            )}

            {renderBlockedSlots(column.id)}
            {renderDragPreview(column.id)}
            {renderAppointments(column.id)}
          </div>
        </div>
      ))}
    </div>
  );
}
