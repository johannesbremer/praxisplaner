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
      const time = slotToTime(i);
      const isHour = i % 12 === 0;

      slots.push(
        <div
          className={`border-b border-border/30 ${isHour ? "border-border" : ""}`}
          key={i}
        >
          <div className="h-4 flex items-center">
            {isHour && (
              <span className="text-xs text-muted-foreground w-16 pr-2 text-right">
                {time}
              </span>
            )}
          </div>
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
