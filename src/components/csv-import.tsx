import { useMutation } from "convex/react";
import { Upload, X } from "lucide-react";
import React, { useState } from "react";
import { toast } from "sonner";

import type { Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";

import { useErrorTracking } from "../utils/error-tracking";

interface CsvImportProps {
  onImportComplete?: () => void;
  onNeedRuleSet?: () => Promise<Id<"ruleSets"> | null | undefined> | undefined;
  practiceId: Id<"practices">;
}

export function CsvImport({
  onImportComplete,
  onNeedRuleSet,
  practiceId,
}: CsvImportProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvContent, setCsvContent] = useState<string>("");
  const [isImporting, setIsImporting] = useState(false);

  const { captureError } = useErrorTracking();
  const importMutation = useMutation(
    api.appointmentTypes.importAppointmentTypesFromCsv,
  );

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      // Reset form when opening
      setCsvFile(null);
      setCsvContent("");
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Bitte wählen Sie eine CSV-Datei aus");
      return;
    }

    setCsvFile(file);

    // Read file content using modern Blob API
    void file
      .text()
      .then((content) => {
        setCsvContent(content);
      })
      .catch((error: unknown) => {
        captureError(error, {
          context: "CsvImport - File read error",
          fileName: file.name,
          fileSize: file.size,
          practiceId,
        });
        toast.error("Fehler beim Lesen der Datei");
      });
  };

  const handleRemoveFile = () => {
    setCsvFile(null);
    setCsvContent("");
  };

  const handleImport = async () => {
    if (!csvContent.trim()) {
      toast.error("Bitte wählen Sie eine CSV-Datei aus");
      return;
    }

    setIsImporting(true);

    try {
      // Ensure we have an unsaved rule set before importing
      let ruleSetId: Id<"ruleSets"> | null | undefined;
      if (onNeedRuleSet) {
        ruleSetId = await onNeedRuleSet();
      }

      if (!ruleSetId) {
        toast.error("Keine Regelset-ID verfügbar");
        setIsImporting(false);
        return;
      }

      const result = await importMutation({
        csvData: csvContent,
        practiceId,
        ruleSetId,
      });

      toast.success("Import erfolgreich!", {
        description: `${result.importedTypes.length} Terminarten importiert. ${result.newPractitioners.length} neue Ärzte erstellt.`,
      });

      setIsOpen(false);
      setCsvFile(null);
      setCsvContent("");
      onImportComplete?.();
    } catch (error: unknown) {
      captureError(error, {
        context: "CsvImport - Import mutation error",
        csvLength: csvContent.length,
        fileName: csvFile?.name,
        practiceId,
      });
      toast.error("Import fehlgeschlagen", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={isOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Upload className="h-4 w-4 mr-2" />
          CSV Import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Terminarten aus CSV importieren</DialogTitle>
          <DialogDescription>
            Importieren Sie Terminarten und deren Dauern für verschiedene Ärzte
            aus einer CSV-Datei. Die erste Spalte muss &quot;Terminart&quot;
            heißen, die weiteren Spalten sind Arztnamen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="csv-file">CSV-Datei auswählen</Label>
            <div className="mt-2">
              <input
                accept=".csv"
                className="block w-full text-sm text-muted-foreground
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-md file:border-0
                  file:text-sm file:font-medium
                  file:bg-primary file:text-primary-foreground
                  hover:file:bg-primary/90"
                id="csv-file"
                onChange={handleFileSelect}
                type="file"
              />
            </div>
          </div>

          {csvFile && (
            <Card className="border-dashed">
              <CardHeader className="pb-2 pt-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Ausgewählte Datei</CardTitle>
                  <Button onClick={handleRemoveFile} size="sm" variant="ghost">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0 pb-3">
                <div className="text-sm text-muted-foreground">
                  {csvFile.name} ({Math.round(csvFile.size / 1024)} KB)
                </div>
              </CardContent>
            </Card>
          )}

          <div className="text-sm text-muted-foreground">
            <p>
              <strong>Format:</strong>
            </p>
            <ul className="list-disc list-inside space-y-1 mt-1">
              <li>Erste Spalte: &quot;Terminart&quot; (Name der Terminart)</li>
              <li>Weitere Spalten: Arztnamen (als Spaltenüberschriften)</li>
              <li>Werte: Dauer in Minuten für jeden Arzt</li>
              <li>Nicht existierende Ärzte werden automatisch erstellt</li>
              <li>Existierende Terminarten werden aktualisiert</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => {
              handleOpenChange(false);
            }}
            variant="outline"
          >
            Abbrechen
          </Button>
          <Button
            disabled={!csvContent.trim() || isImporting}
            onClick={() => {
              void handleImport();
            }}
          >
            {isImporting ? "Importiere..." : "Importieren"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
