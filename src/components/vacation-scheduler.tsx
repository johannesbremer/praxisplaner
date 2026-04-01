import { useMutation, useQuery } from "convex/react";
import {
  BriefcaseMedical,
  ChevronLeft,
  ChevronRight,
  Plus,
  Stethoscope,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";

import type { Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

import { getPractitionerVacationRangesForDate } from "../../lib/vacation-utils";
import {
  getPublicHolidayName,
  getPublicHolidaysData,
} from "../utils/public-holidays";

interface AppointmentConflict {
  end: string;
  id: string;
  locationId?: Id<"locations">;
  start: string;
  title: string;
}

interface ConflictDialogState {
  date: Temporal.PlainDate;
  mode: "create" | "inspect";
  portion: VacationPortion;
  staff: StaffRow;
}

interface StaffRow {
  id: string;
  kind: "mfa" | "practitioner";
  name: string;
}

type VacationPortion = "afternoon" | "full" | "morning";

interface VacationSchedulerProps {
  editable: boolean;
  onDateChange?: (date: Temporal.PlainDate) => void;
  practiceId: Id<"practices">;
  selectedDate: Temporal.PlainDate;
}

const PORTION_META: Record<
  VacationPortion,
  { activeLabel: string; idleLabel: string; short: string }
> = {
  afternoon: {
    activeLabel: "Nachmittag entfernen",
    idleLabel: "Nachmittag setzen",
    short: "NM",
  },
  full: {
    activeLabel: "Ganztag entfernen",
    idleLabel: "Ganztag setzen",
    short: "G",
  },
  morning: {
    activeLabel: "Vormittag entfernen",
    idleLabel: "Vormittag setzen",
    short: "VM",
  },
};

const ORDERED_PORTIONS: VacationPortion[] = ["full", "morning", "afternoon"];

export function VacationScheduler({
  editable,
  onDateChange,
  practiceId,
  selectedDate,
}: VacationSchedulerProps) {
  const monthDate = startOfMonth(selectedDate);
  const monthEndExclusive = endExclusiveMonth(monthDate);
  const practitioners = useQuery(api.entities.getPractitionersFromActive, {
    practiceId,
  });
  const mfas = useQuery(api.mfas.list, { practiceId });
  const vacations = useQuery(api.vacations.getVacationsInRange, {
    endDateExclusive: monthEndExclusive.toString(),
    practiceId,
    startDate: monthDate.toString(),
  });
  const baseSchedules = useQuery(api.entities.getBaseSchedulesFromActive, {
    practiceId,
  });
  const appointments = useQuery(api.appointments.getAppointmentsInRange, {
    end: monthEndExclusive
      .subtract({ days: 1 })
      .toZonedDateTime({
        plainTime: Temporal.PlainTime.from("23:59"),
        timeZone: "Europe/Berlin",
      })
      .toString(),
    scope: "real",
    start: monthDate
      .toZonedDateTime({
        plainTime: Temporal.PlainTime.from("00:00"),
        timeZone: "Europe/Berlin",
      })
      .toString(),
  });
  const locations = useQuery(api.entities.getLocationsFromActive, {
    practiceId,
  });

  const createMfa = useMutation(api.mfas.create);
  const removeMfa = useMutation(api.mfas.remove);
  const createVacation = useMutation(api.vacations.createVacation);
  const deleteVacation = useMutation(api.vacations.deleteVacation);

  const [newMfaName, setNewMfaName] = useState("");
  const [holidayDataLoaded, setHolidayDataLoaded] = useState(false);
  const [conflictDialog, setConflictDialog] =
    useState<ConflictDialogState | null>(null);

  useEffect(() => {
    void getPublicHolidaysData().then(() => {
      setHolidayDataLoaded(true);
    });
  }, []);

  const days = useMemo(() => {
    const result: Temporal.PlainDate[] = [];
    for (
      let current = monthDate;
      Temporal.PlainDate.compare(current, monthEndExclusive) < 0;
      current = current.add({ days: 1 })
    ) {
      result.push(current);
    }
    return result;
  }, [monthDate, monthEndExclusive]);

  const doctorRows = useMemo<StaffRow[]>(
    () =>
      (practitioners ?? [])
        .toSorted((left, right) => left.name.localeCompare(right.name, "de"))
        .map((row) => ({
          id: row._id,
          kind: "practitioner" as const,
          name: row.name,
        })),
    [practitioners],
  );

  const mfaRows = useMemo<StaffRow[]>(
    () =>
      (mfas ?? [])
        .toSorted((left, right) => left.name.localeCompare(right.name, "de"))
        .map((row) => ({
          id: row._id,
          kind: "mfa" as const,
          name: row.name,
        })),
    [mfas],
  );

  const vacationKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const vacation of vacations ?? []) {
      const staffId =
        vacation.staffType === "practitioner"
          ? vacation.practitionerId
          : vacation.mfaId;
      if (!staffId) {
        continue;
      }
      keys.add(
        buildVacationKey(
          vacation.staffType,
          staffId,
          vacation.date,
          vacation.portion,
        ),
      );
    }
    return keys;
  }, [vacations]);

  const navigateMonth = (offset: number) => {
    onDateChange?.(monthDate.add({ months: offset }));
  };

  const isVacationActive = (
    staffType: "mfa" | "practitioner",
    staffId: string,
    date: Temporal.PlainDate,
    portion: VacationPortion,
  ) =>
    vacationKeys.has(
      buildVacationKey(staffType, staffId, date.toString(), portion),
    );

  const getActivePortionsForCell = (
    staff: StaffRow,
    date: Temporal.PlainDate,
  ): VacationPortion[] =>
    ORDERED_PORTIONS.filter((portion) =>
      isVacationActive(staff.kind, staff.id, date, portion),
    );

  const getDisplayedPortionForCell = (
    staff: StaffRow,
    date: Temporal.PlainDate,
  ): null | VacationPortion => {
    const activePortions = getActivePortionsForCell(staff, date);
    if (activePortions.includes("full")) {
      return "full";
    }
    if (
      activePortions.includes("morning") &&
      activePortions.includes("afternoon")
    ) {
      return "full";
    }
    return activePortions[0] ?? null;
  };

  const locationNameById = useMemo(
    () =>
      new Map(
        (locations ?? []).map((location) => [location._id, location.name]),
      ),
    [locations],
  );

  const getAppointmentConflicts = (
    staff: StaffRow,
    date: Temporal.PlainDate,
    portion: VacationPortion,
  ): AppointmentConflict[] => {
    if (staff.kind !== "practitioner" || !appointments || !baseSchedules) {
      return [];
    }

    const vacationRanges = getPractitionerVacationRangesForDate(
      date,
      staff.id,
      baseSchedules,
      [
        {
          date: date.toString(),
          portion,
          practitionerId: staff.id,
          staffType: "practitioner",
        },
      ],
    );

    if (vacationRanges.length === 0) {
      return [];
    }

    return appointments
      .filter(
        (appointment) =>
          appointment.practitionerId === staff.id &&
          Temporal.PlainDate.compare(
            Temporal.ZonedDateTime.from(appointment.start).toPlainDate(),
            date,
          ) === 0,
      )
      .filter((appointment) => {
        const start = Temporal.ZonedDateTime.from(
          appointment.start,
        ).toPlainTime();
        const end = Temporal.ZonedDateTime.from(appointment.end).toPlainTime();
        const startMinutes = start.hour * 60 + start.minute;
        const endMinutes = end.hour * 60 + end.minute;

        return vacationRanges.some(
          (range) =>
            startMinutes < range.endMinutes && endMinutes > range.startMinutes,
        );
      })
      .map((appointment) => ({
        end: appointment.end,
        id: appointment._id,
        locationId: appointment.locationId,
        start: appointment.start,
        title: appointment.title,
      }))
      .toSorted((left, right) => left.start.localeCompare(right.start));
  };

  const clearVacationsForDay = async (
    staff: StaffRow,
    date: Temporal.PlainDate,
  ) => {
    const activePortions = getActivePortionsForCell(staff, date);

    for (const activePortion of activePortions) {
      await deleteVacation({
        date: date.toString(),
        ...(staff.kind === "mfa"
          ? { mfaId: staff.id as Id<"mfas"> }
          : { practitionerId: staff.id as Id<"practitioners"> }),
        portion: activePortion,
        practiceId,
        staffType: staff.kind,
      });
    }
  };

  const upsertVacation = async (
    staff: StaffRow,
    date: Temporal.PlainDate,
    portion: VacationPortion,
  ) => {
    await clearVacationsForDay(staff, date);

    await createVacation({
      date: date.toString(),
      ...(staff.kind === "mfa"
        ? { mfaId: staff.id as Id<"mfas"> }
        : { practitionerId: staff.id as Id<"practitioners"> }),
      portion,
      practiceId,
      staffType: staff.kind,
    });
  };

  const removeVacation = async (staff: StaffRow, date: Temporal.PlainDate) => {
    await clearVacationsForDay(staff, date);
  };

  const handleCreateMfa = async () => {
    const trimmed = newMfaName.trim();
    if (!trimmed) {
      toast.error("Bitte einen MFA-Namen eingeben.");
      return;
    }

    try {
      await createMfa({ name: trimmed, practiceId });
      setNewMfaName("");
      toast.success("MFA hinzugefugt");
    } catch (error) {
      toast.error("MFA konnte nicht angelegt werden", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    }
  };

  const handleRemoveMfa = async (mfaId: Id<"mfas">) => {
    try {
      await removeMfa({ mfaId, practiceId });
      toast.success("MFA entfernt");
    } catch (error) {
      toast.error("MFA konnte nicht entfernt werden", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    }
  };

  const toggleVacation = async (
    staff: StaffRow,
    date: Temporal.PlainDate,
    portion: VacationPortion,
  ) => {
    const displayedPortion = getDisplayedPortionForCell(staff, date);
    const currentlyActive = displayedPortion !== null;
    const conflicts = getAppointmentConflicts(staff, date, portion);

    try {
      if (currentlyActive) {
        setConflictDialog({
          date,
          mode: "inspect",
          portion: displayedPortion,
          staff,
        });
        return;
      }

      if (conflicts.length > 0) {
        setConflictDialog({
          date,
          mode: "create",
          portion,
          staff,
        });
        return;
      }

      await upsertVacation(staff, date, portion);
    } catch (error) {
      toast.error("Urlaub konnte nicht aktualisiert werden", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    }
  };

  const openConflictDialogIfNeeded = (
    staff: StaffRow,
    date: Temporal.PlainDate,
    portion: VacationPortion,
  ) => {
    const conflicts = getAppointmentConflicts(staff, date, portion);
    if (
      conflicts.length === 0 &&
      getDisplayedPortionForCell(staff, date) === null
    ) {
      return false;
    }

    setConflictDialog({
      date,
      mode: "inspect",
      portion,
      staff,
    });
    return true;
  };

  const dialogConflicts = conflictDialog
    ? getAppointmentConflicts(
        conflictDialog.staff,
        conflictDialog.date,
        conflictDialog.portion,
      )
    : [];

  const renderCell = (staff: StaffRow, date: Temporal.PlainDate) => {
    const displayedPortion = getDisplayedPortionForCell(staff, date);
    const holidayName = holidayDataLoaded
      ? getPublicHolidayName(date)
      : undefined;
    const disabledDay = isWeekend(date) || !!holidayName;

    if (!editable) {
      return (
        <div className="flex min-h-12 items-center justify-center">
          {displayedPortion ? (
            <Button
              className="h-7 px-2 text-[10px]"
              onClick={() => {
                void openConflictDialogIfNeeded(staff, date, displayedPortion);
              }}
              size="sm"
              variant="secondary"
            >
              {PORTION_META[displayedPortion].short}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          )}
        </div>
      );
    }

    if (disabledDay) {
      return (
        <div className="flex min-h-12 items-center justify-center text-xs text-muted-foreground">
          -
        </div>
      );
    }

    return (
      <div className="flex min-h-12 items-center justify-center">
        {displayedPortion ? (
          <Button
            className="h-7 px-3 text-[10px]"
            onClick={() => {
              void openConflictDialogIfNeeded(staff, date, displayedPortion);
            }}
            size="sm"
            variant="default"
          >
            {PORTION_META[displayedPortion].short}
          </Button>
        ) : (
          <Button
            className="h-7 px-3 text-[10px]"
            onClick={() => {
              void toggleVacation(staff, date, "full");
            }}
            size="sm"
            variant="outline"
          >
            G
          </Button>
        )}
      </div>
    );
  };

  const isLoading =
    !practitioners || !mfas || !vacations || !appointments || !baseSchedules;

  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="flex items-center justify-between gap-2">
          <Button
            onClick={() => {
              navigateMonth(-1);
            }}
            size="icon"
            variant="outline"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-40 text-center text-sm font-medium">
            {monthDate.toLocaleString("de-DE", {
              month: "long",
              year: "numeric",
            })}
          </div>
          <Button
            onClick={() => {
              navigateMonth(1);
            }}
            size="icon"
            variant="outline"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">
            Urlaubsdaten werden geladen.
          </div>
        ) : (
          <ScrollArea className="w-full rounded-md border">
            <div className="min-w-max">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-20 min-w-56 border-b bg-background p-3 text-left">
                      Mitarbeiter
                    </th>
                    {days.map((date) => {
                      const weekend = isWeekend(date);
                      return (
                        <th
                          className={cn(
                            "min-w-28 border-b border-l p-2 text-center align-top",
                            weekend && "bg-muted/60",
                          )}
                          key={date.toString()}
                        >
                          <div className="font-medium">
                            {date.toLocaleString("de-DE", {
                              day: "2-digit",
                              month: "2-digit",
                            })}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {date.toLocaleString("de-DE", {
                              weekday: "short",
                            })}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                  <tr>
                    <th className="sticky left-0 z-20 border-b bg-background p-2 text-left text-xs text-muted-foreground">
                      Feiertag
                    </th>
                    {days.map((date) => {
                      const holidayName = holidayDataLoaded
                        ? getPublicHolidayName(date)
                        : undefined;
                      return (
                        <th
                          className={cn(
                            "min-w-28 border-b border-l p-2 text-center text-[10px] leading-tight text-muted-foreground",
                            (isWeekend(date) || holidayName) && "bg-muted/60",
                          )}
                          key={`${date.toString()}-holiday`}
                        >
                          {holidayName ?? ""}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {doctorRows.map((staff) => (
                    <tr key={`doctor-${staff.id}`}>
                      <td className="sticky left-0 z-10 border-b bg-background p-3 align-top">
                        <div className="flex items-start gap-2">
                          <Stethoscope className="mt-0.5 h-4 w-4 text-muted-foreground" />
                          <div className="font-medium">{staff.name}</div>
                        </div>
                      </td>
                      {days.map((date) => (
                        <td
                          className={cn(
                            "border-b border-l p-2 align-top",
                            (isWeekend(date) ||
                              (holidayDataLoaded &&
                                getPublicHolidayName(date))) &&
                              "bg-muted/30",
                          )}
                          key={`${staff.id}-${date.toString()}`}
                        >
                          {renderCell(staff, date)}
                        </td>
                      ))}
                    </tr>
                  ))}

                  <tr>
                    <td
                      className="sticky left-0 z-10 bg-background px-3 py-2"
                      colSpan={days.length + 1}
                    >
                      <Separator />
                    </td>
                  </tr>

                  {mfaRows.map((staff) => (
                    <tr key={`mfa-${staff.id}`}>
                      <td className="sticky left-0 z-10 border-b bg-background p-3 align-top">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2">
                            <BriefcaseMedical className="mt-0.5 h-4 w-4 text-muted-foreground" />
                            <div className="font-medium">{staff.name}</div>
                          </div>
                          {editable && (
                            <Button
                              onClick={() => {
                                void handleRemoveMfa(staff.id as Id<"mfas">);
                              }}
                              size="icon"
                              variant="ghost"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                      {days.map((date) => (
                        <td
                          className={cn(
                            "border-b border-l p-2 align-top",
                            (isWeekend(date) ||
                              (holidayDataLoaded &&
                                getPublicHolidayName(date))) &&
                              "bg-muted/30",
                          )}
                          key={`${staff.id}-${date.toString()}`}
                        >
                          {renderCell(staff, date)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        )}
      </CardContent>

      {editable && (
        <CardContent className="pt-0">
          <div className="flex flex-col gap-3 rounded-lg border p-3 lg:flex-row lg:items-center">
            <Input
              onChange={(event) => {
                setNewMfaName(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleCreateMfa();
                }
              }}
              placeholder="Neue MFA"
              value={newMfaName}
            />
            <Button
              onClick={() => {
                void handleCreateMfa();
              }}
              type="button"
            >
              <Plus className="mr-2 h-4 w-4" />
              MFA hinzufügen
            </Button>
          </div>
        </CardContent>
      )}

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setConflictDialog(null);
          }
        }}
        open={conflictDialog !== null}
      >
        <DialogContent className="sm:max-w-2xl">
          {conflictDialog && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Bereits gebuchte Termine im Urlaubszeitraum
                </DialogTitle>
                <DialogDescription>
                  {conflictDialog.staff.name} hat am{" "}
                  {conflictDialog.date.toLocaleString("de-DE", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}{" "}
                  bereits {dialogConflicts.length} Termin
                  {dialogConflicts.length === 1 ? "" : "e"} im Bereich{" "}
                  {PORTION_META[conflictDialog.portion].short}.
                </DialogDescription>
              </DialogHeader>

              <div className="rounded-lg border p-3 text-sm">
                <div className="font-medium">
                  {dialogConflicts.length} Konflikt
                  {dialogConflicts.length === 1 ? "" : "e"}
                </div>
                <div className="text-muted-foreground">
                  Bestehende Buchungen, die von diesem Urlaub betroffen sind.
                </div>
              </div>

              {editable && (
                <div className="flex items-center gap-2">
                  {ORDERED_PORTIONS.map((portion) => (
                    <Button
                      key={portion}
                      onClick={() => {
                        setConflictDialog((current) =>
                          current
                            ? {
                                ...current,
                                portion,
                              }
                            : current,
                        );
                      }}
                      size="sm"
                      variant={
                        conflictDialog.portion === portion
                          ? "default"
                          : "outline"
                      }
                    >
                      {PORTION_META[portion].short}
                    </Button>
                  ))}
                </div>
              )}

              <ScrollArea className="max-h-80 rounded-md border">
                <div className="divide-y">
                  {dialogConflicts.length === 0 && (
                    <div className="p-3 text-sm text-muted-foreground">
                      Keine bestehenden Termine in diesem Zeitraum.
                    </div>
                  )}
                  {dialogConflicts.map((conflict) => {
                    const start = Temporal.ZonedDateTime.from(conflict.start);
                    const end = Temporal.ZonedDateTime.from(conflict.end);
                    return (
                      <div className="p-3" key={conflict.id}>
                        <div className="font-medium">{conflict.title}</div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {start.toLocaleString("de-DE", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}{" "}
                          -{" "}
                          {end.toLocaleString("de-DE", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}{" "}
                          Uhr
                        </div>
                        {conflict.locationId && (
                          <div className="text-sm text-muted-foreground">
                            Standort:{" "}
                            {locationNameById.get(conflict.locationId) ??
                              conflict.locationId}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>

              <DialogFooter>
                <Button
                  onClick={() => {
                    setConflictDialog(null);
                  }}
                  variant="outline"
                >
                  Schließen
                </Button>
                {editable && conflictDialog.mode === "inspect" && (
                  <Button
                    onClick={() => {
                      void removeVacation(
                        conflictDialog.staff,
                        conflictDialog.date,
                      ).then(() => {
                        setConflictDialog(null);
                      });
                    }}
                    variant="destructive"
                  >
                    Urlaub entfernen
                  </Button>
                )}
                {editable && conflictDialog.mode === "create" && (
                  <Button
                    onClick={() => {
                      void upsertVacation(
                        conflictDialog.staff,
                        conflictDialog.date,
                        conflictDialog.portion,
                      ).then(() => {
                        setConflictDialog(null);
                      });
                    }}
                  >
                    Trotzdem eintragen
                  </Button>
                )}
                {editable && conflictDialog.mode === "inspect" && (
                  <Button
                    onClick={() => {
                      void upsertVacation(
                        conflictDialog.staff,
                        conflictDialog.date,
                        conflictDialog.portion,
                      ).then(() => {
                        setConflictDialog(null);
                      });
                    }}
                  >
                    Urlaub ändern
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function buildVacationKey(
  staffType: "mfa" | "practitioner",
  staffId: string,
  date: string,
  portion: VacationPortion,
) {
  return `${staffType}:${staffId}:${date}:${portion}`;
}

function endExclusiveMonth(date: Temporal.PlainDate): Temporal.PlainDate {
  return startOfMonth(date).add({ months: 1 });
}

function isWeekend(date: Temporal.PlainDate) {
  return date.dayOfWeek === 6 || date.dayOfWeek === 7;
}

function startOfMonth(date: Temporal.PlainDate): Temporal.PlainDate {
  return date.with({ day: 1 });
}
