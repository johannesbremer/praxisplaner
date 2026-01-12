// Confirmation step component (Final step for both paths)

import { CalendarCheck, Download, Printer } from "lucide-react";
import { Temporal } from "temporal-polyfill";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type { StepComponentProps } from "./types";

// Helper to format time from ISO string
function formatTime(isoString: string): string {
  const zdt = Temporal.ZonedDateTime.from(isoString);
  return zdt.toPlainTime().toString({ smallestUnit: "minute" });
}

// Helper to format date from ISO string
function formatDate(isoString: string): string {
  const zdt = Temporal.ZonedDateTime.from(isoString);
  const date = zdt.toPlainDate();

  // Format as "Montag, 15. Januar 2025"
  const jsDate = new Date(date.year, date.month - 1, date.day);
  return jsDate.toLocaleDateString("de-DE", {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  });
}

// Generate ICS calendar file content
export interface ConfirmationStepProps extends StepComponentProps {
  onStartOver: () => void;
}

export function ConfirmationStep({
  onStartOver,
  state,
}: ConfirmationStepProps) {
  // Extract data from confirmation state
  const selectedSlot =
    "selectedSlot" in state
      ? (state.selectedSlot as {
          duration: number;
          practitionerId: string;
          practitionerName: string;
          startTime: string;
        })
      : null;

  const personalData =
    "personalData" in state
      ? (state.personalData as {
          firstName: string;
          lastName: string;
        })
      : null;

  if (!selectedSlot || !personalData) {
    return (
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>Fehler</CardTitle>
          <CardDescription>
            Die Terminbestätigung konnte nicht geladen werden.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <CalendarCheck className="w-8 h-8 text-green-600 dark:text-green-400" />
        </div>
        <CardTitle className="text-2xl">Termin erfolgreich gebucht!</CardTitle>
        <CardDescription>
          Vielen Dank, {personalData.firstName}. Wir freuen uns auf Ihren
          Besuch.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Appointment details */}
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Datum</span>
            <span className="font-medium">
              {formatDate(selectedSlot.startTime)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Uhrzeit</span>
            <span className="font-medium">
              {formatTime(selectedSlot.startTime)} Uhr
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Behandler/in</span>
            <span className="font-medium">{selectedSlot.practitionerName}</span>
          </div>
        </div>

        {/* Important notes */}
        <div className="rounded-lg bg-muted/50 p-4 space-y-2">
          <h4 className="font-medium">Wichtige Hinweise:</h4>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li>
              Bitte erscheinen Sie 10 Minuten vor Ihrem Termin in der Praxis.
            </li>
            <li>
              Bringen Sie Ihre Versichertenkarte und einen Lichtbildausweis mit.
            </li>
            <li>
              Falls Sie den Termin nicht wahrnehmen können, sagen Sie bitte
              rechtzeitig ab.
            </li>
          </ul>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            className="flex-1"
            onClick={() => {
              downloadICS(
                selectedSlot.startTime,
                selectedSlot.duration,
                "Arzttermin",
                "Praxis", // TODO: Add actual location name from state
                selectedSlot.practitionerName,
              );
            }}
            variant="outline"
          >
            <Download className="w-4 h-4 mr-2" />
            Zum Kalender hinzufügen
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              globalThis.print();
            }}
            variant="outline"
          >
            <Printer className="w-4 h-4 mr-2" />
            Bestätigung drucken
          </Button>
        </div>

        {/* Close/home button */}
        <div className="text-center pt-4 border-t">
          <p className="text-sm text-muted-foreground mb-4">
            Sie erhalten in Kürze eine Bestätigung per E-Mail (falls angegeben).
          </p>
          <Button onClick={onStartOver} variant="ghost">
            Weiteren Termin buchen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function downloadICS(
  startTime: string,
  duration: number,
  title: string,
  location: string,
  practitionerName: string,
) {
  const icsContent = generateICS(
    startTime,
    duration,
    title,
    location,
    practitionerName,
  );
  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "termin.ics";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function generateICS(
  startTime: string,
  duration: number,
  title: string,
  location: string,
  practitionerName: string,
): string {
  const start = Temporal.ZonedDateTime.from(startTime);
  const end = start.add({ minutes: duration });

  // Format for ICS (YYYYMMDDTHHMMSS)
  const formatICS = (zdt: Temporal.ZonedDateTime) => {
    return zdt
      .toPlainDateTime()
      .toString()
      .replaceAll(/[-:]/g, "")
      .replace("T", "T")
      .slice(0, 15);
  };

  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@praxisplaner`;
  const now = formatICS(Temporal.Now.zonedDateTimeISO("Europe/Berlin"));

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Praxisplaner//Booking//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART;TZID=Europe/Berlin:${formatICS(start)}`,
    `DTEND;TZID=Europe/Berlin:${formatICS(end)}`,
    `SUMMARY:${title}`,
    `LOCATION:${location}`,
    `DESCRIPTION:Termin bei ${practitionerName}`,
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    "DESCRIPTION:Terminerinnerung",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
