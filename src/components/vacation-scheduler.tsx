import { useMutation, useQuery } from "convex/react";
import {
  BriefcaseMedical,
  ChevronLeft,
  ChevronRight,
  Plus,
  Stethoscope,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";

import type { Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

import type { LocalHistoryAction } from "../hooks/use-local-history";

import { getPractitionerVacationRangesForDate } from "../../lib/vacation-utils";
import { dispatchCustomEvent } from "../utils/browser-api";
import {
  getPublicHolidayName,
  getPublicHolidaysData,
} from "../utils/public-holidays";
import { formatDateFull } from "../utils/time-calculations";

interface AppointmentConflict {
  end: string;
  id: string;
  locationId?: Id<"locations">;
  patientId?: Id<"patients">;
  start: string;
  title: string;
  userId?: Id<"users">;
}

interface ConflictDialogState {
  date: Temporal.PlainDate;
  mode: "create" | "inspect";
  portion: VacationPortion;
  staff: StaffRow;
}

interface CreateMfaResult extends DraftMutationResult {
  entityId: Id<"mfas">;
}

interface DraftMutationResult {
  draftRevision: number;
  ruleSetId: Id<"ruleSets">;
}

interface StaffRow {
  id: string;
  kind: "mfa" | "practitioner";
  name: string;
}

type VacationPortion = "afternoon" | "full" | "morning";

interface VacationSchedulerProps {
  editable: boolean;
  expectedDraftRevision?: null | number;
  onDateChange?: (date: Temporal.PlainDate) => void;
  onDraftMutation?: (result: DraftMutationResult) => void;
  onRegisterHistoryAction?: (action: LocalHistoryAction) => void;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
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
  expectedDraftRevision,
  onDateChange,
  onDraftMutation,
  onRegisterHistoryAction,
  practiceId,
  ruleSetId,
  selectedDate,
}: VacationSchedulerProps) {
  const monthDate = startOfMonth(selectedDate);
  const monthEndExclusive = endExclusiveMonth(monthDate);
  const activeRuleSet = useQuery(api.ruleSets.getActiveRuleSet, {
    practiceId,
  });
  const practitioners = useQuery(api.entities.getPractitioners, {
    ruleSetId,
  });
  const mfas = useQuery(api.mfas.list, { ruleSetId });
  const vacations = useQuery(api.vacations.getVacationsInRange, {
    endDateExclusive: monthEndExclusive.toString(),
    ruleSetId,
    startDate: monthDate.toString(),
  });
  const baseSchedules = useQuery(api.entities.getBaseSchedules, {
    ruleSetId,
  });
  const appointments = useQuery(api.appointments.getAppointmentsInRange, {
    ...(activeRuleSet?._id ? { activeRuleSetId: activeRuleSet._id } : {}),
    end: monthEndExclusive
      .subtract({ days: 1 })
      .toZonedDateTime({
        plainTime: Temporal.PlainTime.from("23:59"),
        timeZone: "Europe/Berlin",
      })
      .toString(),
    ...(activeRuleSet?._id ? { selectedRuleSetId: ruleSetId } : {}),
    scope: "real",
    start: monthDate
      .toZonedDateTime({
        plainTime: Temporal.PlainTime.from("00:00"),
        timeZone: "Europe/Berlin",
      })
      .toString(),
  });
  const locations = useQuery(api.entities.getLocations, {
    ruleSetId,
  });
  const appointmentPatientIds = useMemo(() => {
    const ids = new Set<Id<"patients">>();
    for (const appointment of appointments ?? []) {
      if (appointment.patientId) {
        ids.add(appointment.patientId);
      }
    }
    return [...ids];
  }, [appointments]);
  const appointmentUserIds = useMemo(() => {
    const ids = new Set<Id<"users">>();
    for (const appointment of appointments ?? []) {
      if (appointment.userId) {
        ids.add(appointment.userId);
      }
    }
    return [...ids];
  }, [appointments]);
  const patientDetails = useQuery(
    api.patients.getPatientSidebarDetailsByIds,
    appointmentPatientIds.length > 0
      ? { patientIds: appointmentPatientIds }
      : "skip",
  );
  const userDetails = useQuery(
    api.users.getUsersByIds,
    appointmentUserIds.length > 0 ? { userIds: appointmentUserIds } : "skip",
  );

  const createMfa = useMutation(api.mfas.create);
  const removeMfa = useMutation(api.mfas.remove);
  const createVacation = useMutation(api.vacations.createVacation);
  const deleteVacation = useMutation(api.vacations.deleteVacation);

  const [newMfaName, setNewMfaName] = useState("");
  const [holidayDataLoaded, setHolidayDataLoaded] = useState(false);
  const [conflictDialog, setConflictDialog] =
    useState<ConflictDialogState | null>(null);
  const expectedDraftRevisionRef = useRef(expectedDraftRevision ?? null);
  const selectedRuleSetIdRef = useRef(ruleSetId);
  const vacationsRef = useRef(vacations ?? []);
  const mfasRef = useRef(mfas ?? []);

  useEffect(() => {
    expectedDraftRevisionRef.current = expectedDraftRevision ?? null;
  }, [expectedDraftRevision]);

  useEffect(() => {
    selectedRuleSetIdRef.current = ruleSetId;
  }, [ruleSetId]);

  useEffect(() => {
    vacationsRef.current = vacations ?? [];
  }, [vacations]);

  useEffect(() => {
    mfasRef.current = mfas ?? [];
  }, [mfas]);

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

  const combinedRows = useMemo(
    () => [
      ...doctorRows.map((staff) => ({ isFirstMfaRow: false, staff })),
      ...mfaRows.map((staff, index) => ({
        isFirstMfaRow: index === 0,
        staff,
      })),
    ],
    [doctorRows, mfaRows],
  );

  const firstBodyRowStaffId = combinedRows[0]?.staff.id;
  const totalBodyRowCount = combinedRows.length;

  const getExpectedDraftRevision = () => expectedDraftRevisionRef.current;
  const getSelectedRuleSetId = () => selectedRuleSetIdRef.current;

  const handleDraftMutationResult = (result: DraftMutationResult) => {
    expectedDraftRevisionRef.current = result.draftRevision;
    selectedRuleSetIdRef.current = result.ruleSetId;
    onDraftMutation?.(result);
  };

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

  const getActivePortionsForCellFromRows = (
    vacationRows: NonNullable<typeof vacations>,
    staff: StaffRow,
    date: Temporal.PlainDate,
  ): VacationPortion[] =>
    ORDERED_PORTIONS.filter((portion) =>
      vacationRows.some((vacation) => {
        const staffId =
          vacation.staffType === "practitioner"
            ? vacation.practitionerId
            : vacation.mfaId;
        return (
          vacation.staffType === staff.kind &&
          staffId === staff.id &&
          vacation.date === date.toString() &&
          vacation.portion === portion
        );
      }),
    );

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
        ...(appointment.patientId ? { patientId: appointment.patientId } : {}),
        start: appointment.start,
        title: appointment.title,
        ...(appointment.userId ? { userId: appointment.userId } : {}),
      }))
      .toSorted((left, right) => left.start.localeCompare(right.start));
  };

  const clearVacationsForDay = async (
    staff: StaffRow,
    date: Temporal.PlainDate,
  ) => {
    let latestResult: DraftMutationResult | undefined;
    const activePortions = getActivePortionsForCell(staff, date);

    for (const activePortion of activePortions) {
      latestResult = (await deleteVacation({
        date: date.toString(),
        expectedDraftRevision: getExpectedDraftRevision(),
        ...(staff.kind === "mfa"
          ? { mfaId: staff.id as Id<"mfas"> }
          : { practitionerId: staff.id as Id<"practitioners"> }),
        portion: activePortion,
        practiceId,
        selectedRuleSetId: getSelectedRuleSetId(),
        staffType: staff.kind,
      })) as DraftMutationResult;
    }

    if (latestResult) {
      handleDraftMutationResult(latestResult);
    }
  };

  const setVacationsForDay = async (
    staff: StaffRow,
    date: Temporal.PlainDate,
    portions: VacationPortion[],
  ) => {
    await clearVacationsForDay(staff, date);

    let latestResult: DraftMutationResult | undefined;
    for (const portion of portions) {
      latestResult = (await createVacation({
        date: date.toString(),
        expectedDraftRevision: getExpectedDraftRevision(),
        ...(staff.kind === "mfa"
          ? { mfaId: staff.id as Id<"mfas"> }
          : { practitionerId: staff.id as Id<"practitioners"> }),
        portion,
        practiceId,
        selectedRuleSetId: getSelectedRuleSetId(),
        staffType: staff.kind,
      })) as DraftMutationResult;
      handleDraftMutationResult(latestResult);
    }
  };

  const commitVacationChange = async (
    staff: StaffRow,
    date: Temporal.PlainDate,
    nextPortions: VacationPortion[],
    label: string,
  ) => {
    const previousPortions = getActivePortionsForCellFromRows(
      vacationsRef.current,
      staff,
      date,
    );
    await setVacationsForDay(staff, date, nextPortions);
    onRegisterHistoryAction?.({
      label,
      redo: async () => {
        await setVacationsForDay(staff, date, nextPortions);
        return { status: "applied" as const };
      },
      undo: async () => {
        await setVacationsForDay(staff, date, previousPortions);
        return { status: "applied" as const };
      },
    });
  };

  const handleCreateMfa = async () => {
    const trimmed = newMfaName.trim();
    if (!trimmed) {
      toast.error("Bitte einen MFA-Namen eingeben.");
      return;
    }

    try {
      const result = (await createMfa({
        expectedDraftRevision: getExpectedDraftRevision(),
        name: trimmed,
        practiceId,
        selectedRuleSetId: getSelectedRuleSetId(),
      })) as CreateMfaResult;
      handleDraftMutationResult(result);
      setNewMfaName("");
      const lineageKey = result.entityId;
      onRegisterHistoryAction?.({
        label: "MFA erstellt",
        redo: async () => {
          const existing = mfasRef.current.find(
            (entry) => entry.lineageKey === lineageKey,
          );
          if (existing) {
            return { status: "applied" as const };
          }
          const redoResult = (await createMfa({
            expectedDraftRevision: getExpectedDraftRevision(),
            lineageKey,
            name: trimmed,
            practiceId,
            selectedRuleSetId: getSelectedRuleSetId(),
          })) as CreateMfaResult;
          handleDraftMutationResult(redoResult);
          return { status: "applied" as const };
        },
        undo: async () => {
          const existing = mfasRef.current.find(
            (entry) => entry.lineageKey === lineageKey,
          );
          if (!existing) {
            return { status: "applied" as const };
          }
          const undoResult = (await removeMfa({
            expectedDraftRevision: getExpectedDraftRevision(),
            mfaId: existing._id,
            practiceId,
            selectedRuleSetId: getSelectedRuleSetId(),
          })) as DraftMutationResult;
          handleDraftMutationResult(undoResult);
          return { status: "applied" as const };
        },
      });
      toast.success("MFA hinzugefügt");
    } catch (error) {
      toast.error("MFA konnte nicht angelegt werden", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    }
  };

  const handleRemoveMfa = async (mfaId: Id<"mfas">) => {
    try {
      const currentMfa = mfasRef.current.find((entry) => entry._id === mfaId);
      if (!currentMfa) {
        toast.error("MFA konnte nicht gefunden werden");
        return;
      }
      const result = (await removeMfa({
        expectedDraftRevision: getExpectedDraftRevision(),
        mfaId,
        practiceId,
        selectedRuleSetId: getSelectedRuleSetId(),
      })) as DraftMutationResult;
      handleDraftMutationResult(result);
      onRegisterHistoryAction?.({
        label: "MFA entfernt",
        redo: async () => {
          const existing = mfasRef.current.find(
            (entry) =>
              entry.lineageKey === (currentMfa.lineageKey ?? currentMfa._id),
          );
          if (!existing) {
            return { status: "applied" as const };
          }
          const redoResult = (await removeMfa({
            expectedDraftRevision: getExpectedDraftRevision(),
            mfaId: existing._id,
            practiceId,
            selectedRuleSetId: getSelectedRuleSetId(),
          })) as DraftMutationResult;
          handleDraftMutationResult(redoResult);
          return { status: "applied" as const };
        },
        undo: async () => {
          const existing = mfasRef.current.find(
            (entry) =>
              entry.lineageKey === (currentMfa.lineageKey ?? currentMfa._id),
          );
          if (existing) {
            return { status: "applied" as const };
          }
          const undoResult = (await createMfa({
            expectedDraftRevision: getExpectedDraftRevision(),
            lineageKey: currentMfa.lineageKey ?? currentMfa._id,
            name: currentMfa.name,
            practiceId,
            selectedRuleSetId: getSelectedRuleSetId(),
          })) as CreateMfaResult;
          handleDraftMutationResult(undoResult);
          return { status: "applied" as const };
        },
      });
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

      await commitVacationChange(staff, date, [portion], "Urlaub eingetragen");
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
    activeRuleSet === undefined ||
    !practitioners ||
    !mfas ||
    !vacations ||
    !appointments ||
    !baseSchedules ||
    !locations;

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
                    <th className="sticky left-0 z-20 min-w-24 border-b bg-background px-2 py-3 text-left sm:min-w-32">
                      Mitarbeiter
                    </th>
                    {days.map((date) => {
                      const weekend = isWeekend(date);
                      const holidayName = holidayDataLoaded
                        ? getPublicHolidayName(date)
                        : undefined;
                      return (
                        <th
                          className={cn(
                            "border-b border-l p-2 text-center align-top",
                            holidayName ? "min-w-28" : "min-w-16",
                            weekend && "bg-muted/60",
                          )}
                          key={date.toString()}
                        >
                          <div className="font-medium">{date.day}</div>
                          <div className="text-xs text-muted-foreground">
                            {date.toLocaleString("de-DE", {
                              weekday: "short",
                            })}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {combinedRows.map(({ isFirstMfaRow, staff }) => (
                    <tr key={`${staff.kind}-${staff.id}`}>
                      <td
                        className={cn(
                          "sticky left-0 z-10 border-b bg-background px-2 py-3 align-top",
                          isFirstMfaRow && "border-t-2",
                        )}
                      >
                        <div className="flex items-start gap-2">
                          {staff.kind === "practitioner" ? (
                            <Stethoscope className="mt-0.5 h-4 w-4 text-muted-foreground" />
                          ) : (
                            <BriefcaseMedical className="mt-0.5 h-4 w-4 text-muted-foreground" />
                          )}
                          <div
                            className={cn(
                              "font-medium",
                              staff.kind === "mfa" && editable && "flex-1",
                            )}
                          >
                            <div className="font-medium">{staff.name}</div>
                          </div>
                          {staff.kind === "mfa" && editable && (
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
                      {days.map((date) =>
                        (() => {
                          const holidayName = holidayDataLoaded
                            ? getPublicHolidayName(date)
                            : undefined;

                          if (holidayName) {
                            if (staff.id !== firstBodyRowStaffId) {
                              return null;
                            }

                            return (
                              <td
                                className="border-b border-l bg-muted/30 p-0 align-middle"
                                key={`${staff.id}-${date.toString()}`}
                                rowSpan={totalBodyRowCount}
                              >
                                <div className="sticky top-1/2 -translate-y-1/2 px-3 py-2 text-center text-xs text-muted-foreground">
                                  {holidayName}
                                </div>
                              </td>
                            );
                          }

                          return (
                            <td
                              className={cn(
                                "min-w-16 border-b border-l p-2 align-top",
                                isFirstMfaRow && "border-t-2",
                                isWeekend(date) && "bg-muted/30",
                              )}
                              key={`${staff.id}-${date.toString()}`}
                            >
                              {renderCell(staff, date)}
                            </td>
                          );
                        })(),
                      )}
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
                <DialogTitle>{formatDateFull(conflictDialog.date)}</DialogTitle>
              </DialogHeader>

              <div className="rounded-lg border p-3 text-sm font-medium">
                {dialogConflicts.length} Konflikte
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
                      {portion === "full"
                        ? "Ganztägig"
                        : portion === "morning"
                          ? "Vormittag"
                          : "Nachmittag"}
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
                    const patient = conflict.patientId
                      ? patientDetails?.[conflict.patientId]
                      : undefined;
                    const user = conflict.userId
                      ? userDetails?.[conflict.userId]
                      : undefined;
                    const patientDisplayName = patient
                      ? [patient.firstName, patient.lastName]
                          .filter(Boolean)
                          .join(" ")
                      : user
                        ? [user.firstName, user.lastName]
                            .filter(Boolean)
                            .join(" ") || user.email
                        : undefined;
                    return (
                      <div className="p-3" key={conflict.id}>
                        <div className="font-medium">{conflict.title}</div>
                        {patientDisplayName && (
                          <div className="mt-1 text-sm font-medium">
                            {patientDisplayName}
                          </div>
                        )}
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
                        {patient?.dateOfBirth && (
                          <div className="text-sm text-muted-foreground">
                            Geburtsdatum:{" "}
                            {formatGermanDate(patient.dateOfBirth)}
                          </div>
                        )}
                        {user?.email && (
                          <div className="text-sm text-muted-foreground">
                            E-Mail: {user.email}
                          </div>
                        )}
                        {patient?.street && (
                          <div className="text-sm text-muted-foreground">
                            {patient.street}
                          </div>
                        )}
                        {patient?.city && (
                          <div className="text-sm text-muted-foreground">
                            {patient.city}
                          </div>
                        )}
                        {patient?.patientId !== undefined && (
                          <Button
                            className="mt-2 w-full gap-1.5"
                            onClick={() => {
                              dispatchCustomEvent("praxisplaner:openInPvs", {
                                patientId: patient.patientId,
                              });
                            }}
                            size="sm"
                            variant="outline"
                          >
                            Im PVS öffnen
                          </Button>
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
                      void commitVacationChange(
                        conflictDialog.staff,
                        conflictDialog.date,
                        [],
                        "Urlaub entfernt",
                      )
                        .then(() => {
                          setConflictDialog(null);
                        })
                        .catch((error: unknown) => {
                          toast.error("Urlaub konnte nicht entfernt werden", {
                            description:
                              error instanceof Error
                                ? error.message
                                : "Unbekannter Fehler",
                          });
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
                      void commitVacationChange(
                        conflictDialog.staff,
                        conflictDialog.date,
                        [conflictDialog.portion],
                        "Urlaub eingetragen",
                      )
                        .then(() => {
                          setConflictDialog(null);
                        })
                        .catch((error: unknown) => {
                          toast.error(
                            "Urlaub konnte nicht eingetragen werden",
                            {
                              description:
                                error instanceof Error
                                  ? error.message
                                  : "Unbekannter Fehler",
                            },
                          );
                        });
                    }}
                  >
                    Trotzdem eintragen
                  </Button>
                )}
                {editable && conflictDialog.mode === "inspect" && (
                  <Button
                    onClick={() => {
                      void commitVacationChange(
                        conflictDialog.staff,
                        conflictDialog.date,
                        [conflictDialog.portion],
                        "Urlaub geändert",
                      )
                        .then(() => {
                          setConflictDialog(null);
                        })
                        .catch((error: unknown) => {
                          toast.error("Urlaub konnte nicht geändert werden", {
                            description:
                              error instanceof Error
                                ? error.message
                                : "Unbekannter Fehler",
                          });
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

function formatGermanDate(dateString: string) {
  try {
    const date = Temporal.PlainDate.from(dateString);
    return date.toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return dateString;
  }
}

function isWeekend(date: Temporal.PlainDate) {
  return date.dayOfWeek === 6 || date.dayOfWeek === 7;
}

function startOfMonth(date: Temporal.PlainDate): Temporal.PlainDate {
  return date.with({ day: 1 });
}
