import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RotateCcw, Eye, Check } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import type { RuleConfigurationVersion } from "@/lib/types";
import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/version")({
  component: VersionsView,
});

export default function VersionsView() {
  const [versions] = useState<RuleConfigurationVersion[]>([
    {
      id: "v3",
      version: 3,
      createdAt: new Date("2024-01-15T14:30:00"),
      createdBy: "Dr. Schmidt",
      description: "Grippeimpfung Sonderregeln hinzugefügt",
      ruleCount: 12,
      isActive: true,
    },
    {
      id: "v2",
      version: 2,
      createdAt: new Date("2024-01-10T09:15:00"),
      createdBy: "Frau Müller",
      description: "Akutsprechstunde Zeiten angepasst",
      ruleCount: 10,
      isActive: false,
    },
    {
      id: "v1",
      version: 1,
      createdAt: new Date("2024-01-05T11:00:00"),
      createdBy: "Dr. Schmidt",
      description: "Initiale Regelkonfiguration",
      ruleCount: 8,
      isActive: false,
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
                key={version.id}
                className={`p-4 border rounded-lg ${version.isActive ? "border-primary bg-primary/5" : ""}`}
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">
                        Version {version.version}
                      </h3>
                      {version.isActive && (
                        <Badge variant="default" className="gap-1">
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
                      size="sm"
                      variant="outline"
                      onClick={() => handleViewVersion(version.id)}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      Anzeigen
                    </Button>
                    {!version.isActive && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleActivateVersion(version.id)}
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
