import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Check, Eye, RotateCcw } from "lucide-react";
import { useState } from "react";

import type { RuleConfigurationVersion } from "@/lib/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
export const Route = createFileRoute("/version")({
  component: VersionsView,
});

export default function VersionsView() {
  const [versions] = useState<RuleConfigurationVersion[]>([
    {
      createdAt: new Date("2024-01-15T14:30:00"),
      createdBy: "Dr. Schmidt",
      description: "Grippeimpfung Sonderregeln hinzugefügt",
      id: "v3",
      isActive: true,
      ruleCount: 12,
      version: 3,
    },
    {
      createdAt: new Date("2024-01-10T09:15:00"),
      createdBy: "Frau Müller",
      description: "Akutsprechstunde Zeiten angepasst",
      id: "v2",
      isActive: false,
      ruleCount: 10,
      version: 2,
    },
    {
      createdAt: new Date("2024-01-05T11:00:00"),
      createdBy: "Dr. Schmidt",
      description: "Initiale Regelkonfiguration",
      id: "v1",
      isActive: false,
      ruleCount: 8,
      version: 1,
    },
  ]);

  const handleActivateVersion = (versionId: string) => {
    // In a real app, this would update the database
    console.log("Activating version:", versionId);
  };

  const handleViewVersion = (versionId: string) => {
    // In a real app, this would navigate to a detailed view
    console.log("Viewing version:", versionId);
  };

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Versionen</h1>
        <p className="text-muted-foreground">
          Überblick über alle Regelkonfigurationen und deren Historie
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Konfigurationsversionen</CardTitle>
          <CardDescription>
            Jede Änderung an den Regeln erstellt eine neue Version
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {versions.map((version) => (
              <div
                className={`p-4 border rounded-lg ${version.isActive ? "border-primary bg-primary/5" : ""}`}
                key={version.id}
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">
                        Version {version.version}
                      </h3>
                      {version.isActive && (
                        <Badge className="gap-1" variant="default">
                          <Check className="h-3 w-3" />
                          Aktiv
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {version.description}
                    </p>
                    <div className="flex gap-4 text-sm text-muted-foreground">
                      <span>
                        Erstellt am{" "}
                        {format(version.createdAt, "dd.MM.yyyy 'um' HH:mm", {
                          locale: de,
                        })}
                      </span>
                      <span>von {version.createdBy}</span>
                      <span>{version.ruleCount} Regeln</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        handleViewVersion(version.id);
                      }}
                      size="sm"
                      variant="outline"
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      Anzeigen
                    </Button>
                    {!version.isActive && (
                      <Button
                        onClick={() => {
                          handleActivateVersion(version.id);
                        }}
                        size="sm"
                        variant="outline"
                      >
                        <RotateCcw className="h-4 w-4 mr-1" />
                        Aktivieren
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
