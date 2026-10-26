# Audit-Umsetzung, 25. Oktober 2026

Arbeitsbranch `codex/audit-remediation`. Historische Ausgangsbefunde bleiben in
den beiden Auditberichten erhalten. Diese Datei dokumentiert die Implementierung;
sie ist keine produktive Freigabe und erklärt nicht alle 54 Maßnahmen für erledigt.

## Abgeschlossene Implementierungspakete

| Auditpunkte | Änderung | Abnahmegrenze |
|---|---|---|
| M08, M22 | Zufällige Wertungskennung plus Runde/Video auf jeder Stimme; abgegebene Stimmen bleiben bei Austritt erhalten. | Kein genereller Wiedergabenachweis für Wähler; M09 bleibt offen. |
| M06, M07 | Nur nachgewiesene Profilidentität erhält private HTTP-/WS-Rechte. Erste HF-Zuordnung benötigt Eigentumsnachweis; danach dauerhaft dieselbe HF-Identität. Archiv-/Statistikdaten sind auf eigene/geteilte Spiele begrenzt; Lösch-/Restore-Rechte werden objektbezogen geprüft. | Live-Bestandsmigration und Abnahme noch erforderlich. Keine Bindung fremder Legacy-Profile allein über deren Namen. |
| M01–M03, M10 | Tatsächlicher begrenzter PNG/JPEG-Decode, Metadatenentfernung und kanonisches PNG; Promptvalidierung ohne stilles Abschneiden; gemeinsame Bild-/Promptprüfung vor HF-Upload und Budgetstart; Ausgabeprüfung vor Veröffentlichung. Unklar/Review/Ausfall gibt nicht frei. | Semantic-Erkennung ist erst mit qualifiziertem Dienst verfügbar. Bestehende Archivdateien wurden nicht rückwirkend geprüft. |
| M05, M34 teilweise | Neue Wan-Aufträge benötigen festgelegte Space-/Modell-SHAs; Space-Quellstand, laufender Stand und tatsächliche Replica-Konfiguration müssen übereinstimmen. Modellwechsel beendet den Auftrag vor Upload. | Betreiberdeklaration ist keine kryptografische Gewichtsattestierung. Bestehender Community-Space ist damit noch nicht freigegeben. |
| M11 teilweise | Freigabevertrag verlangt vollständigen Decode, mindestens fünf Sekunden und H.264/yuv420p; Dienst prüft jeden decodierten Frame. | Realer Wan-Erzeuger, CPU-Laufzeit und Codec-/Safari-Ausgabe noch nicht live abgenommen. Keine automatische Worker-Transcodierung. |
| M12, M31 teilweise | Bei Speicher-/Moderationsausfall bleibt fertiger HF-Auftrag erhalten. Wiederholung lädt/prüft/speichert das bestehende Ergebnis ohne neue Inferenz und ohne neuen Tokenabruf. Stabiler Objektschlüssel verhindert Duplikate bei verlorener erfolgreicher PUT-Antwort. | Node-Aufträge bleiben Entwicklungsbetrieb im RAM; alle Crashfenster und abgelaufene Providerdateien noch offen. |
| M04 teilweise | Berechtigte Zuschauer können Archivclips melden; Verwalter prüft Meldungen und bestätigt permanente Sperre. Dateiausgabe prüft die persistente Sperre auch bei bekannter URL, Range/Download und nach Restore. Meldungen allein sperren nicht automatisch. | Kein automatischer juristischer Melde-/Beweissicherungsprozess; Altarchivprüfung, Einspruch und verfeinerter Status in allen Spielansichten offen. |
| M13, M16 teilweise | Begrenztes Einlesen von HTTP-Bodies, WS-Bytebudgets und Limits für Raumgründung/Uploads; komplexe Node-Payloads werden abgelehnt. Unbeigetretene Verbindungen enden nach 60 Sekunden. | Worker-Bytebudgets gelten pro Raum/Instanz; teure Befehle zusätzlich persistent pro Konto. Cloudflare-WAF/Account-Grenzen nicht geprüft. |
| M14 | Gezielt aktualisierte body-parser/Zod-Auflösung; begrenzter JPEG-Decoder ergänzt. | Root-Produktionsabhängigkeiten ohne npm-Auditbefund beim Test; keine allgemeine Sicherheitsgarantie. |
| M15 | CSP mit exakter eigener WS-Origin, Frame-Einbettung verboten, Geräte-/Zahlungsberechtigungen deaktiviert, Referrer unterdrückt. HTML passiert Worker für passende dynamische Header. | Inline-Stile bleiben wegen vorhandener Darstellung zugelassen; kein neues Inline-JavaScript erlaubt. Medienausnahme ausschließlich für bisher unterstützte HF-Hosts erhält alte Links. |
| M25, M27, M30 teilweise | Vorübergehender HF-Ausfall wird von fehlender Verbindung getrennt; unabhängige Statistikreads parallel; Node-Videodateien werden gestreamt. | DB-Querypläne, Inventarcaching, globaler Durchsatz und reale Mobilgeräte bleiben offen. |

## Vorbereitung des kostenlosen Moderationsdienstes

`moderation-service/` enthält einen separaten CPU-Dienst (TypeScript, FFmpeg,
NSFW-Klassifikator und SmolVLM). Modellrevisionen sind durch vollständige öffentliche
HF-Commit-SHAs festgeschrieben. Docker läuft ohne root; Modellcache liegt im
schreibbaren temporären Verzeichnis. Keine Spielertokens erforderlich.

`/evaluate` ist nur mit eigenem Bearer-Schlüssel erreichbar und liefert ausdrücklich
keine vom Spiel akzeptierte Freigabe. `/validate` bleibt ohne dokumentierte,
versionsgebundene Qualifikation geschlossen. Kein frei erfundener Testbericht oder
Allow-Platzhalter wurde eingesetzt. Kleine allgemeine Modelle beweisen weder
Volljährigkeit noch Einwilligung oder zuverlässige Erkennung sexueller Ausbeutung.
Insbesondere vollständige Videoprüfung auf CPU kann das Laufzeitbudget überschreiten.
Die Freigabe ist zusätzlich an einen automatisch berechneten Fingerabdruck der
tatsächlich laufenden Prüfsoftware und des Dependency-Locks gebunden. Geänderter
Prüfcode kann eine alte Qualifikation nicht unverändert weiterverwenden.

Noch nicht verifiziert: Hosting-Verfügbarkeit, tatsächliche Modellinitialisierung/
ONNX-Kompatibilität, Klassifikationsqualität einschließlich Fehlalarmen und
missbräuchlichen Eingaben, Speicherbedarf, Laufzeit aller Frames, Lizenzkette und
reale Löschwirkung beim Hoster. Bis dahin keine semantische Schutzwirkung behaupten.

Am 26.10. wurden die öffentlichen HF-Dateimetadaten **genau der festgeschriebenen
Revisionen** erneut geprüft: beide SHAs erreichbar und passend, erforderliche
FP32-ONNX-Dateien vorhanden ([NSFW-Dateistand](https://huggingface.co/onnx-community/nsfw_image_detection-ONNX/tree/1ceb3c7fe1e9f3f2507e6df577437f23a9149fd5/onnx): 343.401.688 Bytes, [VLM-Dateistand](https://huggingface.co/HuggingFaceTB/SmolVLM-500M-Instruct/tree/a7da5b986cb59b408707209984f360a5f4ad7e47/onnx) zusammen
2.032.852.109 Bytes). Dies war ausschließlich ein Metadatenabruf, kein Gewichte-
Download, kein Inferenztest und keine Überprüfung der kostenlosen Hostingkapazität.

## Vor einer Veröffentlichung erforderlich

1. **Bestandsidentität sichern:** Bestehende geschützte Profile melden sich mit ihrem
   Passwort an und binden HF. Ungebundene passwortlose Altprofile brauchen eine
   verifizierte einmalige Zuordnung über den unabhängig geschützten Verwalter.
   Bestehende Namen, IDs, Videos und Punkte bleiben erhalten. Kein automatischer
   Claim nach Kenntnis eines Namens. Die Verknüpfung bleibt nach HF-Trennung bestehen.
2. **Moderation qualifizieren:** Eigenen Dienst anhand zulässiger Testmittel prüfen;
   danach separate Secrets `MODERATION_URL` (HTTPS, endet `/validate`),
   `MODERATION_SECRET`, `MODERATION_POLICY_VERSION`, `MODERATION_MODEL_VERSION`.
   Nicht `/evaluate` anschließen oder bei Ausfall auf ungefilterte Inferenz wechseln.
3. **Kontrollierten Wan-Stand bereitstellen:** `WAN_SPACE_ID`, `WAN_SPACE_REVISION`,
   `WAN_MODEL_ID`, `WAN_MODEL_REVISION`; Revisionen jeweils volle 40-stellige SHA.
   Überprüfter Space muss in `/config` `slop_model: {id, revision}` des tatsächlich
   geladenen Modells deklarieren und am freigegebenen Quell-/Runtime-Stand laufen.
   Neue Aufträge des bisherigen unkontrollierten Modells werden zurückgehalten.
4. Moderationsregister dauerhaft erhalten: Cloudflare im Services-DO, lokal unter
   `.local/moderation`. Kein Entfernen dieser Daten bei normalem Undo/Restore oder
   Deployment. Berichtskategorien/Identitäten sind nur für Verwalter lesbar;
   sichtbare Meldeliste auf 30 Tage/500 Einträge begrenzt, Sperren verfallen nicht.
5. Zwei echte HF-Konten budgetgedeckt separat abnehmen (M17), mindestens fünf
   Sekunden im echten Safari und Chromium prüfen. Stubs belegen keine HF-Abrechnung.
6. Produktive DB/ACL/Backups und Cloudflare-Regeln separat prüfen. Das vorgeschriebene
   MCP `slop_urself` steht nicht zur Verfügung; deshalb keine produktive Schemaänderung
   oder Datenbankprüfung vorgenommen. Kein Push oder Deployment in diesem Auftrag.

## Verifikation und nächste Pakete

Fortsetzung am **26. Oktober 2026**:

- M19: Aktive Archivdateien werden vor Veröffentlichung reserviert. Services-Neustarts
  bewahren die Reservierungen; Raumalarme erneuern sie, abgelaufene Reservierungen
  fallen automatisch aus der Verdrängungssperre. Node schützt zusätzlich die aktiven
  URLs seiner Räume. Zusätzlich reserviert die gemeinsame Archivwarteschlange vor
  Budgetbeginn maximal 15 MiB je Job. Andere Jobs können diese Zusage nicht verbrauchen;
  FIFO plant mit verbleibendem Budget. Vorabprüfung löscht keine Daten, zählt aktive
  Videos/Undo mit und löst keine KI-Aufrufe aus. Reservierungen überstehen Services-
  Neustarts, werden idempotent beendet und verfallen spätestens nach 30 Minuten.
  Die Zusage gilt gegen andere App-Jobs; externe Bucket-Mutationen/Ausfälle können
  weiterhin Speicherung verhindern und sind durch die separate Archivwiederholung
  abgedeckt. Konservative Maximalgröße kann bei kleinen Archiven früher sperren.
- M04: Neue Archivpartien filtern gesperrte URLs serverseitig. Bereits laufende
  Partien können nach nachträglicher Sperre weiterhin einen nicht abspielbaren Clip
  enthalten; Auslieferung bleibt gesperrt. Automatisches Überspringen ist noch offen.
- M20: Betriebsfehler aus Datenbank-/Raumpfaden protokollieren ausschließlich feste
  Stufen und bekannte Fehlercodes. Keine Rohmeldungen, SQL-Werte, Prompts, URLs,
  Tokens oder Stacks. Cloudflare-Account-Logeinstellungen nicht geändert/geprüft.
- M21/M38/M40: lesbare Buttonkontraste, reduzierte CSS-Bewegung und kein Videoautostart
  bei reduzierter Bewegung; bewusster Play-/Retry-Aufruf bleibt möglich. Gleichstände
  teilen in Endwertung und Statistik die Platznummer.
- M37/M39 teilweise: Fokus auf Screenüberschrift nur bei echtem Screenwechsel, kein
  Fokusverlust bei bloßem Snapshot; Raumaktionen bleiben beim Höhenwechsel verankert,
  dynamische Viewporthöhe berücksichtigt. Reale Screenreader-/Gerätetests bleiben offen.
- M06/M07: Hinweis auf ausstehenden Eigentumsnachweis; Restore lehnt fremde Objekte
  verständlich ab und entfernt sie aus wiederholten Undo-Versuchen.
- M15-Kompatibilität: Ein gezielter Browsertest bestätigte, dass `media-src 'self'`
  alte externe HF-Clips unbeabsichtigt blockiert. Medien sind deshalb zusätzlich
  von den bereits im Downloadpfad zugelassenen HTTPS-HF-Hosts erlaubt; keine
  pauschale Freigabe fremder HTTPS-Quellen. Diese Altlinks werden beim Anbieter
  ausgeliefert; eigene Archiv-Sperren können fremde Kopien oder bereits geladene
  Bytes nicht zurückrufen. Altarchiv-Migration/-Prüfung bleibt offen.

- Root-Build/Typprüfungen erfolgreich; derzeit 168 Unit-Tests bestanden.
- Service-Build und fünf Protokoll-/Entscheidungs-/Qualifikation-/native Bildruntime-/Versionsbindungstests bestanden.
- Versionsberechnung zusätzlich am gebauten Dienst ohne Modell-Downloads geprüft.
- Der separate Dienst enthielt indirekt eine ältere verwundbare sharp-Auflösung.
  Gezieltes Override auf 0.35.5, mit tatsächlichem Transformers-Decode/Resize geprüft;
  dessen Produktionsabhängigkeiten melden anschließend ebenfalls 0 npm-Auditbefunde.
- Vollständiger isolierter Chromium-/WebKit-/workerd-Lauf mit **Exitcode 0** bestanden:
  HTTP-Limits, echte lokale Worker-/DO-Routings und Alarme, simulierte persönliche
  HF-Konten, JS-freies SEO, Bedienung, Video/Retry/Reload, Statistiken/Undo/Pagination,
  Spielvarianten, Archivpartien, zehn Spieler, Verwaltung und klassische Runden.
  Danach: erneuter Build/168 Unit-Tests sowie **vier zusätzliche bestandene
  Legacy-CSP-Prüfungen** (Chromium/WebKit jeweils auf Node/workerd) für die eng
  begrenzte HF-Medienausnahme. Der neue Fall ist in künftige Gesamtläufe integriert.
- CI-Testablagen für HF-Verbindungen, Moderationsregister und Archivreservierungen
  liegen in eigens erzeugten temporären Verzeichnissen. Lokale Nutzerdaten werden
  dafür nicht verwendet. Standalone-Archivtests besitzen ebenfalls eigene Ablagen.
- Tests nutzen ausschließlich harmlose Fixtures und simulierte HF-/S3-/DB-Antworten;
  keine GPU-Aufträge, produktiven Löschungen oder Nutzerübernahmen ausgeführt.
- robots.txt/Sitemap-Routing unverändert; neue Header werden mit vorhandenen
  JS-freien SEO-Regressionen geprüft. Kein neuer Produktionsabruf in diesem Paket.

## Priorisierte Restarbeit

### Weitere Pakete am 26.10.: M09, M20 und M27

- **M09/M22:** Neue klassische Mehrspieler-Videos bleiben trotz schneller Stimmen
  in der Vorschau, bis der Ersteller tatsächlich abgespielte Bereiche bestätigt,
  ausdrücklich freigibt oder 45 Sekunden verstrichen sind. Das ist ein UX-Signal,
  kein manipulationssicherer Wiedergabenachweis. Solo bleibt manuell. Explizite
  Enthaltung bindet dieselbe Wertungskennung/Runde/Video wie eine Stimme, zählt
  nicht als Null-Sterne-Bewertung und ist nach Abgabe unveränderbar. Zählung steht
  im aktuellen Ergebnis; dauerhafte historische Zählung braucht eine DB-Erweiterung.
- **M20 teilweise:** `redact_query_string` in Wrangler aktiviert; automatisches
  CF-Versionsbinding, überprüfte UUID/Git-SHA als `X-Slop-Release` und in AI-Logs.
  Keine beliebigen Umgebungswerte/Queryinhalte protokollieren. Dies ist lokal
  getestet; produktive Observability-/WAF-Einstellungen bleiben unverifiziert.
- **M27 teilweise:** Inventaranzeige cached/bündelt erfolgreiche vollständige
  Abrufe fünf Sekunden. Archivierung und physische Löschung invalidieren auch bei
  Fehlern/verlorenen Antworten. Kapazitätsprüfung/FIFO nutzen weiter frische Listen.
  Kein DB-Abgleich aus gecachter, während Abruf invalidierter oder defekter Liste.
  Spielerfilter-Requestoptimierung und reale DB-Querymessung bleiben offen.
- **M25/M45 Revanchekorrektur:** Neue Raumkennung setzt alte Teilnehmer-/Bereit-
  schaftsanzeige und Hostaktionen zurück, bis der neue Snapshot eintrifft. Der
  Gesamtlauf deckte die Race beim WebKit/workerd-Revanchetest auf. Korrigierter
  Teilnehmerablauf anschließend in Chromium/WebKit jeweils Node/workerd bestanden.
- Build/Typprüfungen und **178 Unit-Tests bestanden**; separate Vorschau- und
  Teilnehmerregressionen in vier Kombinationen bestanden. Die gesamte Matrix muss
  nach der Korrektur erneut durchlaufen; bisherigen Gesamtlauf nicht als bestanden
  werten. Keine GPU-Jobs, produktiven Datenänderungen, Pushes oder Deployments.

### Neues P0-Paket, 26.10. (nach bfd749e)

- **M02/M03/M11:** Der eigene Dienst lehnt nun sämtliche Ton-/Zusatzspuren ab,
  decodiert jedes Bild der einzigen H.264-Videospur und bricht bei beschädigten
  Frames ab. Das verhindert, dass ausschließlich geprüfte Bilder zusammen mit
  ungeprüftem Ton veröffentlicht werden. Der aktuelle I2V-Vertrag ist ausdrücklich
  stumm. FFmpeg 9 benötigt `fps_mode passthrough` statt des entfernten `vsync`.
- **M02/M03:** Modellantworten mit doppelten/unbekannten JSON-Feldern oder
  unvollständigen/widersprüchlichen Klassifikatorscores werden nicht freigegeben.
  HTTP-Abbruch/Timeout beendet weitere Arbeit, soweit die native Modelloperation
  Abbruch zulässt; native Einzeloperationen können darüber hinaus dauern. Der
  Compute-Slot bleibt bis zum wirklichen Ende belegt. Nach Inferenz wird eine
  inzwischen abgelaufene Qualifikation erneut geprüft und kann nicht freigeben.
- **M05/M34:** Unbekannte zusätzliche API-Parameter (insbesondere Modell-/LoRA-
  Defaults), doppelte Namen oder fehlende Bild/Prompt/Schritte/Dauer werden vor
  Upload zurückgewiesen. Lesendes Werkzeug `tools/ai-readiness.ts` prüft echten
  öffentlichen Endpoint/Version/API, ohne Generierung oder persönliche Tokens.
- **M17:** Jobtoken wird vor Verwendung zusätzlich gegen HF-whoami geprüft.
  Metadaten und tatsächliche HF-Identität müssen zum reservierten Spieler passen;
  fremder, vertauschter oder widerrufener Token wird vor Inferenz abgewiesen.
  Regression prüft auch den Fall korrekter gespeicherter Metadaten bei falschem
  tatsächlichem Tokeninhaber. Kein Rückfall auf den zentralen Token.

**Tatsächlich extern/lokal geprüft:** Der öffentliche Wan-Space war am 26.10.
erreichbar und RUNNING (Quellstand `fca7f5a33da3057bae497de5cd70f49ce75e6c02`),
sein API-Vertrag kompatibel; erforderliche Modellfreigabekonfiguration fehlte.
Es wurden null aktive Verbindungen im lokalen HF-Vault gefunden. Daraus folgt
keine Aussage über produktive DO-Verbindungen. Zwei getrennte Kontingentbelastungen
sind weiterhin nicht live verifiziert. Die HF-Dokumentation bestätigt persönliche
Token-Abrechnung und mögliche automatische Nutzung von Guthaben bei berechtigten
Konten nach Kontingentende; eine Restbudgetschätzung allein beweist keinen
providerseitigen Ausschluss kostenpflichtiger Überziehung.
[HF API-/Token-Abrechnung](https://huggingface.co/docs/hub/en/spaces-api-endpoints),
[ZeroGPU-Kontingente und Guthaben](https://huggingface.co/docs/hub/spaces-zerogpu).

**Echter Moderationsversuch, nicht bestanden:** Node 26 brach bei nativer
Kontextmodellinitialisierung ab (134). Ein Node-24-Lauf scheiterte zunächst ebenfalls
an Initialisierung; die gezielte Einzelprüfung lud Prozessor und Kontextmodell.
Mit diesem Cache initialisierte der anschließende beaufsichtigte CPU-Diagnoselauf
beide Modelle. Neun sichere Diagnosen ergaben null bestandene Fälle: sieben
technische Fehler/Timeouts und zwei zurückgehaltene harmlose Anfragen. Die vier
beabsichtigt unzulässigen, nur nichtgrafischen Textanfragen konnten dabei nicht
semantisch ausgewertet werden; dies belegt keine Erkennung kritischer Inhalte.
Eine fünfsekündige synthetische Fünf-Frame-Datei scheiterte ebenfalls am Zeitbudget.
Der kleine Korpus enthält keine realen Personen, rechtswidrigen Bilder oder
Generierungsaufträge; er ist kein repräsentativer Sicherheitsnachweis. Kein
Schwellenwert wurde zur Freigabe gelockert. Der alte Diagnoseablauf meldete nur
Prozessabschluss mit 0; der neue Evaluator meldet nicht bestandene Fälle mit Exit 2.

Quelle: [datensparsamer Diagnosebericht](audits/2026-10-26-moderation-diagnostic.json).
Die native Initialisierungsursache ist nicht abschließend bewiesen; aus dem
erfolgreichen Cachewechsel wird keine sichere Ursache abgeleitet. Der beaufsichtigte
Evaluator erfasst native Abstürze/harte Deadline statt ein altes „starting“ zu belassen.
**Sicherheitsfreigabe bleibt ausdrücklich aus.** Keine kostenpflichtigen Tests,
keine GPU-Aufträge, keine produktiven Änderungen und keine juristische Zusage.

1. **P0 – Freigabegrenzen:** Moderationsdienst fachlich und praktisch qualifizieren,
   kontrollierten Wan-Erzeuger anschließen, Altarchiv separat prüfen (M01–M05).
   Profilmigration für Bestandskonten vor Veröffentlichung abnehmen (M06).
   API-/Gate-Tests ersetzen diese externen Abnahmen nicht.
2. **P1 – Zuverlässigkeit/Betrieb:** Reale Ausgabe-/Moderationsabnahme der
   Wiedergabe-/Enthaltungsregeln (M09), echte
   Wan-/Safari-Ausgabe (M11), getrennte HF-Abrechnung (M17), vollständiges Lösch-
   und Aufbewahrungskonzept (M18), externe Speicherabnahme (M19),
   produktive Cloudflare-Logeinstellungen und erweiterte Stufendiagnose (Rest M20).
3. **P2 – Architektur:** Mehrfachidentitäten (M23), Raum-UUIDs (M24), mobile
   Wiederkehr (Rest M25), versionierte Migrationen und DB-/Inventarmessung
   (M26–M29), verbleibende Crashfenster/Jobbereinigung/Schlüsselrotation (M31–M33).
   M26/M28/M44 benötigen den vorgeschriebenen DB-Zugang beziehungsweise isolierte
   Wiederherstellungsprüfungen; produktiv nicht als verifiziert behauptet.
4. **P2 – Nutzbarkeit/Abnahme:** Prompt-/Warteführung (M35–M36), verbleibende
   Screenreader-/Realgeräte-/Entwurfsprüfung (M37/M39/M41), Restore- und Release-
   abnahme (M44–M45). M21/M38/M40 sind im Code mit Regressionen umgesetzt.
5. Optionale Spielerweiterungen M46–M54 bleiben hinter den Sicherheitsabhängigkeiten.
   Bestehende öffentliche SEO-Endpunkte benötigen keinen weiteren robots-Fix.
