"use client";

import { useMutation, useQuery } from "convex/react";
import {
  AlertCircle,
  Calendar,
  ExternalLink,
  Link2,
  PanelRightIcon,
  Plus,
  X,
} from "lucide-react";
import { err, ok, type Result } from "neverthrow";
import * as React from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

import type { Id } from "../../convex/_generated/dataModel";
import type {
  AppointmentResult,
  AppointmentSmiley,
} from "../../convex/appointments";
import type { BookingPersonalData } from "../../convex/bookingSessions.shared";
import type { PatientInfo, PracticePatientSelection } from "../types";

import { api } from "../../convex/_generated/api";
import { dispatchCustomEvent } from "../utils/browser-api";
import { formatZonedDateTimeDE } from "../utils/date-utils";
import {
  captureFrontendError,
  type FrontendError,
  missingContextError,
} from "../utils/frontend-errors";
import { getPatientInfoDisplayName } from "../utils/patient-info";
import {
  getPatientSelectionPanelInitialSelection,
  PatientSelectionPanel,
} from "./patient-selection-panel";

type AppointmentSmileyOption =
  (typeof api.ruleSets.getAppointmentSmileyOptionsForRuleSet)["_returnType"][number];

// Appointment type for the sidebar list
export type SidebarAppointment = AppointmentResult;

interface CalendarRightSidebarProps {
  onPatientSelected?:
    | ((patient?: PracticePatientSelection) => void)
    | undefined;
  onSelectAppointment?: ((appointment: SidebarAppointment) => void) | undefined;
  onUpdateAppointmentSmiley?:
    | ((args: {
        id: Id<"appointments">;
        smiley: AppointmentSmiley | null;
      }) => Promise<void>)
    | undefined;
  patient?: PatientInfo | undefined;
  patientAppointments?: SidebarAppointment[] | undefined;
  practiceId?: Id<"practices"> | undefined;
  ruleSetId?: Id<"ruleSets"> | undefined;
  selectedAppointmentId?: Id<"appointments"> | undefined;
  selectedPatientId?: Id<"patients"> | undefined;
  selectedSeriesId?: string | undefined;
  showGdtAlert?: boolean | undefined;
}

export function resolveAppointmentSmileyOptionsRuleSetId(args: {
  defaultRuleSetId: Id<"ruleSets"> | undefined;
  patientAppointments:
    | readonly Pick<
        SidebarAppointment,
        "_id" | "seriesId" | "simulationRuleSetId"
      >[]
    | undefined;
  selectedAppointmentId: Id<"appointments"> | undefined;
  selectedSeriesId: string | undefined;
}): Id<"ruleSets"> | undefined {
  const selectedAppointment =
    args.patientAppointments?.find(
      (appointment) => appointment._id === args.selectedAppointmentId,
    ) ??
    args.patientAppointments?.find(
      (appointment) =>
        args.selectedSeriesId !== undefined &&
        appointment.seriesId === args.selectedSeriesId,
    );

  return selectedAppointment?.simulationRuleSetId ?? args.defaultRuleSetId;
}

export function shouldShowAppointmentSmileyEditor(args: {
  appointmentId: Id<"appointments">;
  selectedAppointmentId: Id<"appointments"> | undefined;
}): boolean {
  return args.selectedAppointmentId === args.appointmentId;
}

const RIGHT_SIDEBAR_WIDTH = "18rem";
const RIGHT_SIDEBAR_WIDTH_MOBILE = "18rem";
const GENDER_LABELS: Record<
  NonNullable<BookingPersonalData["gender"]>,
  string
> = {
  diverse: "Divers",
  female: "Weiblich",
  male: "Männlich",
};
const BOOKING_FIELD_LABELS: Record<keyof BookingPersonalData, string> = {
  city: "Ort",
  dateOfBirth: "Geburtsdatum",
  email: "E-Mail",
  firstName: "Vorname",
  gender: "Geschlecht",
  lastName: "Nachname",
  phoneNumber: "Telefon",
  postalCode: "PLZ",
  street: "Straße",
  title: "Titel",
};
const BOOKING_FIELD_ORDER = [
  "title",
  "firstName",
  "lastName",
  "dateOfBirth",
  "gender",
  "phoneNumber",
  "email",
  "street",
  "postalCode",
  "city",
] as const satisfies readonly (keyof BookingPersonalData)[];
function isBookingGender(
  value: string,
): value is NonNullable<BookingPersonalData["gender"]> {
  return value in GENDER_LABELS;
}

// Context for controlling the right sidebar from anywhere
interface RightSidebarContextProps {
  isMobile: boolean;
  open: boolean;
  openMobile: boolean;
  setOpen: (open: boolean) => void;
  setOpenMobile: (open: boolean) => void;
  toggleSidebar: () => void;
}

const RightSidebarContext =
  React.createContext<null | RightSidebarContextProps>(null);

// Extracted sidebar content to avoid duplication
export function CalendarRightSidebar({
  onPatientSelected,
  onSelectAppointment,
  onUpdateAppointmentSmiley,
  patient,
  patientAppointments,
  practiceId,
  ruleSetId,
  selectedAppointmentId,
  selectedPatientId,
  selectedSeriesId,
  showGdtAlert,
}: CalendarRightSidebarProps) {
  const sidebarResult = useRightSidebar();

  return sidebarResult.match(
    ({ isMobile, open, openMobile, setOpenMobile }) => {
      const patientDisplayName = patient
        ? getPatientInfoDisplayName(patient) || "Kein Patient ausgewählt"
        : "Kein Patient ausgewählt";

      const handleOpenInPvs = () => {
        if (patient?.patientId) {
          dispatchCustomEvent("praxisplaner:openInPvs", {
            patientId: patient.patientId,
          });
          // Close mobile sidebar when opening patient in PVS
          if (isMobile) {
            setOpenMobile(false);
          }
        }
      };
      const handleLinkWithPvs = () => {
        if (
          patient?.recordType !== "temporary" ||
          patient.bookingIdentityId === undefined
        ) {
          return;
        }

        dispatchCustomEvent("praxisplaner:openInPvs", {
          bookingIdentityId: patient.bookingIdentityId,
          patient: {
            name: getPatientInfoDisplayName(patient),
            phoneNumber: patient.phoneNumber,
          },
          purpose: "link",
        });
        if (isMobile) {
          setOpenMobile(false);
        }
      };

      // Mobile: render as a Sheet overlay
      if (isMobile) {
        return (
          <Sheet onOpenChange={setOpenMobile} open={openMobile}>
            <SheetContent
              className="bg-background text-foreground w-(--sidebar-width) p-0 [&>button]:hidden"
              data-mobile="true"
              data-sidebar="sidebar"
              side="right"
              style={
                {
                  "--sidebar-width": RIGHT_SIDEBAR_WIDTH_MOBILE,
                } as React.CSSProperties
              }
            >
              <SheetHeader className="sr-only">
                <SheetTitle>Patientendaten</SheetTitle>
                <SheetDescription>Zeigt Patientendaten an.</SheetDescription>
              </SheetHeader>
              <div className="flex h-full w-full flex-col">
                <RightSidebarContent
                  handleLinkWithPvs={handleLinkWithPvs}
                  handleOpenInPvs={handleOpenInPvs}
                  onPatientSelected={onPatientSelected}
                  onSelectAppointment={onSelectAppointment}
                  onUpdateAppointmentSmiley={onUpdateAppointmentSmiley}
                  patient={patient}
                  patientAppointments={patientAppointments}
                  patientDisplayName={patientDisplayName}
                  practiceId={practiceId}
                  ruleSetId={ruleSetId}
                  selectedAppointmentId={selectedAppointmentId}
                  selectedPatientId={selectedPatientId}
                  selectedSeriesId={selectedSeriesId}
                  showGdtAlert={showGdtAlert}
                />
              </div>
            </SheetContent>
          </Sheet>
        );
      }

      // Desktop: render as a sidebar that pushes content
      return (
        <div
          className="group peer text-sidebar-foreground hidden md:block h-full relative"
          data-side="right"
          data-state={open ? "expanded" : "collapsed"}
          style={
            { "--sidebar-width": RIGHT_SIDEBAR_WIDTH } as React.CSSProperties
          }
        >
          {/* Gap element that pushes the content */}
          <div
            className={cn(
              "bg-transparent transition-[width] duration-200 ease-linear h-full",
              open ? "w-(--sidebar-width)" : "w-0",
            )}
          />
          {/* Actual sidebar container */}
          <div
            className={cn(
              "absolute top-0 z-10 hidden h-full w-(--sidebar-width) transition-[right] duration-200 ease-linear md:flex border-l",
              open ? "right-0" : "right-[calc(var(--sidebar-width)*-1)]",
            )}
          >
            <div className="bg-background flex h-full w-full flex-col">
              <RightSidebarContent
                handleLinkWithPvs={handleLinkWithPvs}
                handleOpenInPvs={handleOpenInPvs}
                onPatientSelected={onPatientSelected}
                onSelectAppointment={onSelectAppointment}
                onUpdateAppointmentSmiley={onUpdateAppointmentSmiley}
                patient={patient}
                patientAppointments={patientAppointments}
                patientDisplayName={patientDisplayName}
                practiceId={practiceId}
                ruleSetId={ruleSetId}
                selectedAppointmentId={selectedAppointmentId}
                selectedPatientId={selectedPatientId}
                selectedSeriesId={selectedSeriesId}
                showGdtAlert={showGdtAlert}
              />
            </div>
          </div>
        </div>
      );
    },
    (error) => {
      captureFrontendError(error, undefined, "calendar-right-sidebar-context");
      return null;
    },
  );
}

export function RightSidebarProvider({
  children,
  defaultOpen = false,
}: {
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(defaultOpen);
  const [openMobile, setOpenMobile] = React.useState(false);

  const toggleSidebar = React.useCallback(() => {
    if (isMobile) {
      setOpenMobile((prev) => !prev);
    } else {
      setOpen((prev) => !prev);
    }
  }, [isMobile]);

  const contextValue = React.useMemo<RightSidebarContextProps>(
    () => ({
      isMobile,
      open,
      openMobile,
      setOpen,
      setOpenMobile,
      toggleSidebar,
    }),
    [isMobile, open, openMobile, toggleSidebar],
  );

  return (
    <RightSidebarContext.Provider value={contextValue}>
      {children}
    </RightSidebarContext.Provider>
  );
}

export function RightSidebarTrigger({ className }: { className?: string }) {
  return useRightSidebar().match(
    ({ toggleSidebar }) => (
      <Button
        className={cn("size-7", className)}
        onClick={toggleSidebar}
        size="icon"
        title="Patientendaten anzeigen"
        variant="ghost"
      >
        <PanelRightIcon />
        <span className="sr-only">Patientendaten anzeigen</span>
      </Button>
    ),
    (error) => {
      captureFrontendError(error, undefined, "right-sidebar-trigger-context");
      return null;
    },
  );
}

export function useRightSidebar(): Result<
  RightSidebarContextProps,
  FrontendError
> {
  const context = React.useContext(RightSidebarContext);
  if (!context) {
    return err(
      missingContextError("useRightSidebar", "a RightSidebarProvider"),
    );
  }
  return ok(context);
}

function AppointmentSmileyEditor({
  appointment,
  disabled,
  onChange,
  options,
}: {
  appointment: SidebarAppointment;
  disabled: boolean;
  onChange: (smiley: AppointmentSmiley | null) => void;
  options: readonly AppointmentSmileyOption[];
}) {
  const selectedOption =
    appointment.smiley === undefined
      ? undefined
      : options.find((option) => option.emoji === appointment.smiley);
  const hasSmiley = appointment.smiley !== undefined;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-start gap-2">
        <Popover>
          <PopoverTrigger asChild>
            {hasSmiley ? (
              <Button
                aria-label="Termin-Smiley ändern"
                className="h-auto min-w-0 flex-1 justify-start rounded-md border bg-background px-2 py-1.5 text-left font-normal hover:bg-muted/50"
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation();
                }}
                type="button"
                variant="ghost"
              >
                <span className="flex min-w-0 items-start gap-2">
                  <span aria-hidden="true" className="text-base leading-none">
                    {appointment.smiley}
                  </span>
                  <span className="min-w-0 text-xs">
                    <span className="block truncate font-medium">
                      {selectedOption?.name ?? "Unbekannter Termin-Smiley"}
                    </span>
                    {selectedOption === undefined ? (
                      <span className="block text-muted-foreground">
                        Nicht mehr konfiguriert
                      </span>
                    ) : null}
                  </span>
                </span>
              </Button>
            ) : (
              <Button
                aria-label="Termin-Smiley auswählen"
                className="h-8 w-8 shrink-0"
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation();
                }}
                size="icon"
                type="button"
                variant="outline"
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-64 p-2"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="space-y-1">
              {options.length === 0 ? (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">
                  Keine Smileys konfiguriert.
                </p>
              ) : (
                options.map((option) => (
                  <Button
                    className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-left"
                    disabled={disabled}
                    key={option.emoji}
                    onClick={() => {
                      onChange(option.emoji);
                    }}
                    type="button"
                    variant={
                      appointment.smiley === option.emoji
                        ? "secondary"
                        : "ghost"
                    }
                  >
                    <span aria-hidden="true" className="text-base">
                      {option.emoji}
                    </span>
                    <span className="min-w-0 truncate text-sm">
                      {option.name}
                    </span>
                  </Button>
                ))
              )}
              {appointment.smiley === undefined ? null : (
                <Button
                  className="h-8 w-full justify-start gap-2 px-2 text-sm"
                  disabled={disabled}
                  onClick={() => {
                    onChange(null);
                  }}
                  type="button"
                  variant="ghost"
                >
                  <X className="h-4 w-4" />
                  Entfernen
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

function RightSidebarContent({
  handleLinkWithPvs,
  handleOpenInPvs,
  onPatientSelected,
  onSelectAppointment,
  onUpdateAppointmentSmiley,
  patient,
  patientAppointments,
  patientDisplayName,
  practiceId,
  ruleSetId,
  selectedAppointmentId,
  selectedPatientId,
  selectedSeriesId,
  showGdtAlert,
}: {
  handleLinkWithPvs: () => void;
  handleOpenInPvs: () => void;
  onPatientSelected: ((patient?: PracticePatientSelection) => void) | undefined;
  onSelectAppointment: ((appointment: SidebarAppointment) => void) | undefined;
  onUpdateAppointmentSmiley:
    | ((args: {
        id: Id<"appointments">;
        smiley: AppointmentSmiley | null;
      }) => Promise<void>)
    | undefined;
  patient: PatientInfo | undefined;
  patientAppointments: SidebarAppointment[] | undefined;
  patientDisplayName: string;
  practiceId: Id<"practices"> | undefined;
  ruleSetId: Id<"ruleSets"> | undefined;
  selectedAppointmentId: Id<"appointments"> | undefined;
  selectedPatientId: Id<"patients"> | undefined;
  selectedSeriesId: string | undefined;
  showGdtAlert: boolean | undefined;
}) {
  const [pendingSmileyAppointmentId, startSmileyTransition] =
    React.useTransition();
  const appointmentSmileyOptionsRuleSetId =
    resolveAppointmentSmileyOptionsRuleSetId({
      defaultRuleSetId: ruleSetId,
      patientAppointments,
      selectedAppointmentId,
      selectedSeriesId,
    });
  const ruleSetAppointmentSmileyOptions = useQuery(
    api.ruleSets.getAppointmentSmileyOptionsForRuleSet,
    practiceId && appointmentSmileyOptionsRuleSetId
      ? { practiceId, ruleSetId: appointmentSmileyOptionsRuleSetId }
      : "skip",
  );
  const practiceAppointmentSmileyOptions = useQuery(
    api.practices.getAppointmentSmileyOptions,
    practiceId && !appointmentSmileyOptionsRuleSetId ? { practiceId } : "skip",
  );
  const appointmentSmileyOptions =
    appointmentSmileyOptionsRuleSetId === undefined
      ? practiceAppointmentSmileyOptions
      : ruleSetAppointmentSmileyOptions;
  const updateAppointmentSmiley = useMutation(
    api.appointments.updateAppointmentSmiley,
  );
  const bookingFieldEntries =
    patient?.userId === undefined ? [] : getBookingFieldEntries(patient);

  return (
    <ScrollArea className="flex-1">
      <div className="p-4 pb-[100%]">
        {showGdtAlert && (
          <div className="mb-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Keine GDT-Verbindung</AlertTitle>
              <AlertDescription>
                Keine Verbindung mit dem PVS möglich!
              </AlertDescription>
            </Alert>
          </div>
        )}
        {practiceId && onPatientSelected && (
          <div className="mb-4">
            <PatientSelectionPanel
              initialSelection={getPatientSelectionPanelInitialSelection({
                patient,
                selectedPatientId,
              })}
              key={
                selectedPatientId ??
                (patient?.userId
                  ? `user:${patient.userId}`
                  : patient?.recordType === "pvs"
                    ? `pvs:${patient.convexPatientId}`
                    : "empty")
              }
              onPatientSelected={onPatientSelected}
              practiceId={practiceId}
            />
          </div>
        )}
        {patient ? (
          <div className="space-y-3">
            {/* Patient Name */}
            <p className="text-lg font-semibold">{patientDisplayName}</p>

            {bookingFieldEntries.length > 0 ? (
              <div className="space-y-1">
                {bookingFieldEntries.map((entry) => (
                  <p className="text-sm" key={entry.field}>
                    <span className="text-muted-foreground">
                      {entry.label}:
                    </span>{" "}
                    {entry.value}
                  </p>
                ))}
              </div>
            ) : (
              <>
                {/* Date of Birth */}
                {patient.dateOfBirth !== undefined && (
                  <p className="text-sm text-muted-foreground">
                    {formatGermanDate(patient.dateOfBirth)}
                  </p>
                )}

                {/* Email (online booking) */}
                {patient.email && (
                  <p className="text-sm text-muted-foreground">
                    {patient.email}
                  </p>
                )}

                {patient.phoneNumber && (
                  <p className="text-sm text-muted-foreground">
                    {patient.phoneNumber}
                  </p>
                )}

                {/* Address - Street */}
                {patient.street && <p className="text-sm">{patient.street}</p>}

                {/* Address - City */}
                {patient.city && <p className="text-sm">{patient.city}</p>}
              </>
            )}

            <Separator />

            {/* Patient Status */}
            {patient.isNewPatient !== undefined && (
              <p className="text-sm">
                {patient.isNewPatient ? "Neupatient" : "Bestandspatient"}
              </p>
            )}

            {/* Open in PVS Button */}
            {patient.patientId !== undefined && (
              <Button
                className="w-full gap-1.5"
                onClick={handleOpenInPvs}
                size="sm"
                variant="outline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Im PVS öffnen
              </Button>
            )}

            {practiceId !== undefined &&
              patient.recordType === "temporary" &&
              patient.bookingIdentityId !== undefined && (
                <Button
                  className="w-full gap-1.5"
                  onClick={handleLinkWithPvs}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Mit dem PVS verknüpfen
                </Button>
              )}

            {/* Patient ID */}
            {patient.patientId !== undefined && (
              <p className="text-xs text-muted-foreground">
                {patient.patientId}
              </p>
            )}

            {/* Patient Appointments List */}
            {patientAppointments !== undefined &&
              patientAppointments.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm font-medium">Termine</p>
                      <Badge className="ml-auto text-xs" variant="secondary">
                        {patientAppointments.length}
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      {patientAppointments.toReversed().map((appointment) => {
                        const isExactSelectedAppointment =
                          shouldShowAppointmentSmileyEditor({
                            appointmentId: appointment._id,
                            selectedAppointmentId,
                          });
                        const isSelected =
                          isExactSelectedAppointment ||
                          (selectedSeriesId !== undefined &&
                            appointment.seriesId === selectedSeriesId);
                        return (
                          <div
                            className={cn(
                              "rounded-md p-2 text-sm transition-colors",
                              isSelected &&
                                "bg-info-muted text-info-foreground ring-2 ring-selection-ring",
                            )}
                            key={appointment._id}
                          >
                            <button
                              className={cn(
                                "w-full rounded-sm text-left transition-colors",
                                "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                              )}
                              onClick={() => onSelectAppointment?.(appointment)}
                              type="button"
                            >
                              <div className="flex min-w-0 items-center gap-1.5">
                                <p className="truncate font-medium">
                                  {appointment.title}
                                </p>
                              </div>
                              <p className="text-xs text-muted-foreground truncate">
                                {appointment.appointmentTypeTitle}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatAppointmentDateTime(appointment.start)}
                              </p>
                            </button>
                            {isExactSelectedAppointment &&
                              appointmentSmileyOptions && (
                                <AppointmentSmileyEditor
                                  appointment={appointment}
                                  disabled={pendingSmileyAppointmentId}
                                  onChange={(smiley) => {
                                    startSmileyTransition(() => {
                                      void (onUpdateAppointmentSmiley
                                        ? onUpdateAppointmentSmiley({
                                            id: appointment._id,
                                            smiley,
                                          })
                                        : updateAppointmentSmiley({
                                            id: appointment._id,
                                            smiley,
                                          }));
                                    });
                                  }}
                                  options={appointmentSmileyOptions}
                                />
                              )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Kein Patient ausgewählt.
            </p>
            <p className="text-xs text-muted-foreground">
              Wählen Sie einen Patienten aus oder legen Sie beim Erstellen eines
              Termins einen temporären Patienten an.
            </p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

// Helper to format dates in German format
function formatGermanDate(dateString: string) {
  const date = new Date(dateString);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  return dateString;
}

function getBookingFieldEntries(patient: PatientInfo): {
  field: keyof BookingPersonalData;
  label: string;
  value: string;
}[] {
  const entries: {
    field: keyof BookingPersonalData;
    label: string;
    value: string;
  }[] = [];

  for (const field of BOOKING_FIELD_ORDER) {
    const rawValue = patient[field];
    if (typeof rawValue === "string" && rawValue.trim().length > 0) {
      let value = rawValue;
      if (field === "dateOfBirth") {
        value = formatGermanDate(rawValue);
      }
      if (field === "gender") {
        value = isBookingGender(rawValue) ? GENDER_LABELS[rawValue] : rawValue;
      }
      const label = BOOKING_FIELD_LABELS[field];
      if (!label) {
        continue;
      }

      entries.push({
        field,
        label,
        value,
      });
    }
  }

  return entries;
}

// Helper to format appointment date/time for the list in German
const formatAppointmentDateTime = formatZonedDateTimeDE;
