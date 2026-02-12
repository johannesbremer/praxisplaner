// Confirmation step component (Final step for both paths)

import ical, { ICalAlarmType } from "ical-generator";
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
export type ConfirmationStepProps = StepComponentProps;

export function ConfirmationStep({
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

  const appointmentId =
    "appointmentId" in state ? (state.appointmentId as string) : null;

  if (!selectedSlot || !personalData || !appointmentId) {
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
                appointmentId,
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

        {/* Follow-up note */}
        <div className="text-center pt-4 border-t">
          <p className="text-sm text-muted-foreground mb-4">
            Sie erhalten in Kürze eine Bestätigung per E-Mail (falls angegeben).
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function downloadICS(
  appointmentId: string,
  startTime: string,
  duration: number,
  title: string,
  location: string,
  practitionerName: string,
) {
  const start = Temporal.ZonedDateTime.from(startTime);
  const end = start.add({ minutes: duration });

  const calendar = ical({
    name: "Praxisplaner",
    prodId: { company: "Praxisplaner", language: "DE", product: "Booking" },
    timezone: "Europe/Berlin",
  });

  const event = calendar.createEvent({
    description: `Termin bei ${practitionerName}`,
    end: new Date(end.epochMilliseconds),
    id: `${appointmentId}@praxisplaner`,
    location,
    start: new Date(start.epochMilliseconds),
    summary: title,
    timezone: "Europe/Berlin",
  });

  event.createAlarm({
    description: "Terminerinnerung",
    trigger: 60 * 60, // 1 hour before (in seconds)
    type: ICalAlarmType.display,
  });

  const icsContent = calendar.toString();
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
