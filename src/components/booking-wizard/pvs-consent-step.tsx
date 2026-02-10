// PVS consent step component (New patient path - PKV before details input)

import { useMutation } from "convex/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/convex/_generated/api";

import type { StepComponentProps } from "./types";

export function PvsConsentStep({ sessionId }: StepComponentProps) {
  const acceptPvsConsent = useMutation(api.bookingSessions.acceptPvsConsent);

  async function handleAccept() {
    try {
      await acceptPvsConsent({ sessionId });
    } catch (error) {
      console.error("Failed to accept PVS consent:", error);
      toast.error("Zustimmung konnte nicht gespeichert werden", {
        description:
          error instanceof Error
            ? error.message
            : "Bitte versuchen Sie es erneut.",
      });
    }
  }

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader className="text-center">
        <CardTitle>Einwilligung zur Datenweitergabe an die PVS</CardTitle>
        <CardDescription>
          Bitte lesen Sie die folgenden Informationen zur Datenweitergabe an die
          Privatärztliche Verrechnungsstelle.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-6">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">
                Zusammenarbeit mit der PVS
              </h3>
              <p className="text-sm text-muted-foreground">
                Im Interesse einer zügigen und korrekten Rechnungserstellung
                arbeiten wir mit der PrivatVerrechnungsStelle (PVS) der Ärzte in
                Niedersachsen (r.k.V.) zusammen.
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Ihre Einwilligung</h3>
              <p className="text-sm text-muted-foreground">
                Wir bitten Sie hier Ihr Einverständnis zu erteilen, die zur
                Rechnungserstellung durch EDV notwendigen Daten an die PVS zu
                übermitteln. Wenn Sie der Weitergabe der Daten nicht zustimmen
                oder die gegebene Zustimmung widerrufen, entstehen Ihnen keine
                Nachteile, und wir werden unsere Leistungen selbst in Rechnung
                stellen. Bitte fahren Sie in diesem Fall telefonisch fort.
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Über die PVS</h3>
              <p className="text-sm text-muted-foreground">
                Bei der PVS handelt es sich um eine berufsständische
                Organisation mit Sitz in 30159 Hannover, Osterstr. 60. Die PVS
                steht unter ärztlicher Leitung und wird ausschließlich nach
                unseren Weisungen tätig. Sie unterliegt, wie jeder Arzt, den
                Bestimmungen der ärztlichen Schweigepflicht und des
                Datenschutzgesetzes. Darüber wacht der interne
                Datenschutzbeauftragte.
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Datenweitergabe</h3>
              <p className="text-sm text-muted-foreground">
                Wir übermitteln der PVS dazu digital verschlüsselt oder per Post
                Ihre persönlichen Daten: Name und Adresse, Geburtsdatum,
                Behandlungszeitraum, Diagnosen, ärztliche Leistungen und
                Verordnungen sowie bei Krankenhausbehandlungen Krankenakten. Die
                PVS liest diese Daten ein und erstellt dazu die Rechnung gemäß
                §12 der Gebührenordnung für Ärzte (GOÄ), die sie Ihnen zusendet.
                Wenn eine zwangsweise Einziehung nötig ist, werden wie üblich
                Dritte eingeschaltet. Ihre Daten werden gelöscht, wenn die
                Rechnung beglichen ist und keine Rückfragen zu erwarten sind.
              </p>
            </section>
          </div>
        </ScrollArea>

        <div className="pt-4 border-t">
          <Button
            className="w-full h-auto whitespace-normal py-3"
            onClick={() => void handleAccept()}
            size="lg"
          >
            Ich stimme der Datenweitergabe an die Privatärztliche
            Verrechnungsstelle (PVS) zu!
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
