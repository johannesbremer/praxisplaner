"use client";

import { AlertCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";

import type { Doc, Id } from "@/convex/_generated/dataModel";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SidebarTrigger } from "@/components/ui/sidebar";

import type { NewCalendarProps } from "./calendar/types";

import {
  getPublicHolidayName,
  getPublicHolidaysData,
} from "../utils/public-holidays";
import {
  formatDateFull,
  getDayName,
  isToday,
  temporalDayToLegacy,
} from "../utils/time-calculations";
import { BlockedSlotCreationModal } from "./blocked-slot-creation-modal";
import { BlockedSlotEditModal } from "./blocked-slot-edit-modal";
import { CalendarProvider } from "./calendar-context";
import { CalendarSidebar } from "./calendar-sidebar";
import { BlockedSlotWarningDialog } from "./calendar/blocked-slot-warning-dialog";
import { CalendarGrid } from "./calendar/calendar-grid";
import { SLOT_DURATION } from "./calendar/types";
import { useCalendarLogic } from "./calendar/use-calendar-logic";

// Hardcoded timezone for Berlin
const TIMEZONE = "Europe/Berlin";

// Helper to convert Temporal.PlainDate to JS Date for date-fns
export function NewCalendar({
  locationSlug,
  onDateChange,
  onLocationResolved,
  onUpdateSimulatedContext,
  practiceId: propPracticeId,
  ruleSetId,
  selectedLocationId: externalSelectedLocationId,
  showGdtAlert = false,
  simulatedContext,
  simulationDate,
}: NewCalendarProps) {
  // State for appointment type selection - must be defined before useCalendarLogic
  const [selectedAppointmentTypeId, setSelectedAppointmentTypeId] = useState<
    Id<"appointmentTypes"> | undefined
  >();

  // State for blocking mode
  const [isBlockingModeActive, setIsBlockingModeActive] = useState(false);
  const [blockedSlotModalOpen, setBlockedSlotModalOpen] = useState(false);
  const [blockedSlotModalData, setBlockedSlotModalData] = useState<null | {
    practitionerId: Id<"practitioners">;
    slotStart: string;
  }>(null);

  // State for editing blocked slots
  const [blockedSlotEditModalOpen, setBlockedSlotEditModalOpen] =
    useState(false);
  const [blockedSlotEditData, setBlockedSlotEditData] = useState<null | {
    blockedSlotId: Id<"blockedSlots">;
    currentTitle: string;
    slotData: Doc<"blockedSlots">;
    slotIsSimulation: boolean;
  }>(null);

  const {
    addAppointment,
    appointments,
    blockedSlots,
    blockedSlotsData,
    blockedSlotWarning,
    // businessEndHour,
    // businessStartHour,
    // calendarRef,
    columns,
    currentTime,
    currentTimeSlot,
    draggedAppointment,
    draggedBlockedSlotId,
    dragPreview,
    handleBlockedSlotDragEnd,
    handleBlockedSlotDragStart,
    handleBlockedSlotResizeStart,
    handleDateChange,
    handleDeleteAppointment,
    handleDeleteBlockedSlot,
    handleDragEnd,
    handleDragOver,
    handleDragStart,
    handleDrop,
    handleEditAppointment,
    handleEditBlockedSlot: handleEditBlockedSlotInternal,
    handleLocationSelect,
    handleResizeStart,
    locationsData,
    practiceId,
    runCreateAppointment,
    runCreateBlockedSlot,
    runUpdateBlockedSlot,
    selectedDate,
    selectedLocationId,
    setBlockedSlotWarning,
    slotToTime,
    timeToSlot,
    totalSlots,
    workingPractitioners,
  } = useCalendarLogic({
    locationSlug,
    onDateChange,
    onLocationResolved,
    onUpdateSimulatedContext,
    practiceId: propPracticeId,
    ruleSetId,
    selectedAppointmentTypeId,
    selectedLocationId: externalSelectedLocationId,
    showGdtAlert,
    simulatedContext,
    simulationDate,
  } as NewCalendarProps);

  // Temporal uses 1-7 (Monday=1), convert to 0-6 (Sunday=0) for legacy compatibility
  const currentDayOfWeek = temporalDayToLegacy(selectedDate);

  // Check if selected date is today
  const isTodaySelected = isToday(selectedDate);

  // Load public holidays
  const [publicHolidaysLoaded, setPublicHolidaysLoaded] = useState(false);

  useEffect(() => {
    void getPublicHolidaysData().then(() => {
      setPublicHolidaysLoaded(true);
    });
  }, []);

  // Check if selected date is a public holiday
  const holidayName = publicHolidaysLoaded
    ? getPublicHolidayName(selectedDate)
    : undefined;

  // Wrapper for handleEditBlockedSlot to open the edit modal
  const handleEditBlockedSlot = useCallback(
    (blockedSlotId: string) => {
      // Check if we should proceed (returns false if we just finished resizing)
      const shouldProceed = handleEditBlockedSlotInternal(blockedSlotId);
      if (!shouldProceed) {
        return;
      }

      // Find the blocked slot to get its current title
      const blockedSlot = blockedSlotsData?.find(
        (slot) => slot._id === blockedSlotId,
      );
      if (!blockedSlot) {
        toast.error("Gesperrter Slot nicht gefunden");
        return;
      }

      setBlockedSlotEditData({
        blockedSlotId: blockedSlot._id,
        currentTitle: blockedSlot.title,
        slotData: blockedSlot,
        slotIsSimulation: blockedSlot.isSimulation ?? false,
      });
      setBlockedSlotEditModalOpen(true);
    },
    [blockedSlotsData, handleEditBlockedSlotInternal],
  );

  const handleAppointmentTypeSelect = useCallback(
    (appointmentTypeId: Id<"appointmentTypes"> | undefined) => {
      setSelectedAppointmentTypeId(appointmentTypeId);

      // Update simulatedContext immediately when appointment type is selected
      // This will trigger blocked slots to show right away when the modal opens
      if (simulatedContext && onUpdateSimulatedContext) {
        if (appointmentTypeId) {
          // Add appointment type to context - this triggers blocked slots query
          const newContext = {
            ...simulatedContext,
            appointmentTypeId,
          };
          onUpdateSimulatedContext(newContext);
        } else if (simulatedContext.appointmentTypeId !== undefined) {
          // Remove appointment type from context - this clears blocked slots
          const { locationId, patient, requestedAt } = simulatedContext;
          onUpdateSimulatedContext({
            ...(locationId && { locationId }),
            patient,
            ...(requestedAt && { requestedAt }),
          });
        }
      }
    },
    [simulatedContext, onUpdateSimulatedContext],
  );

  const handleBlockSlot = useCallback(
    (column: string, slot: number) => {
      if (!isBlockingModeActive) {
        return;
      }

      // Find the practitioner for this column
      const practitionerId = columns.find((col) => col.id === column)?.id;
      if (!practitionerId) {
        return;
      }

      // Calculate slot start time
      const slotStartTime = slotToTime(slot);
      const [hours, minutes] = slotStartTime.split(":").map(Number);

      const slotStartZoned = selectedDate.toZonedDateTime({
        plainTime: { hour: hours ?? 0, minute: minutes ?? 0 },
        timeZone: TIMEZONE,
      });

      setBlockedSlotModalData({
        practitionerId: practitionerId as Id<"practitioners">,
        slotStart: slotStartZoned.toString(),
      });
      setBlockedSlotModalOpen(true);
      setIsBlockingModeActive(false); // Deactivate blocking mode after click
    },
    [isBlockingModeActive, columns, slotToTime, selectedDate],
  );

  return (
    <CalendarProvider
      value={{
        currentTime,
        isBlockingModeActive,
        locationsData,
        onAppointmentTypeSelect: handleAppointmentTypeSelect,
        onBlockingModeChange: setIsBlockingModeActive,
        onDateChange: handleDateChange,
        onLocationResolved,
        onLocationSelect: handleLocationSelect,
        onUpdateSimulatedContext,
        practiceId: practiceId ?? undefined,
        ruleSetId,
        runCreateAppointment,
        selectedAppointmentTypeId,
        selectedDate,
        selectedLocationId: simulatedContext?.locationId || selectedLocationId,
        showGdtAlert,
        simulatedContext,
      }}
    >
      <div className="flex h-full w-full flex-col">
        {/* Header */}
        <div className="border-b border-border bg-card px-6 py-4 z-20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <SidebarTrigger />
              <h2 className="text-xl font-semibold">
                {formatDateFull(selectedDate)}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => {
                  handleDateChange(selectedDate.subtract({ days: 1 }));
                }}
                size="sm"
                variant="outline"
              >
                Zurück
              </Button>
              <Button
                disabled={isTodaySelected}
                onClick={() => {
                  handleDateChange(Temporal.Now.plainDateISO(TIMEZONE));
                }}
                size="sm"
                variant="outline"
              >
                Heute
              </Button>
              <Button
                onClick={() => {
                  handleDateChange(selectedDate.add({ days: 1 }));
                }}
                size="sm"
                variant="outline"
              >
                Weiter
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <CalendarSidebar />

          {/* Main Content */}
          <div className="flex-1 overflow-auto">
            {practiceId ? (
              selectedLocationId ? (
                holidayName || workingPractitioners.length === 0 ? (
                  <Card className="m-8">
                    <CardContent className="pt-6">
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>
                          {holidayName ? (
                            <>{holidayName}</>
                          ) : (
                            <>
                              Keine Therapeuten für {getDayName(selectedDate)}
                            </>
                          )}
                        </AlertTitle>
                        <AlertDescription>
                          {holidayName
                            ? "An Feiertagen ist die Praxis geschlossen."
                            : currentDayOfWeek === 0 || currentDayOfWeek === 6
                              ? "An diesem Tag sind keine Therapeuten eingeplant. Bitte wählen Sie einen Wochentag aus."
                              : "Es sind noch keine Therapeuten für diesen Tag eingeplant. Bitte erstellen Sie einen Basisplan in den Einstellungen."}
                        </AlertDescription>
                      </Alert>
                    </CardContent>
                  </Card>
                ) : (
                  <CalendarGrid
                    appointments={appointments}
                    blockedSlots={blockedSlots}
                    columns={columns}
                    currentTimeSlot={currentTimeSlot}
                    draggedAppointment={draggedAppointment}
                    draggedBlockedSlotId={draggedBlockedSlotId}
                    dragPreview={dragPreview}
                    isBlockingModeActive={isBlockingModeActive}
                    onAddAppointment={addAppointment}
                    onBlockedSlotDragEnd={handleBlockedSlotDragEnd}
                    onBlockSlot={handleBlockSlot}
                    onDeleteAppointment={handleDeleteAppointment}
                    onDeleteBlockedSlot={handleDeleteBlockedSlot}
                    onDragEnd={handleDragEnd}
                    onDragOver={handleDragOver}
                    onDragStart={handleDragStart}
                    onDragStartBlockedSlot={handleBlockedSlotDragStart}
                    onDrop={handleDrop}
                    onEditAppointment={handleEditAppointment}
                    onEditBlockedSlot={handleEditBlockedSlot}
                    onResizeStart={handleResizeStart}
                    onResizeStartBlockedSlot={handleBlockedSlotResizeStart}
                    slotDuration={SLOT_DURATION}
                    slotToTime={slotToTime}
                    timeToSlot={timeToSlot}
                    totalSlots={totalSlots}
                  />
                )
              ) : (
                <Alert className="m-8 w-96">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Kein Standort ausgewählt</AlertTitle>
                </Alert>
              )
            ) : (
              <Card className="m-8">
                <CardContent className="pt-6">
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Keine Praxis gefunden</AlertTitle>
                    <AlertDescription>
                      Bitte erstellen Sie zuerst eine Praxis in den
                      Einstellungen.
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
      <BlockedSlotWarningDialog
        canBook={blockedSlotWarning?.canBook ?? true}
        {...(blockedSlotWarning?.isManualBlock !== undefined && {
          isManualBlock: blockedSlotWarning.isManualBlock,
        })}
        onCancel={() => {
          setBlockedSlotWarning(null);
        }}
        onConfirm={() => {
          blockedSlotWarning?.onConfirm();
          setBlockedSlotWarning(null);
        }}
        open={blockedSlotWarning !== null}
        {...(blockedSlotWarning?.reason && {
          reason: blockedSlotWarning.reason,
        })}
        slotTime={blockedSlotWarning?.slotTime || ""}
      />
      {practiceId && selectedLocationId && blockedSlotModalData && (
        <BlockedSlotCreationModal
          initialDurationMinutes={SLOT_DURATION}
          initialSlotStart={blockedSlotModalData.slotStart}
          isSimulation={simulatedContext !== undefined}
          locationId={selectedLocationId}
          onOpenChange={(open) => {
            setBlockedSlotModalOpen(open);
            if (!open) {
              setBlockedSlotModalData(null);
            }
          }}
          open={blockedSlotModalOpen}
          practiceId={practiceId}
          practitionerId={blockedSlotModalData.practitionerId}
          runCreateBlockedSlot={runCreateBlockedSlot}
        />
      )}
      {blockedSlotEditData && (
        <BlockedSlotEditModal
          blockedSlotId={blockedSlotEditData.blockedSlotId}
          currentTitle={blockedSlotEditData.currentTitle}
          inSimulationContext={simulatedContext !== undefined}
          onOpenChange={(open) => {
            setBlockedSlotEditModalOpen(open);
            if (!open) {
              setBlockedSlotEditData(null);
            }
          }}
          open={blockedSlotEditModalOpen}
          runCreateBlockedSlot={runCreateBlockedSlot}
          runUpdateBlockedSlot={runUpdateBlockedSlot}
          slotData={blockedSlotEditData.slotData}
          slotIsSimulation={blockedSlotEditData.slotIsSimulation}
        />
      )}
    </CalendarProvider>
  );
}
