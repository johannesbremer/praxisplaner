import { useCallback, useEffect, useState } from "react";

import type { Id } from "@/convex/_generated/dataModel";

export interface LocalAppointment {
  appointmentType: string;
  end: Date;
  id: string; // Local ID, not Convex ID
  isLocal: true; // Flag to distinguish from real appointments
  locationId?: Id<"locations">;
  notes?: string;
  patientId?: Id<"patients">;
  practitionerId: Id<"practitioners">;
  start: Date;
  title: string;
}

/* eslint-disable react-hooks/react-compiler */
// Global state to sync between views - using object to avoid reassignment issues
const globalState = {
  appointments: [] as LocalAppointment[],
  subscribers: [] as ((appointments: LocalAppointment[]) => void)[],
};

const notifySubscribers = () => {
  for (const callback of globalState.subscribers) {
    callback([...globalState.appointments]);
  }
};

/**
 * Hook for managing local temporary appointments that sync between views.
 */
export function useLocalAppointments() {
  const [localAppointments, setLocalAppointments] = useState<
    LocalAppointment[]
  >(globalState.appointments);

  // Subscribe to global state changes
  useEffect(() => {
    const updateLocal = (appointments: LocalAppointment[]) => {
      setLocalAppointments(appointments);
    };

    globalState.subscribers.push(updateLocal);

    return () => {
      const index = globalState.subscribers.indexOf(updateLocal);
      if (index !== -1) {
        globalState.subscribers.splice(index, 1);
      }
    };
  }, []);

  const addLocalAppointment = useCallback(
    (appointment: Omit<LocalAppointment, "id" | "isLocal">) => {
      const newAppointment: LocalAppointment = {
        ...appointment,
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        isLocal: true,
      };

      const newAppointments = [...globalState.appointments, newAppointment];
      globalState.appointments.length = 0;
      globalState.appointments.push(...newAppointments);
      notifySubscribers();
    },
    [],
  );

  const updateLocalAppointment = useCallback(
    (id: string, updates: Partial<LocalAppointment>) => {
      const newAppointments = globalState.appointments.map((apt) =>
        apt.id === id ? { ...apt, ...updates } : apt,
      );
      globalState.appointments.length = 0;
      globalState.appointments.push(...newAppointments);
      notifySubscribers();
    },
    [],
  );

  const removeLocalAppointment = useCallback((id: string) => {
    const newAppointments = globalState.appointments.filter(
      (apt) => apt.id !== id,
    );
    globalState.appointments.length = 0;
    globalState.appointments.push(...newAppointments);
    notifySubscribers();
  }, []);

  const clearAllLocalAppointments = useCallback(() => {
    globalState.appointments.length = 0;
    notifySubscribers();
  }, []);

  return {
    addLocalAppointment,
    clearAllLocalAppointments,
    localAppointments,
    removeLocalAppointment,
    updateLocalAppointment,
  };
}
