"use client";

import { format } from "date-fns";
import { de } from "date-fns/locale";
import { AlertCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { Id } from "@/convex/_generated/dataModel";
import type { SchedulingSimulatedContext } from "../types";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Calendar } from "@/components/ui/calendar";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
} from "@/components/ui/sidebar";

import {
  getPublicHolidays,
  isPublicHolidaySync,
} from "../utils/public-holidays";
import { useCalendarContext } from "./calendar-context";
import { LocationSelector } from "./location-selector";

export function CalendarSidebar() {
  const {
    currentTime,
    locationsData,
    onDateChange,
    onLocationResolved,
    onLocationSelect,
    onUpdateSimulatedContext,
    selectedDate,
    selectedLocationId,
    showGdtAlert,
    simulatedContext,
  } = useCalendarContext();

  // Load public holidays
  const [publicHolidayDates, setPublicHolidayDates] = useState<Date[]>([]);

  useEffect(() => {
    void getPublicHolidays().then(setPublicHolidayDates);
  }, []);

  const publicHolidaysSet = useMemo(() => {
    const set = new Set<string>();
    for (const date of publicHolidayDates) {
      set.add(format(date, "yyyy-MM-dd"));
    }
    return set;
  }, [publicHolidayDates]);

  const handleLocationSelect = (locationId: Id<"locations"> | undefined) => {
    if (simulatedContext && onUpdateSimulatedContext) {
      // Simulation mode: update simulated context
      const newContext: SchedulingSimulatedContext = {
        patient: simulatedContext.patient,
      };

      if (simulatedContext.appointmentTypeId) {
        newContext.appointmentTypeId = simulatedContext.appointmentTypeId;
      }

      if (locationId) {
        newContext.locationId = locationId;
      }

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

  return (
    <Sidebar collapsible="offcanvas" side="left" variant="sidebar">
      <SidebarHeader />

      <SidebarContent>
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
              locale={de}
              mode="single"
              modifiers={{
                publicHoliday: (date) =>
                  isPublicHolidaySync(date, publicHolidaysSet),
              }}
              modifiersClassNames={{
                publicHoliday: "bg-muted/40 text-muted-foreground opacity-60",
              }}
              onSelect={(date) => {
                if (date) {
                  onDateChange(date);
                }
              }}
              selected={selectedDate}
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

        <SidebarGroup>
          <SidebarGroupLabel>Status</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="text-xs text-muted-foreground space-y-1 px-2">
              <div>Aktuelle Zeit: {format(currentTime, "HH:mm")}</div>
              <div>Gewählt: {format(selectedDate, "dd.MM.yyyy")}</div>
              <div>Tag: {format(selectedDate, "EEEE", { locale: de })}</div>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
