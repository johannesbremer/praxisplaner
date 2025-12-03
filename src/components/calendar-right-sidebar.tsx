"use client";

import { AlertCircle, ExternalLink, PanelRightIcon } from "lucide-react";
import * as React from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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

import type { PatientInfo } from "../types";

import { dispatchCustomEvent } from "../utils/browser-api";

interface CalendarRightSidebarProps {
  patient?: PatientInfo | undefined;
  showGdtAlert?: boolean | undefined;
}

const RIGHT_SIDEBAR_WIDTH = "18rem";
const RIGHT_SIDEBAR_WIDTH_MOBILE = "18rem";

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
  patient,
  showGdtAlert,
}: CalendarRightSidebarProps) {
  const { isMobile, open, openMobile, setOpenMobile } = useRightSidebar();

  const patientDisplayName = patient
    ? patient.firstName && patient.lastName
      ? `${patient.firstName} ${patient.lastName}`
      : patient.patientId
        ? `Patient ${patient.patientId}`
        : "Kein Patient ausgewählt"
    : "Kein Patient ausgewählt";

  const handleOpenInPvs = () => {
    if (patient?.patientId) {
      dispatchCustomEvent("praxisplaner:openInPvs", {
        patientId: patient.patientId,
      });
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
              patient={patient}
              patientDisplayName={patientDisplayName}
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
      style={{ "--sidebar-width": RIGHT_SIDEBAR_WIDTH } as React.CSSProperties}
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
            patient={patient}
            patientDisplayName={patientDisplayName}
            showGdtAlert={showGdtAlert}
          />
        </div>
      </div>
    </div>
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
  const { toggleSidebar } = useRightSidebar();

  return (
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
  );
}

export function useRightSidebar() {
  const context = React.useContext(RightSidebarContext);
  if (!context) {
    throw new Error(
      "useRightSidebar must be used within a RightSidebarProvider",
    );
  }
  return context;
}

function RightSidebarContent({
  handleOpenInPvs,
  patient,
  patientDisplayName,
  showGdtAlert,
}: {
  handleOpenInPvs: () => void;
  patient: PatientInfo | undefined;
  patientDisplayName: string;
  showGdtAlert: boolean | undefined;
}) {
  return (
    <ScrollArea className="flex-1">
      <div className="p-4">
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
        {patient ? (
          <div className="space-y-3">
            {/* Patient Name */}
            <p className="text-lg font-semibold">{patientDisplayName}</p>

            {/* Date of Birth */}
            {patient.dateOfBirth !== undefined && (
              <p className="text-sm text-muted-foreground">
                {formatGermanDate(patient.dateOfBirth)}
              </p>
            )}

            {/* Address - Street */}
            {patient.street && <p className="text-sm">{patient.street}</p>}

            {/* Address - City */}
            {patient.city && <p className="text-sm">{patient.city}</p>}

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

            {/* Patient ID */}
            {patient.patientId !== undefined && (
              <p className="text-xs text-muted-foreground">
                {patient.patientId}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Kein Patient aus dem PVS ausgewählt.
            </p>
            <p className="text-xs text-muted-foreground">
              Wählen Sie einen Patienten in Ihrem Praxisverwaltungssystem aus,
              um dessen Daten hier anzuzeigen.
            </p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

// Helper to format dates in German format
function formatGermanDate(dateString: string) {
  // Handle ISO date format (YYYY-MM-DD)
  const date = new Date(dateString);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  // Fallback: if it's in GDT format TTMMJJJJ
  if (dateString.length === 8) {
    const day = dateString.slice(0, 2);
    const month = dateString.slice(2, 4);
    const year = dateString.slice(4, 8);
    return `${day}.${month}.${year}`;
  }

  return dateString;
}
