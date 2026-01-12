// Booking Wizard Components
// Export all step components for the multi-step booking wizard

export { AgeCheckStep } from "./age-check-step";
export { AppointmentTypeStep } from "./appointment-type-step";
export { CalendarSelectionStep } from "./calendar-selection-step";
export {
  ConfirmationStep,
  type ConfirmationStepProps,
} from "./confirmation-step";
export { DataInputStep } from "./data-input-step";
export { DoctorSelectionStep } from "./doctor-selection-step";
export { GkvDetailsStep } from "./gkv-details-step";
export { InsuranceTypeStep } from "./insurance-type-step";
export { LocationStep } from "./location-step";
export { PatientStatusStep } from "./patient-status-step";
export { PkvDetailsStep } from "./pkv-details-step";
export { PrivacyStep } from "./privacy-step";
export { PvsConsentStep } from "./pvs-consent-step";

// Export types and utilities
export {
  type BookingSessionState,
  canGoBack,
  getStepGroup,
  STEP_LABELS,
  type StepComponentProps,
} from "./types";
