import type React from "react";

import { Plus } from "lucide-react";
import { useState } from "react";

import type { Id } from "../../../convex/_generated/dataModel";
import type {
  CalendarAppointmentView,
  CalendarColumn,
  CalendarColumnId,
} from "./types";

import {
  calendarColumnScopeKey,
  sameCalendarColumnScope,
} from "../../../lib/calendar-occupancy";
import { BlockedSlotOverlay } from "./blocked-slot-overlay";
import { CalendarAppointment } from "./calendar-appointment";
import { CalendarBlockedSlot } from "./calendar-blocked-slot";

type BlockedSlot =
  | {
      column: CalendarColumnId;
      duration: number;
      id: string;
      isManual: true;
      reason?: string;
      slot: number;
      startSlot: number;
      title?: string;
    }
  | {
      column: CalendarColumnId;
      id?: undefined;
      isManual?: false | undefined;
      reason?: string;
      slot: number;
      title?: string;
    };
interface CalendarGridProps {
  appointments: CalendarAppointmentView[];
  blockedSlots?: BlockedSlot[];
  columns: CalendarColumn[];
  currentTimeSlot: number;
  draggedAppointment: CalendarAppointmentView | null;
  draggedBlockedSlotId?: null | string;
  dragPreview: {
    column: CalendarColumnId | null;
    slot: number;
    visible: boolean;
  };
  isBlockingModeActive?: boolean;
  onAddAppointment: (column: CalendarColumnId, slot: number) => void;
  onBlockedSlotDragEnd?: () => void;
  onBlockSlot?: (column: CalendarColumnId, slot: number) => void;
  onDeleteAppointment: (appointmentId: string) => void;
  onDeleteBlockedSlot?: (id: string) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, column: CalendarColumnId) => void;
  onDragStart: (e: React.DragEvent, appointmentId: string) => void;
  onDragStartBlockedSlot?: (e: React.DragEvent, id: string) => void;
  onDrop: (e: React.DragEvent, column: CalendarColumnId) => Promise<void>;
  onEditAppointment: (appointmentId: string) => void;
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
  onSelectAppointment?: (appointment: CalendarAppointmentView) => void;
  selectedAppointmentId?: Id<"appointments"> | null;
  selectedPatientId?: Id<"patients"> | null;
  selectedSeriesId?: null | string;
  selectedUserId?: Id<"users"> | null;
  slotDuration: number;
  slotToTime: (slot: number) => string;
  timeToSlot: (time: string) => number;
  totalSlots: number;
}

interface FocusedCalendarSlot {
  columnIndex: number;
  slot: number;
}

type ManualBlockedSlot = Extract<BlockedSlot, { isManual: true }>;

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
  selectedSeriesId,
  selectedUserId,
  slotDuration,
  slotToTime,
  timeToSlot,
  totalSlots,
}: CalendarGridProps) {
  const [focusedSlot, setFocusedSlot] = useState<FocusedCalendarSlot>({
    columnIndex: 0,
    slot: 0,
  });
  const isColumnInteractionDisabled = (column: CalendarColumn) =>
    column.isUnavailable === true ||
    column.isAppointmentTypeUnavailable === true ||
    (draggedAppointment !== null && column.isDragDisabled === true);

  const renderAppointments = (column: CalendarColumnId) => {
    return appointments
      .filter((apt) => sameCalendarColumnScope(apt.layout.column, column))
      .map((appointment) => {
        const isDragging =
          draggedAppointment?.layout.id === appointment.layout.id;
        const isSelected =
          selectedAppointmentId === appointment.layout.record._id ||
          (selectedSeriesId !== null &&
            selectedSeriesId !== undefined &&
            appointment.layout.record.seriesId === selectedSeriesId);
        // Check if this appointment belongs to the selected patient
        const isRelatedToSelectedPatient =
          (selectedPatientId !== null &&
            selectedPatientId !== undefined &&
            appointment.layout.record.patientId === selectedPatientId) ||
          (selectedUserId !== null &&
            selectedUserId !== undefined &&
            appointment.layout.record.userId === selectedUserId);

        return (
          <CalendarAppointment
            appointment={appointment}
            isDragging={isDragging}
            isRelatedToSelectedPatient={isRelatedToSelectedPatient}
            isSelected={isSelected}
            key={appointment.layout.id}
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

  const renderDragPreview = (column: CalendarColumnId) => {
    if (
      !dragPreview.visible ||
      dragPreview.column === null ||
      !sameCalendarColumnScope(dragPreview.column, column)
    ) {
      return null;
    }

    // Handle appointment drag preview
    if (draggedAppointment) {
      const height = (draggedAppointment.layout.duration / slotDuration) * 16;
      const top = dragPreview.slot * 16;

      return (
        <div
          className={`absolute left-1 right-1 ${draggedAppointment.color} opacity-50 border-2 border-background border-dashed rounded z-20 h-(--calendar-appointment-height) min-h-4 top-(--calendar-appointment-top)`}
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
      const draggedBlockedSlot = blockedSlots
        .filter(isManualBlockedSlot)
        .find((slot) => slot.id === draggedBlockedSlotId);
      if (!draggedBlockedSlot) {
        return null;
      }

      const height = (draggedBlockedSlot.duration / slotDuration) * 16;
      const top = dragPreview.slot * 16;

      return (
        <div
          className="absolute left-1 right-1 bg-muted-foreground opacity-50 border-2 border-background border-dashed rounded z-20 h-(--calendar-appointment-height) min-h-4 top-(--calendar-appointment-top)"
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

  const renderBlockedSlots = (column: CalendarColumnId) => {
    // Separate manual blocked slots (from database) from rule-based blocked slots
    const manualBlocked = blockedSlots.filter(
      (slot): slot is ManualBlockedSlot =>
        sameCalendarColumnScope(slot.column, column) &&
        isManualBlockedSlot(slot),
    );
    const ruleBasedBlocked = blockedSlots.filter(
      (slot) => sameCalendarColumnScope(slot.column, column) && !slot.isManual,
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
        key={`blocked-${calendarColumnScopeKey(column)}-${group.start}`}
        slot={group.start}
        slotCount={group.count}
      />
    ));

    // Group manual blocked slots by id to render as single appointment-like blocks
    const manualBlocksById = new Map<string, ManualBlockedSlot[]>();
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

  const moveFocusedSlot = (
    currentColumnIndex: number,
    currentSlot: number,
    columnDelta: number,
    slotDelta: number,
  ) => {
    const nextColumnIndex = Math.min(
      Math.max(currentColumnIndex + columnDelta, 0),
      columns.length - 1,
    );
    const nextSlot = Math.min(
      Math.max(currentSlot + slotDelta, 0),
      totalSlots - 1,
    );
    setFocusedSlot({ columnIndex: nextColumnIndex, slot: nextSlot });
    const focusNextSlot = () => {
      document
        .querySelector<HTMLButtonElement>(
          `[data-calendar-slot-button="${CSS.escape(String(nextColumnIndex))}:${CSS.escape(String(nextSlot))}"]`,
        )
        ?.focus();
    };
    focusNextSlot();
  };

  const handleSlotKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    column: CalendarColumn,
    columnIndex: number,
    slot: number,
    isInteractionDisabled: boolean,
  ) => {
    switch (e.key) {
      case " ":
      case "Enter": {
        e.preventDefault();
        if (isInteractionDisabled) {
          return;
        }
        if (isBlockingModeActive && onBlockSlot) {
          onBlockSlot(column.id, slot);
        } else {
          onAddAppointment(column.id, slot);
        }
        break;
      }
      case "ArrowDown": {
        e.preventDefault();
        moveFocusedSlot(columnIndex, slot, 0, 1);
        break;
      }
      case "ArrowLeft": {
        e.preventDefault();
        moveFocusedSlot(columnIndex, slot, -1, 0);
        break;
      }
      case "ArrowRight": {
        e.preventDefault();
        moveFocusedSlot(columnIndex, slot, 1, 0);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        moveFocusedSlot(columnIndex, slot, 0, -1);
        break;
      }
      case "End": {
        e.preventDefault();
        moveFocusedSlot(columnIndex, slot, 0, totalSlots - 1 - slot);
        break;
      }
      case "Home": {
        e.preventDefault();
        moveFocusedSlot(columnIndex, slot, 0, -slot);
        break;
      }
    }
  };

  const resolvePointerSlot = (
    element: HTMLElement,
    clientY: number,
  ): number => {
    const rect = element.getBoundingClientRect();
    const slotHeight = rect.height / totalSlots;
    if (slotHeight <= 0) {
      return 0;
    }

    return Math.min(
      Math.max(Math.floor((clientY - rect.top) / slotHeight), 0),
      totalSlots - 1,
    );
  };

  const handleColumnPointerClick = (
    e: React.MouseEvent<HTMLDivElement>,
    column: CalendarColumn,
  ) => {
    if (isColumnInteractionDisabled(column)) {
      return;
    }

    const slot = resolvePointerSlot(e.currentTarget, e.clientY);
    if (isBlockingModeActive && onBlockSlot) {
      onBlockSlot(column.id, slot);
    } else {
      onAddAppointment(column.id, slot);
    }
  };

  return (
    <div
      aria-label="Praxis-Kalender"
      className="grid min-h-full"
      role="grid"
      style={{
        gridTemplateColumns: `80px repeat(${columns.length}, 1fr)`,
        gridTemplateRows: `48px repeat(${totalSlots}, 16px)`,
      }}
    >
      <div className="contents" role="row">
        <div
          className="sticky left-0 top-0 z-40 flex h-12 items-center border-r border-b border-border bg-card px-3 text-sm font-medium text-muted-foreground"
          role="columnheader"
        >
          Zeit
        </div>
        {columns.map((column) => (
          <div
            className={`sticky top-0 z-30 flex h-12 items-center justify-center border-r border-b border-border bg-card last:border-r-0 ${column.isMuted ? "bg-muted/90 text-muted-foreground" : ""}`}
            key={calendarColumnScopeKey(column.id)}
            role="columnheader"
          >
            <span className="font-medium">{column.title}</span>
          </div>
        ))}
      </div>

      {Array.from({ length: totalSlots }, (_, slot) => {
        const isHour = slot % 12 === 0;
        const isHalfHour = slot % 6 === 0 && !isHour;
        const hourTime = isHour ? slotToTime(slot) : null;
        const slotBorderClass = isHour
          ? "border-t-2 border-t-border"
          : isHalfHour
            ? "border-t border-t-border/80"
            : "border-t-0";

        return (
          <div className="contents" key={slot} role="row">
            <div
              className={`sticky left-0 z-10 flex h-4 items-center border-r border-b border-b-border/30 bg-muted/30 ${slotBorderClass}`}
              role="rowheader"
              style={{
                gridColumn: 1,
                gridRow: slot + 2,
              }}
            >
              {hourTime && (
                <span className="w-16 pr-2 text-right text-xs text-muted-foreground">
                  {hourTime}
                </span>
              )}
            </div>
            {columns.map((column, columnIndex) => {
              const isInteractionDisabled = isColumnInteractionDisabled(column);
              const isFocusedSlot =
                focusedSlot.columnIndex === columnIndex &&
                focusedSlot.slot === slot;
              const actionLabel =
                isBlockingModeActive && onBlockSlot
                  ? `Zeitraum um ${slotToTime(slot)} bei ${column.title} sperren`
                  : `Termin um ${slotToTime(slot)} bei ${column.title} erstellen`;

              return (
                <div
                  className={`pointer-events-none relative z-20 h-4 border-r border-b border-b-border/30 last:border-r-0 ${slotBorderClass} ${column.isMuted ? "bg-muted/40 opacity-60 grayscale-[0.35]" : ""}`}
                  key={`${calendarColumnScopeKey(column.id)}-${slot}`}
                  role="gridcell"
                  style={{
                    gridColumn: columnIndex + 2,
                    gridRow: slot + 2,
                  }}
                >
                  <button
                    aria-disabled={isInteractionDisabled}
                    aria-label={actionLabel}
                    className={`pointer-events-none absolute inset-0 z-10 h-4 group bg-transparent p-0 text-left focus-visible:relative focus-visible:z-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 before:absolute before:inset-x-0 before:top-1/2 before:min-h-6 before:-translate-y-1/2 before:content-[''] ${isInteractionDisabled ? "cursor-not-allowed" : ""}`}
                    data-calendar-slot-button={`${columnIndex}:${slot}`}
                    data-calendar-slot-row="true"
                    data-calendar-slot-target="keyboard"
                    onClick={() => {
                      if (isInteractionDisabled) {
                        return;
                      }
                      if (isBlockingModeActive && onBlockSlot) {
                        onBlockSlot(column.id, slot);
                      } else {
                        onAddAppointment(column.id, slot);
                      }
                    }}
                    onFocus={() => {
                      setFocusedSlot({ columnIndex, slot });
                    }}
                    onKeyDown={(e) => {
                      handleSlotKeyDown(
                        e,
                        column,
                        columnIndex,
                        slot,
                        isInteractionDisabled,
                      );
                    }}
                    tabIndex={isFocusedSlot && !isInteractionDisabled ? 0 : -1}
                    type="button"
                  >
                    <div
                      className={`flex h-full items-center justify-center ${isInteractionDisabled ? "opacity-0" : "opacity-0 group-hover:opacity-100"}`}
                    >
                      <Plus className="h-3 w-3 text-muted-foreground" />
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}

      {columns.map((column, columnIndex) => {
        const isInteractionDisabled = isColumnInteractionDisabled(column);
        return (
          <div
            aria-hidden="true"
            className={`relative z-10 ${isInteractionDisabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-muted/20"}`}
            data-calendar-column-hit-target="deterministic"
            key={`hit-target-${calendarColumnScopeKey(column.id)}`}
            onClick={(e) => {
              handleColumnPointerClick(e, column);
            }}
            onDragLeave={() => {
              if (
                dragPreview.column !== null &&
                sameCalendarColumnScope(dragPreview.column, column.id)
              ) {
                // User left this column while dragging.
              }
            }}
            onDragOver={(e) => {
              if (isInteractionDisabled) {
                return;
              }
              onDragOver(e, column.id);
            }}
            onDrop={(e) => {
              if (isInteractionDisabled) {
                return;
              }
              void onDrop(e, column.id);
            }}
            role="presentation"
            style={{
              gridColumn: columnIndex + 2,
              gridRow: `2 / span ${totalSlots}`,
            }}
          >
            <div
              aria-hidden="true"
              className="calendar-column-grid-lines pointer-events-none absolute inset-0 z-0"
              data-calendar-column-grid-lines="true"
            />
            <span
              className="pointer-events-none absolute left-0 top-0 h-4 w-px"
              data-calendar-slot-row="true"
            />
          </div>
        );
      })}

      {currentTimeSlot >= 0 && (
        <div
          className="pointer-events-none sticky left-0 z-30 h-0 border-t-2 border-calendar-current-time"
          style={{
            gridColumn: "1",
            gridRow: `${currentTimeSlot + 2}`,
          }}
        >
          <div className="-mt-1 -ml-1 h-2 w-2 rounded-full bg-calendar-current-time" />
        </div>
      )}

      {columns.map((column, columnIndex) => {
        const isInteractionDisabled = isColumnInteractionDisabled(column);
        return (
          <div
            className="pointer-events-none relative z-20"
            data-calendar-column-overlay-target="occupied-ranges"
            key={`overlay-${calendarColumnScopeKey(column.id)}`}
            onDragLeave={() => {
              if (
                dragPreview.column !== null &&
                sameCalendarColumnScope(dragPreview.column, column.id)
              ) {
                // User left this occupied overlay while dragging.
              }
            }}
            onDragOver={(e) => {
              if (isInteractionDisabled) {
                return;
              }
              onDragOver(e, column.id);
            }}
            onDrop={(e) => {
              if (isInteractionDisabled) {
                return;
              }
              void onDrop(e, column.id);
            }}
            role="presentation"
            style={{
              gridColumn: columnIndex + 2,
              gridRow: `2 / span ${totalSlots}`,
            }}
          >
            <span
              className="pointer-events-none absolute left-0 top-0 h-4 w-px"
              data-calendar-slot-row="true"
            />
            {currentTimeSlot >= 0 && (
              <div
                className="pointer-events-none absolute left-0 right-0 z-20 h-0.5 bg-calendar-current-time top-(--calendar-current-time-top)"
                style={
                  {
                    "--calendar-current-time-top": `${currentTimeSlot * 16}px`,
                  } as React.CSSProperties
                }
              >
                <div className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-calendar-current-time" />
              </div>
            )}
            {renderBlockedSlots(column.id)}
            {renderDragPreview(column.id)}
            {renderAppointments(column.id)}
          </div>
        );
      })}
    </div>
  );
}

function isManualBlockedSlot(slot: BlockedSlot): slot is ManualBlockedSlot {
  return slot.isManual === true;
}
