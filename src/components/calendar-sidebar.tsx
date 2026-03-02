"use client";

import { useEffect, useMemo, useState } from "react";
import { Temporal } from "temporal-polyfill";

import type { Id } from "@/convex/_generated/dataModel";

import { Calendar } from "@/components/ui/calendar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";

import { createSimulatedContext } from "../../lib/utils";
import { captureFrontendError } from "../utils/frontend-errors";
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
import {
  type CalendarContextValue,
  useCalendarContext,
} from "./calendar-context";
import { LocationSelector } from "./location-selector";
import { StaffAppointmentCreationModal } from "./staff-appointment-creation-modal";

const FALLBACK_CALENDAR_CONTEXT: CalendarContextValue = {
  currentTime: Temporal.Now.zonedDateTimeISO("Europe/Berlin"),
  onDateChange: () => 0,
  onLocationSelect: () => 0,
  selectedDate: Temporal.Now.plainDateISO("Europe/Berlin"),
  selectedLocationId: undefined,
};

export function CalendarSidebar() {
  const calendarContextResult = useCalendarContext();
  const sidebarResult = useSidebar();

  const calendarContext = calendarContextResult.match(
    (value) => value,
    (error) => {
      captureFrontendError(error, undefined, "calendar-sidebar-context");
      return FALLBACK_CALENDAR_CONTEXT;
    },
  );
  const sidebarContext = sidebarResult.match(
    (value) => value,
    (error) => {
      captureFrontendError(
        error,
        undefined,
        "calendar-sidebar-sidebar-context",
      );
      return {
        isMobile: false,
        open: false,
        openMobile: false,
        setOpen: () => 0,
        setOpenMobile: () => 0,
        state: "collapsed" as const,
        toggleSidebar: () => 0,
      };
    },
  );

  const {
    currentTime,
    isBlockingModeActive,
    locationsData,
    onAppointmentCreated,
    onAppointmentTypeSelect,
    onBlockingModeChange,
    onDateChange,
    onLocationResolved,
    onLocationSelect,
    onPendingTitleChange,
    onUpdateSimulatedContext,
    patient,
    practiceId,
    ruleSetId,
    runCreateAppointment,
    selectedAppointmentTypeId,
    selectedDate,
    selectedLocationId,
    simulatedContext,
  } = calendarContext;

  const { isMobile, setOpenMobile } = sidebarContext;

  const [showCreationModal, setShowCreationModal] = useState(false);

  // Stable callback to prevent re-renders
  const handleTypeSelect = (typeId: Id<"appointmentTypes">) => {
    if (onAppointmentTypeSelect) {
      onAppointmentTypeSelect(typeId);
      setShowCreationModal(true);
      if (isMobile) {
        setOpenMobile(false);
      }
    }
  };

  // Handle deselection of appointment type
  const handleTypeDeselect = () => {
    if (onAppointmentTypeSelect) {
      onAppointmentTypeSelect();
    }
  };

  // Handle blocking mode change and close mobile sidebar
  const handleBlockingModeChange = (active: boolean) => {
    if (onBlockingModeChange) {
      onBlockingModeChange(active);
      if (active && isMobile) {
        setOpenMobile(false);
      }
    }
  };

  // Handle modal close - optionally reset appointment type selection
  const handleModalClose = (
    open: boolean,
    shouldResetAppointmentType?: boolean,
  ) => {
    setShowCreationModal(open);
    if (!open && shouldResetAppointmentType && onAppointmentTypeSelect) {
      onAppointmentTypeSelect();
    }
  };

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
        ...(simulatedContext.patient.dateOfBirth && {
          patientDateOfBirth: simulatedContext.patient.dateOfBirth,
        }),
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

    // Close mobile sidebar when location is selected
    if (isMobile) {
      setOpenMobile(false);
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
                        // Close mobile sidebar when date is selected
                        if (isMobile) {
                          setOpenMobile(false);
                        }
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
                      onBlockingModeChange={handleBlockingModeChange}
                      onTypeDeselect={handleTypeDeselect}
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
            isSimulation={simulatedContext !== undefined}
            locationId={selectedLocationId}
            onOpenChange={handleModalClose}
            onPendingTitleChange={onPendingTitleChange}
            open={showCreationModal}
            patient={patient}
            practiceId={practiceId}
            ruleSetId={ruleSetId}
            {...(onAppointmentCreated && { onAppointmentCreated })}
            {...(runCreateAppointment && { runCreateAppointment })}
          />
        )}
    </>
  );
}
