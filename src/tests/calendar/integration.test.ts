import { act, renderHook, waitFor } from "@testing-library/react";
import { Temporal } from "temporal-polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BlockedSlotResult } from "../../../convex/appointments";

import { toTableId } from "../../../convex/identity";
import { useCalendarInteractions } from "../../components/calendar/use-calendar-interactions";

const { captureErrorGlobal, toastError } = vi.hoisted(() => ({
  captureErrorGlobal: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastError,
  },
}));

vi.mock("../../utils/error-tracking", () => ({
  captureErrorGlobal,
}));

const location1 = toTableId<"locations">("location_1");
const practice1 = toTableId<"practices">("practice_1");
const practitioner1 = toTableId<"practitioners">("practitioner_1");

const resolveBlockedSlotDisplayRefs = () => ({
  locationId: location1,
  practitionerId: practitioner1,
});

function buildBlockedSlotResult(
  overrides: Partial<BlockedSlotResult> & Pick<BlockedSlotResult, "_id">,
): BlockedSlotResult {
  const { _id, ...rest } = overrides;
  return {
    _creationTime: 0,
    _id,
    createdAt: 0n,
    end: "2026-04-23T09:30:00+02:00[Europe/Berlin]",
    lastModified: 0n,
    locationId: location1,
    locationLineageKey: location1,
    practiceId: practice1,
    practitionerId: practitioner1,
    practitionerLineageKey: practitioner1,
    start: "2026-04-23T09:00:00+02:00[Europe/Berlin]",
    title: "Blocked",
    ...rest,
  };
}

function createResizeStartEvent(clientY: number) {
  return {
    clientY,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

describe("calendar resize interactions", () => {
  beforeEach(() => {
    toastError.mockReset();
    captureErrorGlobal.mockReset();
  });

  it("keeps resize mutations local until mouseup, then commits exactly once", async () => {
    const runUpdateAppointment = vi.fn(() => Promise.resolve());

    const { result } = renderHook(() =>
      useCalendarInteractions({
        baseAppointments: [
          {
            color: "bg-blue-500",
            column: practitioner1,
            convexId: toTableId<"appointments">("appointment_1"),
            duration: 30,
            id: "appointment_1",
            isSimulation: false,
            startTime: "09:00",
            title: "Checkup",
          },
        ],
        baseManualBlockedSlots: [],
        blockedSlotDocMapRef: { current: new Map() },
        checkCollision: vi.fn().mockReturnValue(false),
        convertRealAppointmentToSimulation: vi.fn(),
        convertRealBlockedSlotToSimulation: vi.fn(),
        isNonRootSeriesAppointment: vi.fn().mockReturnValue(false),
        resolveBlockedSlotDisplayRefs,
        runUpdateAppointment,
        runUpdateBlockedSlot: vi.fn(),
        selectedDate: Temporal.PlainDate.from("2026-04-23"),
        showNonRootSeriesEditToast: vi.fn(),
        simulatedContext: undefined,
        slotToTime: (slot) =>
          `${String(8 + Math.floor((slot * 5) / 60)).padStart(2, "0")}:${String((slot * 5) % 60).padStart(2, "0")}`,
        timeToSlot: (time) => {
          const [hours = "0", minutes = "0"] = time.split(":");
          return (Number(hours) - 8) * 12 + Math.floor(Number(minutes) / 5);
        },
      }),
    );

    act(() => {
      result.current.handleResizeStart(
        createResizeStartEvent(100),
        "appointment_1",
        30,
      );
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientY: 148 }));
    });

    expect(runUpdateAppointment).not.toHaveBeenCalled();
    expect(result.current.appointments[0]?.duration).toBe(45);

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });

    await waitFor(() => {
      expect(runUpdateAppointment).toHaveBeenCalledTimes(1);
    });
    expect(runUpdateAppointment).toHaveBeenCalledWith({
      end: "2026-04-23T09:45:00+02:00[Europe/Berlin]",
      id: "appointment_1",
    });
  });

  it("commits the latest preview duration when mousemove and mouseup happen in the same act", async () => {
    const runUpdateAppointment = vi.fn(() => Promise.resolve());

    const { result } = renderHook(() =>
      useCalendarInteractions({
        baseAppointments: [
          {
            color: "bg-blue-500",
            column: practitioner1,
            convexId: toTableId<"appointments">("appointment_1"),
            duration: 30,
            id: "appointment_1",
            isSimulation: false,
            startTime: "09:00",
            title: "Checkup",
          },
        ],
        baseManualBlockedSlots: [],
        blockedSlotDocMapRef: { current: new Map() },
        checkCollision: vi.fn().mockReturnValue(false),
        convertRealAppointmentToSimulation: vi.fn(),
        convertRealBlockedSlotToSimulation: vi.fn(),
        isNonRootSeriesAppointment: vi.fn().mockReturnValue(false),
        resolveBlockedSlotDisplayRefs,
        runUpdateAppointment,
        runUpdateBlockedSlot: vi.fn(),
        selectedDate: Temporal.PlainDate.from("2026-04-23"),
        showNonRootSeriesEditToast: vi.fn(),
        simulatedContext: undefined,
        slotToTime: () => "09:00",
        timeToSlot: () => 12,
      }),
    );

    act(() => {
      result.current.handleResizeStart(
        createResizeStartEvent(100),
        "appointment_1",
        30,
      );
      document.dispatchEvent(new MouseEvent("mousemove", { clientY: 148 }));
      document.dispatchEvent(new MouseEvent("mouseup"));
    });

    await waitFor(() => {
      expect(runUpdateAppointment).toHaveBeenCalledTimes(1);
    });
    expect(runUpdateAppointment).toHaveBeenCalledWith({
      end: "2026-04-23T09:45:00+02:00[Europe/Berlin]",
      id: "appointment_1",
    });
  });

  it("skips the mutation when the resize does not change the duration", async () => {
    const runUpdateAppointment = vi.fn(() => Promise.resolve());

    const { result } = renderHook(() =>
      useCalendarInteractions({
        baseAppointments: [
          {
            color: "bg-blue-500",
            column: practitioner1,
            convexId: toTableId<"appointments">("appointment_1"),
            duration: 30,
            id: "appointment_1",
            isSimulation: false,
            startTime: "09:00",
            title: "Checkup",
          },
        ],
        baseManualBlockedSlots: [],
        blockedSlotDocMapRef: { current: new Map() },
        checkCollision: vi.fn().mockReturnValue(false),
        convertRealAppointmentToSimulation: vi.fn(),
        convertRealBlockedSlotToSimulation: vi.fn(),
        isNonRootSeriesAppointment: vi.fn().mockReturnValue(false),
        resolveBlockedSlotDisplayRefs,
        runUpdateAppointment,
        runUpdateBlockedSlot: vi.fn(),
        selectedDate: Temporal.PlainDate.from("2026-04-23"),
        showNonRootSeriesEditToast: vi.fn(),
        simulatedContext: undefined,
        slotToTime: () => "09:00",
        timeToSlot: () => 12,
      }),
    );

    act(() => {
      result.current.handleResizeStart(
        createResizeStartEvent(100),
        "appointment_1",
        30,
      );
      document.dispatchEvent(new MouseEvent("mouseup"));
    });

    await waitFor(() => {
      expect(runUpdateAppointment).not.toHaveBeenCalled();
    });
  });

  it("prevents the commit when the resized appointment would collide", async () => {
    const runUpdateAppointment = vi.fn(() => Promise.resolve());

    const { result } = renderHook(() =>
      useCalendarInteractions({
        baseAppointments: [
          {
            color: "bg-blue-500",
            column: practitioner1,
            convexId: toTableId<"appointments">("appointment_1"),
            duration: 30,
            id: "appointment_1",
            isSimulation: false,
            startTime: "09:00",
            title: "Checkup",
          },
        ],
        baseManualBlockedSlots: [],
        blockedSlotDocMapRef: { current: new Map() },
        checkCollision: vi.fn().mockReturnValue(true),
        convertRealAppointmentToSimulation: vi.fn(),
        convertRealBlockedSlotToSimulation: vi.fn(),
        isNonRootSeriesAppointment: vi.fn().mockReturnValue(false),
        resolveBlockedSlotDisplayRefs,
        runUpdateAppointment,
        runUpdateBlockedSlot: vi.fn(),
        selectedDate: Temporal.PlainDate.from("2026-04-23"),
        showNonRootSeriesEditToast: vi.fn(),
        simulatedContext: undefined,
        slotToTime: () => "09:00",
        timeToSlot: () => 12,
      }),
    );

    act(() => {
      result.current.handleResizeStart(
        createResizeStartEvent(100),
        "appointment_1",
        30,
      );
      document.dispatchEvent(new MouseEvent("mousemove", { clientY: 148 }));
      document.dispatchEvent(new MouseEvent("mouseup"));
    });

    await waitFor(() => {
      expect(runUpdateAppointment).not.toHaveBeenCalled();
    });
  });

  it("commits a resized simulation copy even before the appointment list refreshes", async () => {
    const runUpdateAppointment = vi.fn(() => Promise.resolve());
    const convertRealAppointmentToSimulation = vi.fn(() =>
      Promise.resolve({
        color: "bg-blue-500",
        column: practitioner1,
        convexId: toTableId<"appointments">("appointment_sim"),
        duration: 30,
        id: "appointment_sim",
        isSimulation: true,
        startTime: "09:00",
        title: "Checkup",
      }),
    );

    const { result } = renderHook(() =>
      useCalendarInteractions({
        baseAppointments: [
          {
            color: "bg-blue-500",
            column: practitioner1,
            convexId: toTableId<"appointments">("appointment_1"),
            duration: 30,
            id: "appointment_1",
            isSimulation: false,
            startTime: "09:00",
            title: "Checkup",
          },
        ],
        baseManualBlockedSlots: [],
        blockedSlotDocMapRef: { current: new Map() },
        checkCollision: vi.fn().mockReturnValue(false),
        convertRealAppointmentToSimulation,
        convertRealBlockedSlotToSimulation: vi.fn(),
        isNonRootSeriesAppointment: vi.fn().mockReturnValue(false),
        resolveBlockedSlotDisplayRefs,
        runUpdateAppointment,
        runUpdateBlockedSlot: vi.fn(),
        selectedDate: Temporal.PlainDate.from("2026-04-23"),
        showNonRootSeriesEditToast: vi.fn(),
        simulatedContext: { locationId: location1 },
        slotToTime: (slot) =>
          `${String(8 + Math.floor((slot * 5) / 60)).padStart(2, "0")}:${String((slot * 5) % 60).padStart(2, "0")}`,
        timeToSlot: (time) => {
          const [hours = "0", minutes = "0"] = time.split(":");
          return (Number(hours) - 8) * 12 + Math.floor(Number(minutes) / 5);
        },
      }),
    );

    await act(async () => {
      result.current.handleResizeStart(
        createResizeStartEvent(100),
        "appointment_1",
        30,
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(convertRealAppointmentToSimulation).toHaveBeenCalledTimes(1);
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientY: 148 }));
      document.dispatchEvent(new MouseEvent("mouseup"));
    });

    await waitFor(() => {
      expect(runUpdateAppointment).toHaveBeenCalledTimes(1);
    });
    expect(runUpdateAppointment).toHaveBeenCalledWith({
      end: "2026-04-23T09:45:00+02:00[Europe/Berlin]",
      id: toTableId<"appointments">("appointment_sim"),
    });
  });

  it("commits blocked-slot resizes once on mouseup", async () => {
    const runUpdateBlockedSlot = vi.fn(() => Promise.resolve());

    const { result } = renderHook(() =>
      useCalendarInteractions({
        baseAppointments: [],
        baseManualBlockedSlots: [
          {
            column: practitioner1,
            duration: 30,
            id: "blocked_slot_1",
            isManual: true,
            slot: 12,
            startSlot: 12,
            title: "Blocked",
          },
        ],
        blockedSlotDocMapRef: {
          current: new Map([
            [
              "blocked_slot_1",
              buildBlockedSlotResult({
                _id: toTableId<"blockedSlots">("blocked_slot_1"),
              }),
            ],
          ]),
        },
        checkCollision: vi.fn().mockReturnValue(false),
        convertRealAppointmentToSimulation: vi.fn(),
        convertRealBlockedSlotToSimulation: vi.fn(),
        isNonRootSeriesAppointment: vi.fn().mockReturnValue(false),
        resolveBlockedSlotDisplayRefs,
        runUpdateAppointment: vi.fn(),
        runUpdateBlockedSlot,
        selectedDate: Temporal.PlainDate.from("2026-04-23"),
        showNonRootSeriesEditToast: vi.fn(),
        simulatedContext: undefined,
        slotToTime: () => "09:00",
        timeToSlot: () => 12,
      }),
    );

    act(() => {
      result.current.handleBlockedSlotResizeStart(
        createResizeStartEvent(100),
        "blocked_slot_1",
        30,
      );
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientY: 148 }));
    });

    expect(runUpdateBlockedSlot).not.toHaveBeenCalled();
    expect(result.current.manualBlockedSlots[0]?.duration).toBe(45);

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });

    await waitFor(() => {
      expect(runUpdateBlockedSlot).toHaveBeenCalledTimes(1);
    });
    expect(runUpdateBlockedSlot).toHaveBeenCalledWith({
      end: "2026-04-23T09:45:00+02:00[Europe/Berlin]",
      id: "blocked_slot_1",
    });
  });

  it("commits a resized simulation blocked-slot copy even before the blocked-slot list refreshes", async () => {
    const runUpdateBlockedSlot = vi.fn(() => Promise.resolve());
    const convertRealBlockedSlotToSimulation = vi.fn(() =>
      Promise.resolve(toTableId<"blockedSlots">("blocked_slot_sim")),
    );

    const { result } = renderHook(() =>
      useCalendarInteractions({
        baseAppointments: [],
        baseManualBlockedSlots: [
          {
            column: practitioner1,
            duration: 30,
            id: "blocked_slot_1",
            isManual: true,
            slot: 12,
            startSlot: 12,
            title: "Blocked",
          },
        ],
        blockedSlotDocMapRef: {
          current: new Map([
            [
              "blocked_slot_1",
              buildBlockedSlotResult({
                _id: toTableId<"blockedSlots">("blocked_slot_1"),
              }),
            ],
          ]),
        },
        checkCollision: vi.fn().mockReturnValue(false),
        convertRealAppointmentToSimulation: vi.fn(),
        convertRealBlockedSlotToSimulation,
        isNonRootSeriesAppointment: vi.fn().mockReturnValue(false),
        resolveBlockedSlotDisplayRefs,
        runUpdateAppointment: vi.fn(),
        runUpdateBlockedSlot,
        selectedDate: Temporal.PlainDate.from("2026-04-23"),
        showNonRootSeriesEditToast: vi.fn(),
        simulatedContext: { locationId: location1 },
        slotToTime: (slot) =>
          `${String(8 + Math.floor((slot * 5) / 60)).padStart(2, "0")}:${String((slot * 5) % 60).padStart(2, "0")}`,
        timeToSlot: (time) => {
          const [hours = "0", minutes = "0"] = time.split(":");
          return (Number(hours) - 8) * 12 + Math.floor(Number(minutes) / 5);
        },
      }),
    );

    await act(async () => {
      result.current.handleBlockedSlotResizeStart(
        createResizeStartEvent(100),
        "blocked_slot_1",
        30,
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(convertRealBlockedSlotToSimulation).toHaveBeenCalledTimes(1);
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientY: 148 }));
      document.dispatchEvent(new MouseEvent("mouseup"));
    });

    await waitFor(() => {
      expect(runUpdateBlockedSlot).toHaveBeenCalledTimes(1);
    });
    expect(runUpdateBlockedSlot).toHaveBeenCalledWith({
      end: "2026-04-23T09:45:00+02:00[Europe/Berlin]",
      id: toTableId<"blockedSlots">("blocked_slot_sim"),
      isSimulation: true,
    });
  });

  it("preserves the original blocked-slot start slot while converting a real slot to simulation for resize", async () => {
    const runUpdateBlockedSlot = vi.fn(() => Promise.resolve());
    const convertRealBlockedSlotToSimulation = vi.fn(() =>
      Promise.resolve(toTableId<"blockedSlots">("blocked_slot_sim")),
    );
    const slotToTime = (slot: number) =>
      `${String(8 + Math.floor((slot * 5) / 60)).padStart(2, "0")}:${String((slot * 5) % 60).padStart(2, "0")}`;
    const timeToSlot = (time: string) => {
      const [hours = "0", minutes = "0"] = time.split(":");
      return (Number(hours) - 8) * 12 + Math.floor(Number(minutes) / 5);
    };

    const originalBlockedSlot = buildBlockedSlotResult({
      _id: toTableId<"blockedSlots">("blocked_slot_1"),
    });
    const blockedSlotDocMapRef = {
      current: new Map<string, typeof originalBlockedSlot>([
        ["blocked_slot_1", originalBlockedSlot],
      ]),
    };

    const { rerender, result } = renderHook(
      (props: Parameters<typeof useCalendarInteractions>[0]) =>
        useCalendarInteractions(props),
      {
        initialProps: {
          baseAppointments: [],
          baseManualBlockedSlots: [
            {
              column: practitioner1,
              duration: 30,
              id: "blocked_slot_1",
              isManual: true,
              slot: 12,
              startSlot: 12,
              title: "Blocked",
            },
          ],
          blockedSlotDocMapRef,
          checkCollision: vi.fn().mockReturnValue(false),
          convertRealAppointmentToSimulation: vi.fn(),
          convertRealBlockedSlotToSimulation,
          isNonRootSeriesAppointment: vi.fn().mockReturnValue(false),
          resolveBlockedSlotDisplayRefs,
          runUpdateAppointment: vi.fn(),
          runUpdateBlockedSlot,
          selectedDate: Temporal.PlainDate.from("2026-04-23"),
          showNonRootSeriesEditToast: vi.fn(),
          simulatedContext: {
            locationId: location1,
          },
          slotToTime,
          timeToSlot,
        },
      },
    );

    await act(async () => {
      result.current.handleBlockedSlotResizeStart(
        createResizeStartEvent(100),
        "blocked_slot_1",
        30,
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(convertRealBlockedSlotToSimulation).toHaveBeenCalledTimes(1);
    });

    blockedSlotDocMapRef.current = new Map([
      ["blocked_slot_1", originalBlockedSlot],
      [
        "blocked_slot_sim",
        {
          ...originalBlockedSlot,
          _id: toTableId<"blockedSlots">("blocked_slot_sim"),
        },
      ],
    ]);

    rerender({
      baseAppointments: [],
      baseManualBlockedSlots: [
        {
          column: practitioner1,
          duration: 30,
          id: "blocked_slot_sim",
          isManual: true,
          slot: 12,
          startSlot: 12,
          title: "Blocked",
        },
      ],
      blockedSlotDocMapRef,
      checkCollision: vi.fn().mockReturnValue(false),
      convertRealAppointmentToSimulation: vi.fn(),
      convertRealBlockedSlotToSimulation,
      isNonRootSeriesAppointment: vi.fn().mockReturnValue(false),
      resolveBlockedSlotDisplayRefs,
      runUpdateAppointment: vi.fn(),
      runUpdateBlockedSlot,
      selectedDate: Temporal.PlainDate.from("2026-04-23"),
      showNonRootSeriesEditToast: vi.fn(),
      simulatedContext: {
        locationId: location1,
      },
      slotToTime,
      timeToSlot,
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientY: 148 }));
      document.dispatchEvent(new MouseEvent("mouseup"));
    });

    await waitFor(() => {
      expect(runUpdateBlockedSlot).toHaveBeenCalledTimes(1);
    });
    expect(runUpdateBlockedSlot).toHaveBeenCalledWith({
      end: "2026-04-23T09:45:00+02:00[Europe/Berlin]",
      id: "blocked_slot_sim",
      isSimulation: true,
    });
  });
});
