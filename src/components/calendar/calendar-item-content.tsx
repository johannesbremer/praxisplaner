export interface CalendarItemContentProps {
  /** Patient name (optional, for appointments). */
  patientName?: string | undefined;
  /** Number of 5-minute slots this item spans. */
  slotCount: number;
  /** Start time string (e.g., "08:00"). */
  startTime: string;
  /** Title or name of the appointment or blocked slot. */
  title: string;
}

/**
 * Shared content component for calendar items (appointments and blocked slots).
 *
 * Handles responsive layout based on available vertical space:
 * - Single line with dot separators for short items (≤10 minutes).
 * - Vertical stacked layout for taller items.
 */
export function CalendarItemContent({
  patientName,
  slotCount,
  startTime,
  title,
}: CalendarItemContentProps) {
  const isCompact = slotCount <= 2; // 10 minutes or less

  // Build content parts for the dot-separated display
  const parts = [startTime, title, patientName].filter(Boolean);

  if (isCompact) {
    // Horizontal layout: time · title · patient (all in one line)
    return (
      <div className="h-full flex flex-row items-center px-1">
        <div className="text-xs truncate min-w-0">
          {parts.map((part, index) => (
            <span key={index}>
              {index > 0 && <span className="opacity-70"> · </span>}
              {index === 1 ? (
                <span className="font-medium">{part}</span>
              ) : (
                <span>{part}</span>
              )}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // Vertical layout for taller items
  return (
    <div className="h-full flex flex-col p-1 pb-2">
      <div className="text-xs">{startTime}</div>
      <div className="text-xs font-medium">{title}</div>
      {patientName && <div className="text-xs truncate">{patientName}</div>}
    </div>
  );
}
