export interface AvailableSlot {
  appointmentType: string;
  date: Date;
  doctor: string;
  duration: number;
  id: string;
  notes?: string;
  time: string;
}

export interface BaseAvailability {
  breakTimes?: {
    end: string;
    start: string;
  }[];
  dayOfWeek: number;
  doctorId: string;
  endTime: string;
  slotDuration: number;
  startTime: string;
}

export interface PatientContext {
  assignedDoctor: null | string;
  isNewPatient: boolean;
  lastVisit: null | string;
  medicalHistory: string[];
}

export interface Rule {
  actions: {
    batchDuration?: number;
    batchSize?: number;
    blockTimeSlots?: string[];
    enableBatchAppointments?: boolean;
    extraMinutes?: number;
    limitPerDay?: number;
    requireExtraTime?: boolean;
    requireSpecificDoctor?: string;
  };
  active: boolean;
  conditions: {
    appointmentType?: string;
    dateRange?: {
      end: string;
      start: string;
    };
    dayOfWeek?: number[];
    patientType?: string;
    requiredResources?: string[];
    timeRange?: {
      end: string;
      start: string;
    };
  };
  id: string;
  name: string;
  priority: number;
  type:
    | "CONDITIONAL_AVAILABILITY"
    | "RESOURCE_CONSTRAINT"
    | "SEASONAL_AVAILABILITY"
    | "TIME_BLOCK";
}

export interface RuleConfigurationVersion {
  createdAt: Date;
  createdBy: string;
  description: string;
  id: string;
  isActive: boolean;
  ruleCount: number;
  version: number;
}
