export interface AvailableSlot {
  appointmentType: string;
  date: Date | string;
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

// Database-compatible types for Convex
export interface DbRule {
  _id: string;
  _creationTime: number;
  ruleConfigurationId: string;
  name: string;
  type: "CONDITIONAL_AVAILABILITY" | "RESOURCE_CONSTRAINT" | "SEASONAL_AVAILABILITY" | "TIME_BLOCK";
  priority: number;
  active: boolean;
  conditions: {
    appointmentType?: string;
    patientType?: string;
    dateRange?: {
      start: string;
      end: string;
    };
    timeRange?: {
      start: string;
      end: string;
    };
    dayOfWeek?: number[];
    requiredResources?: string[];
  };
  actions: {
    requireExtraTime?: boolean;
    extraMinutes?: number;
    limitPerDay?: number;
    requireSpecificDoctor?: string;
    enableBatchAppointments?: boolean;
    batchSize?: number;
    batchDuration?: number;
    blockTimeSlots?: string[];
  };
  createdAt: bigint;
  lastModified: bigint;
}

export interface DbRuleConfiguration {
  _id: string;
  _creationTime: number;
  practiceId: string;
  version: number;
  description: string;
  createdBy: string;
  createdAt: bigint;
  isActive: boolean;
}

export interface DbPractice {
  _id: string;
  _creationTime: number;
  name: string;
  currentActiveRuleConfigurationId?: string;
  settings?: {
    defaultSlotDuration?: number;
    workingHours?: {
      start: string;
      end: string;
    };
  };
  createdAt: bigint;
  lastModified: bigint;
}

export interface DbBaseAvailability {
  _id: string;
  _creationTime: number;
  practiceId: string;
  doctorId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotDuration: number;
  breakTimes?: {
    start: string;
    end: string;
  }[];
  createdAt: bigint;
  lastModified: bigint;
}

export interface RuleApplicationResult {
  slots: AvailableSlot[];
  appliedRules: string[];
  ruleTrace?: {
    ruleName: string;
    applied: boolean;
    reason: string;
  }[];
}
