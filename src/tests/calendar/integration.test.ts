import { act, renderHook, waitFor } from "@testing-library/react";
import { Temporal } from "temporal-polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
            column: "practitioner_1",
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
            column: "practitioner_1",
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
            column: "practitioner_1",
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
            column: "practitioner_1",
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

  it("commits blocked-slot resizes once on mouseup", async () => {
    const runUpdateBlockedSlot = vi.fn(() => Promise.resolve());

    const { result } = renderHook(() =>
      useCalendarInteractions({
        baseAppointments: [],
        baseManualBlockedSlots: [
          {
            column: "practitioner_1",
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
              {
                _id: toTableId<"blockedSlots">("blocked_slot_1"),
                end: "2026-04-23T09:30:00+02:00[Europe/Berlin]",
                locationId: toTableId<"locations">("location_1"),
                practitionerId: toTableId<"practitioners">("practitioner_1"),
                start: "2026-04-23T09:00:00+02:00[Europe/Berlin]",
                title: "Blocked",
              },
            ],
          ]),
        },
        checkCollision: vi.fn().mockReturnValue(false),
        convertRealAppointmentToSimulation: vi.fn(),
        convertRealBlockedSlotToSimulation: vi.fn(),
        isNonRootSeriesAppointment: vi.fn().mockReturnValue(false),
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

  it("keeps blocked-slot resize active across conversion before the simulated row reaches query state", async () => {
    const runUpdateBlockedSlot = vi.fn(() => Promise.resolve());
    const convertRealBlockedSlotToSimulation = vi.fn(() =>
      Promise.resolve({
        id: toTableId<"blockedSlots">("blocked_slot_sim"),
        startISO: "2026-04-23T09:00:00+02:00[Europe/Berlin]",
      }),
    );
    const slotToTime = (slot: number) =>
      `${String(8 + Math.floor((slot * 5) / 60)).padStart(2, "0")}:${String((slot * 5) % 60).padStart(2, "0")}`;
    const timeToSlot = (time: string) => {
      const [hours = "0", minutes = "0"] = time.split(":");
      return (Number(hours) - 8) * 12 + Math.floor(Number(minutes) / 5);
    };

    const originalBlockedSlot = {
      _id: toTableId<"blockedSlots">("blocked_slot_1"),
      end: "2026-04-23T09:30:00+02:00[Europe/Berlin]",
      locationId: toTableId<"locations">("location_1"),
      practitionerId: toTableId<"practitioners">("practitioner_1"),
      start: "2026-04-23T09:00:00+02:00[Europe/Berlin]",
      title: "Blocked",
    };
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
              column: "practitioner_1",
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
          runUpdateAppointment: vi.fn(),
          runUpdateBlockedSlot,
          selectedDate: Temporal.PlainDate.from("2026-04-23"),
          showNonRootSeriesEditToast: vi.fn(),
          simulatedContext: {
            locationId: toTableId<"locations">("location_1"),
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

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientY: 148 }));
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
          column: "practitioner_1",
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
      runUpdateAppointment: vi.fn(),
      runUpdateBlockedSlot,
      selectedDate: Temporal.PlainDate.from("2026-04-23"),
      showNonRootSeriesEditToast: vi.fn(),
      simulatedContext: {
        locationId: toTableId<"locations">("location_1"),
      },
      slotToTime,
      timeToSlot,
    });

    expect(result.current.manualBlockedSlots[0]?.duration).toBe(45);

    act(() => {
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
