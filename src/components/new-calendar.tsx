"use client";

import { addDays, format, isToday } from "date-fns";
import { de } from "date-fns/locale";
import { AlertCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SidebarTrigger } from "@/components/ui/sidebar";

import type { NewCalendarProps } from "./calendar/types";

import { CalendarProvider } from "./calendar-context";
import { CalendarSidebar } from "./calendar-sidebar";
import { CalendarGrid } from "./calendar/calendar-grid";
import { SLOT_DURATION } from "./calendar/types";
import { useCalendarLogic } from "./calendar/use-calendar-logic";

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

  const currentDayOfWeek = selectedDate.getDay();

  const isTodaySelected = isToday(selectedDate);

  return (
    <CalendarProvider
      value={{
        currentTime: new Date(),
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
                {format(selectedDate, "EEEE, dd. MMMM yyyy", { locale: de })}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => {
                  handleDateChange(addDays(selectedDate, -1));
                }}
                size="sm"
                variant="outline"
              >
                Zurück
              </Button>
              <Button
                disabled={isTodaySelected}
                onClick={() => {
                  handleDateChange(new Date());
                }}
                size="sm"
                variant="outline"
              >
                Heute
              </Button>
              <Button
                onClick={() => {
                  handleDateChange(addDays(selectedDate, 1));
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
              workingPractitioners.length === 0 ? (
                <Card className="m-8">
                  <CardContent className="pt-6">
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>
                        Keine Therapeuten für{" "}
                        {format(selectedDate, "EEEE", { locale: de })}
                      </AlertTitle>
                      <AlertDescription>
                        {currentDayOfWeek === 0 || currentDayOfWeek === 6
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
