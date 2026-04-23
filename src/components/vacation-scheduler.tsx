import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useMutation, useQuery } from "convex/react";
import {
  BriefcaseMedical,
  ChevronLeft,
  ChevronRight,
  Plus,
  Stethoscope,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";

import type { Id } from "@/convex/_generated/dataModel";
import type { CoverageSuggestion } from "@/convex/appointmentCoverage";
import type { AppointmentResult } from "@/convex/appointments";
import type {
  MfaId,
  MfaLineageKey,
  PractitionerId,
  PractitionerLineageKey,
} from "@/convex/identity";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import { api } from "@/convex/_generated/api";
import { asMfaId, asMfaLineageKey } from "@/convex/identity";
import { GDT_DATE_REGEX } from "@/lib/typed-regex";
import { cn } from "@/lib/utils";

import type { LocalHistoryAction } from "../hooks/use-local-history";
import type {
  DraftMutationResult,
  RuleSetReplayTarget,
} from "../utils/cow-history";
import type { FrontendLineageEntity } from "../utils/frontend-lineage";

import { getPractitionerVacationRangesForDate } from "../../lib/vacation-utils";
import { dispatchCustomEvent } from "../utils/browser-api";
import {
  ruleSetIdFromReplayTarget,
  toCowMutationArgs,
  updateRuleSetReplayTarget,
} from "../utils/cow-history";
import { captureErrorGlobal } from "../utils/error-tracking";
import {
  findFrontendEntityByEntityId,
  findFrontendEntityByLineageKey,
  requireFrontendLineageEntities,
} from "../utils/frontend-lineage";
import {
  getPublicHolidayName,
  getPublicHolidaysData,
} from "../utils/public-holidays";
import {
  formatDateFull,
  zonedDateTimeStringResult,
} from "../utils/time-calculations";

type AppointmentConflict = Pick<
  AppointmentResult,
  "end" | "locationId" | "patientId" | "start" | "title" | "userId"
> & {
  id: AppointmentResult["_id"];
};

interface ConflictDialogState {
  date: Temporal.PlainDate;
  mode: "create" | "inspect";
  portion: VacationPortion;
  replacingSnapshots: VacationReplaySnapshot[];
  staff: StaffRow;
}

interface ConflictEntry {
  conflict: AppointmentConflict;
  coverageSuggestion: CoverageSuggestion | undefined;
}

type MfaQueryResult = (typeof api.mfas.list)["_returnType"];
type MfaRowEntity = FrontendLineageEntity<"mfas", MfaQueryResult[number]>;
type PractitionerQueryResult =
  (typeof api.entities.getPractitioners)["_returnType"];
type PractitionerRowEntity = FrontendLineageEntity<
  "practitioners",
  PractitionerQueryResult[number]
>;

type StaffRow =
  | {
      id: MfaId;
      kind: "mfa";
      lineageKey: MfaLineageKey;
      name: string;
    }
  | {
      id: PractitionerId;
      kind: "practitioner";
      lineageKey: PractitionerLineageKey;
      name: string;
    };

type VacationPortion = "afternoon" | "full" | "morning";

interface VacationReplaySnapshot {
  lineageKey: Id<"vacations">;
  portion: VacationPortion;
}

interface VacationSchedulerProps {
  editable: boolean;
  onDateChange?: (date: Temporal.PlainDate) => void;
  onDraftMutation?: (result: DraftMutationResult) => void;
  onRegisterHistoryAction?: (action: LocalHistoryAction) => void;
  practiceId: Id<"practices">;
  ruleSetReplayTarget: RuleSetReplayTarget;
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
  onDraftMutation,
  onRegisterHistoryAction,
  practiceId,
  ruleSetReplayTarget,
  selectedDate,
}: VacationSchedulerProps) {
  const ruleSetId = ruleSetIdFromReplayTarget(ruleSetReplayTarget);
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
    scope: "simulation",
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
  const scopedAppointments = useMemo(
    () =>
      (appointments ?? []).filter(
        (appointment) => appointment.practiceId === practiceId,
      ),
    [appointments, practiceId],
  );
  const appointmentPatientIds = useMemo(() => {
    const ids = new Set<Id<"patients">>();
    for (const appointment of scopedAppointments) {
      if (appointment.patientId !== undefined) {
        ids.add(appointment.patientId);
      }
    }
    return [...ids];
  }, [scopedAppointments]);
  const appointmentUserIds = useMemo(() => {
    const ids = new Set<Id<"users">>();
    for (const appointment of scopedAppointments) {
      if (appointment.userId) {
        ids.add(appointment.userId);
      }
    }
    return [...ids];
  }, [scopedAppointments]);
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
  const createVacationWithCoverageAdjustments = useMutation(
    api.vacations.createVacationWithCoverageAdjustments,
  );
  const deleteVacation = useMutation(api.vacations.deleteVacation);

  const [newMfaName, setNewMfaName] = useState("");
  const [holidayDataLoaded, setHolidayDataLoaded] = useState(false);
  const [conflictDialog, setConflictDialog] =
    useState<ConflictDialogState | null>(null);
  const mappedPractitioners = useMemo<PractitionerRowEntity[]>(() => {
    if (!practitioners) {
      return [];
    }

    return requireFrontendLineageEntities<
      "practitioners",
      PractitionerQueryResult[number]
    >({
      entities: practitioners,
      entityType: "practitioner",
      source: "VacationScheduler",
    });
  }, [practitioners]);
  const mappedMfas = useMemo<MfaRowEntity[]>(() => {
    if (!mfas) {
      return [];
    }

    return requireFrontendLineageEntities<"mfas", MfaQueryResult[number]>({
      entities: mfas,
      entityType: "mfa",
      source: "VacationScheduler",
    });
  }, [mfas]);
  const ruleSetReplayTargetRef = useRef(ruleSetReplayTarget);
  const vacationsRef = useRef(vacations ?? []);
  const mfasRef = useRef(mappedMfas);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const autoScrolledMonthRef = useRef<null | string>(null);
  const today = useMemo(() => Temporal.Now.plainDateISO("Europe/Berlin"), []);

  useEffect(() => {
    ruleSetReplayTargetRef.current = ruleSetReplayTarget;
  }, [ruleSetReplayTarget]);

  useEffect(() => {
    vacationsRef.current = vacations ?? [];
  }, [vacations]);

  useEffect(() => {
    mfasRef.current = mappedMfas;
  }, [mappedMfas]);

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
      mappedPractitioners
        .toSorted((left, right) => left.name.localeCompare(right.name, "de"))
        .map((row) => ({
          id: row._id,
          kind: "practitioner" as const,
          lineageKey: row.lineageKey,
          name: row.name,
        })),
    [mappedPractitioners],
  );

  const mfaRows = useMemo<StaffRow[]>(
    () =>
      mappedMfas
        .toSorted((left, right) => left.name.localeCompare(right.name, "de"))
        .map((row) => ({
          id: row._id,
          kind: "mfa" as const,
          lineageKey: row.lineageKey,
          name: row.name,
        })),
    [mappedMfas],
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

  const getCowMutationArgs = () =>
    toCowMutationArgs(ruleSetReplayTargetRef.current);

  const handleDraftMutationResult = (result: DraftMutationResult) => {
    ruleSetReplayTargetRef.current = updateRuleSetReplayTarget(
      ruleSetReplayTargetRef.current,
      result,
    );
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

  const getActiveVacationSnapshotsForCellFromRows = (
    vacationRows: NonNullable<typeof vacations>,
    staff: StaffRow,
    date: Temporal.PlainDate,
  ): VacationReplaySnapshot[] =>
    ORDERED_PORTIONS.flatMap((portion) => {
      const vacation = vacationRows.find((candidate) => {
        const staffId =
          candidate.staffType === "practitioner"
            ? candidate.practitionerId
            : candidate.mfaId;
        return (
          candidate.staffType === staff.kind &&
          staffId === staff.id &&
          candidate.date === date.toString() &&
          candidate.portion === portion
        );
      });

      if (!vacation) {
        return [];
      }

      return [
        {
          lineageKey: vacation.lineageKey,
          portion: vacation.portion,
        },
      ];
    });

  const locationNameById = useMemo(
    () =>
      new Map(
        (locations ?? []).map((location) => [location._id, location.name]),
      ),
    [locations],
  );

  const getAppointmentConflicts = useCallback(
    (
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

      return scopedAppointments
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
          const end = Temporal.ZonedDateTime.from(
            appointment.end,
          ).toPlainTime();
          const startMinutes = start.hour * 60 + start.minute;
          const endMinutes = end.hour * 60 + end.minute;

          return vacationRanges.some(
            (range) =>
              startMinutes < range.endMinutes &&
              endMinutes > range.startMinutes,
          );
        })
        .map((appointment) => ({
          end: appointment.end,
          id: appointment._id,
          locationId: appointment.locationId,
          ...(appointment.patientId === undefined
            ? {}
            : { patientId: appointment.patientId }),
          start: appointment.start,
          title: appointment.title,
          ...(appointment.userId ? { userId: appointment.userId } : {}),
        }))
        .toSorted((left, right) => left.start.localeCompare(right.start));
    },
    [appointments, baseSchedules, scopedAppointments],
  );

  const getAvailablePortionsForDay = (
    staff: StaffRow,
    date: Temporal.PlainDate,
    currentPortion?: VacationPortion,
  ): VacationPortion[] => {
    const portions: VacationPortion[] = ["full"];

    if (staff.kind === "practitioner" && baseSchedules) {
      let totalScheduledMinutes = 0;
      for (const schedule of baseSchedules) {
        if (
          schedule.practitionerId !== staff.id ||
          schedule.dayOfWeek !== (date.dayOfWeek === 7 ? 0 : date.dayOfWeek)
        ) {
          continue;
        }
        const [startHour = 0, startMinute = 0] = schedule.startTime
          .split(":")
          .map(Number);
        const [endHour = 0, endMinute = 0] = schedule.endTime
          .split(":")
          .map(Number);
        const startMinutes = startHour * 60 + startMinute;
        const endMinutes = endHour * 60 + endMinute;
        totalScheduledMinutes += Math.max(0, endMinutes - startMinutes);
      }

      if (totalScheduledMinutes >= 7 * 60) {
        portions.push("morning", "afternoon");
      }
    }

    if (
      currentPortion &&
      currentPortion !== "full" &&
      !portions.includes(currentPortion)
    ) {
      portions.push(currentPortion);
    }

    return portions;
  };

  const clearVacationsForDay = async (
    staff: StaffRow,
    date: Temporal.PlainDate,
    snapshotsToClear?: VacationReplaySnapshot[],
  ) => {
    const activeSnapshots =
      snapshotsToClear ??
      getActiveVacationSnapshotsForCellFromRows(
        vacationsRef.current,
        staff,
        date,
      );

    for (const snapshot of activeSnapshots) {
      const result = (await deleteVacation({
        date: date.toString(),
        lineageKey: snapshot.lineageKey,
        ...vacationStaffLineageMutationArgs(staff),
        portion: snapshot.portion,
        practiceId,
        staffType: staff.kind,
        ...getCowMutationArgs(),
      })) as DraftMutationResult;
      handleDraftMutationResult(result);
    }
  };

  const setVacationsForDay = async (
    staff: StaffRow,
    date: Temporal.PlainDate,
    portions: VacationPortion[],
    options?: {
      clearSnapshots?: VacationReplaySnapshot[];
      createSnapshots?: VacationReplaySnapshot[];
    },
  ): Promise<VacationReplaySnapshot[]> => {
    await clearVacationsForDay(staff, date, options?.clearSnapshots);

    const createdSnapshots: VacationReplaySnapshot[] = [];
    for (const portion of portions) {
      const existingSnapshot = options?.createSnapshots?.find(
        (snapshot) => snapshot.portion === portion,
      );
      const result = await createVacation({
        date: date.toString(),
        ...(existingSnapshot
          ? { lineageKey: existingSnapshot.lineageKey }
          : {}),
        ...vacationStaffLineageMutationArgs(staff),
        portion,
        practiceId,
        staffType: staff.kind,
        ...getCowMutationArgs(),
      });
      handleDraftMutationResult(result);
      createdSnapshots.push({
        lineageKey: result.entityId,
        portion,
      });
    }

    return createdSnapshots;
  };

  const commitVacationChange = async (
    staff: StaffRow,
    date: Temporal.PlainDate,
    nextPortions: VacationPortion[],
    label: string,
  ) => {
    const previousSnapshots = getActiveVacationSnapshotsForCellFromRows(
      vacationsRef.current,
      staff,
      date,
    );
    const nextSnapshots = await setVacationsForDay(staff, date, nextPortions, {
      clearSnapshots: previousSnapshots,
    });
    onRegisterHistoryAction?.({
      label,
      redo: async () => {
        await setVacationsForDay(staff, date, nextPortions, {
          clearSnapshots: previousSnapshots,
          createSnapshots: nextSnapshots,
        });
        return { status: "applied" as const };
      },
      undo: async () => {
        await setVacationsForDay(
          staff,
          date,
          previousSnapshots.map((snapshot) => snapshot.portion),
          {
            clearSnapshots: nextSnapshots,
            createSnapshots: previousSnapshots,
          },
        );
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
      const result = await createMfa({
        name: trimmed,
        practiceId,
        ...getCowMutationArgs(),
      });
      handleDraftMutationResult(result);
      setNewMfaName("");
      const lineageKey = asMfaLineageKey(result.entityId);
      let currentMfaId = result.entityId;
      onRegisterHistoryAction?.({
        label: "MFA erstellt",
        redo: async () => {
          try {
            const redoResult = await createMfa({
              lineageKey,
              name: trimmed,
              practiceId,
              ...getCowMutationArgs(),
            });
            currentMfaId = redoResult.entityId;
            handleDraftMutationResult(redoResult);
          } catch (error) {
            if (isAlreadyExistingMfaError(error)) {
              return { status: "applied" as const };
            }
            captureErrorGlobal(error, {
              actionLabel: "MFA erstellt",
              context: "vacation_scheduler_history_redo_create_mfa",
              lineageKey,
              operation: "redo",
              practiceId,
            });
            return {
              message:
                error instanceof Error
                  ? error.message
                  : "MFA konnte nicht erneut erstellt werden.",
              status: "conflict" as const,
            };
          }
          return { status: "applied" as const };
        },
        undo: async () => {
          const existing = findMfaByLineage(mfasRef.current, lineageKey);
          try {
            const undoResult = await removeMfa({
              mfaId: existing?._id ?? currentMfaId,
              practiceId,
              ...getCowMutationArgs(),
            });
            handleDraftMutationResult(undoResult);
          } catch (error) {
            if (isMissingMfaError(error)) {
              return { status: "applied" as const };
            }
            captureErrorGlobal(error, {
              actionLabel: "MFA erstellt",
              context: "vacation_scheduler_history_undo_create_mfa",
              lineageKey,
              operation: "undo",
              practiceId,
            });
            return {
              message:
                error instanceof Error
                  ? error.message
                  : "MFA konnte nicht entfernt werden.",
              status: "conflict" as const,
            };
          }
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
      const currentMfa = findFrontendEntityByEntityId(
        mfasRef.current,
        asMfaId(mfaId),
      );
      if (!currentMfa) {
        toast.error("MFA konnte nicht gefunden werden");
        return;
      }
      const result = await removeMfa({
        mfaId,
        practiceId,
        ...getCowMutationArgs(),
      });
      handleDraftMutationResult(result);
      let currentMfaId = currentMfa._id;
      const lineageKey = currentMfa.lineageKey;
      onRegisterHistoryAction?.({
        label: "MFA entfernt",
        redo: async () => {
          const existing = findMfaByLineage(mfasRef.current, lineageKey);
          try {
            const redoResult = await removeMfa({
              mfaId: existing?._id ?? currentMfaId,
              practiceId,
              ...getCowMutationArgs(),
            });
            handleDraftMutationResult(redoResult);
          } catch (error) {
            if (isMissingMfaError(error)) {
              return { status: "applied" as const };
            }
            captureErrorGlobal(error, {
              actionLabel: "MFA entfernt",
              context: "vacation_scheduler_history_redo_remove_mfa",
              lineageKey,
              operation: "redo",
              practiceId,
            });
            return {
              message:
                error instanceof Error
                  ? error.message
                  : "MFA konnte nicht erneut entfernt werden.",
              status: "conflict" as const,
            };
          }
          return { status: "applied" as const };
        },
        undo: async () => {
          const existing = findMfaByLineage(mfasRef.current, lineageKey);
          if (existing) {
            currentMfaId = existing._id;
            return { status: "applied" as const };
          }
          const undoResult = await createMfa({
            lineageKey,
            name: currentMfa.name,
            practiceId,
            ...getCowMutationArgs(),
          });
          currentMfaId = asMfaId(undoResult.entityId);
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
          replacingSnapshots: getActiveVacationSnapshotsForCellFromRows(
            vacationsRef.current,
            staff,
            date,
          ),
          staff,
        });
        return;
      }

      if (conflicts.length > 0) {
        setConflictDialog({
          date,
          mode: "create",
          portion,
          replacingSnapshots: [],
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
      replacingSnapshots: getActiveVacationSnapshotsForCellFromRows(
        vacationsRef.current,
        staff,
        date,
      ),
      staff,
    });
    return true;
  };

  const dialogConflicts = useMemo(
    () =>
      conflictDialog
        ? getAppointmentConflicts(
            conflictDialog.staff,
            conflictDialog.date,
            conflictDialog.portion,
          )
        : [],
    [conflictDialog, getAppointmentConflicts],
  );
  const replacingVacationLineageKeys = useMemo(
    () =>
      conflictDialog?.replacingSnapshots.map(
        (snapshot) => snapshot.lineageKey,
      ) ?? [],
    [conflictDialog],
  );
  const coveragePreview = useQuery(
    api.appointmentCoverage.previewPractitionerAbsenceCoverage,
    editable && conflictDialog?.staff.kind === "practitioner"
      ? {
          date: conflictDialog.date.toString(),
          portion: conflictDialog.portion,
          practiceId,
          practitionerId: conflictDialog.staff.lineageKey,
          ruleSetId,
          ...(replacingVacationLineageKeys.length > 0
            ? { replacingVacationLineageKeys }
            : {}),
        }
      : "skip",
  );
  const dialogPortionOptions: VacationPortion[] = conflictDialog
    ? getAvailablePortionsForDay(
        conflictDialog.staff,
        conflictDialog.date,
        conflictDialog.portion,
      )
    : ["full"];
  const coverageSuggestionByAppointmentId = useMemo(
    () =>
      new Map<string, CoverageSuggestion>(
        (coveragePreview?.suggestions ?? []).map((suggestion) => [
          suggestion.appointmentId,
          suggestion,
        ]),
      ),
    [coveragePreview],
  );
  const dialogConflictEntries = useMemo<ConflictEntry[]>(
    () =>
      dialogConflicts.map((conflict) => ({
        conflict,
        coverageSuggestion: coverageSuggestionByAppointmentId.get(conflict.id),
      })),
    [coverageSuggestionByAppointmentId, dialogConflicts],
  );
  const showCoverageAccordion =
    editable && conflictDialog?.staff.kind === "practitioner";
  const coveragePreviewEntries = useMemo<ConflictEntry[]>(
    () =>
      (coveragePreview?.suggestions ?? []).flatMap((suggestion) => {
        return zonedDateTimeStringResult(
          suggestion.start,
          "VacationScheduler.coverageSuggestion.start",
        ).match(
          (start) =>
            zonedDateTimeStringResult(
              suggestion.end,
              "VacationScheduler.coverageSuggestion.end",
            ).match(
              (end) => [
                {
                  conflict: {
                    end,
                    id: suggestion.appointmentId,
                    locationId: suggestion.locationId,
                    ...(suggestion.patientId === undefined
                      ? {}
                      : { patientId: suggestion.patientId }),
                    start,
                    title: suggestion.title,
                    ...(suggestion.userId ? { userId: suggestion.userId } : {}),
                  },
                  coverageSuggestion: suggestion,
                },
              ],
              () => [],
            ),
          () => [],
        );
      }),
    [coveragePreview],
  );
  const coverageDialogEntries = useMemo(
    () =>
      showCoverageAccordion ? coveragePreviewEntries : dialogConflictEntries,
    [dialogConflictEntries, coveragePreviewEntries, showCoverageAccordion],
  );
  const movableConflictEntries = useMemo(
    () =>
      coverageDialogEntries.filter(
        (entry) =>
          entry.coverageSuggestion?.targetPractitionerName !== undefined,
      ),
    [coverageDialogEntries],
  );
  const unresolvedConflictEntries = useMemo(
    () =>
      coverageDialogEntries.filter(
        (entry) =>
          entry.coverageSuggestion?.targetPractitionerName === undefined,
      ),
    [coverageDialogEntries],
  );
  const coverageAccordionResetKey = conflictDialog
    ? [
        conflictDialog.staff.kind,
        conflictDialog.staff.lineageKey,
        conflictDialog.date.toString(),
        conflictDialog.portion,
        replacingVacationLineageKeys.join(","),
      ].join(":")
    : null;
  const defaultCoverageAccordionValue =
    unresolvedConflictEntries.length > 0 && coveragePreview !== undefined
      ? ["not-movable"]
      : [];

  const renderConflictEntry = ({
    conflict,
    coverageSuggestion,
  }: ConflictEntry) => {
    const start = Temporal.ZonedDateTime.from(conflict.start);
    const end = Temporal.ZonedDateTime.from(conflict.end);
    const patient = conflict.patientId
      ? patientDetails?.[conflict.patientId]
      : undefined;
    const user = conflict.userId ? userDetails?.[conflict.userId] : undefined;
    const patientDisplayName = patient
      ? (patient.name ??
        [patient.firstName, patient.lastName].filter(Boolean).join(" "))
      : user
        ? [user.firstName, user.lastName].filter(Boolean).join(" ") ||
          user.email
        : undefined;

    return (
      <div className="p-3" key={conflict.id}>
        <div className="font-medium">{conflict.title}</div>
        {patientDisplayName && (
          <div className="mt-1 text-sm font-medium">{patientDisplayName}</div>
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
            {locationNameById.get(conflict.locationId) ?? conflict.locationId}
          </div>
        )}
        {patient?.dateOfBirth && (
          <div className="text-sm text-muted-foreground">
            Geburtsdatum: {formatGermanDate(patient.dateOfBirth)}
          </div>
        )}
        {user?.email && (
          <div className="text-sm text-muted-foreground">
            E-Mail: {user.email}
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
        {editable &&
          conflictDialog?.staff.kind === "practitioner" &&
          coverageSuggestion?.targetPractitionerName && (
            <div className="mt-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
              Wird verschoben zu{" "}
              <span className="font-medium">
                {coverageSuggestion.targetPractitionerName}
              </span>
              .
            </div>
          )}
      </div>
    );
  };

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
      if (displayedPortion) {
        return (
          <div className="flex min-h-12 items-center justify-center">
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
          </div>
        );
      }

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

  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (
      Temporal.PlainDate.compare(today, monthDate) < 0 ||
      Temporal.PlainDate.compare(today, monthEndExclusive) >= 0
    ) {
      return;
    }

    const monthKey = monthDate.toString();
    if (autoScrolledMonthRef.current === monthKey) {
      return;
    }

    const scrollArea = scrollAreaRef.current;
    const viewport = scrollArea?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    const staffColumn = scrollArea?.querySelector<HTMLElement>(
      '[data-vacation-staff-column="true"]',
    );
    const todayColumn = scrollArea?.querySelector<HTMLElement>(
      '[data-vacation-today-column="true"]',
    );

    if (!viewport || !staffColumn || !todayColumn) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const maxScrollLeft = Math.max(
        0,
        viewport.scrollWidth - viewport.clientWidth,
      );
      const targetScrollLeft = Math.min(
        maxScrollLeft,
        Math.max(0, todayColumn.offsetLeft - staffColumn.offsetWidth),
      );

      viewport.scrollLeft = targetScrollLeft;
      autoScrolledMonthRef.current = monthKey;
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [isLoading, monthDate, monthEndExclusive, today]);

  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="flex items-center justify-between gap-2">
          <Button
            aria-label="Vorheriger Monat"
            onClick={() => {
              navigateMonth(-1);
            }}
            size="icon"
            title="Vorheriger Monat"
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
            aria-label="Nächster Monat"
            onClick={() => {
              navigateMonth(1);
            }}
            size="icon"
            title="Nächster Monat"
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
          <ScrollArea className="w-full rounded-md border" ref={scrollAreaRef}>
            <div className="min-w-max">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th
                      className="sticky left-0 z-20 min-w-24 border-b bg-background px-2 py-3 text-left sm:min-w-32"
                      data-vacation-staff-column="true"
                    >
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
                          data-vacation-today-column={
                            Temporal.PlainDate.compare(date, today) === 0
                              ? "true"
                              : undefined
                          }
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
                              aria-label="MFA entfernen"
                              onClick={() => {
                                void handleRemoveMfa(staff.id);
                              }}
                              size="icon"
                              title="MFA entfernen"
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
                <VisuallyHidden>
                  <DialogDescription>
                    Zeigt die Urlaubskonflikte für den ausgewählten Tag und
                    erlaubt bei bearbeitbaren Einträgen die Auswahl des
                    betroffenen Tagesabschnitts.
                  </DialogDescription>
                </VisuallyHidden>
              </DialogHeader>

              <div className="rounded-lg border p-3 text-sm font-medium">
                {coveragePreview && conflictDialog.staff.kind === "practitioner"
                  ? `${coveragePreview.movableCount} von ${coveragePreview.affectedCount} Terminen können automatisch verschoben werden`
                  : `${dialogConflicts.length} Konflikte`}
              </div>

              {editable &&
                conflictDialog.staff.kind === "practitioner" &&
                coveragePreview === undefined && (
                  <div className="rounded-lg border p-3 text-sm text-muted-foreground">
                    Verschiebevorschläge werden berechnet.
                  </div>
                )}

              {editable && (
                <div className="flex items-center gap-2">
                  {dialogPortionOptions.map((portion) => (
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
                {showCoverageAccordion ? (
                  <Accordion
                    className="px-3"
                    defaultValue={defaultCoverageAccordionValue}
                    key={coverageAccordionResetKey ?? "coverage-preview"}
                    type="multiple"
                  >
                    <AccordionItem value="not-movable">
                      <AccordionTrigger>
                        <div className="flex items-center gap-2">
                          <span>Nicht verschiebbare Termine</span>
                          <span className="text-muted-foreground">
                            ({unresolvedConflictEntries.length})
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="divide-y rounded-md border">
                          {coveragePreview === undefined ? (
                            <div className="p-3 text-sm text-muted-foreground">
                              Verschiebevorschläge werden berechnet.
                            </div>
                          ) : unresolvedConflictEntries.length === 0 ? (
                            <div className="p-3 text-sm text-muted-foreground">
                              Alle betroffenen Termine können verschoben werden.
                            </div>
                          ) : (
                            unresolvedConflictEntries.map((entry) =>
                              renderConflictEntry(entry),
                            )
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="movable">
                      <AccordionTrigger>
                        <div className="flex items-center gap-2">
                          <span>Verschiebbare Termine</span>
                          <span className="text-muted-foreground">
                            ({movableConflictEntries.length})
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="divide-y rounded-md border">
                          {coveragePreview === undefined ? (
                            <div className="p-3 text-sm text-muted-foreground">
                              Verschiebbare Termine werden geladen.
                            </div>
                          ) : movableConflictEntries.length === 0 ? (
                            <div className="p-3 text-sm text-muted-foreground">
                              Keine automatisch verschiebbaren Termine gefunden.
                            </div>
                          ) : (
                            movableConflictEntries.map((entry) =>
                              renderConflictEntry(entry),
                            )
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                ) : (
                  <div className="divide-y">
                    {dialogConflicts.length === 0 && (
                      <div className="p-3 text-sm text-muted-foreground">
                        Keine bestehenden Termine in diesem Zeitraum.
                      </div>
                    )}
                    {dialogConflictEntries.map((entry) =>
                      renderConflictEntry(entry),
                    )}
                  </div>
                )}
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
                    disabled={
                      conflictDialog.staff.kind === "practitioner" &&
                      coveragePreview === undefined
                    }
                    onClick={() => {
                      const applyChange =
                        conflictDialog.staff.kind === "practitioner" &&
                        coveragePreview
                          ? createVacationWithCoverageAdjustments({
                              date: conflictDialog.date.toString(),
                              expectedDraftRevision:
                                ruleSetReplayTargetRef.current.kind === "draft"
                                  ? ruleSetReplayTargetRef.current.draftRevision
                                  : null,
                              portion: conflictDialog.portion,
                              practiceId,
                              practitionerId: conflictDialog.staff.lineageKey,
                              reassignments:
                                coveragePreview.suggestions.flatMap(
                                  (suggestion) =>
                                    suggestion.targetPractitionerId
                                      ? [
                                          {
                                            appointmentId:
                                              suggestion.appointmentId,
                                            targetPractitionerId:
                                              suggestion.targetPractitionerId,
                                          },
                                        ]
                                      : [],
                                ),
                              selectedRuleSetId: ruleSetIdFromReplayTarget(
                                ruleSetReplayTargetRef.current,
                              ),
                              ...(replacingVacationLineageKeys.length > 0
                                ? { replacingVacationLineageKeys }
                                : {}),
                            }).then((result) => {
                              handleDraftMutationResult(result);
                            })
                          : commitVacationChange(
                              conflictDialog.staff,
                              conflictDialog.date,
                              [conflictDialog.portion],
                              "Urlaub eingetragen",
                            );

                      void applyChange
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
                    {coveragePreview &&
                    conflictDialog.staff.kind === "practitioner"
                      ? coveragePreview.movableCount > 0
                        ? `Urlaub eintragen und ${coveragePreview.movableCount} Termine verschieben`
                        : "Urlaub mit Restkonflikten eintragen"
                      : "Trotzdem eintragen"}
                  </Button>
                )}
                {editable && conflictDialog.mode === "inspect" && (
                  <Button
                    disabled={
                      conflictDialog.staff.kind === "practitioner" &&
                      coveragePreview === undefined
                    }
                    onClick={() => {
                      const applyChange =
                        conflictDialog.staff.kind === "practitioner" &&
                        coveragePreview
                          ? createVacationWithCoverageAdjustments({
                              date: conflictDialog.date.toString(),
                              expectedDraftRevision:
                                ruleSetReplayTargetRef.current.kind === "draft"
                                  ? ruleSetReplayTargetRef.current.draftRevision
                                  : null,
                              portion: conflictDialog.portion,
                              practiceId,
                              practitionerId: conflictDialog.staff.lineageKey,
                              reassignments:
                                coveragePreview.suggestions.flatMap(
                                  (suggestion) =>
                                    suggestion.targetPractitionerId
                                      ? [
                                          {
                                            appointmentId:
                                              suggestion.appointmentId,
                                            targetPractitionerId:
                                              suggestion.targetPractitionerId,
                                          },
                                        ]
                                      : [],
                                ),
                              selectedRuleSetId: ruleSetIdFromReplayTarget(
                                ruleSetReplayTargetRef.current,
                              ),
                              ...(replacingVacationLineageKeys.length > 0
                                ? { replacingVacationLineageKeys }
                                : {}),
                            }).then((result) => {
                              handleDraftMutationResult(result);
                            })
                          : commitVacationChange(
                              conflictDialog.staff,
                              conflictDialog.date,
                              [conflictDialog.portion],
                              "Urlaub geändert",
                            );

                      void applyChange
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
                    {coveragePreview &&
                    conflictDialog.staff.kind === "practitioner"
                      ? coveragePreview.movableCount > 0
                        ? `Urlaub ändern und ${coveragePreview.movableCount} Termine verschieben`
                        : "Urlaub mit Restkonflikten ändern"
                      : "Urlaub ändern"}
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

function findMfaByLineage(rows: MfaRowEntity[], lineageKey: MfaLineageKey) {
  return findFrontendEntityByLineageKey(rows, lineageKey);
}

function formatGermanDate(dateString: string) {
  try {
    const date = Temporal.PlainDate.from(dateString);
    return `${String(date.day).padStart(2, "0")}.${String(date.month).padStart(2, "0")}.${date.year}`;
  } catch {
    const gdtDateMatch = GDT_DATE_REGEX.exec(dateString);
    if (gdtDateMatch) {
      const [, day, month, year] = gdtDateMatch;
      return `${day}.${month}.${year}`;
    }

    return dateString;
  }
}

function isAlreadyExistingMfaError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes("Diese MFA existiert im aktuellen Regelset bereits.")
  );
}

function isMissingMfaError(error: unknown) {
  return (
    error instanceof Error && error.message.includes("MFA nicht gefunden.")
  );
}

function isWeekend(date: Temporal.PlainDate) {
  return date.dayOfWeek === 6 || date.dayOfWeek === 7;
}

function startOfMonth(date: Temporal.PlainDate): Temporal.PlainDate {
  return date.with({ day: 1 });
}

function vacationStaffLineageMutationArgs(staff: StaffRow) {
  return staff.kind === "mfa"
    ? { mfaId: staff.lineageKey }
    : { practitionerId: staff.lineageKey };
}
