"use client";

import { useQuery } from "convex/react";
import { AlertCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";

import type { Doc, Id } from "@/convex/_generated/dataModel";
import type { PatientInfo } from "@/src/types";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { api } from "@/convex/_generated/api";

import type {
  Appointment,
  NewCalendarProps,
  PendingAppointmentData,
} from "./calendar/types";

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
import {
  CalendarRightSidebar,
  RightSidebarProvider,
  RightSidebarTrigger,
  useRightSidebar,
} from "./calendar-right-sidebar";
import { CalendarSidebar } from "./calendar-sidebar";
import { BlockedSlotWarningDialog } from "./calendar/blocked-slot-warning-dialog";
import { CalendarGrid } from "./calendar/calendar-grid";
import { SLOT_DURATION } from "./calendar/types";
import { useCalendarLogic } from "./calendar/use-calendar-logic";
import {
  TemporaryPatientCreationModal,
  type TemporaryPatientSelection,
} from "./patient-selection-modal";

// Hardcoded timezone for Berlin
const TIMEZONE = "Europe/Berlin";

// Wrapper component that enhances appointment selection with sidebar opening
// Must be rendered inside RightSidebarProvider
function CalendarGridWithSidebarOpening({
  onSelectAppointment,
  ...gridProps
}: React.ComponentProps<typeof CalendarGrid>) {
  const { isMobile, setOpen, setOpenMobile } = useRightSidebar();

  const handleSelectWithSidebar = useCallback(
    (appointment: Appointment) => {
      onSelectAppointment?.(appointment);
      // Open the sidebar to show appointment details
      if (isMobile) {
        setOpenMobile(true);
      } else {
        setOpen(true);
      }
    },
    [onSelectAppointment, isMobile, setOpen, setOpenMobile],
  );

  return (
    <CalendarGrid
      {...gridProps}
      onSelectAppointment={handleSelectWithSidebar}
    />
  );
}

// Helper to convert Temporal.PlainDate to JS Date for date-fns
export function NewCalendar({
  locationName,
  onDateChange,
  onLocationResolved,
  onUpdateSimulatedContext,
  patient,
  practiceId: propPracticeId,
  ruleSetId,
  selectedLocationId: externalSelectedLocationId,
  showGdtAlert = false,
  simulatedContext,
  simulationDate,
}: NewCalendarProps) {
  // Ref for scrolling to appointments
  const calendarScrollContainerRef = useRef<HTMLDivElement>(null);

  // State for appointment type selection - must be defined before useCalendarLogic
  const [selectedAppointmentTypeId, setSelectedAppointmentTypeId] = useState<
    Id<"appointmentTypes"> | undefined
  >();

  // State for pending appointment title (set by sidebar modal before manual placement)
  const [pendingAppointmentTitle, setPendingAppointmentTitle] = useState<
    string | undefined
  >();

  // State for selected appointment (shown with blue border)
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<
    Id<"appointments"> | undefined
  >();
  // Track patient selection with explicit type to avoid ID prefix guessing
  const [selectedPatient, setSelectedPatient] = useState<
    | undefined
    | { id: Id<"patients">; type: "patient" }
    | { id: Id<"temporaryPatients">; type: "temporaryPatient" }
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

  // State for patient selection modal (shown when creating appointment without patient)
  const [patientSelectionModalOpen, setPatientSelectionModalOpen] =
    useState(false);
  const [pendingAppointmentData, setPendingAppointmentData] =
    useState<null | PendingAppointmentData>(null);

  const {
    addAppointment,
    appointments,
    blockedSlots,
    blockedSlotsData,
    blockedSlotWarning,
    // businessEndHour,
    businessStartHour,
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
    locationName,
    onDateChange,
    onLocationResolved,
    onPatientRequired: useCallback((data: PendingAppointmentData) => {
      setPendingAppointmentData(data);
      setPatientSelectionModalOpen(true);
    }, []),
    onUpdateSimulatedContext,
    patient,
    pendingAppointmentTitle,
    practiceId: propPracticeId,
    ruleSetId,
    scrollContainerRef: calendarScrollContainerRef,
    selectedAppointmentTypeId,
    selectedLocationId: externalSelectedLocationId,
    showGdtAlert,
    simulatedContext,
    simulationDate,
  });

  // Query for patient appointments when a patient is selected
  // Note: The query handles both regular patients and temporary patients
  // Also queries for GDT patient when no specific appointment is selected
  const patientAppointments = useQuery(
    api.appointments.getAppointmentsForPatient,
    selectedPatient
      ? selectedPatient.type === "patient"
        ? { patientId: selectedPatient.id }
        : { temporaryPatientId: selectedPatient.id }
      : patient?.convexPatientId
        ? { patientId: patient.convexPatientId }
        : "skip",
  );

  // Query for selected patient data (regular patient)
  const selectedPatientData = useQuery(
    api.patients.getPatientById,
    selectedPatient?.type === "patient" ? { id: selectedPatient.id } : "skip",
  );

  // Query for selected temporary patient data
  const selectedTemporaryPatientData = useQuery(
    api.temporaryPatients.getTemporaryPatient,
    selectedPatient?.type === "temporaryPatient"
      ? { temporaryPatientId: selectedPatient.id }
      : "skip",
  );

  // Convert selected patient data to PatientInfo format for the sidebar
  const selectedPatientInfo: PatientInfo | undefined = (() => {
    if (selectedPatient?.type === "patient" && selectedPatientData) {
      const info: PatientInfo = {
        convexPatientId: selectedPatientData._id,
        isNewPatient: false,
        patientId: selectedPatientData.patientId,
      };
      if (selectedPatientData.firstName !== undefined) {
        info.firstName = selectedPatientData.firstName;
      }
      if (selectedPatientData.lastName !== undefined) {
        info.lastName = selectedPatientData.lastName;
      }
      if (selectedPatientData.dateOfBirth !== undefined) {
        info.dateOfBirth = selectedPatientData.dateOfBirth;
      }
      if (selectedPatientData.street !== undefined) {
        info.street = selectedPatientData.street;
      }
      if (selectedPatientData.city !== undefined) {
        info.city = selectedPatientData.city;
      }
      return info;
    } else if (
      selectedPatient?.type === "temporaryPatient" &&
      selectedTemporaryPatientData
    ) {
      return {
        firstName: selectedTemporaryPatientData.firstName,
        isNewPatient: true,
        lastName: selectedTemporaryPatientData.lastName,
      };
    }
    return;
  })();

  // Handler for selecting an appointment
  const handleSelectAppointment = useCallback((appointment: Appointment) => {
    setSelectedAppointmentId(appointment.convexId);
    // Set the patient - could be patientId or temporaryPatientId
    if (appointment.resource?.patientId) {
      setSelectedPatient({
        id: appointment.resource.patientId,
        type: "patient",
      });
    } else if (appointment.resource?.temporaryPatientId) {
      setSelectedPatient({
        id: appointment.resource.temporaryPatientId,
        type: "temporaryPatient",
      });
    }
  }, []);

  // Handler for selecting an appointment by ID (used after creation)
  const handleAppointmentSelection = useCallback(
    (
      appointmentId: Id<"appointments">,
      patient?:
        | { id: Id<"patients">; type: "patient" }
        | { id: Id<"temporaryPatients">; type: "temporaryPatient" },
    ) => {
      setSelectedAppointmentId(appointmentId);
      if (patient) {
        setSelectedPatient(patient);
      }
    },
    [],
  );

  // Handle patient selection from modal
  const handlePatientSelection = useCallback(
    async (selection: TemporaryPatientSelection) => {
      if (!pendingAppointmentData) {
        return;
      }

      try {
        const newAppointmentId = await runCreateAppointment({
          ...pendingAppointmentData,
          temporaryPatientId: selection.temporaryPatientId,
        });

        // Select the newly created appointment
        if (newAppointmentId) {
          setSelectedAppointmentId(newAppointmentId);
          setSelectedPatient({
            id: selection.temporaryPatientId,
            type: "temporaryPatient",
          });
        }

        toast.success("Termin erfolgreich erstellt");
        setPatientSelectionModalOpen(false);
        setPendingAppointmentData(null);
        // Clear the pending title after successful appointment creation
        setPendingAppointmentTitle(undefined);
      } catch {
        toast.error("Fehler beim Erstellen des Termins");
      }
    },
    [pendingAppointmentData, runCreateAppointment],
  );

  // Auto-create appointment when a patient is selected externally (via GDT) while modal is open
  useEffect(() => {
    const createAppointmentWithExternalPatient = async () => {
      if (
        !patientSelectionModalOpen ||
        !pendingAppointmentData ||
        !patient?.convexPatientId
      ) {
        return;
      }

      try {
        const newAppointmentId = await runCreateAppointment({
          ...pendingAppointmentData,
          patientId: patient.convexPatientId,
        });

        // Select the newly created appointment
        if (newAppointmentId) {
          setSelectedAppointmentId(newAppointmentId);
          setSelectedPatient({
            id: patient.convexPatientId,
            type: "patient",
          });
        }

        toast.success("Termin erfolgreich erstellt");
        setPatientSelectionModalOpen(false);
        setPendingAppointmentData(null);
        // Clear the pending title after successful appointment creation
        setPendingAppointmentTitle(undefined);
      } catch {
        toast.error("Fehler beim Erstellen des Termins");
      }
    };

    void createAppointmentWithExternalPatient();
  }, [
    patient?.convexPatientId,
    patientSelectionModalOpen,
    pendingAppointmentData,
    runCreateAppointment,
  ]);

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
        onAppointmentCreated: handleAppointmentSelection,
        onAppointmentTypeSelect: handleAppointmentTypeSelect,
        onBlockingModeChange: setIsBlockingModeActive,
        onDateChange: handleDateChange,
        onLocationResolved,
        onLocationSelect: handleLocationSelect,
        onPendingTitleChange: setPendingAppointmentTitle,
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
      <RightSidebarProvider defaultOpen>
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
                <RightSidebarTrigger />
              </div>
            </div>
          </div>

          <div className="flex flex-1 overflow-hidden">
            <CalendarSidebar />

            {/* Main Content */}
            <div
              className="flex-1 overflow-auto"
              ref={calendarScrollContainerRef}
            >
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
                    <CalendarGridWithSidebarOpening
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
                      onSelectAppointment={handleSelectAppointment}
                      selectedAppointmentId={selectedAppointmentId ?? null}
                      selectedPatientId={selectedPatient?.id ?? null}
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
            <CalendarRightSidebar
              onSelectAppointment={(appointment) => {
                // Convert from SidebarAppointment (Doc<"appointments">) to Appointment format
                // and select it
                setSelectedAppointmentId(appointment._id);
                if (appointment.patientId) {
                  setSelectedPatient({
                    id: appointment.patientId,
                    type: "patient",
                  });
                } else if (appointment.temporaryPatientId) {
                  setSelectedPatient({
                    id: appointment.temporaryPatientId,
                    type: "temporaryPatient",
                  });
                }

                // Navigate to the appointment's date
                const appointmentDateTime = Temporal.Instant.from(
                  appointment.start,
                ).toZonedDateTimeISO(TIMEZONE);
                const appointmentDate = appointmentDateTime.toPlainDate();
                handleDateChange(appointmentDate);

                // Scroll to the appointment's time after content has rendered
                // Calculate scroll position based on the appointment's time slot
                // Each slot is 16px high, 12 slots per hour (5-minute slots)
                // IMPORTANT: The calendar grid starts at businessStartHour, not midnight!
                const hour = appointmentDateTime.hour;
                const minute = appointmentDateTime.minute;
                // Calculate slot relative to business start hour
                const slotFromBusinessStart =
                  (hour - businessStartHour) * 12 + Math.floor(minute / 5);
                const scrollTop = Math.max(0, slotFromBusinessStart * 16);
                const headerOffset = 48 + 32; // header + some padding
                const targetScrollTop = Math.max(0, scrollTop - headerOffset);

                // Use requestAnimationFrame to wait for the DOM to update after date change
                // We need to wait for React to re-render with the new date's data
                const attemptScroll = (attempts = 0) => {
                  const container = calendarScrollContainerRef.current;
                  if (!container) {
                    return;
                  }

                  // Check if content is ready (scrollHeight should be >= expected for full calendar)
                  const expectedMinHeight = totalSlots * 16;
                  const isContentReady =
                    container.scrollHeight >= expectedMinHeight;

                  if (isContentReady || attempts >= 10) {
                    container.scrollTo({
                      behavior: "smooth",
                      top: targetScrollTop,
                    });
                  } else {
                    // Content not ready, try again on next frame
                    requestAnimationFrame(() => {
                      attemptScroll(attempts + 1);
                    });
                  }
                };

                // Start attempting after a short delay to let React begin re-rendering
                setTimeout(() => {
                  requestAnimationFrame(() => {
                    attemptScroll(0);
                  });
                }, 50);
              }}
              patient={selectedPatientInfo ?? patient}
              patientAppointments={patientAppointments}
              selectedAppointmentId={selectedAppointmentId}
              showGdtAlert={showGdtAlert}
            />
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
        {/* Temporary patient creation modal - shown when creating appointment without patient */}
        {practiceId && pendingAppointmentData && (
          <TemporaryPatientCreationModal
            onOpenChange={(open) => {
              setPatientSelectionModalOpen(open);
              if (!open) {
                setPendingAppointmentData(null);
              }
            }}
            onSelect={(selection) => {
              void handlePatientSelection(selection);
            }}
            open={patientSelectionModalOpen}
            practiceId={practiceId}
          />
        )}
      </RightSidebarProvider>
    </CalendarProvider>
  );
}
