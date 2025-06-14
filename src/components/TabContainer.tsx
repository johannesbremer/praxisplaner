// src/components/TabContainer.tsx

import { Suspense, lazy } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PatientTabData } from "../types";
import type { Doc } from "../../convex/_generated/dataModel";

// Lazy load PatientTab component for better code splitting
const PatientTab = lazy(() =>
  import("./PatientTab").then((module) => ({
    default: module.PatientTab,
  })),
);

interface TabContainerProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  patientTabs: PatientTabData[];
  closePatientTab: (patientId: Doc<"patients">["patientId"]) => void;
  settingsContent: React.ReactNode;
}

export function TabContainer({
  activeTab,
  setActiveTab,
  patientTabs,
  closePatientTab,
  settingsContent,
}: TabContainerProps) {
  return (
    <div className="h-screen bg-background text-foreground">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="h-full flex flex-col"
      >
        <div className="border-b px-6 py-3">
          <TabsList className="h-auto">
            <TabsTrigger value="settings" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Einstellungen
            </TabsTrigger>
            {patientTabs.map((tab) => (
              <TabsTrigger
                key={`patient-${tab.patientId}`}
                value={`patient-${tab.patientId}`}
                className="flex items-center gap-2 group relative"
              >
                <User className="h-4 w-4" />
                {tab.title}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 ml-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    closePatientTab(tab.patientId);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="flex-1 overflow-hidden">
          <TabsContent value="settings" className="h-full overflow-auto">
            {settingsContent}
          </TabsContent>

          {patientTabs.map((tab) => (
            <TabsContent
              key={`patient-${tab.patientId}`}
              value={`patient-${tab.patientId}`}
              className="h-full overflow-auto"
            >
              <Suspense
                fallback={
                  <div className="flex items-center justify-center h-64">
                    <div className="text-center space-y-2">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                      <p className="text-muted-foreground">
                        Lade Patientendaten...
                      </p>
                    </div>
                  </div>
                }
              >
                <PatientTab patientId={tab.patientId} />
              </Suspense>
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  );
}
