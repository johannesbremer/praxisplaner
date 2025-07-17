import { createFileRoute } from "@tanstack/react-router";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { RuleSetHistoryDemo } from "../components/rule-set-history-demo";

export const Route = createFileRoute("/demo")({
  component: DemoView,
});

export default function DemoView() {
  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">
          Git-like Rule Set History Demo
        </h1>
        <p className="text-muted-foreground">
          Demonstration der git-ähnlichen Visualisierung für
          Regelset-Versionshistorie
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Regelset Historie</CardTitle>
          <CardDescription>
            Diese Visualisierung zeigt die Entwicklung von Regelsets über die
            Zeit in einer git-ähnlichen Darstellung. Jeder Commit repräsentiert
            eine Version des Regelsets mit Autor, Zeitstempel und Beschreibung.
            Klicken Sie auf einen Commit, um Details zu sehen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RuleSetHistoryDemo />
        </CardContent>
      </Card>

      <div className="mt-6 space-y-4">
        <h2 className="text-xl font-semibold">Features</h2>
        <ul className="list-disc list-inside space-y-2 text-muted-foreground">
          <li>
            <strong>Git-ähnliche Historie:</strong> Zeigt die Entwicklung von
            Regelsets als Commit-Graph
          </li>
          <li>
            <strong>Verzweigungen:</strong> Unterstützt Branching wenn von
            älteren Versionen abgezweigt wird
          </li>
          <li>
            <strong>Interaktive Commits:</strong> Klicken Sie auf Commits um zu
            verschiedenen Regelset-Versionen zu wechseln
          </li>
          <li>
            <strong>Branch-Heads:</strong> Aktive, Draft und alternative
            Regelsets werden als Branch-Heads angezeigt
          </li>
          <li>
            <strong>Autor & Zeitstempel:</strong> Zeigt wer und wann Änderungen
            gemacht hat
          </li>
        </ul>
      </div>
    </div>
  );
}
