import { useQuery } from "convex/react";

import type { Id } from "@/convex/_generated/dataModel";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "@/convex/_generated/api";

import type { VersionNode } from "./version-graph/types";

import { VersionGraph } from "./version-graph/index";

interface VersionHistoryProps {
  className?: string;
  onVersionClick?: (version: VersionNode) => void;
  practiceId: Id<"practices">;
}

export default function VersionHistory({
  className,
  onVersionClick,
  practiceId,
}: VersionHistoryProps) {
  const versionsQuery = useQuery(api.rules.getVersionHistory, {
    practiceId,
  });

  if (!versionsQuery) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Versionshistorie</CardTitle>
          <CardDescription>Lade Versionshistorie...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            Lade Daten...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (versionsQuery.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Versionshistorie</CardTitle>
          <CardDescription>
            Visualisierung der Regelset-Änderungen über die Zeit
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            Noch keine Versionen vorhanden. Speichern Sie Ihr erstes Regelset,
            um die Historie zu beginnen.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Versionshistorie</CardTitle>
        <CardDescription>
          Visualisierung der Regelset-Änderungen über die Zeit. Klicken Sie auf
          einen Punkt, um zu einer Version zu wechseln.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <VersionGraph
          className="w-full"
          versions={versionsQuery}
          {...(onVersionClick && { onVersionClick })}
        />
      </CardContent>
    </Card>
  );
}
