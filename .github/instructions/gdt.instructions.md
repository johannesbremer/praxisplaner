# GDT 6310 - Daten einer Untersuchung übermitteln (GERÄT an AIS) - Erweiterte und Korrigierte Erklärung

## 1. Zweck und Allgemeines

Die **Satzart (SA) 6310** im GDT-Standard (Geräte-Daten-Transfer) dient dazu, dass ein **medizinisches GERÄT** Daten einer durchgeführten Untersuchung an ein **Arztinformationssystem (AIS)** übermittelt. Dies ist einer der Kernprozesse in der Geräteanbindung, um Untersuchungsergebnisse digital in die Patientenakte zu integrieren.

Referenzen:
*   GDT 3.5 Datensatzbeschreibung.pdf (Primärquelle für Satzarten und Objektstruktur)
*   GDT 3.5 Anhang.pdf (Details zu spezifischen Feldern wie 8402 und Übermittlung von Messdaten)
*   GDT 3.5 Best Practice.pdf (Workflow-Beispiele, die 6310 verwenden)

**Annahme für diese Erklärung:** Jede 6310-Datei enthält immer eine eindeutige **Patienten-ID des Praxisverwaltungssystems (FK 3000)** innerhalb des `Obj_Patient`. Dies dient der klaren Zuordnung der Untersuchungsergebnisse zum korrekten Patienten im AIS.

## 2. Grundlegende Struktur eines GDT-Datensatzes

Jede Zeile in einer GDT-Datei folgt einem festen Format:

`LLLFFFFDDDD...DD<CR><LF>`

*   **LLL**: 3-stellige Länge. Gibt die Länge des Feldteils "DDDD...DD" (Inhalt) + 9 Bytes an. (GDT 3.5 Datensatzbeschreibung, S. 20, S. 30)
*   **FFFF**: 4-stellige Feldkennung (FK).
*   **DDDD...DD**: Der eigentliche Inhalt des Feldes.
*   **`<CR><LF>`**: Zeilenende (Wagenrücklauf und Zeilenvorschub).

**Zeichenkodierung:** Gemäß GDT 3.5 Datensatzbeschreibung (S. 33) ist **ISO 8859-15** zu verwenden.

## 3. Aufbau der Satzart 6310

Eine GDT-Datei mit Satzart 6310 beginnt immer mit der Satzidentifikation und endet mit dem Satzende. (GDT 3.5 Datensatzbeschreibung, S. 26, S. 36)

**Struktur gemäß "GDT 3.5 Datensatzbeschreibung", Seite 36 (Tabelle für SA 6310):**

1.  **Satzidentifikation (Muss)**
    *   FK `8000`, Inhalt: `6310`
    *   Beispiel: `01380006310` (Länge von "6310" (4) + 9 = 13)

2.  **Obj_Kopfdaten_GDT (Muss-Objekt)** (GDT 3.5 Datensatzbeschreibung, S. 41)
    *   Eingeleitet durch Objektattribut FK `8133` (Inhalt: `Kopfdaten_GDT`).
    *   Beginnt mit FK `8002`, Inhalt: `Obj_0033`.
    *   Enthält wichtige Metadaten zur Übertragung:
        *   FK `0001` (Version der Datensatzbeschreibung): z.B. `3.5` (Kann-Feld)
        *   FK `8315` (ID des Empfängers): z.B. `PRAX_AIS` (Kennung des AIS) (Kann-Feld)
        *   FK `8316` (ID des Senders): z.B. `EKG_GERAET_01` (Kennung des GDT-Geräts) (Kann-Feld)
        *   Weitere optionale Felder wie Zeitstempel der Erstellung (Obj_Timestamp via FK `8218` mit Inhalt `Timestamp_Erstellung_Datensatz`), Softwareversion etc.
    *   Endet mit FK `8003`, Inhalt: `Obj_0033`.

3.  **Obj_Patient (Muss-Objekt)** (GDT 3.5 Datensatzbeschreibung, S. 40)
    *   Eingeleitet durch Objektattribut FK `8145` (Inhalt: `Patient`).
    *   Beginnt mit FK `8002`, Inhalt: `Obj_0045`.
    *   **Enthält gemäß unserer Annahme immer:**
        *   **FK `3000` (Patientennummer):** Die eindeutige ID des Patienten aus dem AIS.
            *   Beispiel: `014300018983` (Länge von "18983" (5) + 9 = 14)
    *   Kann das **Obj_Person (Muss-Objekt innerhalb Obj_Patient)** enthalten (eingeleitet durch FK `8147` mit Inhalt `Person`):
        *   Beginnt mit FK `8002`, Inhalt: `Obj_0047`.
        *   FK `3101` (Name): z.B. `Mustermann`
        *   FK `3102` (Vorname): z.B. `Franz`
        *   FK `3103` (Geburtsdatum): Format **`TTMMJJJJ`** (basierend auf GDT-Beispielen, z.B. `01101945` aus der Beispieldatei und GDT 3.5 Datensatzbeschreibung S. 21).
        *   FK `3110` (Geschlecht): z.B. `M` (männlich), `W` (weiblich). (GDT 3.5 Datensatzbeschreibung S. 21 Beispiel `0103110M`). Moderne Systeme könnten auch `D` (divers), `X` (unbestimmt) verwenden.
        *   Weitere Felder wie Adresse, Titel etc.
        *   Endet mit FK `8003`, Inhalt: `Obj_0047`.
    *   Endet mit FK `8003`, Inhalt: `Obj_0045`.

4.  **Obj_Anforderung (Muss-Objekt)** (GDT 3.5 Datensatzbeschreibung, S. 36, S. 41)
    *   Eingeleitet durch Objektattribut FK `8112` (Inhalt: `Anforderung`).
    *   Beginnt mit FK `8002`, Inhalt: `Obj_0012`.
    *   Dient zur Referenzierung einer vorherigen Untersuchungsanforderung (SA 6302) oder zur Beschreibung der aktuell durchgeführten Untersuchung.
        *   FK `8310` (Anforderungs-Ident): ID, die vom AIS bei der Anforderung vergeben wurde oder eine geräteinterne Kennung.
        *   FK `8314` (Anforderungs-UID): Eindeutige UID der Anforderung.
        *   **FK `8402` (Geräte- und verfahrensspezifisches Kennfeld):** Sehr wichtig! Definiert die Art der Untersuchung. (GDT 3.5 Anhang, S. 8ff).
            *   Beispiel: `BDM_01` (Langzeit-Blutdruckmessung) oder `EKG01` (Ruhe-EKG).
            *   Besteht aus Textteil (max. 4 Buchstaben) und 2-stelliger Nummer.
        *   FK `8404` (Unterkategorie zur KF 8402): Detailliert FK 8402, z.B. `Niere links`.
    *   Endet mit FK `8003`, Inhalt: `Obj_0012`.
    *   *Hinweis: Obwohl als "Muss" in der Tabelle für SA 6310 gelistet, hängt die genaue Befüllung davon ab, ob eine explizite Anforderung vom AIS vorlag oder das GERÄT eigenständig Daten sendet. In der Praxis ist es oft die Referenz auf die Anforderung.*

5.  **Obj_Untersuchungsergebnis_GDT (Optionales Objekt)** (GDT 3.5 Datensatzbeschreibung, S. 42)
    *   Eingeleitet durch Objektattribut FK `8157` (Inhalt: `Untersuchungsergebnis_GDT`).
    *   Beginnt mit FK `8002`, Inhalt: `Obj_0057`.
    *   Dies ist das Kernstück und enthält die eigentlichen Messwerte und Befunde.
        *   **FK `8410` (Test-Ident / Ergebnis-ID):** Eindeutige Kennung des Tests/Parameters innerhalb der Untersuchung (herstellerspezifisch).
            *   Beispiel: `SYSMXTG` (Systolischer Maximalwert Tagsüber)
        *   **FK `8411` (Testbezeichnung):** Klartextbezeichnung des Tests/Parameters.
            *   Beispiel: `Systole max Tagphase`
        *   FK `7263` (Test-ID): Eindeutige, oft numerische ID des Tests (z.B. LOINC, falls verwendet).
        *   FK `7264` (Test-Gerät-UID): Eindeutige ID des Geräts, das den Test durchgeführt hat.
        *   **FK `8420` (Ergebnis-Wert):** Der gemessene Wert.
            *   Beispiel: `142`
        *   **FK `8421` (Maßeinheit des Messwertes):**
            *   Beispiel: `mmHg`
        *   FK `8419` (Einheitensystem des Messwertes): Z.B. Angabe, ob metrisch, UCUM etc.
        *   FK `7306` (Darstellung Ergebniswerte): Gibt an, wie der Wert zu interpretieren ist (z.B. numerisch, Text, Datum).
        *   **Obj_Timestamp (Messzeitpunkt, optional, aber empfohlen)** (eingeleitet durch FK `8225` mit Inhalt `Timestamp_Messung`):
            *   Beginnt mit FK `8002`, Inhalt: `Obj_0054`.
            *   FK `7278` (Datum): **`TTMMJJJJ`**
            *   FK `7279` (Uhrzeit): `HHMMSS`
            *   FK `7273` (Zeitzone): z.B. `UTC+2`
            *   Endet mit FK `8003`, Inhalt: `Obj_0054`.
        *   **Obj_Timestamp (Materialabnahme/-entnahme, optional)** (eingeleitet durch FK `8219` mit Inhalt `Timestamp_Materialabnahme_entnahme`): Falls relevant, ähnlich wie Messzeitpunkt.
        *   FK `8142` (Normalwert) mit optionalem **Obj_Normalwert (Obj_0042)**: Zur Angabe von Referenzbereichen.
        *   FK `6220` (Befund): Freitextlicher Befund.
        *   FK `6221` (Fremdbefund): Befund von externer Quelle.
        *   FK `6227` (Kommentar): Zusätzliche Kommentare.
        *   **Strukturierte Befunde/Fließtexte/Rohdatenübermittlung:**
            *   Für komplexere Daten kann das **Obj_Fließtext (Obj_0068)**, eingeleitet durch das Objektattribut **FK `8167`** (Inhalt: `Zusaetzliche_Informationen` oder ein spezifischerer Name), verwendet werden. (GDT 3.5 Datensatzbeschreibung S. 14 für Objektattribute).
            *   Innerhalb dieses `Obj_Fließtext` können Standard-Felder wie `6206` (Textzeile) mehrfach auftreten.
            *   **Hinweis zur Beispieldatei:** Die Beispieldatei verwendet innerhalb eines durch `8167 Zusaetzliche_Informationen` eingeleiteten `Obj_0068` (Fließtext) Feldkennungen wie `3564`, `3565`, `3566`. Diese sind **nicht Standard-GDT/LDT**. Es handelt sich hierbei um herstellerspezifische Feldkennungen für die Zeilen des formatierten Blutdruck-Protokolls. Der Inhalt dieser Felder beginnt dann mit `6220...`, `6227...` etc., was *Teil des Inhalts der FK `356x`* ist, nicht eine weitere FK.
            *   Für Rohdaten (Kurven etc.) können auch die Felder `8417` (Datenstrom) und `8420` (Messwert) in Kombination mit `8410` (Test-Ident) mehrfach verwendet werden. (GDT 3.5 Anhang, S. 14ff).
    *   Endet mit FK `8003`, Inhalt: `Obj_0057`.
    *   *Hinweis: Es können mehrere `Obj_Untersuchungsergebnis_GDT` Objekte für verschiedene Parameter derselben Untersuchung gesendet werden.*

6.  **Obj_Koerperkenngroessen (Optionales Objekt)** (GDT 3.5 Anhang, S. 14; LDT Referenz für Obj_0069)
    *   Eingeleitet durch Objektattribut FK `8169` (Inhalt: `Koerperkenngroessen`).
    *   Beginnt mit FK `8002`, Inhalt: `Obj_0069`.
    *   Übermittelt Körpermaße, die zum Untersuchungszeitpunkt relevant waren.
        *   FK `3622` (Größe des Patienten)
        *   FK `8421` (Maßeinheit, z.B. `cm`)
        *   FK `3623` (Gewicht des Patienten)
        *   FK `8421` (Maßeinheit, z.B. `kg`)
        *   Optional mit eigenem `Obj_Timestamp` (via FK `8225` mit Inhalt `Timestamp_Messung`), wenn die Messung der Körpermaße zu einem spezifischen Zeitpunkt erfolgte.
    *   Endet mit FK `8003`, Inhalt: `Obj_0069`.

7.  **Obj_Anhang (Optionales Objekt)** (GDT 3.5 Datensatzbeschreibung, S. 36)
    *   Eingeleitet durch Objektattribut FK `8110` (Inhalt: `Anhang`).
    *   Beginnt mit FK `8002`, Inhalt: `Obj_0010`.
    *   Dient zur Übermittlung von binären Anhängen (z.B. PDF-Berichte, Bilder).
        *   FK `6205` (Erklärung des Anhangs/Dateiname).
        *   FK `6228` (Base64-kodierter Inhalt der Datei).
        *   FK `6229` (Dateityp/MIME-Type).
    *   Endet mit FK `8003`, Inhalt: `Obj_0010`.

8.  **Satzende (Optionales Objekt)**
    *   FK `8001`, Inhalt: `6310`
    *   Beispiel: `01380016310` (Länge von "6310" (4) + 9 = 13)

## 4. Verarbeitung im AIS

Das AIS empfängt die GDT 6310-Datei und parst sie.
1.  **Patientenidentifikation:** Über die (gemäß unserer Annahme immer vorhandene) Patienten-ID (FK `3000`) wird der Datensatz dem korrekten Patienten zugeordnet.
2.  **Verarbeitung der Kopfdaten:** Sender, Empfänger, Versionen können geloggt oder für Routing-Entscheidungen genutzt werden.
3.  **Verarbeitung der Anforderungsdaten:** Falls vorhanden, kann das Ergebnis mit einer offenen Anforderung im AIS verknüpft werden.
4.  **Speicherung der Untersuchungsergebnisse:**
    *   Die einzelnen `Obj_Untersuchungsergebnis_GDT` werden extrahiert.
    *   `Test-Ident (8410)`, `Testbezeichnung (8411)`, `Ergebnis-Wert (8420)` und `Maßeinheit (8421)` sind die wichtigsten Felder.
    *   Zeitstempel werden zugeordnet.
    *   Fließtexte/strukturierte Befunde werden gespeichert.
    *   Körperkenngrößen und Anhänge werden ebenfalls verarbeitet und gespeichert.
5.  **Darstellung:** Die Ergebnisse werden in der Patientenakte angezeigt, oft in tabellarischer oder grafischer Form, ergänzt durch Befundtexte und Anhänge.

## 5. Wichtige Hinweise und Besonderheiten

*   **Fehlertoleranz vs. strikte Validierung:** AIS-Systeme sollten robust genug sein, um kleinere Abweichungen vom Standard zu tolerieren, aber kritische Fehler sollten erkannt werden.
*   **Herstellerspezifische FKs:** Wie im `Obj_Fließtext`-Beispiel (FKs `3564` ff. in der Beispieldatei) können Systeme proprietäre FKs verwenden. Ein allgemeiner Parser muss dies berücksichtigen oder konfigurierbar sein.
*   **Dynamik der Feldkennung `8402`:** Die Liste der gültigen Kennungen für `8402` wird vom QMS gepflegt und ist dynamisch (GDT 3.5 Anhang, S. 8).
*   **Datumsformate:** Für alle Datumsfelder im GDT, insbesondere FK `3103` (Geburtsdatum) und FK `7278` (allgemeines Datum), ist das Format **`TTMMJJJJ`** zu verwenden. Frühere Annahmen oder Beispiele, die `JJJJMMTT` für FK `3103` nannten, sind hiermit korrigiert. Dies ist bei der Implementierung konsistent zu beachten.

## 6. Beispiel aus der Beispieldatei (gekürzt und kommentiert mit Korrekturen)

```gdt
01380006310                     // Satzart 6310
0228133Kopfdaten_GDT            // Attribut: Kopfdaten_GDT
0178002Obj_0033                 //   Objektstart: Obj_Kopfdaten_GDT
01200013.5                      //     FK 0001: Version 3.5
0178315PRAX_AIS                 //     FK 8315: Empfänger AIS
0178316LZBD_SYS                 //     FK 8316: Sender Gerät
0178003Obj_0033                 //   Objektende
0168145Patient                  // Attribut: Patient
0178002Obj_0045                 //   Objektstart: Obj_Patient
// Beispiel für angenommene Patienten-ID:
// 014300012345                  //     FK 3000: Patienten-ID "12345"
0158147Person                   //     Attribut: Person
0178002Obj_0047                 //       Objektstart: Obj_Person
0193101Mustermann               //         FK 3101: Name
0143102Franz                    //         FK 3102: Vorname
017310301101945                 //         FK 3103: Geburtsdatum "01101945" (TTMMJJJJ)
0103110M                        //         FK 3110: Geschlecht "M"
0178003Obj_0047                 //       Objektende
0178003Obj_0045                 //   Objektende
0208112Anforderung              // Attribut: Anforderung
0178002Obj_0012                 //   Objektstart: Obj_Anforderung
0128310BDM                      //     FK 8310: Anforderungs-Ident "BDM"
0158402BDM_01                   //     FK 8402: Verfahren "BDM_01"
0178003Obj_0012                 //   Objektende
0348157Untersuchungsergebnis_GDT  // Attribut: Untersuchungsergebnis_GDT
0178002Obj_0057                 //   Objektstart: Obj_Untersuchungsergebnis_GDT
0168410SYSMXTG                  //     FK 8410: Test-Ident "SYSMXTG"
0298411Systole max Tagphase     //     FK 8411: Testbezeichnung
0128420142                      //     FK 8420: Wert "142"
0138421mmHg                     //     FK 8421: Einheit "mmHg"
0268225Timestamp_Messung        //     Attribut: Timestamp_Messung
0178002Obj_0054                 //       Objektstart: Obj_Timestamp
017727823101998                 //         FK 7278: Datum "23101998" (TTMMJJJJ)
0157279173510                 //         FK 7279: Uhrzeit "173510"
0147273UTC+2                    //         FK 7273: Zeitzone
0178003Obj_0054                 //       Objektende
0178003Obj_0057                 //   Objektende
0358167Zusaetzliche_Informationen // Attribut: Zusaetzliche_Informationen
0178002Obj_0068                 //   Objektstart: Obj_Fließtext (Obj_0068)
// Folgende sind herstellerspezifische FKs für Zeilen des Fließtextes:
03835646220Dies ist ein zweizeiliger // FK 3564, Inhalt beginnt mit "6220..."
04535656220Befund zur 24h-Blutdruckmessung. // FK 3565, Inhalt beginnt mit "6220..."
// ... weitere Zeilen des spezifischen Fließtext-Protokolls ...
0178003Obj_0068                 //   Objektende
0288169Koerperkenngroessen      // Attribut: Koerperkenngroessen
0178002Obj_0069                 //   Objektstart: Obj_Koerperkenngroessen
0123622178                      //     FK 3622: Größe "178"
0118421cm                       //     FK 8421: Einheit "cm"
0178003Obj_0069                 //   Objektende
01380016310                     // Satzende

```

