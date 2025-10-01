"use client";

import { format } from "date-fns";
import { de } from "date-fns/locale";
import { AlertCircle } from "lucide-react";

import type { Id } from "@/convex/_generated/dataModel";

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

  const handleLocationSelect = (locationId: Id<"locations"> | undefined) => {
    if (simulatedContext && onUpdateSimulatedContext) {
      // Simulation mode: update simulated context
      const newContext = {
        appointmentType: simulatedContext.appointmentType,
        ...(locationId && { locationId }),
        patient: simulatedContext.patient,
      };
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
              mode="single"
              onSelect={(date) => {
                if (date) {
                  onDateChange(date);
                }
              }}
              selected={selectedDate}
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
