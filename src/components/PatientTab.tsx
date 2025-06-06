// src/components/PatientTab.tsx

import { useConvexQuery } from "@convex-dev/react-query";
import { api } from "../../convex/_generated/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User, Calendar, MapPin, FileText } from "lucide-react";

interface PatientTabProps {
  patientId: number;
}

export function PatientTab({ patientId }: PatientTabProps) {
  const patient = useConvexQuery(api.patients.getPatient, { patientId });

  if (!patient) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Patient nicht gefunden...</p>
      </div>
    );
  }

  const formatDate = (dateString?: string) => {
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

  const formatTimestamp = (timestamp: number) => {
    return new Date(Number(timestamp)).toLocaleString("de-DE");
  };

  return (
    <div className="container mx-auto max-w-4xl p-6 space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <User className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {patient.firstName && patient.lastName
              ? `${patient.firstName} ${patient.lastName}`
              : `Patient ${patient.patientId}`}
          </h1>
          <p className="text-muted-foreground">
            Patient ID: {patient.patientId}
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
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
                Vorname:
              </span>
              <p>{patient.firstName || "Nicht verfügbar"}</p>
            </div>
            <div>
              <span className="font-medium text-sm text-muted-foreground">
                Nachname:
              </span>
              <p>{patient.lastName || "Nicht verfügbar"}</p>
            </div>
            <div>
              <span className="font-medium text-sm text-muted-foreground">
                Geburtsdatum:
              </span>
              <p className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {formatDate(patient.dateOfBirth)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Adresse
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <span className="font-medium text-sm text-muted-foreground">
                Straße:
              </span>
              <p>{patient.street || "Nicht verfügbar"}</p>
            </div>
            <div>
              <span className="font-medium text-sm text-muted-foreground">
                Stadt:
              </span>
              <p>{patient.city || "Nicht verfügbar"}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              GDT Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <span className="font-medium text-sm text-muted-foreground">
                Quell-GDT-Datei:
              </span>
              <p>{patient.sourceGdtFileName || "Nicht verfügbar"}</p>
            </div>
            <div>
              <span className="font-medium text-sm text-muted-foreground">
                Erstellt:
              </span>
              <p>{formatTimestamp(patient.createdAt)}</p>
            </div>
            <div>
              <span className="font-medium text-sm text-muted-foreground">
                Zuletzt geändert:
              </span>
              <p>{formatTimestamp(patient.lastModified)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge
              variant="secondary"
              className="bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100"
            >
              Aktiv
            </Badge>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
