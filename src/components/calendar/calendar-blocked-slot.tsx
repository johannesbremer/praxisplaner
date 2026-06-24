import type React from "react";

import type { CalendarColumnId } from "./types";

import { CalendarItemContent } from "./calendar-item-content";

interface BlockedSlot {
  column: CalendarColumnId;
  duration: number;
  id: string;
  isManual: true;
  reason?: string;
  slot: number;
  startSlot: number;
  title?: string;
}

interface CalendarBlockedSlotProps {
  blockedSlot: BlockedSlot;
  canDrag?: boolean | undefined;
  isDragging: boolean;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
  onPointerDragStart?:
    | ((e: React.PointerEvent, id: string) => void)
    | undefined;
  onResizeStart?:
    | ((e: React.MouseEvent, id: string, currentDuration: number) => void)
    | undefined;
  slotCount: number;
  slotToTime: (slot: number) => string;
}

export function CalendarBlockedSlot({
  blockedSlot,
  canDrag = true,
  isDragging,
  onDelete,
  onEdit,
  onPointerDragStart,
  onResizeStart,
  slotCount,
  slotToTime,
}: CalendarBlockedSlotProps) {
  const height = slotCount * 16;
  const top = blockedSlot.slot * 16;
  const blockedSlotTitle = blockedSlot.title || "Gesperrt";

  return (
    <button
      aria-label={`Gesperrter Zeitraum ${blockedSlotTitle}, ${slotToTime(blockedSlot.slot)}. Bearbeiten`}
      className={`pointer-events-auto absolute left-1 right-1 bg-muted-foreground text-background border-0 p-0 text-left text-xs rounded shadow-sm hover:shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background transition-[opacity,box-shadow] z-10 ${canDrag ? "cursor-move" : "cursor-pointer"} ${
        isDragging ? "opacity-0" : "opacity-100"
      } h-(--blocked-height) min-h-4 before:absolute before:inset-x-0 before:top-1/2 before:min-h-6 before:-translate-y-1/2 before:content-[''] top-(--blocked-top)`}
      onClick={() => {
        onEdit(blockedSlot.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onDelete(blockedSlot.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEdit(blockedSlot.id);
        } else if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onDelete(blockedSlot.id);
        }
      }}
      onPointerDown={(e) => {
        if (!canDrag || onPointerDragStart === undefined) {
          return;
        }
        onPointerDragStart(e, blockedSlot.id);
      }}
      style={
        {
          "--blocked-height": `${height}px`,
          "--blocked-top": `${top}px`,
        } as React.CSSProperties
      }
      type="button"
    >
      <CalendarItemContent
        slotCount={slotCount}
        startTime={slotToTime(blockedSlot.slot)}
        title={blockedSlotTitle}
      />

      {onResizeStart && (
        <div
          className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-white/20 flex items-center justify-center"
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeStart(e, blockedSlot.id, blockedSlot.duration);
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
        >
          <div className="w-8 h-0.5 bg-white/60 rounded" />
        </div>
      )}
    </button>
  );
}
