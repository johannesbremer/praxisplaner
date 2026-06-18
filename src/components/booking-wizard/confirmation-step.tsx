import { useMutation } from "convex/react";
import ical, { ICalAlarmType } from "ical-generator";
import { CalendarCheck, Download, Printer } from "lucide-react";
import { ResultAsync } from "neverthrow";
import { useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";

import type { Id } from "@/convex/_generated/dataModel";
import type { BookedAppointmentSummaryItem } from "@/convex/appointments";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "@/convex/_generated/api";

import {
  captureFrontendError,
  frontendErrorFromUnknown,
} from "../../utils/frontend-errors";

interface AppointmentConfirmationCardProps {
  appointmentId: Id<"appointments">;
  description: string;
  duration: number;
  isCancelled: boolean;
  isCancelling: boolean;
  onCancel: () => void;
  practitionerName?: string;
  startTime: string;
  title: string;
}

interface BookedAppointmentsSummaryProps {
  appointments: BookedAppointmentSummaryItem[];
  onCancelled?: () => Promise<void> | void;
  practitionerNamesById?: ReadonlyMap<Id<"practitioners">, string>;
}

interface BookedAppointmentSummaryProps {
  appointment: Extract<BookedAppointmentSummaryItem, { kind: "appointment" }>;
  onCancelled?: () => Promise<void> | void;
  practitionerName?: string;
}

export function BookedAppointmentsSummary({
  appointments,
  onCancelled,
  practitionerNamesById,
}: BookedAppointmentsSummaryProps) {
  return (
    <Card className="max-w-3xl mx-auto">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-lg bg-success-muted">
          <CalendarCheck className="h-8 w-8 text-success-foreground" />
        </div>
        <CardTitle className="text-2xl">Ihre zukünftigen Termine</CardTitle>
        <CardDescription>
          Hier sehen Sie alle aktuell gebuchten zukünftigen Termine.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {appointments.map((appointment) => {
          if (appointment.kind === "legacy-unmatched-future-hold") {
            return (
              <LegacyUnmatchedFutureBookingHoldSummaryItem
                hold={appointment}
                key={`${appointment.kind}:${appointment._id}`}
              />
            );
          }

          const practitionerName = appointment.practitionerId
            ? practitionerNamesById?.get(appointment.practitionerId)
            : undefined;

          return (
            <BookedAppointmentsSummaryItem
              appointment={appointment}
              key={`${appointment.kind}:${appointment._id}`}
              {...(onCancelled ? { onCancelled } : {})}
              {...(practitionerName ? { practitionerName } : {})}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}

export function BookedAppointmentSummary({
  appointment,
  onCancelled,
  practitionerName,
}: BookedAppointmentSummaryProps) {
  const { cancelAppointment, isCancelled, isCancelling } =
    useAppointmentCancellation(onCancelled);

  const duration = getDurationMinutes(appointment.end, appointment.start);

  return (
    <AppointmentConfirmationCard
      appointmentId={appointment._id}
      description="Sie können den Termin in Ihren Kalender übernehmen oder direkt stornieren."
      duration={duration}
      isCancelled={isCancelled}
      isCancelling={isCancelling}
      onCancel={() => {
        void cancelAppointment(appointment._id);
      }}
      {...(practitionerName ? { practitionerName } : {})}
      startTime={appointment.start}
      title="Sie haben bereits einen gebuchten Termin"
    />
  );
}

function AppointmentConfirmationCard({
  appointmentId,
  description,
  duration,
  isCancelled,
  isCancelling,
  onCancel,
  practitionerName,
  startTime,
  title,
}: AppointmentConfirmationCardProps) {
  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-lg bg-success-muted">
          <CalendarCheck className="h-8 w-8 text-success-foreground" />
        </div>
        <CardTitle className="text-2xl">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Datum</span>
            <span className="font-medium">{formatDate(startTime)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Uhrzeit</span>
            <span className="font-medium">{formatTime(startTime)} Uhr</span>
          </div>
          {practitionerName ? (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Behandler/in</span>
              <span className="font-medium">{practitionerName}</span>
            </div>
          ) : null}
        </div>

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

        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            className="flex-1"
            onClick={() => {
              downloadICS(
                String(appointmentId),
                startTime,
                duration,
                "Arzttermin",
                "Praxis",
                practitionerName,
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

        <Button
          className="w-full"
          disabled={isCancelled || isCancelling}
          onClick={onCancel}
          variant="destructive"
        >
          {isCancelled
            ? "Termin storniert"
            : isCancelling
              ? "Storniere..."
              : "Termin stornieren"}
        </Button>

        <div className="text-center pt-4 border-t">
          <p className="text-sm text-muted-foreground mb-4">
            Sie erhalten in Kürze eine Bestätigung per E-Mail (falls angegeben).
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function BookedAppointmentsSummaryItem({
  appointment,
  onCancelled,
  practitionerName,
}: BookedAppointmentSummaryProps) {
  const { cancelAppointment, isCancelled, isCancelling } =
    useAppointmentCancellation(onCancelled);
  const duration = getDurationMinutes(appointment.end, appointment.start);

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="font-medium">{appointment.appointmentTypeTitle}</p>
          <p className="text-sm text-muted-foreground">
            {formatDate(appointment.start)} um {formatTime(appointment.start)}{" "}
            Uhr
          </p>
          {practitionerName ? (
            <p className="text-sm text-muted-foreground">
              Behandler/in: {practitionerName}
            </p>
          ) : null}
        </div>
        {appointment.seriesId ? (
          <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
            Kette
          </span>
        ) : null}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          className="flex-1"
          onClick={() => {
            downloadICS(
              String(appointment._id),
              appointment.start,
              duration,
              appointment.appointmentTypeTitle,
              "Praxis",
              practitionerName,
            );
          }}
          variant="outline"
        >
          <Download className="w-4 h-4 mr-2" />
          Zum Kalender hinzufügen
        </Button>
        <Button
          className="flex-1"
          disabled={isCancelled || isCancelling}
          onClick={() => {
            void cancelAppointment(appointment._id);
          }}
          variant="destructive"
        >
          {isCancelled
            ? "Termin storniert"
            : isCancelling
              ? "Storniere..."
              : "Termin stornieren"}
        </Button>
      </div>

      {appointment.seriesId ? (
        <p className="text-sm text-muted-foreground">
          Das Stornieren dieses Kettentermins storniert die gesamte verbleibende
          Terminserie.
        </p>
      ) : null}
    </div>
  );
}

function downloadICS(
  appointmentId: string,
  startTime: string,
  duration: number,
  title: string,
  location: string,
  practitionerName?: string,
) {
  const start = Temporal.ZonedDateTime.from(startTime);
  const end = start.add({ minutes: duration });

  const calendar = ical({
    name: "Praxisplaner",
    prodId: { company: "Praxisplaner", language: "DE", product: "Booking" },
    timezone: "Europe/Berlin",
  });

  const event = calendar.createEvent({
    ...(practitionerName
      ? { description: `Termin bei ${practitionerName}` }
      : {}),
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

function formatDate(isoString: string): string {
  return Temporal.ZonedDateTime.from(isoString).toLocaleString("de-DE", {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  });
}

function formatTime(isoString: string): string {
  return Temporal.ZonedDateTime.from(isoString).toLocaleString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getDurationMinutes(endTime: string, startTime: string): number {
  const endEpochMilliseconds =
    Temporal.ZonedDateTime.from(endTime).epochMilliseconds;
  const startEpochMilliseconds =
    Temporal.ZonedDateTime.from(startTime).epochMilliseconds;
  const duration = Math.round(
    (endEpochMilliseconds - startEpochMilliseconds) / 60_000,
  );
  return Math.max(1, duration);
}

function LegacyUnmatchedFutureBookingHoldSummaryItem({
  hold,
}: {
  hold: Extract<
    BookedAppointmentSummaryItem,
    { kind: "legacy-unmatched-future-hold" }
  >;
}) {
  const resolvedTitle = hold.legacyType ?? "Importierter zukünftiger Termin";

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="font-medium">{resolvedTitle}</p>
          <p className="text-sm text-muted-foreground">
            {formatDate(hold.start)} um {formatTime(hold.start)} Uhr
          </p>
          <p className="text-sm text-muted-foreground">
            Standort: {hold.locationName ?? "Praxis"}
          </p>
          {hold.practitionerName ? (
            <p className="text-sm text-muted-foreground">
              Behandler/in: {hold.practitionerName}
            </p>
          ) : null}
        </div>
        <span className="rounded-md bg-warning-muted px-2 py-1 text-xs text-warning-foreground">
          Importierter Altfall
        </span>
      </div>

      <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
        Dieser zukünftige Termin wurde aus dem alten Online-System importiert,
        konnte aber nicht sicher mit dem Quellsystem verknüpft werden. Bitte
        kontaktieren Sie die Praxis, wenn Sie diesen Termin ändern oder absagen
        möchten.
      </div>
    </div>
  );
}

function useAppointmentCancellation(onCancelled?: () => Promise<void> | void) {
  const cancelOwnAppointment = useMutation(
    api.appointments.cancelOwnAppointment,
  );
  const [isCancelled, setIsCancelled] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const cancelAppointment = async (appointmentId: Id<"appointments">) => {
    if (isCancelled || isCancelling) {
      return;
    }

    setIsCancelling(true);
    await ResultAsync.fromPromise(
      cancelOwnAppointment({ appointmentId }),
      (error) =>
        frontendErrorFromUnknown(error, {
          kind: "unknown",
          message: "Termin konnte nicht storniert werden.",
          source: "BookedAppointmentsSummary.cancelAppointment",
        }),
    )
      .andThen(() =>
        ResultAsync.fromPromise(Promise.resolve(onCancelled?.()), (error) =>
          frontendErrorFromUnknown(error, {
            kind: "unknown",
            message:
              "Termin wurde storniert, aber die Ansicht konnte nicht aktualisiert werden.",
            source: "BookedAppointmentsSummary.onCancelled",
          }),
        ),
      )
      .match(
        () => {
          setIsCancelled(true);
          toast.success("Termin wurde storniert");
        },
        (error) => {
          captureFrontendError(error, {
            appointmentId,
            context: "BookedAppointmentsSummary.cancelAppointment",
          });
          toast.error("Termin konnte nicht storniert werden", {
            description: error.message || "Bitte versuchen Sie es erneut.",
          });
        },
      )
      .finally(() => {
        setIsCancelling(false);
      });
  };

  return { cancelAppointment, isCancelled, isCancelling };
}
