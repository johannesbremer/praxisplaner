"use client";

import { AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Temporal } from "temporal-polyfill";

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
import { CalendarProvider } from "./calendar-context";
import { CalendarSidebar } from "./calendar-sidebar";
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
  selectedLocationId: externalSelectedLocationId,
  showGdtAlert = false,
  simulatedContext,
  simulationDate,
}: NewCalendarProps) {
  const {
    addAppointment,
    appointments,
    columns,
    currentTime,
    currentTimeSlot,
    Dialog,
    draggedAppointment,
    dragPreview,
    handleDateChange,
    handleDeleteAppointment,
    handleDragEnd,
    handleDragOver,
    handleDragStart,
    handleDrop,
    handleEditAppointment,
    handleLocationSelect,
    handleResizeStart,
    locationsData,
    practiceId,
    selectedDate,
    selectedLocationId,
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

  return (
    <CalendarProvider
      value={{
        currentTime,
        locationsData,
        onDateChange: handleDateChange,
        onLocationResolved,
        onLocationSelect: handleLocationSelect,
        onUpdateSimulatedContext,
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
              holidayName || workingPractitioners.length === 0 ? (
                <Card className="m-8">
                  <CardContent className="pt-6">
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>
                        {holidayName ? (
                          <>{holidayName}</>
                        ) : (
                          <>Keine Therapeuten für {getDayName(selectedDate)}</>
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
                  columns={columns}
                  currentTimeSlot={currentTimeSlot}
                  draggedAppointment={draggedAppointment}
                  dragPreview={dragPreview}
                  onAddAppointment={addAppointment}
                  onDeleteAppointment={handleDeleteAppointment}
                  onDragEnd={handleDragEnd}
                  onDragOver={handleDragOver}
                  onDragStart={handleDragStart}
                  onDrop={handleDrop}
                  onEditAppointment={handleEditAppointment}
                  onResizeStart={handleResizeStart}
                  slotDuration={SLOT_DURATION}
                  slotToTime={slotToTime}
                  timeToSlot={timeToSlot}
                  totalSlots={totalSlots}
                />
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
      {Dialog}
    </CalendarProvider>
  );
}
