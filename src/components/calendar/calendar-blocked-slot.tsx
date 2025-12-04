import type React from "react";

import { CalendarItemContent } from "./calendar-item-content";

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

interface CalendarBlockedSlotProps {
  blockedSlot: BlockedSlot;
  isDragging: boolean;
  onDelete: (id: string) => void;
  onDragEnd: () => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onEdit: (id: string) => void;
  onResizeStart: (
    e: React.MouseEvent,
    id: string,
    currentDuration: number,
  ) => void;
  slotCount: number;
  slotToTime: (slot: number) => string;
}

export function CalendarBlockedSlot({
  blockedSlot,
  isDragging,
  onDelete,
  onDragEnd,
  onDragStart,
  onEdit,
  onResizeStart,
  slotCount,
  slotToTime,
}: CalendarBlockedSlotProps) {
  const height = slotCount * 16;
  const top = blockedSlot.slot * 16;

  if (!blockedSlot.id) {
    return null;
  }

  return (
    <div
      className={`absolute left-1 right-1 bg-gray-400 text-white text-xs rounded shadow-sm hover:shadow-md transition-all z-10 cursor-move ${
        isDragging ? "opacity-50" : "opacity-100"
      } h-(--blocked-height) min-h-4 top-(--blocked-top)`}
      draggable
      onClick={() => {
        if (blockedSlot.id) {
          onEdit(blockedSlot.id);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (blockedSlot.id) {
          onDelete(blockedSlot.id);
        }
      }}
      onDragEnd={onDragEnd}
      onDragStart={(e) => {
        if (blockedSlot.id) {
          onDragStart(e, blockedSlot.id);
        }
      }}
      style={
        {
          "--blocked-height": `${height}px`,
          "--blocked-top": `${top}px`,
        } as React.CSSProperties
      }
    >
      <CalendarItemContent
        slotCount={slotCount}
        startTime={slotToTime(blockedSlot.slot)}
        title={blockedSlot.title || "Gesperrt"}
      />

      <div
        className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-white/20 flex items-center justify-center"
        onMouseDown={(e) => {
          e.stopPropagation();
          if (blockedSlot.id) {
            onResizeStart(e, blockedSlot.id, blockedSlot.duration || 0);
          }
        }}
      >
        <div className="w-8 h-0.5 bg-white/60 rounded" />
      </div>
    </div>
  );
}
