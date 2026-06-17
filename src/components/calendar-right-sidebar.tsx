"use client";

import { useMutation, useQuery } from "convex/react";
import {
  AlertCircle,
  Calendar,
  ExternalLink,
  Link2,
  PanelRightIcon,
} from "lucide-react";
import { err, ok, type Result } from "neverthrow";
import * as React from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { api } from "@/convex/_generated/api";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

import type { Id } from "../../convex/_generated/dataModel";
import type { AppointmentResult } from "../../convex/appointments";
import type { BookingPersonalData } from "../../convex/bookingSessions.shared";
import type { PatientInfo, PracticePatientSelection } from "../types";

import { dispatchCustomEvent } from "../utils/browser-api";
import { formatZonedDateTimeDE } from "../utils/date-utils";
import {
  captureFrontendError,
  type FrontendError,
  missingContextError,
} from "../utils/frontend-errors";
import {
  formatPatientOptionLabel,
  getPatientInfoDisplayName,
  patientDocToInfo,
} from "../utils/patient-info";
import {
  getPatientSelectionPanelInitialSelection,
  PatientSelectionPanel,
} from "./patient-selection-panel";

// Appointment type for the sidebar list
export type SidebarAppointment = AppointmentResult;

interface CalendarRightSidebarProps {
  onPatientSelected?:
    | ((patient?: PracticePatientSelection) => void)
    | undefined;
  onSelectAppointment?: ((appointment: SidebarAppointment) => void) | undefined;
  patient?: PatientInfo | undefined;
  patientAppointments?: SidebarAppointment[] | undefined;
  practiceId?: Id<"practices"> | undefined;
  selectedAppointmentId?: Id<"appointments"> | undefined;
  selectedPatientId?: Id<"patients"> | undefined;
  selectedSeriesId?: string | undefined;
  showGdtAlert?: boolean | undefined;
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
  patient,
  patientAppointments,
  practiceId,
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
                  handleOpenInPvs={handleOpenInPvs}
                  onPatientSelected={onPatientSelected}
                  onSelectAppointment={onSelectAppointment}
                  patient={patient}
                  patientAppointments={patientAppointments}
                  patientDisplayName={patientDisplayName}
                  practiceId={practiceId}
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
                handleOpenInPvs={handleOpenInPvs}
                onPatientSelected={onPatientSelected}
                onSelectAppointment={onSelectAppointment}
                patient={patient}
                patientAppointments={patientAppointments}
                patientDisplayName={patientDisplayName}
                practiceId={practiceId}
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

function RightSidebarContent({
  handleOpenInPvs,
  onPatientSelected,
  onSelectAppointment,
  patient,
  patientAppointments,
  patientDisplayName,
  practiceId,
  selectedAppointmentId,
  selectedPatientId,
  selectedSeriesId,
  showGdtAlert,
}: {
  handleOpenInPvs: () => void;
  onPatientSelected: ((patient?: PracticePatientSelection) => void) | undefined;
  onSelectAppointment: ((appointment: SidebarAppointment) => void) | undefined;
  patient: PatientInfo | undefined;
  patientAppointments: SidebarAppointment[] | undefined;
  patientDisplayName: string;
  practiceId: Id<"practices"> | undefined;
  selectedAppointmentId: Id<"appointments"> | undefined;
  selectedPatientId: Id<"patients"> | undefined;
  selectedSeriesId: string | undefined;
  showGdtAlert: boolean | undefined;
}) {
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
              patient.bookingIdentityId !== undefined &&
              onPatientSelected !== undefined && (
                <TemporaryPatientPvsLinkDialog
                  bookingIdentityId={patient.bookingIdentityId}
                  onPatientSelected={onPatientSelected}
                  practiceId={practiceId}
                />
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
                        const isSelected =
                          selectedAppointmentId === appointment._id ||
                          (selectedSeriesId !== undefined &&
                            appointment.seriesId === selectedSeriesId);
                        return (
                          <button
                            className={cn(
                              "w-full text-left p-2 rounded-md text-sm transition-colors",
                              "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                              isSelected &&
                                "bg-info-muted text-info-foreground ring-2 ring-info",
                            )}
                            key={appointment._id}
                            onClick={() => onSelectAppointment?.(appointment)}
                          >
                            <p className="font-medium truncate">
                              {appointment.title}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {appointment.appointmentTypeTitle}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatAppointmentDateTime(appointment.start)}
                            </p>
                          </button>
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

function TemporaryPatientPvsLinkDialog({
  bookingIdentityId,
  onPatientSelected,
  practiceId,
}: {
  bookingIdentityId: Id<"bookingIdentities">;
  onPatientSelected: (patient?: PracticePatientSelection) => void;
  practiceId: Id<"practices">;
}) {
  const [open, setOpen] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState("");
  const [selectedPatientId, setSelectedPatientId] = React.useState<
    Id<"patients"> | undefined
  >();
  const [isLinking, setIsLinking] = React.useState(false);
  const deferredSearchTerm = React.useDeferredValue(searchTerm.trim());
  const associateBookingIdentityWithPvsPatient = useMutation(
    api.bookingIdentities.associateBookingIdentityWithPvsPatient,
  );
  const activePvsPatient = useQuery(
    api.bookingIdentities.getActivePvsPatientForBookingIdentity,
    { bookingIdentityId, practiceId },
  );
  const patients = useQuery(
    api.patients.searchPatients,
    open ? { practiceId, searchTerm: deferredSearchTerm } : "skip",
  );
  const pvsPatients = React.useMemo(
    () =>
      (patients ?? []).filter((candidate) => candidate.recordType === "pvs"),
    [patients],
  );
  const selectedPatient = pvsPatients.find(
    (candidate) => candidate._id === selectedPatientId,
  );

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearchTerm("");
      setSelectedPatientId(undefined);
    }
  };

  const handleLink = async () => {
    if (selectedPatient === undefined) {
      return;
    }

    const selectedPatientInfo = patientDocToInfo(selectedPatient).match(
      (info) => info,
      (error) => {
        captureFrontendError(error, undefined, "temporary-patient-pvs-link");
        toast.error("Der PVS-Patient konnte nicht gelesen werden.");
        return null;
      },
    );
    if (selectedPatientInfo === null) {
      return;
    }

    setIsLinking(true);
    try {
      await associateBookingIdentityWithPvsPatient({
        bookingIdentityId,
        method: "manual",
        patientId: selectedPatient._id,
        practiceId,
        ...(selectedPatient.patientId === undefined
          ? {}
          : { pvsPatientNumber: selectedPatient.patientId }),
      });
      onPatientSelected({
        id: selectedPatient._id,
        info: selectedPatientInfo,
      });
      toast.success("Temporärer Patient wurde mit dem PVS verknüpft.");
      handleOpenChange(false);
    } catch {
      toast.error("Der Patient konnte nicht mit dem PVS verknüpft werden.");
    } finally {
      setIsLinking(false);
    }
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <Button
        className="w-full gap-1.5"
        onClick={() => {
          setOpen(true);
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        <Link2 className="h-3.5 w-3.5" />
        Mit dem PVS verknüpfen
      </Button>
      {activePvsPatient !== undefined && activePvsPatient !== null && (
        <p className="text-xs text-muted-foreground">
          Verknüpft mit {formatPatientOptionLabel(activePvsPatient)}
        </p>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mit dem PVS verknüpfen</DialogTitle>
          <DialogDescription>
            Wählen Sie den kanonischen PVS-Patienten für diesen temporären
            Patienten aus.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="temporary-patient-pvs-search">PVS-Patient</Label>
            <Input
              id="temporary-patient-pvs-search"
              onChange={(event) => {
                setSearchTerm(event.target.value);
                setSelectedPatientId(undefined);
              }}
              placeholder="PVS-Patient suchen"
              value={searchTerm}
            />
          </div>

          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-1">
            {pvsPatients.length > 0 ? (
              pvsPatients.map((candidate) => {
                const isSelected = candidate._id === selectedPatientId;
                return (
                  <button
                    className={cn(
                      "w-full rounded-sm px-3 py-2 text-left text-sm transition-colors",
                      isSelected
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent hover:text-accent-foreground",
                    )}
                    key={candidate._id}
                    onClick={() => {
                      setSelectedPatientId(candidate._id);
                    }}
                    type="button"
                  >
                    {formatPatientOptionLabel(candidate)}
                  </button>
                );
              })
            ) : (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                Keine PVS-Patienten gefunden.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => {
              handleOpenChange(false);
            }}
            type="button"
            variant="outline"
          >
            Abbrechen
          </Button>
          <Button
            disabled={selectedPatient === undefined || isLinking}
            onClick={() => {
              void handleLink();
            }}
            type="button"
          >
            Verknüpfen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
