import type { SlotInfo } from "react-big-calendar";
import type { EventInteractionArgs } from "react-big-calendar/lib/addons/dragAndDrop";

import { useConvexMutation, useConvexQuery } from "@convex-dev/react-query";
import { ClientOnly } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";
import moment from "moment";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Calendar, momentLocalizer } from "react-big-calendar";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";
import "react-big-calendar/lib/css/react-big-calendar.css";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import {
  MiniCalendar,
  MiniCalendarDay,
  MiniCalendarDays,
  MiniCalendarNavigation,
} from "@/components/ui/mini-calendar";

import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { CalendarEvent } from "../types";

import { api } from "../../convex/_generated/api";
import { slugify } from "../utils/slug";
import { LocationSelector } from "./location-selector";

// Import CSS for drag and drop
import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";

const localizer = momentLocalizer(moment);

import type { LocalAppointment } from "../utils/local-appointments";

interface PraxisCalendarProps {
  localAppointments?: LocalAppointment[];
  onCreateLocalAppointment?: (
    appointment: Omit<LocalAppointment, "id" | "isLocal">,
  ) => void;
  // Notify parent when the current date changes
  locationSlug?: string | undefined;
  onDateChange?: (date: Date) => void;
  onLocationResolved?: (
    locationId: Id<"locations">,
    locationName: string,
  ) => void;
  onSlotClick?: (slot: {
    blockedByRuleId?: Id<"rules"> | undefined;
    duration: number;
    locationId?: Id<"locations"> | undefined;
    practitionerId: Id<"practitioners">;
    practitionerName: string;
    startTime: string;
    status: "AVAILABLE" | "BLOCKED";
  }) => void;
  onUpdateSimulatedContext?: (context: {
    appointmentType: string;
    locationId?: Id<"locations"> | undefined;
    patient: { isNew: boolean };
  }) => void;
  practiceId?: Id<"practices">;
  ruleSetId?: Id<"ruleSets">;
  selectedLocationId?: Id<"locations"> | undefined;
  showGdtAlert?: boolean;
  simulatedContext?: {
    appointmentType: string;
    locationId?: Id<"locations"> | undefined;
    patient: { isNew: boolean };
  };
  simulationDate?: Date;
}

// Client-only drag and drop calendar component
function DragDropCalendar({
  currentDate,
  events,
  handleEventDrop,
  handleEventResize,
  handleSelectEvent,
  handleSelectSlot,
  maxEndTime,
  minStartTime,
  step,
  timeslots,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  handleEventDrop: (args: EventInteractionArgs<CalendarEvent>) => void;
  handleEventResize: (args: EventInteractionArgs<CalendarEvent>) => void;
  handleSelectEvent: (
    event: CalendarEvent,
    e: React.SyntheticEvent<HTMLElement>,
  ) => void;
  handleSelectSlot: (slotInfo: SlotInfo) => void;
  maxEndTime: Date;
  minStartTime: Date;
  step: number;
  timeslots: number;
}) {
  // State to track if drag and drop is loaded
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasDragDrop, setHasDragDrop] = useState(false);

  // Ref to store the enhanced calendar component
  // Using any here because the drag-and-drop addon returns complex generic types
  // that are difficult to constrain properly with our CalendarEvent type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const DnDCalendarRef = useRef<null | React.ComponentType<any>>(null);

  useEffect(() => {
    let mounted = true;

    import("react-big-calendar/lib/addons/dragAndDrop")
      .then((module) => {
        if (!mounted) {
          return;
        }

        const withDragAndDrop = module.default;
        const EnhancedCalendar = withDragAndDrop(Calendar);
        DnDCalendarRef.current = EnhancedCalendar;
        setHasDragDrop(true);
        setIsLoaded(true);
      })
      .catch((error: unknown) => {
        console.warn(
          "Failed to load drag and drop calendar, falling back to regular calendar:",
          error,
        );
        if (!mounted) {
          return;
        }

        // Fallback to regular calendar if drag and drop fails to load
        DnDCalendarRef.current = Calendar;
        setHasDragDrop(false);
        setIsLoaded(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  if (!isLoaded || !DnDCalendarRef.current) {
    return (
      <div className="flex items-center justify-center h-full">
        <p>Kalender wird geladen...</p>
      </div>
    );
  }

  const CalendarComponent = DnDCalendarRef.current;

  // Create props object with proper typing where possible
  const calendarProps = {
    culture: "de",
    date: currentDate,
    dayLayoutAlgorithm: "no-overlap",
    defaultView: "day" as const,
    endAccessor: (event: CalendarEvent) => event.end,
    events,
    formats: {
      dayHeaderFormat: "dddd, DD.MM.YYYY",
      eventTimeRangeFormat: ({ end, start }: { end: Date; start: Date }) => {
        const startTime = moment(start).format("HH:mm");
        const endTime = moment(end).format("HH:mm");
        return `${startTime} - ${endTime}`;
      },
      timeGutterFormat: "HH:mm",
    },
    localizer,
    max: maxEndTime,
    messages: {
      agenda: "Agenda",
      date: "Datum",
      day: "Tag",
      event: "Termin",
      month: "Monat",
      next: "Weiter",
      noEventsInRange: "Keine Termine in diesem Bereich.",
      previous: "Zurück",
      showMore: (total: number) => `+ ${total} weitere`,
      time: "Zeit",
      today: "Heute",
      week: "Woche",
    },
    min: minStartTime,
    // Only add drag and drop handlers if drag and drop is available
    ...(hasDragDrop && {
      onEventDrop: handleEventDrop,
      onEventResize: handleEventResize,
      resizable: true,
    }),
    onNavigate: () => {
      // Disable navigation - we'll handle it with mini calendar
    },
    onSelectEvent: handleSelectEvent,
    onSelectSlot: handleSelectSlot,
    selectable: true,
    startAccessor: (event: CalendarEvent) => event.start,
    step,
    timeslots,
    titleAccessor: (event: CalendarEvent) => event.title,
    toolbar: false,
    views: ["day" as const],
  };

  // Use JSX with spread props - type assertion needed due to dynamic component loading
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <CalendarComponent {...(calendarProps as any)} />;
}

// Helper function to parse time string to minutes from midnight
function timeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

// Helper function to parse time string to minutes from midnight
export function PraxisCalendar({
  localAppointments = [],
  locationSlug,
  onCreateLocalAppointment,
  onDateChange,
  onLocationResolved,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Will be used later
  onSlotClick: _onSlotClick,
  onUpdateSimulatedContext,
  practiceId: propPracticeId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Will be used later
  ruleSetId: _ruleSetId,
  selectedLocationId: externalSelectedLocationId,
  showGdtAlert = false,
  simulatedContext,
  simulationDate,
}: PraxisCalendarProps) {
  const [practiceId, setPracticeId] = useState<Id<"practices"> | null>(
    propPracticeId ?? null,
  );

  // Initialize practice
  const initializePracticeMutation = useConvexMutation(
    api.practices.initializeDefaultPractice,
  );

  // Initialize practice on mount if not provided as prop
  useEffect(() => {
    if (propPracticeId) {
      setPracticeId(propPracticeId);
      return;
    }

    const initPractice = async () => {
      try {
        const id = await initializePracticeMutation({});
        setPracticeId(id);
      } catch (error) {
        console.error("Failed to initialize practice:", error);
      }
    };

    void initPractice();
  }, [initializePracticeMutation, propPracticeId]);

  // Query data - only run if we have a practice ID
  const appointmentsData = useConvexQuery(api.appointments.getAppointments);
  const practitionersData = useConvexQuery(
    api.practitioners.getPractitioners,
    practiceId ? { practiceId } : "skip",
  );
  const baseSchedulesData = useConvexQuery(
    api.baseSchedules.getAllBaseSchedules,
    practiceId ? { practiceId } : "skip",
  );
  const locationsData = useConvexQuery(
    api.locations.getLocations,
    practiceId ? { practiceId } : "skip",
  );

  // Mutations
  const createAppointmentMutation = useConvexMutation(
    api.appointments.createAppointment,
  );
  const updateAppointmentMutation = useConvexMutation(
    api.appointments.updateAppointment,
  );

  // Get current date info - use simulationDate if provided, otherwise use current date
  const [currentDate, setCurrentDate] = useState(simulationDate ?? new Date());

  // Local state for selected location (for non-simulation mode)
  const [selectedLocationId, setSelectedLocationId] = useState<
    Id<"locations"> | undefined
  >(externalSelectedLocationId);

  useEffect(() => {
    if (
      externalSelectedLocationId &&
      externalSelectedLocationId !== selectedLocationId
    ) {
      setSelectedLocationId(externalSelectedLocationId);
    }
  }, [externalSelectedLocationId, selectedLocationId]);

  // Resolve location slug from URL once locations data is available
  useEffect(() => {
    if (!locationSlug || !locationsData || selectedLocationId) {
      return;
    }
    const match = locationsData.find(
      (l: { name: string }) => slugify(l.name) === locationSlug,
    );
    if (match) {
      setSelectedLocationId(match._id);
      if (onLocationResolved) {
        onLocationResolved(match._id, match.name);
      }
    }
  }, [locationSlug, locationsData, selectedLocationId, onLocationResolved]);

  // Update currentDate when simulationDate changes
  useEffect(() => {
    if (simulationDate) {
      setCurrentDate(simulationDate);
      onDateChange?.(simulationDate);
    }
  }, [simulationDate, onDateChange]);

  const currentDayOfWeek = currentDate.getDay(); // 0 = Sunday

  // Calculate working practitioners for current date and work hours
  const { maxEndTime, minStartTime, workingPractitioners } = useMemo(() => {
    if (!practitionersData || !baseSchedulesData) {
      return {
        maxEndTime: new Date(0, 0, 0, 18, 0, 0),
        minStartTime: new Date(0, 0, 0, 8, 0, 0),
        workingPractitioners: [],
      };
    }

    // Find practitioners working on the current selected day
    let daySchedules = baseSchedulesData.filter(
      (schedule: Doc<"baseSchedules"> & { practitionerName: string }) =>
        schedule.dayOfWeek === currentDayOfWeek,
    );

    // Filter by location in simulation mode
    if (simulatedContext?.locationId) {
      daySchedules = daySchedules.filter(
        (schedule) => schedule.locationId === simulatedContext.locationId,
      );
    } else if (selectedLocationId) {
      // Filter by location in real mode
      daySchedules = daySchedules.filter(
        (schedule) => schedule.locationId === selectedLocationId,
      );
    }

    if (daySchedules.length === 0) {
      return {
        maxEndTime: new Date(0, 0, 0, 18, 0, 0),
        minStartTime: new Date(0, 0, 0, 8, 0, 0),
        workingPractitioners: [],
      };
    }

    const working = daySchedules.map((schedule) => ({
      endTime: schedule.endTime,
      id: schedule.practitionerId,
      name: schedule.practitionerName,
      startTime: schedule.startTime,
    }));

    // Calculate business hours: round to full hours
    const startTimes = daySchedules.map((s) => timeToMinutes(s.startTime));
    const endTimes = daySchedules.map((s) => timeToMinutes(s.endTime));

    const earliestStartMinutes = Math.min(...startTimes);
    const latestEndMinutes = Math.max(...endTimes);

    // Round start time down to full hour (e.g., 7:40 -> 7:00, 8:00 -> 8:00)
    const businessStartHour = Math.floor(earliestStartMinutes / 60);

    // Round end time up to full hour (e.g., 18:05 -> 19:00, 19:00 -> 19:00)
    const businessEndHour = Math.ceil(latestEndMinutes / 60);

    return {
      maxEndTime: new Date(0, 0, 0, businessEndHour, 0, 0),
      minStartTime: new Date(0, 0, 0, businessStartHour, 0, 0),
      workingPractitioners: working,
    };
  }, [
    practitionersData,
    baseSchedulesData,
    currentDayOfWeek,
    simulatedContext,
    selectedLocationId,
  ]);

  // Convert convex appointments to calendar events
  const events: CalendarEvent[] = useMemo(() => {
    let convexEvents: CalendarEvent[] = appointmentsData
      ? appointmentsData.map(
          (appointment: Doc<"appointments">): CalendarEvent => ({
            end: new Date(appointment.end),
            id: appointment._id,
            resource: {
              appointmentType: appointment.appointmentType,
              locationId: appointment.locationId,
              notes: appointment.notes,
              patientId: appointment.patientId,
              practitionerId: appointment.practitionerId,
            },
            start: new Date(appointment.start),
            title: appointment.title,
          }),
        )
      : [];

    // Filter by location in simulation mode
    if (simulatedContext?.locationId) {
      convexEvents = convexEvents.filter(
        (event) => event.resource?.locationId === simulatedContext.locationId,
      );
    } else if (selectedLocationId) {
      // Filter by location in real mode
      convexEvents = convexEvents.filter(
        (event) => event.resource?.locationId === selectedLocationId,
      );
    }

    // Convert local appointments to calendar events
    let localEvents: CalendarEvent[] = localAppointments.map(
      (appointment: LocalAppointment): CalendarEvent => ({
        end: appointment.end,
        id: appointment.id,
        resource: {
          appointmentType: appointment.appointmentType,
          isLocal: true, // Flag to distinguish local appointments
          locationId: appointment.locationId,
          notes: appointment.notes,
          patientId: appointment.patientId,
          practitionerId: appointment.practitionerId,
        },
        start: appointment.start,
        title: appointment.title,
      }),
    );

    // Filter local appointments by location in simulation mode
    if (simulatedContext?.locationId) {
      localEvents = localEvents.filter(
        (event) => event.resource?.locationId === simulatedContext.locationId,
      );
    } else if (selectedLocationId) {
      // Filter local appointments by location in real mode
      localEvents = localEvents.filter(
        (event) => event.resource?.locationId === selectedLocationId,
      );
    }

    return [...convexEvents, ...localEvents];
  }, [
    appointmentsData,
    localAppointments,
    simulatedContext,
    selectedLocationId,
  ]);

  const handleSelectSlot = useCallback(
    (slotInfo: SlotInfo) => {
      if (onCreateLocalAppointment && simulatedContext) {
        // For simulation mode, create local appointments
        if (!simulatedContext.locationId) {
          alert("Bitte wählen Sie zuerst einen Standort aus.");
          return;
        }

        const title = globalThis.prompt("Neuer lokaler Termin:");
        if (title && workingPractitioners.length > 0) {
          // Use the first available practitioner for simplicity
          const practitioner = workingPractitioners[0];
          if (practitioner) {
            onCreateLocalAppointment({
              appointmentType: simulatedContext.appointmentType,
              end: slotInfo.end,
              locationId: simulatedContext.locationId,
              notes: "Lokaler Simulationstermin",
              practitionerId: practitioner.id,
              start: slotInfo.start,
              title,
            });
          }
        }
      } else {
        // For regular mode, create real appointments
        const title = globalThis.prompt("Neuer Termin:");
        if (title) {
          void createAppointmentMutation({
            end: slotInfo.end.toISOString(),
            ...(selectedLocationId && { locationId: selectedLocationId }),
            start: slotInfo.start.toISOString(),
            title,
          });
        }
      }
    },
    [
      createAppointmentMutation,
      onCreateLocalAppointment,
      selectedLocationId,
      simulatedContext,
      workingPractitioners,
    ],
  );

  const handleSelectEvent = useCallback(
    (event: CalendarEvent, e: React.SyntheticEvent<HTMLElement>) => {
      e.preventDefault();
      // Only handle real appointments, not local ones
      if (typeof event.id === "string" && event.id.startsWith("local-")) {
        return; // Skip local appointments
      }
      const newTitle = globalThis.prompt("Termin bearbeiten:", event.title);
      if (newTitle !== null && newTitle !== event.title) {
        void updateAppointmentMutation({
          id: event.id as Id<"appointments">,
          title: newTitle,
        });
      }
    },
    [updateAppointmentMutation],
  );

  // Handle appointment move (drag & drop)
  const handleEventDrop = useCallback(
    (args: EventInteractionArgs<CalendarEvent>) => {
      const { end, event, start } = args;
      // Only handle real appointments, not local ones
      if (typeof event.id === "string" && event.id.startsWith("local-")) {
        return; // Skip local appointments
      }
      // Handle the fact that start/end might be string or Date
      const startDate = typeof start === "string" ? new Date(start) : start;
      const endDate = typeof end === "string" ? new Date(end) : end;

      void updateAppointmentMutation({
        end: endDate.toISOString(),
        id: event.id as Id<"appointments">,
        start: startDate.toISOString(),
      });
    },
    [updateAppointmentMutation],
  );

  // Handle appointment resize
  const handleEventResize = useCallback(
    (args: EventInteractionArgs<CalendarEvent>) => {
      const { end, event, start } = args;
      // Only handle real appointments, not local ones
      if (typeof event.id === "string" && event.id.startsWith("local-")) {
        return; // Skip local appointments
      }
      // Handle the fact that start/end might be string or Date
      const startDate = typeof start === "string" ? new Date(start) : start;
      const endDate = typeof end === "string" ? new Date(end) : end;

      void updateAppointmentMutation({
        end: endDate.toISOString(),
        id: event.id as Id<"appointments">,
        start: startDate.toISOString(),
      });
    },
    [updateAppointmentMutation],
  );

  // 5-minute time steps
  const step = 5;
  const timeslots = 12; // 12 slots per hour (5-minute intervals)

  // Early return if we don't have a practice ID yet or data is loading
  if (
    !practiceId ||
    !appointmentsData ||
    !practitionersData ||
    !baseSchedulesData
  ) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-96 pt-6">
          <p>Termine werden geladen...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {showGdtAlert && (
        <div className="flex justify-center">
          <Alert className="w-auto max-w-md" variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Keine Verbindung mit dem PVS möglich!</AlertTitle>
          </Alert>
        </div>
      )}

      {/* Mini Calendar Navigation */}
      <div className="flex justify-center">
        <Card className="w-auto">
          <CardContent className="p-4">
            <MiniCalendar
              days={7}
              onStartDateChange={(date) => {
                // Set to the first day of the week containing the selected date
                const startOfWeek = new Date(date);
                startOfWeek.setDate(date.getDate() - date.getDay());
                setCurrentDate(date);
                onDateChange?.(date);
              }}
              onValueChange={(d) => {
                setCurrentDate(d);
                onDateChange?.(d);
              }}
              startDate={currentDate}
              value={currentDate}
            >
              <MiniCalendarNavigation direction="prev" />
              <MiniCalendarDays className="flex-1 min-w-0">
                {(date) => (
                  <MiniCalendarDay date={date} key={date.toISOString()} />
                )}
              </MiniCalendarDays>
              <MiniCalendarNavigation direction="next" />
            </MiniCalendar>
          </CardContent>
        </Card>
      </div>

      {/* Location Selection */}
      {locationsData && locationsData.length > 0 && (
        <div className="flex justify-center">
          <div className="w-auto min-w-96">
            <LocationSelector
              locations={locationsData}
              onLocationSelect={(locationId) => {
                if (simulatedContext && onUpdateSimulatedContext) {
                  // Simulation mode: update simulated context
                  const newContext = {
                    appointmentType: simulatedContext.appointmentType,
                    locationId,
                    patient: simulatedContext.patient,
                  };
                  onUpdateSimulatedContext(newContext);
                } else {
                  // Real mode: update local state
                  setSelectedLocationId(locationId);
                }
                const found = locationsData.find((l) => l._id === locationId);
                if (found && onLocationResolved) {
                  onLocationResolved(locationId, found.name);
                }
              }}
              selectedLocationId={
                simulatedContext?.locationId || selectedLocationId
              }
            />
          </div>
        </div>
      )}

      <Card>
        {simulatedContext && !simulatedContext.locationId ? (
          <CardContent className="flex items-center justify-center h-96 pt-6">
            <Alert className="w-auto max-w-md">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Standort auswählen</AlertTitle>
              <AlertDescription>
                Bitte wählen Sie einen Standort aus, um Termine anzuzeigen.
              </AlertDescription>
            </Alert>
          </CardContent>
        ) : workingPractitioners.length === 0 ? (
          <CardContent className="flex items-center justify-center h-96 pt-6">
            <Alert className="w-auto max-w-md">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Keine Ärzte heute verfügbar</AlertTitle>
              <AlertDescription>
                Es sind keine Ärzte für{" "}
                {moment(currentDate).format("dddd, DD.MM.YYYY")} eingeplant.
                {selectedLocationId || simulatedContext?.locationId
                  ? " an diesem Standort"
                  : " (alle Standorte)"}
              </AlertDescription>
            </Alert>
          </CardContent>
        ) : (
          <CardContent className="p-6">
            <div style={{ height: "2400px" }}>
              <ClientOnly>
                <DragDropCalendar
                  currentDate={currentDate}
                  events={events}
                  handleEventDrop={handleEventDrop}
                  handleEventResize={handleEventResize}
                  handleSelectEvent={handleSelectEvent}
                  handleSelectSlot={handleSelectSlot}
                  maxEndTime={maxEndTime}
                  minStartTime={minStartTime}
                  step={step}
                  timeslots={timeslots}
                />
              </ClientOnly>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
