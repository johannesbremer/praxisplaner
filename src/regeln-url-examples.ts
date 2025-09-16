// URL structure and examples for /regeln route
// 
// The regeln route supports the following URL structure:
// /regeln/{tab}/{location}/{date}/{patientType}/{ruleSet}
//
// Examples demonstrating the new functionality:
//
// 1. Default tab with active rule set:
//    /regeln
//
// 2. Rule management tab with unsaved changes:
//    /regeln/unsaved
//    or
//    /regeln/2024-11-16/unsaved
//
// 3. Staff view tab with specific rule set:
//    /regeln/mitarbeiter/hauptstandort/2024-11-16/bestand/wintersprechzeiten-2024
//
// 4. Debug tab with unsaved changes for new patient:
//    /regeln/debug/hauptstandort/2024-11-16/unsaved
//
// Key improvements implemented:
//
// 1. URL Tracking for Rule Sets:
//    - "Ungespeicherte Änderungen" maps to "unsaved" in URL
//    - Other rule sets use slugified description
//    - URL persists across tab changes
//
// 2. Auto-Unsaved State:
//    - PractitionerManagement triggers unsaved state on create/update/delete
//    - BaseScheduleManagement triggers unsaved state on schedule changes
//    - LocationsManagement triggers unsaved state on location changes  
//    - AppointmentTypesManagement triggers unsaved state on practitioner assignments
//
// 3. Cross-Tab Availability:
//    - SimulationControls now shows "Ungespeicherte Änderungen" option
//    - Rule set selection persists across all tabs
//    - URL updates automatically when switching rule sets
//
// 4. Component Integration:
//    - All management components accept onNeedRuleSet callback
//    - ensureUnsavedRuleSet is called before making changes
//    - Seamless integration with existing rule modification workflow

export const urlExamples = {
  defaultTab: "/regeln",
  unsavedChanges: "/regeln/unsaved",
  staffViewWithRuleSet: "/regeln/mitarbeiter/hauptstandort/2024-11-16/bestand/wintersprechzeiten-2024",
  debugWithUnsaved: "/regeln/debug/hauptstandort/2024-11-16/unsaved",
  withLocationAndDate: "/regeln/hauptstandort/2024-11-16/unsaved"
};

export const implementedFeatures = [
  "URL tracking for rule set selection across all tabs",
  "Auto-switch to 'Ungespeichert' state when modifying docs, work hours, locations, or appointment types", 
  "'Ungespeichert' rule set available in all tabs via SimulationControls",
  "Persistent URL state when changing tabs",
  "Integration with existing rule modification workflow"
];