export interface CalendarItemContentProps {
  /** Appointment type title (optional, for appointments). */
  appointmentTypeTitle?: string | undefined;
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
 * - Single line with dot separators for very short items (≤10 minutes).
 * - Two lines with dot separators for short items (≤20 minutes).
 * - Vertical stacked layout for taller items.
 */
export function CalendarItemContent({
  appointmentTypeTitle,
  patientName,
  slotCount,
  startTime,
  title,
}: CalendarItemContentProps) {
  const isVeryCompact = slotCount <= 2; // 10 minutes or less
  const isCompact = slotCount <= 4; // 20 minutes or less

  // Build content parts for the dot-separated display
  const line1Parts = [startTime, title].filter(Boolean);
  const line2Parts = [appointmentTypeTitle, patientName].filter(Boolean);

  if (isVeryCompact) {
    // Single line layout: time · title · type · patient (all in one line)
    const allParts = [...line1Parts, ...line2Parts];
    return (
      <div className="h-full flex flex-row items-center px-1">
        <div className="text-xs truncate min-w-0">
          {allParts.map((part, index) => (
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

  if (isCompact) {
    // Two line layout: time · title on line 1, type · patient on line 2
    return (
      <div className="h-full flex flex-col justify-center px-1">
        <div className="text-xs truncate min-w-0">
          {line1Parts.map((part, index) => (
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
        {line2Parts.length > 0 && (
          <div className="text-xs truncate min-w-0">
            {line2Parts.map((part, index) => (
              <span key={index}>
                {index > 0 && <span className="opacity-70"> · </span>}
                <span>{part}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Vertical layout for taller items
  return (
    <div className="h-full flex flex-col p-1 pb-2">
      <div className="text-xs">{startTime}</div>
      <div className="text-xs font-medium">{title}</div>
      {appointmentTypeTitle && (
        <div className="text-xs">{appointmentTypeTitle}</div>
      )}
      {patientName && <div className="text-xs">{patientName}</div>}
    </div>
  );
}
