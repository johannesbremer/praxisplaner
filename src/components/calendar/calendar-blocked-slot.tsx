import type React from "react";

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

  // Calculate number of slots
  const slots = slotCount;
  const isSingleSlot = slots === 1; // 5 minutes
  const isTwoSlotsOrLess = slots <= 2; // 10 minutes or less

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
      <div
        className={`h-full flex ${isTwoSlotsOrLess ? "flex-row items-center gap-1" : "flex-col justify-between pb-2"} ${isSingleSlot ? "px-0.5 py-0" : "p-1"}`}
      >
        <div
          className={
            isTwoSlotsOrLess ? "flex items-center gap-1 flex-1 min-w-0" : ""
          }
        >
          <div
            className={`font-medium truncate ${isTwoSlotsOrLess ? "" : "mb-1"}`}
          >
            {blockedSlot.title || "Gesperrt"}
          </div>
          <div
            className={`text-xs opacity-90 ${isTwoSlotsOrLess ? "whitespace-nowrap" : ""}`}
          >
            {slotToTime(blockedSlot.slot)}
          </div>
        </div>
      </div>

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
