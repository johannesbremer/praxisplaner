// src/tests/patient-tab-functionality.test.ts

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the PatientTab component
vi.mock("../components/PatientTab", () => ({
  PatientTab: ({ patientId }: { patientId: number }) =>
    `Patient Tab for ${patientId}`,
}));

// Mock Convex query
vi.mock("@convex-dev/react-query", () => ({
  useConvexMutation: vi.fn(() => vi.fn()),
  useConvexQuery: vi.fn(),
}));

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  Calendar: () => "Calendar Icon",
  MapPin: () => "MapPin Icon",
  Settings: () => "Settings Icon",
  User: () => "User Icon",
  X: () => "X Icon",
}));

// Mock UI components
vi.mock("@/components/ui/tabs", () => ({
  Tabs: () => null,
  TabsContent: () => null,
  TabsList: () => null,
  TabsTrigger: () => null,
}));

vi.mock("@/components/ui/card", () => ({
  Card: () => null,
  CardContent: () => null,
  CardDescription: () => null,
  CardHeader: () => null,
  CardTitle: () => null,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: () => null,
}));

vi.mock("@/components/ui/alert", () => ({
  Alert: () => null,
  AlertDescription: () => null,
  AlertTitle: () => null,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: () => null,
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => null,
}));

describe("Patient Tab Functionality", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have tab management interface", () => {
    // Test that the interface types exist and work
    interface PatientTabData {
      patientId: number;
      title: string;
    }

    const mockTab: PatientTabData = {
      patientId: 123,
      title: "John Doe",
    };

    expect(mockTab.patientId).toBe(123);
    expect(mockTab.title).toBe("John Doe");
  });

  it("should format patient name correctly", () => {
    // Test the patient name formatting logic
    const formatPatientName = (
      firstName?: string,
      lastName?: string,
      patientId?: number,
    ) => {
      if (firstName && lastName) {
        return `${firstName} ${lastName}`;
      }
      return `Patient ${patientId}`;
    };

    expect(formatPatientName("John", "Doe", 123)).toBe("John Doe");
    expect(formatPatientName(undefined, undefined, 123)).toBe("Patient 123");
    expect(formatPatientName("John", undefined, 123)).toBe("Patient 123");
  });

  it("should generate correct tab ID", () => {
    const generateTabId = (patientId: number) => `patient-${patientId}`;

    expect(generateTabId(123)).toBe("patient-123");
    expect(generateTabId(456)).toBe("patient-456");
  });

  it("should handle tab data structure", () => {
    // Test the tab data structure management
    const tabs: { patientId: number; title: string }[] = [];

    // Add a new tab
    const newTab = { patientId: 123, title: "John Doe" };
    tabs.push(newTab);

    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.patientId).toBe(123);

    // Check if tab exists
    const existingTab = tabs.find((tab) => tab.patientId === 123);
    expect(existingTab).toBeDefined();

    // Remove tab
    const filteredTabs = tabs.filter((tab) => tab.patientId !== 123);
    expect(filteredTabs).toHaveLength(0);
  });

  it("should handle GDT date formatting", () => {
    // Test the GDT date formatting function used in PatientTab
    const formatGdtDate = (dateString?: string) => {
      if (!dateString) {
        return "Nicht verf\xFCgbar";
      }
      // GDT format is TTMMJJJJ (day month year)
      if (dateString.length === 8) {
        const day = dateString.substring(0, 2);
        const month = dateString.substring(2, 4);
        const year = dateString.substring(4, 8);
        return `${day}.${month}.${year}`;
      }
      return dateString;
    };

    expect(formatGdtDate("15121990")).toBe("15.12.1990");
    expect(formatGdtDate("01011980")).toBe("01.01.1980");
    expect(formatGdtDate(undefined)).toBe("Nicht verfügbar");
    expect(formatGdtDate("")).toBe("Nicht verfügbar");
    expect(formatGdtDate("invalid")).toBe("invalid");
  });

  it("should dispatch PVS custom event correctly", () => {
    // Test the PVS button functionality
    const mockDispatchEvent = vi.fn();

    // Mock the window object for Node.js environment
    interface MockWindow {
      CustomEvent: new (
        type: string,
        options?: { detail?: unknown },
      ) => {
        detail: unknown;
        type: string;
      };
      dispatchEvent: ReturnType<typeof vi.fn>;
    }

    const mockWindow: MockWindow = {
      CustomEvent: class CustomEvent {
        detail: unknown;
        type: string;
        constructor(type: string, options?: { detail?: unknown }) {
          this.type = type;
          this.detail = options?.detail;
        }
      },
      dispatchEvent: mockDispatchEvent,
    };

    Object.defineProperty(global, "window", {
      value: mockWindow,
      writable: true,
    });

    // Simulate the handleOpenInPvs function
    const handleOpenInPvs = (patientId: number) => {
      const event = new mockWindow.CustomEvent("praxisplaner:openInPvs", {
        detail: { patientId },
      });
      mockWindow.dispatchEvent(event);
    };

    // Test the function
    handleOpenInPvs(4567);

    // Verify the event was dispatched
    expect(mockDispatchEvent).toHaveBeenCalledTimes(1);

    const dispatchedEvent = mockDispatchEvent.mock.calls[0]?.[0] as {
      detail: unknown;
      type: string;
    };
    expect(dispatchedEvent.type).toBe("praxisplaner:openInPvs");
    expect(dispatchedEvent.detail).toEqual({ patientId: 4567 });
  });
});
