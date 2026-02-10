// Privacy step component

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

export function PrivacyStep({ sessionId }: StepComponentProps) {
  const acceptPrivacy = useMutation(api.bookingSessions.acceptPrivacy);

  const handleAccept = async () => {
    try {
      await acceptPrivacy({ sessionId });
    } catch (error) {
      console.error("Failed to accept privacy:", error);
      toast.error("Datenschutzzustimmung fehlgeschlagen", {
        description:
          error instanceof Error
            ? error.message
            : "Bitte versuchen Sie es erneut.",
      });
    }
  };

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-center">
          Patienteninformation zur Verarbeitung personenbezogener Daten
        </CardTitle>
        <CardDescription className="text-center">
          Bitte lesen Sie unsere Datenschutzerklärung sorgfältig durch.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ScrollArea className="h-[400px] pr-4">
          <div className="prose prose-sm max-w-none space-y-4">
            <p className="text-sm text-muted-foreground">
              Sehr geehrte Patientin, sehr geehrter Patient,
            </p>
            <p className="text-sm text-muted-foreground">
              der Schutz Ihrer personenbezogenen Daten ist uns wichtig. Nach der
              EU-Datenschutz-Grundverordnung (DSGVO) sind wir verpflichtet, Sie
              darüber zu informieren, wie und zu welchem Zweck unsere Praxis
              Ihre Daten verarbeitet. Darüber hinaus möchten wir Sie auch über
              Ihre Rechte in Bezug auf die Datenverarbeitung informieren.
            </p>

            <div className="space-y-4">
              <section>
                <h4 className="text-sm font-semibold mb-2">
                  1. Verantwortlichkeit für die Datenverarbeitung
                </h4>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>Verantwortlich für die Datenverarbeitung ist</p>
                  <p>MVZ Dissen</p>
                  <p>Westendarpstraße 21-23</p>
                  <p>49201 Dissen am Teutoburger Wald</p>
                  <p>E-Mail: service@mvzdissen.de</p>
                  <p>Tel.: 05421-755(6)</p>
                  <p className="mt-2">
                    Datenschutzbeauftragter ist: Johannes Bremer
                  </p>
                </div>
              </section>

              <section>
                <h4 className="text-sm font-semibold mb-2">
                  2. Zweck der Datenverarbeitung
                </h4>
                <p className="text-sm text-muted-foreground">
                  Die Datenverarbeitung erfolgt zur Onlineterminvergabe und zur
                  Durchführung und Verwaltung der ärztlichen Beratung und
                  Behandlung und beinhaltet deren Erhebung, Speicherung und
                  Weiterleitung. Hierzu verarbeiten wir Ihre personenbezogenen
                  Daten, insbesondere Ihre Gesundheitsdaten. Dazu zählen
                  Anamnesen, Diagnosen, Therapievorschläge und Befunde, die wir
                  oder andere Ärzte erheben. Die von Ihnen auf diesem Weg
                  erhobenen Daten werden in unserem Praxisverwaltungssystem
                  gespeichert. Die Erhebung personenbezogener Daten dient der
                  einfacheren und schnelleren Terminvergabe und ist
                  Voraussetzung für ihre Behandlung. Soweit die notwendigen
                  Gesundheitsdaten nicht bereits gestellt werden, kann eine
                  sorgfältige Behandlung nicht erfolgen. Die Speicherung
                  personenbezogener Daten dient zur Erfüllung unserer Pflicht
                  zur Dokumentation Ihrer Behandlung. Die Übermittlung
                  personenbezogener Daten erfolgt überwiegend zum Zwecke der
                  Abrechnung der bei Ihnen erbrachten Leistungen und zur Klärung
                  von medizinischen und sich aus dem Versicherungsverhältnis
                  ergebenden Fragen. Im Einzelfall erfolgt die Übermittlung
                  Ihrer Daten an weitere berechtigte Empfänger.
                </p>
              </section>

              <section>
                <h4 className="text-sm font-semibold mb-2">
                  3. Rechtsgrundlagen der Datenverarbeitung
                </h4>
                <p className="text-sm text-muted-foreground">
                  Rechtsgrundlage für die Verarbeitung Ihrer Daten ist Art. 9
                  Abs. 2 lit. h) DSGVO i.V.m. § 22 Abs. 1 Nr. 1 lit. b) BDSG im
                  Rahmen der Gesundheitsvorsorge. Weitere gesetzliche Grundlagen
                  sind die Pflicht zum Führen einer Behandlungsdokumentation
                  nach § 630f Abs. 1 BGB sowie die Pflicht zur Erbringung
                  vertragsärztlicher Leistungen nach § 95 SGB V.
                </p>
              </section>

              <section>
                <h4 className="text-sm font-semibold mb-2">
                  4. Empfänger Ihrer Daten
                </h4>
                <p className="text-sm text-muted-foreground">
                  Wir übermitteln Ihre personenbezogenen Daten nur dann an
                  Dritte, wenn dies gesetzlich erlaubt ist oder Sie ausdrücklich
                  eingewilligt haben. Empfänger Ihrer Daten können andere Ärzte,
                  Krankenkassen, Kassenärztliche Vereinigungen, privatärztliche
                  Abrechnungsstellen, Medizinischer Dienst der
                  Krankenversicherung, Beihilfestellen, Behörden oder Gerichte
                  sein.
                </p>
              </section>

              <section>
                <h4 className="text-sm font-semibold mb-2">
                  5. Dauer der Speicherung
                </h4>
                <p className="text-sm text-muted-foreground">
                  Wir bewahren Ihre personenbezogenen Daten nur solange auf, wie
                  dies aufgrund rechtlicher Vorgaben für die Durchführung der
                  Behandlung und der Einhaltung der Dokumentationspflicht
                  erforderlich ist. Die Dauer der Speicherung richtet sich im
                  Wesentlichen nach den gesetzlichen und satzungsrechtlichen
                  Aufbewahrungsfristen. Diese betragen im Regelfall 10 Jahre (§
                  630f Abs. 3 BGB, § 10 Abs. 3 Berufsordnung der ÄKWL). Im
                  Einzelfall können sich auch längere Aufbewahrungsfristen
                  ergeben, z.B. 30 Jahre bei bildgebenden Verfahren nach dem
                  Strahlenschutzgesetz (§ 85 Abs. 2 StrlSchG, § 85 Abs. 3
                  StrlSchV).
                </p>
              </section>

              <section>
                <h4 className="text-sm font-semibold mb-2">
                  6. Ihre Rechte als Patientin/Patient
                </h4>
                <p className="text-sm text-muted-foreground mb-2">
                  Sie können gegenüber dem o.g. Verantwortlichen folgende Rechte
                  geltend machen:
                </p>
                <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                  <li>
                    Recht auf Auskunft nach § 15 DSGVO über die
                    Datenverarbeitung einschließlich Auskünfte über die hier
                    genannten, diesbezüglichen Rechte;
                  </li>
                  <li>
                    Recht auf Berichtigung oder Ergänzung von Daten nach Art. 16
                    DSGVO, wobei Änderungen in der Behandlungsdokumentation als
                    solche erkennbar bleiben müssen, § 630f Abs. 1 BGB;
                  </li>
                  <li>
                    Recht auf Löschung oder Sperrung von Daten nach Art. 17 bzw.
                    18 DSGVO, wobei die Daten in der Behandlungsdokumentation
                    aufgrund der Aufbewahrungspflicht nur gesperrt werden
                    können;
                  </li>
                  <li>
                    Recht auf Widerspruch nach Art. 21 DSGVO in den dort
                    genannten Fallkonstellationen;
                  </li>
                  <li>
                    Recht auf Datenübertragbarkeit nach Art. 20 DSGVO, und damit
                    Erhalt der Daten in maschinenlesbarem Format und auf
                    Übermittlung an einen anderen Verantwortlichen.
                  </li>
                </ul>
                <p className="text-sm text-muted-foreground mt-2">
                  Die Verarbeitung Ihrer Daten erfolgt in der Regel auf Basis
                  vertraglicher oder gesetzlicher Grundlage. Soweit dies nicht
                  der Fall ist, benötigen wir Ihre Einwilligung. Die
                  Einwilligung erfolgt schriftlich und mithilfe einer
                  gesonderten Erklärung. In diesen Fällen haben Sie das Recht,
                  Ihre Einwilligung jederzeit durch formlose Erklärung gegenüber
                  dem o.g. Verantwortlichen mit Wirkung für die Zukunft zu
                  widerrufen. Sie haben ferner nach Art. 77 DSGVO das Recht,
                  sich bei der zuständigen Aufsichtsbehörde für den Datenschutz
                  zu beschweren, wenn Sie der Auffassung sind, dass die
                  Verarbeitung Ihrer personenbezogenen Daten nicht rechtmäßig
                  erfolgt.
                </p>
                <div className="text-sm text-muted-foreground mt-2 space-y-1">
                  <p>
                    Die Anschrift der für uns zuständigen Aufsichtsbehörde
                    lautet:
                  </p>
                  <p>Der Landesbeauftragte für den Datenschutz Niedersachsen</p>
                  <p>Postfach 221</p>
                  <p>30002 Hannover</p>
                </div>
              </section>
            </div>
          </div>
        </ScrollArea>

        <div className="pt-4 border-t">
          <Button
            className="w-full h-auto whitespace-normal py-3"
            onClick={() => void handleAccept()}
            size="lg"
          >
            Ich habe diese Datenschutzerklärung verstanden und stimme ihr zu!
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
