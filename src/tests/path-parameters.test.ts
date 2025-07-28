// src/tests/path-parameters.test.ts
import { describe, expect, it } from "vitest";

// Import the utility functions from the route files
// Note: These would normally be exported from the route files for testing
const formatDateParam = (date: Date): string => {
  const isoString = date.toISOString();
  const datePart = isoString.split('T')[0];
  return datePart || isoString;
};

const parseDateParam = (dateParam: string | undefined): Date => {
  if (!dateParam) {
    return new Date();
  }
  const parsed = new Date(dateParam + 'T00:00:00.000Z');
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const isToday = (date: Date): boolean => {
  const today = new Date();
  return date.toDateString() === today.toDateString();
};

// Praxisplaner path parameter utilities
const mapTabToParam = (tab: string): string | undefined => {
  if (tab === 'settings') return 'nerds';
  return undefined; // omit for calendar (default)
};

const mapParamToTab = (param: string | undefined): string => {
  if (param === 'nerds') return 'settings';
  return 'calendar'; // default
};

// Regeln path parameter utilities
const mapRegelTabToParam = (tab: string): string | undefined => {
  if (tab === 'staff-view') return 'mitarbeiter';
  if (tab === 'debug-views') return 'debug';
  return undefined; // omit for rule-management (default)
};

const mapParamToRegelTab = (param: string | undefined): string => {
  if (param === 'mitarbeiter') return 'staff-view';
  if (param === 'debug') return 'debug-views';
  return 'rule-management'; // default
};

const mapPatientTypeToParam = (isNew: boolean): string | undefined => {
  return isNew ? undefined : 'bestand'; // omit for new patients (default)
};

const mapParamToPatientType = (param: string | undefined): boolean => {
  return param !== 'bestand'; // default to new patient unless explicitly 'bestand'
};

describe('Path Parameter Utilities', () => {
  describe('Date handling', () => {
    it('should format date as YYYY-MM-DD', () => {
      const testDate = new Date('2024-03-15T10:30:00.000Z');
      expect(formatDateParam(testDate)).toBe('2024-03-15');
    });

    it('should parse date parameter correctly', () => {
      const parsed = parseDateParam('2024-03-15');
      expect(parsed.getFullYear()).toBe(2024);
      expect(parsed.getMonth()).toBe(2); // March (0-indexed)
      expect(parsed.getDate()).toBe(15);
    });

    it('should return current date for undefined parameter', () => {
      const parsed = parseDateParam(undefined);
      const now = new Date();
      expect(parsed.toDateString()).toBe(now.toDateString());
    });

    it('should detect if date is today', () => {
      const today = new Date();
      expect(isToday(today)).toBe(true);
      
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(isToday(yesterday)).toBe(false);
    });

    it('should handle invalid date strings gracefully', () => {
      const parsed = parseDateParam('invalid-date');
      const now = new Date();
      expect(parsed.toDateString()).toBe(now.toDateString());
    });
  });

  describe('Praxisplaner tab mapping', () => {
    it('should map settings tab to nerds parameter', () => {
      expect(mapTabToParam('settings')).toBe('nerds');
    });

    it('should omit parameter for calendar tab', () => {
      expect(mapTabToParam('calendar')).toBeUndefined();
    });

    it('should map nerds parameter to settings tab', () => {
      expect(mapParamToTab('nerds')).toBe('settings');
    });

    it('should default to calendar for undefined parameter', () => {
      expect(mapParamToTab(undefined)).toBe('calendar');
    });

    it('should default to calendar for unknown parameter', () => {
      expect(mapParamToTab('unknown')).toBe('calendar');
    });
  });

  describe('Regeln tab mapping', () => {
    it('should map staff-view tab to mitarbeiter parameter', () => {
      expect(mapRegelTabToParam('staff-view')).toBe('mitarbeiter');
    });

    it('should map debug-views tab to debug parameter', () => {
      expect(mapRegelTabToParam('debug-views')).toBe('debug');
    });

    it('should omit parameter for rule-management tab', () => {
      expect(mapRegelTabToParam('rule-management')).toBeUndefined();
    });

    it('should map parameters back to correct tabs', () => {
      expect(mapParamToRegelTab('mitarbeiter')).toBe('staff-view');
      expect(mapParamToRegelTab('debug')).toBe('debug-views');
      expect(mapParamToRegelTab(undefined)).toBe('rule-management');
    });
  });

  describe('Patient type mapping', () => {
    it('should omit parameter for new patients', () => {
      expect(mapPatientTypeToParam(true)).toBeUndefined();
    });

    it('should use bestand parameter for existing patients', () => {
      expect(mapPatientTypeToParam(false)).toBe('bestand');
    });

    it('should map bestand parameter to existing patient', () => {
      expect(mapParamToPatientType('bestand')).toBe(false);
    });

    it('should default to new patient for undefined parameter', () => {
      expect(mapParamToPatientType(undefined)).toBe(true);
    });

    it('should default to new patient for other parameters', () => {
      expect(mapParamToPatientType('other')).toBe(true);
    });
  });

  describe('URL path construction scenarios', () => {
    it('should handle praxisplaner default state (today, calendar)', () => {
      const today = new Date();
      const dateParam = isToday(today) ? undefined : formatDateParam(today);
      const tabParam = mapTabToParam('calendar');
      
      expect(dateParam).toBeUndefined();
      expect(tabParam).toBeUndefined();
      // URL would be: /praxisplaner (all parameters omitted)
    });

    it('should handle praxisplaner with specific date and nerds tab', () => {
      const specificDate = new Date('2024-12-25T00:00:00.000Z');
      const dateParam = isToday(specificDate) ? undefined : formatDateParam(specificDate);
      const tabParam = mapTabToParam('settings');
      
      expect(dateParam).toBe('2024-12-25');
      expect(tabParam).toBe('nerds');
      // URL would be: /praxisplaner/2024-12-25/nerds
    });

    it('should handle regeln default state', () => {
      const today = new Date();
      const tabParam = mapRegelTabToParam('rule-management');
      const ruleSetParam = undefined; // active rule set
      const patientTypeParam = mapPatientTypeToParam(true); // new patient
      const dateParam = isToday(today) ? undefined : formatDateParam(today);
      
      expect(tabParam).toBeUndefined();
      expect(ruleSetParam).toBeUndefined();
      expect(patientTypeParam).toBeUndefined();
      expect(dateParam).toBeUndefined();
      // URL would be: /regeln (all parameters omitted)
    });

    it('should handle regeln with all parameters', () => {
      const specificDate = new Date('2024-06-15T00:00:00.000Z');
      const tabParam = mapRegelTabToParam('debug-views');
      const ruleSetParam = 'ruleset123';
      const patientTypeParam = mapPatientTypeToParam(false); // existing patient
      const dateParam = isToday(specificDate) ? undefined : formatDateParam(specificDate);
      
      expect(tabParam).toBe('debug');
      expect(ruleSetParam).toBe('ruleset123');
      expect(patientTypeParam).toBe('bestand');
      expect(dateParam).toBe('2024-06-15');
      // URL would be: /regeln/debug/ruleset123/bestand/2024-06-15
    });
  });

  describe('Bidirectional parameter conversion', () => {
    it('should maintain consistency in praxisplaner tab conversion', () => {
      const tabs = ['calendar', 'settings'];
      for (const tab of tabs) {
        const param = mapTabToParam(tab);
        const backToTab = mapParamToTab(param);
        expect(backToTab).toBe(tab);
      }
    });

    it('should maintain consistency in regeln tab conversion', () => {
      const tabs = ['rule-management', 'staff-view', 'debug-views'];
      for (const tab of tabs) {
        const param = mapRegelTabToParam(tab);
        const backToTab = mapParamToRegelTab(param);
        expect(backToTab).toBe(tab);
      }
    });

    it('should maintain consistency in patient type conversion', () => {
      const patientTypes = [true, false];
      for (const isNew of patientTypes) {
        const param = mapPatientTypeToParam(isNew);
        const backToType = mapParamToPatientType(param);
        expect(backToType).toBe(isNew);
      }
    });

    it('should maintain consistency in date conversion', () => {
      const testDates = [
        new Date('2024-01-01T00:00:00.000Z'),
        new Date('2024-12-31T23:59:59.999Z'),
        new Date(), // current date
      ];
      
      for (const date of testDates) {
        const param = formatDateParam(date);
        const backToDate = parseDateParam(param);
        
        // Should maintain the same date (ignoring time)
        expect(backToDate.getFullYear()).toBe(date.getFullYear());
        expect(backToDate.getMonth()).toBe(date.getMonth());
        expect(backToDate.getDate()).toBe(date.getDate());
      }
    });
  });
});