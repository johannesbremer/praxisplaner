"use client";

import { useQuery } from "convex/react";
import { AlertCircle, Columns3 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";

import type { Id } from "@/convex/_generated/dataModel";
import type { PatientInfo, PracticePatientSelection } from "@/src/types";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { api } from "@/convex/_generated/api";
import { calendarColumnScopeKey } from "@/lib/calendar-occupancy";

import type {
  CalendarAppointmentView,
  CalendarBlockedSlotEditorRecord,
  CalendarColumnId,
  NewCalendarProps,
} from "./calendar/types";

import { captureFrontendError } from "../utils/frontend-errors";
import {
  parseOptionalPatientDateOfBirth,
  patientDocToInfo,
} from "../utils/patient-info";
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
  type SidebarAppointment,
  useRightSidebar,
} from "./calendar-right-sidebar";
import { CalendarSidebar } from "./calendar-sidebar";
import { BlockedSlotWarningDialog } from "./calendar/blocked-slot-warning-dialog";
import { CalendarGrid } from "./calendar/calendar-grid";
import { SLOT_DURATION } from "./calendar/types";
import { useCalendarLogic } from "./calendar/use-calendar-logic";

// Hardcoded timezone for Berlin
const TIMEZONE = "Europe/Berlin";
type SelectedPatient =
  | { id: Id<"patients">; info?: PatientInfo; type: "patient" }
  | { id: Id<"users">; type: "user" }
  | { info: PatientInfo; type: "draftTemporaryPatient" };

export function getSidebarAppointmentCalendarTarget(args: {
  appointment: Pick<SidebarAppointment, "locationLineageKey" | "start">;
  businessStartHour: number;
}): {
  date: Temporal.PlainDate;
  locationLineageKey: Id<"locations">;
  targetScrollTop: number;
} {
  const appointmentDateTime = Temporal.Instant.from(
    args.appointment.start,
  ).toZonedDateTimeISO(TIMEZONE);
  const slotFromBusinessStart =
    (appointmentDateTime.hour - args.businessStartHour) * 12 +
    Math.floor(appointmentDateTime.minute / 5);
  const scrollTop = Math.max(0, slotFromBusinessStart * 16);
  const headerOffset = 48 + 32;

  return {
    date: appointmentDateTime.toPlainDate(),
    locationLineageKey: args.appointment.locationLineageKey,
    targetScrollTop: Math.max(0, scrollTop - headerOffset),
  };
}

// Wrapper component that enhances appointment selection with sidebar opening
// Must be rendered inside RightSidebarProvider
function CalendarGridWithSidebarOpening({
  onSelectAppointment,
  ...gridProps
}: React.ComponentProps<typeof CalendarGrid>) {
  const sidebarResult = useRightSidebar();

  return sidebarResult.match(
    ({ isMobile, setOpen, setOpenMobile }) => {
      const handleSelectWithSidebar = (
        appointment: CalendarAppointmentView,
      ) => {
        onSelectAppointment?.(appointment);
        if (isMobile) {
          setOpenMobile(true);
        } else {
          setOpen(true);
        }
      };

      return (
        <CalendarGrid
          {...gridProps}
          onSelectAppointment={handleSelectWithSidebar}
        />
      );
    },
    (error) => {
      captureFrontendError(
        error,
        undefined,
        "calendar-grid-with-sidebar-opening-context",
      );
      return (
        <CalendarGrid
          {...gridProps}
          {...(onSelectAppointment ? { onSelectAppointment } : {})}
        />
      );
    },
  );
}

// Helper to convert Temporal.PlainDate to JS Date for date-fns
export function NewCalendar({
  canManageCalendarPlanning = false,
  locationName,
  onDateChange,
  onLocationResolved,
  onUpdateSimulatedContext,
  onVisibleColumnNamesChange,
  patient,
  practiceId: propPracticeId,
  ruleSetId,
  selectedLocationId: externalSelectedLocationId,
  showGdtAlert = false,
  simulatedContext,
  simulationDate,
  visibleColumnNames,
}: NewCalendarProps) {
  // Ref for scrolling to appointments
  const calendarScrollContainerRef = useRef<HTMLDivElement>(null);

  // State for appointment type selection - must be defined before useCalendarLogic
  const [selectedAppointmentTypeId, setSelectedAppointmentTypeId] = useState<
    Id<"appointmentTypes"> | undefined
  >();

  // State for pending appointment reason (set by sidebar modal before manual placement)
  const [pendingAppointmentTitle, setPendingAppointmentTitle] = useState<
    string | undefined
  >();
  const patientAppointmentScopeArgs = simulatedContext
    ? {
        scope: "simulation" as const,
        ...(ruleSetId === undefined ? {} : { selectedRuleSetId: ruleSetId }),
      }
    : { scope: "real" as const };
  // State for selected appointment (shown with blue border)
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<
    Id<"appointments"> | undefined
  >();
  // Track patient selection with explicit type to avoid ID prefix guessing
  const [selectedPatient, setSelectedPatient] = useState<
    SelectedPatient | undefined
  >();

  const clearAppointmentCreationSelection = useCallback(() => {
    setSelectedAppointmentTypeId(undefined);
    setPendingAppointmentTitle(undefined);

    if (simulatedContext && onUpdateSimulatedContext) {
      const { clientType, locationLineageKey, patient, requestedAt } =
        simulatedContext;
      onUpdateSimulatedContext({
        ...(clientType !== undefined && { clientType }),
        ...(locationLineageKey && { locationLineageKey }),
        patient,
        ...(requestedAt && { requestedAt }),
      });
    }
  }, [onUpdateSimulatedContext, simulatedContext]);

  // Query for selected patient data (regular patient)
  const selectedPatientData = useQuery(
    api.patients.getPatientById,
    selectedPatient?.type === "patient" ? { id: selectedPatient.id } : "skip",
  );

  const selectedUserData = useQuery(
    api.users.getById,
    selectedPatient?.type === "user"
      ? { id: selectedPatient.id, practiceId: propPracticeId }
      : "skip",
  );
  const appointmentTypesData = useQuery(
    api.entities.getAppointmentTypes,
    ruleSetId ? { ruleSetId } : "skip",
  );

  const selectedPatientInfo: PatientInfo | undefined = (() => {
    if (selectedPatient?.type === "patient" && selectedPatientData) {
      return patientDocToInfo(selectedPatientData)._unsafeUnwrap();
    }

    if (selectedPatient?.type === "patient") {
      return selectedPatient.info;
    }

    if (selectedPatient?.type === "draftTemporaryPatient") {
      return selectedPatient.info;
    }

    if (selectedPatient?.type === "user" && selectedUserData) {
      const bookingPersonalData = selectedUserData.bookingPersonalData;
      const info: PatientInfo = {
        isNewPatient: false,
        userId: selectedUserData._id,
      };
      if (bookingPersonalData) {
        const dateOfBirth = parseOptionalPatientDateOfBirth({
          dateOfBirth: bookingPersonalData.dateOfBirth,
          patientLabel: `user:${selectedUserData._id}`,
          source: "NewCalendar.selectedUserData",
        })._unsafeUnwrap();
        Object.assign(info, {
          ...bookingPersonalData,
          ...(dateOfBirth !== undefined && { dateOfBirth }),
        });
      }

      if (
        info.firstName === undefined &&
        selectedUserData.firstName !== undefined
      ) {
        info.firstName = selectedUserData.firstName;
      }
      if (
        info.lastName === undefined &&
        selectedUserData.lastName !== undefined
      ) {
        info.lastName = selectedUserData.lastName;
      }
      info.email ??= selectedUserData.email;

      return info;
    }

    return;
  })();
  const activePatient =
    selectedPatient === undefined ? patient : selectedPatientInfo;
  const activeSelectedPatientId =
    selectedPatient?.type === "patient"
      ? selectedPatient.id
      : selectedPatient === undefined
        ? patient?.convexPatientId
        : undefined;

  // Handler for selecting an appointment by ID (used after creation)
  const handleAppointmentSelection = useCallback(
    (appointmentId: Id<"appointments">, patient?: SelectedPatient) => {
      setSelectedAppointmentId(appointmentId);
      clearAppointmentCreationSelection();
      if (patient) {
        setSelectedPatient(patient);
      }
    },
    [clearAppointmentCreationSelection],
  );

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
    slotData: CalendarBlockedSlotEditorRecord;
    slotIsSimulation: boolean;
  }>(null);

  const {
    addAppointment,
    appointments,
    blockedSlots,
    blockedSlotWarning,
    // businessEndHour,
    businessStartHour,
    columns,
    currentTime,
    currentTimeSlot,
    draggedAppointment,
    draggedBlockedSlotId,
    dragPreview,
    getBlockedSlotEditorData,
    getPractitionerIdForColumn,
    handleBlockedSlotDragStart,
    handleBlockedSlotResizeStart,
    handleDateChange,
    handleDeleteAppointment,
    handleDragStart,
    handleEditAppointment,
    handleEditBlockedSlot: handleEditBlockedSlotInternal,
    handleLocationSelect,
    handleResizeStart,
    locationsData,
    practiceId,
    runCreateAppointment,
    runCreateBlockedSlot,
    runDeleteBlockedSlot,
    runUpdateAppointment,
    runUpdateBlockedSlot,
    selectedDate,
    selectedLocationId,
    setBlockedSlotWarning,
    slotToTime,
    timeToSlot,
    totalSlots,
    workingPractitioners,
  } = useCalendarLogic({
    canManageCalendarPlanning,
    locationName,
    onAppointmentCreated: handleAppointmentSelection,
    onClearAppointmentTypeSelection: clearAppointmentCreationSelection,
    onDateChange,
    onLocationResolved,
    onUpdateSimulatedContext,
    patient: activePatient,
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

  const visibleColumnNameSet = useMemo(
    () =>
      visibleColumnNames === undefined
        ? undefined
        : new Set(visibleColumnNames),
    [visibleColumnNames],
  );
  const visibleColumns = useMemo(
    () =>
      visibleColumnNameSet === undefined
        ? columns
        : columns.filter((column) => visibleColumnNameSet.has(column.title)),
    [columns, visibleColumnNameSet],
  );
  const currentColumnNames = useMemo(
    () => columns.map((column) => column.title),
    [columns],
  );
  const hiddenColumnCount = columns.length - visibleColumns.length;
  const areAllColumnsHidden = columns.length > 0 && visibleColumns.length === 0;
  const canChangeColumnVisibility = onVisibleColumnNamesChange !== undefined;

  const handleColumnVisibleChange = useCallback(
    (columnName: string, nextVisible: boolean) => {
      if (!onVisibleColumnNamesChange) {
        return;
      }

      const nextVisibleColumnNames = new Set(
        visibleColumnNames === undefined
          ? currentColumnNames
          : currentColumnNames.filter((columnName) =>
              visibleColumnNames.includes(columnName),
            ),
      );
      if (nextVisible) {
        nextVisibleColumnNames.add(columnName);
      } else {
        nextVisibleColumnNames.delete(columnName);
      }

      if (nextVisibleColumnNames.size === columns.length) {
        onVisibleColumnNamesChange();
        return;
      }

      onVisibleColumnNamesChange([...nextVisibleColumnNames]);
    },
    [
      columns.length,
      currentColumnNames,
      onVisibleColumnNamesChange,
      visibleColumnNames,
    ],
  );

  const showAllColumns = useCallback(() => {
    onVisibleColumnNamesChange?.();
  }, [onVisibleColumnNamesChange]);

  // Query for patient appointments when a patient is selected
  // Also queries for GDT patient when no specific appointment is selected
  const patientAppointments = useQuery(
    api.appointments.getAppointmentsForPatient,
    selectedPatient
      ? selectedPatient.type === "patient"
        ? {
            patientId: selectedPatient.id,
            practiceId: propPracticeId,
            ...patientAppointmentScopeArgs,
          }
        : selectedPatient.type === "user"
          ? {
              practiceId: propPracticeId,
              userId: selectedPatient.id,
              ...patientAppointmentScopeArgs,
            }
          : "skip"
      : activePatient?.convexPatientId
        ? {
            patientId: activePatient.convexPatientId,
            practiceId: propPracticeId,
            ...patientAppointmentScopeArgs,
          }
        : activePatient?.userId
          ? {
              practiceId: propPracticeId,
              userId: activePatient.userId,
              ...patientAppointmentScopeArgs,
            }
          : "skip",
  );

  const selectedSeriesId =
    appointments.find(
      (appointment) => appointment.layout.record._id === selectedAppointmentId,
    )?.layout.record.seriesId ??
    patientAppointments?.find(
      (appointment) => appointment._id === selectedAppointmentId,
    )?.seriesId;

  // Handler for selecting an appointment
  const handleSelectAppointment = useCallback(
    (appointment: CalendarAppointmentView) => {
      setSelectedAppointmentId(appointment.layout.record._id);
      if (appointment.layout.record.patientId) {
        setSelectedPatient({
          id: appointment.layout.record.patientId,
          type: "patient",
        });
        return;
      }

      if (appointment.layout.record.userId) {
        setSelectedPatient({
          id: appointment.layout.record.userId,
          type: "user",
        });
      }
    },
    [],
  );

  const scrollToSidebarAppointmentTarget = useCallback(
    (targetScrollTop: number) => {
      const attemptScroll = (attempts = 0) => {
        const container = calendarScrollContainerRef.current;
        if (!container) {
          return;
        }

        const expectedMinHeight = totalSlots * 16;
        const isContentReady = container.scrollHeight >= expectedMinHeight;

        if (isContentReady || attempts >= 10) {
          container.scrollTo({
            behavior: "smooth",
            top: targetScrollTop,
          });
          return;
        }

        requestAnimationFrame(() => {
          attemptScroll(attempts + 1);
        });
      };

      setTimeout(() => {
        requestAnimationFrame(() => {
          attemptScroll(0);
        });
      }, 50);
    },
    [totalSlots],
  );

  const handleSelectSidebarAppointment = useCallback(
    (appointment: SidebarAppointment) => {
      setSelectedAppointmentId(appointment._id);
      if (appointment.patientId) {
        setSelectedPatient({
          id: appointment.patientId,
          type: "patient",
        });
      } else if (appointment.userId) {
        setSelectedPatient({ id: appointment.userId, type: "user" });
      }

      const target = getSidebarAppointmentCalendarTarget({
        appointment,
        businessStartHour,
      });
      const targetLocation = locationsData?.find(
        (location) => location.lineageKey === target.locationLineageKey,
      );

      if (targetLocation === undefined) {
        toast.error("Der Terminstandort konnte nicht aufgelöst werden.");
        return;
      }

      handleLocationSelect(targetLocation._id);
      if (onLocationResolved === undefined) {
        handleDateChange(target.date);
      } else {
        onLocationResolved(
          targetLocation._id,
          targetLocation.name,
          target.date,
        );
      }
      scrollToSidebarAppointmentTarget(target.targetScrollTop);
    },
    [
      businessStartHour,
      handleDateChange,
      handleLocationSelect,
      locationsData,
      onLocationResolved,
      scrollToSidebarAppointmentTarget,
    ],
  );

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

      const blockedSlot = getBlockedSlotEditorData(blockedSlotId);
      if (!blockedSlot) {
        toast.error("Gesperrter Slot nicht gefunden");
        return;
      }

      setBlockedSlotEditData(blockedSlot);
      setBlockedSlotEditModalOpen(true);
    },
    [getBlockedSlotEditorData, handleEditBlockedSlotInternal],
  );

  const handleAppointmentTypeSelect = (
    appointmentTypeId?: Id<"appointmentTypes">,
  ) => {
    setSelectedAppointmentTypeId(appointmentTypeId);

    // Update simulatedContext immediately when appointment type is selected
    // This will trigger blocked slots to show right away when the modal opens
    if (simulatedContext && onUpdateSimulatedContext) {
      if (appointmentTypeId) {
        const appointmentTypeLineageKey = appointmentTypesData?.find(
          (appointmentType) => appointmentType._id === appointmentTypeId,
        )?.lineageKey;
        if (!appointmentTypeLineageKey) {
          return;
        }
        // Add appointment type to context - this triggers blocked slots query
        const newContext = {
          ...simulatedContext,
          appointmentTypeLineageKey,
        };
        onUpdateSimulatedContext(newContext);
      } else if (simulatedContext.appointmentTypeLineageKey !== undefined) {
        // Remove appointment type from context - this clears blocked slots
        const { clientType, locationLineageKey, patient, requestedAt } =
          simulatedContext;
        onUpdateSimulatedContext({
          ...(clientType !== undefined && { clientType }),
          ...(locationLineageKey && { locationLineageKey }),
          patient,
          ...(requestedAt && { requestedAt }),
        });
      }
    }
  };

  const handleSelectPracticePatient = useCallback(
    (selected?: PracticePatientSelection) => {
      if (!selected) {
        setSelectedPatient(undefined);
        return;
      }

      if ("id" in selected) {
        setSelectedPatient({
          id: selected.id,
          info: selected.info,
          type: "patient",
        });
        return;
      }

      setSelectedPatient({
        info: selected.info,
        type: "draftTemporaryPatient",
      });
    },
    [],
  );

  const handleCreateAppointment = useCallback(
    async (...args: Parameters<typeof runCreateAppointment>) => {
      return await runCreateAppointment(...args);
    },
    [runCreateAppointment],
  );

  const handleBlockSlot = useCallback(
    (column: CalendarColumnId, slot: number) => {
      if (!canManageCalendarPlanning || !isBlockingModeActive) {
        return;
      }

      const practitionerId = getPractitionerIdForColumn(column);
      if (practitionerId === undefined) {
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
        practitionerId,
        slotStart: slotStartZoned.toString(),
      });
      setBlockedSlotModalOpen(true);
      setIsBlockingModeActive(false); // Deactivate blocking mode after click
    },
    [
      getPractitionerIdForColumn,
      canManageCalendarPlanning,
      isBlockingModeActive,
      selectedDate,
      slotToTime,
    ],
  );

  return (
    <CalendarProvider
      value={{
        canManageCalendarPlanning,
        currentTime,
        isBlockingModeActive: canManageCalendarPlanning && isBlockingModeActive,
        isManualAppointmentPlacementActive:
          pendingAppointmentTitle !== undefined,
        locationsData,
        onAppointmentCreated: handleAppointmentSelection,
        onAppointmentTypeSelect: handleAppointmentTypeSelect,
        onBlockingModeChange: canManageCalendarPlanning
          ? setIsBlockingModeActive
          : undefined,
        onDateChange: handleDateChange,
        onLocationResolved,
        onLocationSelect: handleLocationSelect,
        onPatientSelected: handleSelectPracticePatient,
        onPendingTitleChange: setPendingAppointmentTitle,
        onUpdateSimulatedContext,
        patient: activePatient,
        practiceId,
        ruleSetId,
        runCreateAppointment: handleCreateAppointment,
        selectedAppointmentTypeId,
        selectedDate,
        selectedLocationId,
        selectedPatientId: activeSelectedPatientId,
        showGdtAlert,
        simulatedContext,
      }}
    >
      <RightSidebarProvider defaultOpen>
        <div className="flex h-full w-full min-w-0 flex-col">
          {/* Header */}
          <div className="z-20 border-b border-border bg-card px-6 py-4">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <SidebarTrigger />
                <h2 className="truncate text-xl font-semibold">
                  {formatDateFull(selectedDate)}
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-2">
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
                {canChangeColumnVisibility ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        disabled={columns.length === 0}
                        size="sm"
                        variant="outline"
                      >
                        <Columns3 className="h-4 w-4" />
                        Spalten
                        {hiddenColumnCount > 0 ? (
                          <span className="text-muted-foreground">
                            {visibleColumns.length}/{columns.length}
                          </span>
                        ) : null}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuLabel>Spalten anzeigen</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {columns.map((column) => {
                        const columnKey = calendarColumnScopeKey(column.id);
                        const isVisible =
                          visibleColumnNameSet === undefined ||
                          visibleColumnNameSet.has(column.title);
                        const isLastVisibleColumn =
                          isVisible && visibleColumns.length === 1;
                        return (
                          <DropdownMenuCheckboxItem
                            checked={isVisible}
                            disabled={isLastVisibleColumn}
                            key={columnKey}
                            onCheckedChange={(checked) => {
                              handleColumnVisibleChange(column.title, checked);
                            }}
                            onSelect={(event) => {
                              event.preventDefault();
                            }}
                          >
                            <span className="truncate">{column.title}</span>
                          </DropdownMenuCheckboxItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                <RightSidebarTrigger />
              </div>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 overflow-hidden">
            <CalendarSidebar />

            {/* Main Content */}
            <div
              className="min-w-0 flex-1 overflow-auto"
              ref={calendarScrollContainerRef}
            >
              {practiceId ? (
                selectedLocationId ? (
                  areAllColumnsHidden ? (
                    <Card className="m-8">
                      <CardContent className="pt-6">
                        <Alert>
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>Alle Spalten ausgeblendet</AlertTitle>
                          <AlertDescription>
                            Wählen Sie mindestens eine Spalte aus, um den
                            Kalender anzuzeigen.
                          </AlertDescription>
                        </Alert>
                        <Button
                          className="mt-4"
                          onClick={showAllColumns}
                          size="sm"
                          variant="outline"
                        >
                          Alle Spalten anzeigen
                        </Button>
                      </CardContent>
                    </Card>
                  ) : holidayName || workingPractitioners.length === 0 ? (
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
                      canDragCalendarItems={canManageCalendarPlanning}
                      columns={visibleColumns}
                      currentTimeSlot={currentTimeSlot}
                      draggedAppointment={draggedAppointment}
                      draggedBlockedSlotId={draggedBlockedSlotId}
                      dragPreview={dragPreview}
                      isBlockingModeActive={
                        canManageCalendarPlanning && isBlockingModeActive
                      }
                      onAddAppointment={addAppointment}
                      onBlockSlot={
                        canManageCalendarPlanning ? handleBlockSlot : undefined
                      }
                      onDeleteAppointment={handleDeleteAppointment}
                      onDeleteBlockedSlot={
                        canManageCalendarPlanning
                          ? handleEditBlockedSlot
                          : undefined
                      }
                      onEditAppointment={handleEditAppointment}
                      onEditBlockedSlot={
                        canManageCalendarPlanning
                          ? handleEditBlockedSlot
                          : undefined
                      }
                      onPointerDragStart={
                        canManageCalendarPlanning ? handleDragStart : undefined
                      }
                      onPointerDragStartBlockedSlot={
                        canManageCalendarPlanning
                          ? handleBlockedSlotDragStart
                          : undefined
                      }
                      onResizeStart={
                        canManageCalendarPlanning
                          ? handleResizeStart
                          : undefined
                      }
                      onResizeStartBlockedSlot={
                        canManageCalendarPlanning
                          ? handleBlockedSlotResizeStart
                          : undefined
                      }
                      onSelectAppointment={handleSelectAppointment}
                      selectedAppointmentId={selectedAppointmentId ?? null}
                      selectedPatientId={
                        selectedPatient?.type === "patient"
                          ? selectedPatient.id
                          : null
                      }
                      selectedSeriesId={selectedSeriesId ?? null}
                      selectedUserId={
                        selectedPatient?.type === "user"
                          ? selectedPatient.id
                          : null
                      }
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
              onPatientSelected={handleSelectPracticePatient}
              onSelectAppointment={handleSelectSidebarAppointment}
              onUpdateAppointmentSmiley={async ({ id, smiley }) => {
                await runUpdateAppointment({ id, smiley });
              }}
              patient={activePatient}
              patientAppointments={patientAppointments}
              practiceId={practiceId}
              ruleSetId={ruleSetId}
              selectedAppointmentId={selectedAppointmentId}
              selectedPatientId={activeSelectedPatientId}
              selectedSeriesId={selectedSeriesId}
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
            runDeleteBlockedSlot={runDeleteBlockedSlot}
            runUpdateBlockedSlot={runUpdateBlockedSlot}
            slotData={blockedSlotEditData.slotData}
            slotIsSimulation={blockedSlotEditData.slotIsSimulation}
          />
        )}
      </RightSidebarProvider>
    </CalendarProvider>
  );
}
