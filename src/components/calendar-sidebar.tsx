"use client";

import { AlertCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Temporal } from "temporal-polyfill";

import type { Id } from "@/convex/_generated/dataModel";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Calendar } from "@/components/ui/calendar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
} from "@/components/ui/sidebar";

import { createSimulatedContext } from "../../lib/utils";
import {
  getPublicHolidays,
  isPublicHolidaySync,
} from "../utils/public-holidays";
import {
  dateToTemporal,
  formatDateDE,
  getDayName,
  temporalToDate,
} from "../utils/time-calculations";
import { AppointmentTypeSelector } from "./appointment-type-selector";
import { useCalendarContext } from "./calendar-context";
import { LocationSelector } from "./location-selector";
import { StaffAppointmentCreationModal } from "./staff-appointment-creation-modal";

export function CalendarSidebar() {
  const {
    currentTime,
    isBlockingModeActive,
    locationsData,
    onAppointmentTypeSelect,
    onBlockingModeChange,
    onDateChange,
    onLocationResolved,
    onLocationSelect,
    onUpdateSimulatedContext,
    practiceId,
    ruleSetId,
    runCreateAppointment,
    selectedAppointmentTypeId,
    selectedDate,
    selectedLocationId,
    showGdtAlert,
    simulatedContext,
  } = useCalendarContext();

  const [showCreationModal, setShowCreationModal] = useState(false);

  // Stable callback to prevent re-renders
  const handleTypeSelect = useCallback(
    (typeId: Id<"appointmentTypes">) => {
      if (onAppointmentTypeSelect) {
        onAppointmentTypeSelect(typeId);
        setShowCreationModal(true);
      }
    },
    [onAppointmentTypeSelect],
  );

  // Handle modal close - optionally reset appointment type selection
  const handleModalClose = useCallback(
    (open: boolean, shouldResetAppointmentType = true) => {
      setShowCreationModal(open);
      if (!open && shouldResetAppointmentType && onAppointmentTypeSelect) {
        // Reset appointment type selection when modal closes (unless manual placement was chosen)
        onAppointmentTypeSelect();
      }
    },
    [onAppointmentTypeSelect],
  );

  // Load public holidays as Temporal.PlainDate
  const [publicHolidayDates, setPublicHolidayDates] = useState<
    Temporal.PlainDate[]
  >([]);

  useEffect(() => {
    void getPublicHolidays().then(setPublicHolidayDates);
  }, []);

  const publicHolidaysSet = useMemo(() => {
    const set = new Set<string>();
    for (const date of publicHolidayDates) {
      set.add(date.toString());
    }
    return set;
  }, [publicHolidayDates]);

  const handleLocationSelect = (locationId: Id<"locations"> | undefined) => {
    if (simulatedContext && onUpdateSimulatedContext) {
      // Simulation mode: update simulated context
      // Use the new locationId if provided, otherwise keep the existing one
      const effectiveLocationId = locationId ?? simulatedContext.locationId;

      const newContext = createSimulatedContext({
        ...(simulatedContext.appointmentTypeId && {
          appointmentTypeId: simulatedContext.appointmentTypeId,
        }),
        isNewPatient: simulatedContext.patient.isNew,
        // Only include locationId if we have one
        ...(effectiveLocationId && { locationId: effectiveLocationId }),
      });

      onUpdateSimulatedContext(newContext);
    } else {
      // Real mode: update local state
      onLocationSelect(locationId);
    }

    if (locationId) {
      const found = locationsData?.find((l) => l._id === locationId);
      if (found && onLocationResolved) {
        onLocationResolved(locationId, found.name);
      }
    }
  };

  // Convert Temporal to Date for the Calendar component
  const selectedDateAsDate = temporalToDate(selectedDate);

  // Format times and dates using Temporal
  const currentTimeFormatted = `${String(currentTime.hour).padStart(2, "0")}:${String(currentTime.minute).padStart(2, "0")}`;
  const selectedDateFormatted = formatDateDE(selectedDate);
  const dayName = getDayName(selectedDate);

  return (
    <>
      <Sidebar collapsible="offcanvas" side="left" variant="sidebar">
        <SidebarHeader />

        <SidebarContent>
          <ScrollArea className="h-full">
            <div className="pb-[100%]">
              {showGdtAlert && (
                <div className="px-2 pt-2">
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Keine GDT-Verbindung</AlertTitle>
                    <AlertDescription>
                      Keine Verbindung mit dem PVS möglich!
                    </AlertDescription>
                  </Alert>
                </div>
              )}
              <SidebarGroup>
                <SidebarGroupContent className="flex items-center justify-center">
                  <Calendar
                    className="rounded-md border-0"
                    disabled={{ dayOfWeek: [0, 6] }}
                    mode="single"
                    modifiers={{
                      publicHoliday: (date) => {
                        const plainDate = dateToTemporal(date);
                        return isPublicHolidaySync(
                          plainDate,
                          publicHolidaysSet,
                        );
                      },
                    }}
                    modifiersClassNames={{
                      publicHoliday:
                        "bg-muted/40 text-muted-foreground opacity-60",
                    }}
                    onSelect={(date) => {
                      if (date) {
                        onDateChange(dateToTemporal(date));
                      }
                    }}
                    selected={selectedDateAsDate}
                    weekStartsOn={1}
                  />
                </SidebarGroupContent>
              </SidebarGroup>

              {locationsData && locationsData.length > 0 && (
                <SidebarGroup>
                  <SidebarGroupContent>
                    <LocationSelector
                      locations={locationsData}
                      onLocationSelect={handleLocationSelect}
                      selectedLocationId={selectedLocationId}
                    />
                  </SidebarGroupContent>
                </SidebarGroup>
              )}

              {ruleSetId && onAppointmentTypeSelect && (
                <SidebarGroup>
                  <SidebarGroupContent>
                    <AppointmentTypeSelector
                      isBlockingModeActive={isBlockingModeActive}
                      onBlockingModeChange={onBlockingModeChange}
                      onTypeSelect={handleTypeSelect}
                      ruleSetId={ruleSetId}
                      selectedType={selectedAppointmentTypeId}
                    />
                  </SidebarGroupContent>
                </SidebarGroup>
              )}

              <SidebarGroup>
                <SidebarGroupLabel>Status</SidebarGroupLabel>
                <SidebarGroupContent>
                  <div className="text-xs text-muted-foreground space-y-1 px-2">
                    <div>Aktuelle Zeit: {currentTimeFormatted}</div>
                    <div>Gewählt: {selectedDateFormatted}</div>
                    <div>Tag: {dayName}</div>
                  </div>
                </SidebarGroupContent>
              </SidebarGroup>
            </div>
          </ScrollArea>
        </SidebarContent>
      </Sidebar>

      {/* Only render modal when we have all required IDs */}
      {practiceId &&
        ruleSetId &&
        selectedAppointmentTypeId &&
        selectedLocationId && (
          <StaffAppointmentCreationModal
            appointmentTypeId={selectedAppointmentTypeId}
            locationId={selectedLocationId}
            onOpenChange={handleModalClose}
            open={showCreationModal}
            practiceId={practiceId}
            ruleSetId={ruleSetId}
            {...(runCreateAppointment && { runCreateAppointment })}
          />
        )}
    </>
  );
}
