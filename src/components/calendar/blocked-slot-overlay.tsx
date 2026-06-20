import type React from "react";

interface BlockedSlotOverlayProps {
  slot: number;
  slotCount: number;
  variant?: "range" | "start";
}

export function BlockedSlotOverlay({
  slot,
  slotCount,
  variant = "range",
}: BlockedSlotOverlayProps) {
  const height = slotCount * 16; // Height based on number of consecutive slots
  const isStartMarker = variant === "start";
  const renderedHeight = isStartMarker ? Math.max(6, height - 8) : height;
  const top = slot * 16 + (isStartMarker ? 4 : 0);

  return (
    <div
      className={`absolute pointer-events-none z-10 h-(--blocked-slot-height) top-(--blocked-slot-top) ${
        isStartMarker
          ? "left-2 right-2 rounded-sm border border-muted-foreground/25 bg-muted/45"
          : "left-0 right-0 bg-muted/80"
      }`}
      data-calendar-blocked-slot-overlay={variant}
      style={
        {
          "--blocked-slot-height": `${renderedHeight}px`,
          "--blocked-slot-top": `${top}px`,
        } as React.CSSProperties
      }
    />
  );
}
