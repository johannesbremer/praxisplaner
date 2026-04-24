import type { RefObject } from "react";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";

import type { Id } from "../../../convex/_generated/dataModel";
import type {
  CalendarAppointmentLayout,
  CalendarBlockedSlotRecord,
  CalendarColumnId,
} from "./types";
import type { SimulatedBlockedSlotConversionResult } from "./use-calendar-logic-helpers";

import { captureErrorGlobal } from "../../utils/error-tracking";
import { SLOT_DURATION } from "./types";
import { TIMEZONE } from "./use-calendar-logic-helpers";

export type ActiveResizeDraft =
  | {
      column: CalendarColumnId;
      commitAppointmentId: Id<"appointments">;
      entityId: string;
      kind: "appointment";
      originalDuration: number;
      previewDuration: number;
      startClientY: number;
      startSlot: number;
    }
  | {
      column: CalendarColumnId;
      commitBlockedSlotId: Id<"blockedSlots">;
      entityId: string;
      kind: "blockedSlot";
      originalDuration: number;
      previewDuration: number;
      startClientY: number;
      startSlot: number;
    };

export interface CalendarManualBlockedSlot {
  column: CalendarColumnId;
  duration?: number;
  id?: string;
  isManual?: boolean;
  reason?: string;
  slot: number;
  startSlot?: number;
  title?: string;
}

export interface ResizeStartEvent {
  clientY: number;
  preventDefault(): void;
  stopPropagation(): void;
}

type BlockedSlotRecord = CalendarBlockedSlotRecord;

export function useCalendarInteractions({
  baseAppointments,
  baseManualBlockedSlots,
  blockedSlotDocMapRef,
  checkCollision,
  convertRealAppointmentToSimulation,
  convertRealBlockedSlotToSimulation,
  isNonRootSeriesAppointment,
  resolveBlockedSlotDisplayRefs,
  runUpdateAppointment,
  runUpdateBlockedSlot,
  selectedDate,
  showNonRootSeriesEditToast,
  simulatedContext,
  slotToTime,
  timeToSlot,
}: {
  baseAppointments: CalendarAppointmentLayout[];
  baseManualBlockedSlots: CalendarManualBlockedSlot[];
  blockedSlotDocMapRef: RefObject<Map<string, BlockedSlotRecord>>;
  checkCollision: (
    column: CalendarColumnId,
    slot: number,
    duration: number,
    excludeId?: string,
  ) => boolean;
  convertRealAppointmentToSimulation: (
    appointment: CalendarAppointmentLayout,
    options: {
      durationMinutes?: number;
      endISO?: string;
      startISO?: string;
    },
  ) => Promise<CalendarAppointmentLayout | null>;
  convertRealBlockedSlotToSimulation: (
    blockedSlotId: string,
    options: {
      endISO?: string;
      locationId?: Id<"locations">;
      practitionerId?: Id<"practitioners">;
      startISO?: string;
      title?: string;
    },
  ) => Promise<null | SimulatedBlockedSlotConversionResult>;
  isNonRootSeriesAppointment: (appointmentId?: string) => boolean;
  resolveBlockedSlotDisplayRefs: (blockedSlot: BlockedSlotRecord) => null | {
    locationId: Id<"locations">;
    practitionerId?: Id<"practitioners">;
  };
  runUpdateAppointment: (args: {
    end?: string;
    id: Id<"appointments">;
  }) => Promise<void>;
  runUpdateBlockedSlot: (args: {
    end?: string;
    id: Id<"blockedSlots">;
    isSimulation?: boolean;
  }) => Promise<unknown>;
  selectedDate: Temporal.PlainDate;
  showNonRootSeriesEditToast: () => void;
  simulatedContext: undefined | { locationId?: Id<"locations"> };
  slotToTime: (slot: number) => string;
  timeToSlot: (time: string) => number;
}) {
  const [activeResizeDraft, setActiveResizeDraft] =
    useState<ActiveResizeDraft | null>(null);
  const activeResizeDraftRef = useRef<ActiveResizeDraft | null>(null);
  const detachResizeListenersRef = useRef<(() => void) | null>(null);
  const justFinishedResizingRef = useRef<null | string>(null);

  const appointmentsRef = useRef(baseAppointments);
  const manualBlockedSlotsRef = useRef(baseManualBlockedSlots);
  const checkCollisionRef = useRef(checkCollision);
  const runUpdateAppointmentRef = useRef(runUpdateAppointment);
  const runUpdateBlockedSlotRef = useRef(runUpdateBlockedSlot);
  const selectedDateRef = useRef(selectedDate);
  const simulatedContextRef = useRef(simulatedContext);
  const slotToTimeRef = useRef(slotToTime);
  const timeToSlotRef = useRef(timeToSlot);
  const convertRealAppointmentToSimulationRef = useRef(
    convertRealAppointmentToSimulation,
  );
  const convertRealBlockedSlotToSimulationRef = useRef(
    convertRealBlockedSlotToSimulation,
  );
  const isNonRootSeriesAppointmentRef = useRef(isNonRootSeriesAppointment);
  const showNonRootSeriesEditToastRef = useRef(showNonRootSeriesEditToast);

  useEffect(() => {
    appointmentsRef.current = baseAppointments;
  }, [baseAppointments]);

  useEffect(() => {
    manualBlockedSlotsRef.current = baseManualBlockedSlots;
  }, [baseManualBlockedSlots]);

  useEffect(() => {
    checkCollisionRef.current = checkCollision;
  }, [checkCollision]);

  useEffect(() => {
    runUpdateAppointmentRef.current = runUpdateAppointment;
  }, [runUpdateAppointment]);

  useEffect(() => {
    runUpdateBlockedSlotRef.current = runUpdateBlockedSlot;
  }, [runUpdateBlockedSlot]);

  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  useEffect(() => {
    simulatedContextRef.current = simulatedContext;
  }, [simulatedContext]);

  useEffect(() => {
    slotToTimeRef.current = slotToTime;
  }, [slotToTime]);

  useEffect(() => {
    timeToSlotRef.current = timeToSlot;
  }, [timeToSlot]);

  useEffect(() => {
    convertRealAppointmentToSimulationRef.current =
      convertRealAppointmentToSimulation;
  }, [convertRealAppointmentToSimulation]);

  useEffect(() => {
    convertRealBlockedSlotToSimulationRef.current =
      convertRealBlockedSlotToSimulation;
  }, [convertRealBlockedSlotToSimulation]);

  useEffect(() => {
    isNonRootSeriesAppointmentRef.current = isNonRootSeriesAppointment;
  }, [isNonRootSeriesAppointment]);

  useEffect(() => {
    showNonRootSeriesEditToastRef.current = showNonRootSeriesEditToast;
  }, [showNonRootSeriesEditToast]);

  const setResizeDraft = useCallback((draft: ActiveResizeDraft | null) => {
    activeResizeDraftRef.current = draft;
    setActiveResizeDraft(draft);
  }, []);

  const clearResizeListeners = useCallback(() => {
    detachResizeListenersRef.current?.();
    detachResizeListenersRef.current = null;
  }, []);

  const handleDocumentMouseMove = useCallback(
    (event: MouseEvent) => {
      const currentDraft = activeResizeDraftRef.current;
      if (!currentDraft) {
        setResizeDraft(null);
        return;
      }

      const deltaY = event.clientY - currentDraft.startClientY;
      const deltaSlots = Math.round(deltaY / 16);

      setResizeDraft({
        ...currentDraft,
        previewDuration: Math.max(
          SLOT_DURATION,
          currentDraft.originalDuration + deltaSlots * SLOT_DURATION,
        ),
      });
    },
    [setResizeDraft],
  );

  const handleDocumentMouseUp = useCallback(() => {
    const resizeDraft = activeResizeDraftRef.current;
    if (!resizeDraft) {
      clearResizeListeners();
      return;
    }

    justFinishedResizingRef.current = resizeDraft.entityId;
    globalThis.setTimeout(() => {
      justFinishedResizingRef.current = null;
    }, 100);
    clearResizeListeners();
    setResizeDraft(null);

    if (resizeDraft.previewDuration === resizeDraft.originalDuration) {
      return;
    }

    if (resizeDraft.kind === "appointment") {
      const appointmentVisibleId = String(resizeDraft.commitAppointmentId);
      const collisionExcludeId = appointmentsRef.current.some(
        (entry) => entry.id === appointmentVisibleId,
      )
        ? appointmentVisibleId
        : resizeDraft.entityId;
      if (
        checkCollisionRef.current(
          resizeDraft.column,
          resizeDraft.startSlot,
          resizeDraft.previewDuration,
          collisionExcludeId,
        )
      ) {
        return;
      }
      const appointmentId = resizeDraft.commitAppointmentId;

      void (async () => {
        try {
          const startTime = slotToTimeRef.current(resizeDraft.startSlot);
          const plainTime = Temporal.PlainTime.from(startTime);
          const startZoned = selectedDateRef.current.toZonedDateTime({
            plainTime,
            timeZone: TIMEZONE,
          });
          const endZoned = startZoned.add({
            minutes: resizeDraft.previewDuration,
          });
          await runUpdateAppointmentRef.current({
            end: endZoned.toString(),
            id: appointmentId,
          });
        } catch (error) {
          captureErrorGlobal(error, {
            appointmentId,
            context: "NewCalendar - Failed to update appointment duration",
          });
          toast.error("Termin-Dauer konnte nicht aktualisiert werden");
        }
      })();
      return;
    }

    const blockedSlotVisibleId = String(resizeDraft.commitBlockedSlotId);
    const collisionExcludeId = manualBlockedSlotsRef.current.some(
      (entry) => entry.id === blockedSlotVisibleId,
    )
      ? blockedSlotVisibleId
      : resizeDraft.entityId;
    if (
      checkCollisionRef.current(
        resizeDraft.column,
        resizeDraft.startSlot,
        resizeDraft.previewDuration,
        collisionExcludeId,
      )
    ) {
      return;
    }

    void (async () => {
      try {
        const startTime = slotToTimeRef.current(resizeDraft.startSlot);
        const plainTime = Temporal.PlainTime.from(startTime);
        const startZoned = selectedDateRef.current.toZonedDateTime({
          plainTime,
          timeZone: TIMEZONE,
        });
        const endZoned = startZoned.add({
          minutes: resizeDraft.previewDuration,
        });
        await runUpdateBlockedSlotRef.current({
          end: endZoned.toString(),
          id: resizeDraft.commitBlockedSlotId,
          ...(simulatedContextRef.current ? { isSimulation: true } : {}),
        });
      } catch (error) {
        captureErrorGlobal(error, {
          blockedSlotId: resizeDraft.entityId,
          context: "Failed to update blocked slot duration",
        });
        toast.error(
          "Dauer des gesperrten Zeitraums konnte nicht aktualisiert werden",
        );
      }
    })();
  }, [clearResizeListeners, setResizeDraft]);

  const ensureResizeListeners = useCallback(() => {
    if (detachResizeListenersRef.current) {
      return;
    }

    document.addEventListener("mousemove", handleDocumentMouseMove);
    document.addEventListener("mouseup", handleDocumentMouseUp);
    detachResizeListenersRef.current = () => {
      document.removeEventListener("mousemove", handleDocumentMouseMove);
      document.removeEventListener("mouseup", handleDocumentMouseUp);
    };
  }, [handleDocumentMouseMove, handleDocumentMouseUp]);

  useEffect(() => clearResizeListeners, [clearResizeListeners]);

  const handleResizeStart = useCallback(
    (
      event: ResizeStartEvent,
      appointmentId: string,
      currentDuration: number,
    ) => {
      event.preventDefault();
      event.stopPropagation();

      if (isNonRootSeriesAppointmentRef.current(appointmentId)) {
        showNonRootSeriesEditToastRef.current();
        return;
      }

      const targetAppointment = appointmentsRef.current.find(
        (appointment) => appointment.id === appointmentId,
      );
      if (!targetAppointment) {
        return;
      }

      const startResizing = (args: {
        column: CalendarColumnId;
        commitAppointmentId: Id<"appointments">;
        entityId: string;
      }) => {
        ensureResizeListeners();
        setResizeDraft({
          column: args.column,
          commitAppointmentId: args.commitAppointmentId,
          entityId: args.entityId,
          kind: "appointment",
          originalDuration: currentDuration,
          previewDuration: currentDuration,
          startClientY: event.clientY,
          startSlot: timeToSlotRef.current(targetAppointment.startTime),
        });
      };

      if (
        simulatedContextRef.current &&
        targetAppointment.record.isSimulation !== true
      ) {
        void (async () => {
          try {
            const plainTime = Temporal.PlainTime.from(
              targetAppointment.startTime,
            );
            const startZoned = selectedDateRef.current.toZonedDateTime({
              plainTime,
              timeZone: TIMEZONE,
            });
            const endZoned = startZoned.add({
              minutes: targetAppointment.duration,
            });
            const converted =
              await convertRealAppointmentToSimulationRef.current(
                targetAppointment,
                {
                  durationMinutes: targetAppointment.duration,
                  endISO: endZoned.toString(),
                  startISO: startZoned.toString(),
                },
              );
            if (converted) {
              startResizing({
                column: targetAppointment.column,
                commitAppointmentId: converted.record._id,
                entityId: targetAppointment.id,
              });
            }
          } catch (error) {
            captureErrorGlobal(error, {
              context: "Failed to parse time in resize start",
              startTime: targetAppointment.startTime,
            });
            toast.error("Startzeit konnte nicht ermittelt werden");
          }
        })();
        return;
      }

      startResizing({
        column: targetAppointment.column,
        commitAppointmentId: targetAppointment.record._id,
        entityId: appointmentId,
      });
    },
    [ensureResizeListeners, setResizeDraft],
  );

  const handleBlockedSlotResizeStart = useCallback(
    (
      event: ResizeStartEvent,
      blockedSlotId: string,
      currentDuration: number,
    ) => {
      event.preventDefault();
      event.stopPropagation();

      const startResizing = (args: {
        column: CalendarColumnId;
        commitBlockedSlotId: Id<"blockedSlots">;
        entityId: string;
        startISO: string;
      }) => {
        const startTime = Temporal.ZonedDateTime.from(args.startISO)
          .toPlainTime()
          .toString({ smallestUnit: "minute" });
        const startSlot = timeToSlotRef.current(startTime);

        ensureResizeListeners();
        setResizeDraft({
          column: args.column,
          commitBlockedSlotId: args.commitBlockedSlotId,
          entityId: args.entityId,
          kind: "blockedSlot",
          originalDuration: currentDuration,
          previewDuration: currentDuration,
          startClientY: event.clientY,
          startSlot,
        });
      };

      const blockedSlotDoc = blockedSlotDocMapRef.current.get(blockedSlotId);
      if (
        simulatedContextRef.current &&
        blockedSlotDoc &&
        !blockedSlotDoc.isSimulation
      ) {
        void (async () => {
          try {
            const displayRefs = resolveBlockedSlotDisplayRefs(blockedSlotDoc);
            if (!displayRefs) {
              toast.error(
                "Gesperrter Zeitraum konnte in der Simulation nicht aktualisiert werden.",
              );
              return;
            }
            const convertedId =
              await convertRealBlockedSlotToSimulationRef.current(
                blockedSlotId,
                {
                  endISO: blockedSlotDoc.end,
                  locationId: displayRefs.locationId,
                  ...(displayRefs.practitionerId
                    ? { practitionerId: displayRefs.practitionerId }
                    : {}),
                  startISO: blockedSlotDoc.start,
                  title:
                    blockedSlotDoc.title ||
                    manualBlockedSlotsRef.current.find(
                      (slot) => slot.id === blockedSlotId,
                    )?.title ||
                    "Gesperrter Zeitraum",
                },
              );
            if (convertedId) {
              const manualBlockedSlot = manualBlockedSlotsRef.current.find(
                (slot) => slot.id === blockedSlotId,
              );
              const column =
                manualBlockedSlot?.column ??
                blockedSlotDoc.practitionerLineageKey ??
                "ekg";
              startResizing({
                column,
                commitBlockedSlotId: convertedId.id,
                entityId: blockedSlotId,
                startISO: convertedId.startISO,
              });
            }
          } catch (error) {
            captureErrorGlobal(error, {
              blockedSlotId,
              context: "Failed to convert blocked slot for resize",
            });
            toast.error(
              "Gesperrter Zeitraum konnte für die Simulation nicht kopiert werden",
            );
          }
        })();
        return;
      }

      const manualBlockedSlot = manualBlockedSlotsRef.current.find(
        (slot) => slot.id === blockedSlotId,
      );
      if (!manualBlockedSlot || !blockedSlotDoc) {
        return;
      }

      startResizing({
        column: manualBlockedSlot.column,
        commitBlockedSlotId: blockedSlotDoc._id,
        entityId: blockedSlotId,
        startISO: blockedSlotDoc.start,
      });
    },
    [
      blockedSlotDocMapRef,
      ensureResizeListeners,
      resolveBlockedSlotDisplayRefs,
      setResizeDraft,
    ],
  );

  const appointments = useMemo(() => {
    if (activeResizeDraft?.kind !== "appointment") {
      return baseAppointments;
    }

    return baseAppointments.map((appointment) =>
      appointment.id === activeResizeDraft.entityId ||
      appointment.id === String(activeResizeDraft.commitAppointmentId)
        ? {
            ...appointment,
            duration: activeResizeDraft.previewDuration,
          }
        : appointment,
    );
  }, [activeResizeDraft, baseAppointments]);

  const manualBlockedSlots = useMemo(() => {
    if (activeResizeDraft?.kind !== "blockedSlot") {
      return baseManualBlockedSlots;
    }

    return baseManualBlockedSlots.map((blockedSlot) =>
      blockedSlot.id === activeResizeDraft.entityId ||
      blockedSlot.id === String(activeResizeDraft.commitBlockedSlotId)
        ? {
            ...blockedSlot,
            duration: activeResizeDraft.previewDuration,
          }
        : blockedSlot,
    );
  }, [activeResizeDraft, baseManualBlockedSlots]);

  return {
    appointments,
    handleBlockedSlotResizeStart,
    handleResizeStart,
    justFinishedResizingRef,
    manualBlockedSlots,
  };
}
