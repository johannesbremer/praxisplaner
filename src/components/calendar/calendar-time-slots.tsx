interface CalendarTimeSlotsProps {
  currentTimeSlot: number;
  slotToTime: (slot: number) => string;
  totalSlots: number;
}

export function CalendarTimeSlots({
  currentTimeSlot,
  slotToTime,
  totalSlots,
}: CalendarTimeSlotsProps) {
  const renderTimeSlots = () => {
    const slots = [];
    for (let i = 0; i < totalSlots; i++) {
      const isHour = i % 12 === 0;
      const isHalfHour = i % 6 === 0 && !isHour;
      const isNextHour = (i + 1) % 12 === 0;
      const nextTime = isNextHour ? slotToTime(i + 1) : null;

      slots.push(
        <div
          className={`h-4 flex items-center ${isHour ? "border-t-2 border-t-border border-b border-b-border/30" : isHalfHour ? "border-t border-t-border/80 border-b border-b-border/30" : "border-b border-b-border/30"}`}
          key={i}
        >
          {nextTime && (
            <span className="text-xs text-muted-foreground w-16 pr-2 text-right">
              {nextTime}
            </span>
          )}
        </div>,
      );
    }
    return slots;
  };

  return (
    <div className="border-r border-border bg-muted/30 sticky left-0 z-10">
      <div className="h-12 border-b border-border bg-card flex items-center px-3 sticky top-0 z-30">
        <span className="text-sm font-medium text-muted-foreground">Zeit</span>
      </div>
      <div className="relative">
        {renderTimeSlots()}
        {currentTimeSlot >= 0 && (
          <div
            className="absolute left-0 right-0 border-t-2 border-red-500 z-30 h-0 top-[var(--calendar-current-time-top)]"
            style={
              {
                "--calendar-current-time-top": `${currentTimeSlot * 16}px`,
              } as React.CSSProperties
            }
          >
            <div className="w-2 h-2 bg-red-500 rounded-full -mt-1 -ml-1" />
          </div>
        )}
      </div>
    </div>
  );
}
