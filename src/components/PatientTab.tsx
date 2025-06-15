// src/components/PatientTab.tsx

import { useConvexQuery } from "@convex-dev/react-query";
import { Calendar, ExternalLink, MapPin, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import type { Doc as Document_ } from "../../convex/_generated/dataModel";
import type { PatientTabData } from "../types";

import { api } from "../../convex/_generated/api";
import { dispatchCustomEvent } from "../utils/browser-api";

interface PatientTabProperties {
  patientId: PatientTabData["patientId"];
}

const formatGermanDate = (dateString?: string) => {
  if (!dateString) {
    return "Nicht verfügbar";
  }

  // Handle ISO date format (YYYY-MM-DD) which is how dates are stored in Convex
  const date = new Date(dateString);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  // Fallback: if it's still in GDT format TTMMJJJJ
  if (dateString.length === 8) {
    const day = dateString.slice(0, 2);
    const month = dateString.slice(2, 4);
    const year = dateString.slice(4, 8);
    return `${day}.${month}.${year}`;
  }

  return dateString;
};

export function PatientTab({ patientId }: PatientTabProperties) {
  const patient = useConvexQuery(api.patients.getPatient, { patientId });

  const handleOpenInPvs = () => {
    dispatchCustomEvent("praxisplaner:openInPvs", { patientId });
  };

  if (!patient) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Patient nicht gefunden...</p>
      </div>
    );
  }

  // Patient is already properly typed from the query
  const typedPatient: Document_<"patients"> = patient;

  return (
    <div className="container mx-auto max-w-4xl p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <User className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {typedPatient.firstName && typedPatient.lastName
                ? `${typedPatient.firstName} ${typedPatient.lastName}`
                : `Patient ${typedPatient.patientId}`}
            </h1>
            <p className="text-muted-foreground">
              Patient ID: {typedPatient.patientId}
            </p>
          </div>
        </div>
        <Button
          className="flex items-center gap-2"
          onClick={handleOpenInPvs}
          variant="outline"
        >
          <ExternalLink className="h-4 w-4" />
          Im PVS öffnen
        </Button>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Persönliche Daten
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <span className="font-medium text-sm text-muted-foreground">
                Geburtsdatum:
              </span>
              <p className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {formatGermanDate(typedPatient.dateOfBirth)}
              </p>
            </div>
            <div>
              <span className="font-medium text-sm text-muted-foreground">
                Straße:
              </span>
              <p className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                {typedPatient.street || "Nicht verfügbar"}
              </p>
            </div>
            <div>
              <span className="font-medium text-sm text-muted-foreground">
                Stadt:
              </span>
              <p>{typedPatient.city || "Nicht verfügbar"}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
