// src/components/rule-editor-natural.tsx
import { Sparkles } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface RuleEditorNaturalProps {
  customTrigger?: React.ReactNode;
  triggerText?: string;
}

/**
 * Placeholder component for natural language rule creation.
 * This will be implemented later with LLM integration.
 */
export default function RuleEditorNatural({
  customTrigger,
  triggerText = "Neue Regel (Natürliche Sprache)",
}: RuleEditorNaturalProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {customTrigger ?? (
          <Button size="sm" variant="outline">
            <Sparkles className="h-4 w-4 mr-2" />
            {triggerText}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Regel mit natürlicher Sprache erstellen</DialogTitle>
          <DialogDescription>
            Beschreiben Sie die Regel in natürlicher Sprache, und wir erstellen
            die entsprechende JSON-Konfiguration für Sie.
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <Sparkles className="h-4 w-4" />
          <AlertTitle>In Entwicklung</AlertTitle>
          <AlertDescription>
            Diese Funktion wird in Kürze verfügbar sein. Sie ermöglicht es
            Ihnen, Regeln in natürlicher Sprache zu beschreiben, z.B.
            &ldquo;Blockiere Termine am Wochenende&rdquo; oder &ldquo;Erlaube
            maximal 20 Termine pro Tag&rdquo;, und das System erstellt
            automatisch die entsprechende Regel-Konfiguration.
          </AlertDescription>
        </Alert>

        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong>Beispiele für natürliche Sprache:</strong>
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>&ldquo;Blockiere alle Termine am Wochenende&rdquo;</li>
            <li>&ldquo;Maximal 20 Termine pro Tag erlauben&rdquo;</li>
            <li>
              &ldquo;15 Minuten Pause nach jedem Termin erforderlich&rdquo;
            </li>
            <li>&ldquo;Nur Neupatienten-Termine am Montag vormittag&rdquo;</li>
          </ul>
        </div>

        <div className="pt-4">
          <p className="text-sm text-muted-foreground">
            In der Zwischenzeit können Sie den{" "}
            <strong>Erweiterten Editor</strong> verwenden, um Regeln mit
            JSON-Konfiguration zu erstellen.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
