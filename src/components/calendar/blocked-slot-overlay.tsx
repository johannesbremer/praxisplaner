import type React from "react";

interface BlockedSlotOverlayProps {
  slot: number;
  slotCount: number;
}

export function BlockedSlotOverlay({
  slot,
  slotCount,
}: BlockedSlotOverlayProps) {
  const height = slotCount * 16; // Height based on number of consecutive slots
  const top = slot * 16;

  return (
    <div
      className="absolute left-1 right-1 bg-muted/60 pointer-events-none z-10 h-(--blocked-slot-height) top-(--blocked-slot-top)"
      style={
        {
          "--blocked-slot-height": `${height}px`,
          "--blocked-slot-top": `${top}px`,
        } as React.CSSProperties
      }
    />
  );
}
