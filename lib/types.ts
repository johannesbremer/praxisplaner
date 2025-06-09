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
export interface DbBaseAvailability {
  _creationTime: number;
  _id: string;
  breakTimes?: {
    end: string;
    start: string;
  }[];
  createdAt: bigint;
  dayOfWeek: number;
  doctorId: string;
  endTime: string;
  lastModified: bigint;
  practiceId: string;
  slotDuration: number;
  startTime: string;
}

export interface DbPractice {
  _creationTime: number;
  _id: string;
  createdAt: bigint;
  currentActiveRuleConfigurationId?: string;
  lastModified: bigint;
  name: string;
  settings?: {
    defaultSlotDuration?: number;
    workingHours?: {
      end: string;
      start: string;
    };
  };
}

export interface DbRule {
  _creationTime: number;
  _id: string;
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
  createdAt: bigint;
  lastModified: bigint;
  name: string;
  priority: number;
  ruleConfigurationId: string;
  type:
    | "CONDITIONAL_AVAILABILITY"
    | "RESOURCE_CONSTRAINT"
    | "SEASONAL_AVAILABILITY"
    | "TIME_BLOCK";
}

export interface DbRuleConfiguration {
  _creationTime: number;
  _id: string;
  createdAt: bigint;
  createdBy: string;
  description: string;
  isActive: boolean;
  practiceId: string;
  version: number;
}

export interface RuleApplicationResult {
  appliedRules: string[];
  ruleTrace?: {
    applied: boolean;
    reason: string;
    ruleName: string;
  }[];
  slots: AvailableSlot[];
}
