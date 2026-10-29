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

### Abnahme M09/M22 und tatsächlicher CPU-Befund, 27.10.

Angenommene Stimmen ausgeschiedener Wähler zählen nun auch im Fortschrittsnenner;
ausgeschiedene Nichtwähler werden nicht mehr erwartet. Die ursprüngliche Gruppen-
vorschau behält ihr 45-Sekunden-Limit, selbst wenn nur der Ersteller übrig bleibt.
Reine Solo-Vorschau bleibt manuell. Build/189 Units und vier gezielte Browserläufe
(Chromium/WebKit jeweils Node/workerd) bestanden, inklusive Austritt aller Wähler.
Unverändert gilt die bisherige Punktesumme; historische Normalisierung wurde nicht
eingeführt und dauerhaftes Enthaltungs-/Wahlberechtigungsprotokoll bleibt DB-abhängig.

Die Modellreparatur ist mit Exit 0 abgeschlossen; alle vier ONNX-Prüfsummen stimmen.
Der anschließende echte CPU-Lauf initialisiert beide Modelle. Acht Eingaben liefern
jedoch ausnahmslos review, auch alle vier harmlosen. Vier zurückgehaltene abstrakte
Risikotexte belegen damit keine sinnvolle Klassifikationsleistung. Der Fünf-Frame-
Videofall überschreitet mit 33.997 ms das Budget. **Keine Freigabe.** Evidenz:
`audits/2026-10-27-moderation-diagnostic.json`. Ein gezielter harmloser Grundtest
identifiziert `context_format`: Mindestens dort scheitert bereits der strikte
Ausgabevertrag. Diagnostik enthält nur feste Fehlerkategorien, keine Rohantworten
oder Nutzereingaben. Schwellen und Freigabebedingungen bleiben unverändert.
Der Formtest bestätigt acht Ausgabetokens ohne JSON-Objekt oder Codefence; das
Tokenlimit ist nicht erreicht. Daher keine willkürliche Limiterhöhung oder
nachträgliche Freigabe natürlichsprachlicher Antworten. Eine einfachere strikt
validierte Entscheidungsform darf nur separat/versioniert experimentell geprüft
werden; das ist noch keine Änderung des freigegebenen Betriebs.

### Laufend am 27.10.: M41 und Moderationslaufzeit

M41 ergänzt ausschließlich tablokale Prompttextentwürfe pro Raum/Spieler/Video mit
15 Minuten Gültigkeit. Es werden keine Bilder oder Zugangsdaten gespeichert;
akzeptierte Generierung, Raumverlassen und Abmeldung löschen den Text. Ablauf wird
beim nächsten Zugriff bereinigt; eine sofortige physische Löschung im pausierten
Browserhintergrund wird nicht zugesichert. Bounded Speicher und Fehlerbehandlung
sind mit zwei Regressionen abgedeckt; Root-Build/188 Unit-Tests bestanden.
Vollständiger Chromium-/WebKit-/workerd-Lauf mit vier zusätzlichen Reload-/Entwurfs-
tests am 27.10. mit **Exitcode 0 bestanden**, einschließlich neuer Vault-/Filterpfade.

Gezielte P0-CPU-Diagnose (keine erneute Gesamtauditphase): Der festgeschriebene
SmolVLM-Prozessor erzeugt durch 2048px-Upscaling 13–17 Kontextausschnitte aus unseren
begrenzten Medien. Eine 1024px-Grenze liefert fünf Ausschnitte und hält Splitting
aktiv. Keine akzeptierte Quelle wird unter ihre native Auflösung verkleinert.
Video-Frames werden nun ebenfalls ohne vorherige 320px-Verkleinerung geprüft.
Die Grenze ist mit der Upload-/Videoprüfung gemeinsam; geänderte Prozessor-Defaults
werden zurückgewiesen und der Runtime-Hash umfasst den Code. Dienst-Build/11
technische Tests bestanden, einschließlich echtem vollständigem 640×360-Decode.
Ein neuer beaufsichtigter Node-24-Lauf scheiterte vor der Inferenz mit „Protobuf
parsing failed“. Der aktuelle Decoder-Cache ist nachweislich unvollständig:
1.323.696.414 statt 1.450.425.745 Bytes laut festgeschriebener HF-Revision. Dies ist
ein konkreter Defekt im beim Fehler verwendeten Cache; die Reparatur samt erneutem
Modellladen muss den Zusammenhang noch abschließend bestätigen. Daraus folgt keine
pauschale Erklärung der älteren Abstürze oder bisherigen Qualitäts-/Laufzeitprobleme.
ONNX-Dateigrößen und LFS-SHA256 sind jetzt im Lock enthalten; jedes Modell prüft
die tatsächlichen Cachebytes vor dem Laden. Öffentliche Downloads werden ohne
Spielertoken gestreamt, begrenzt/gehasht und erst vollständig atomar übernommen.
Defekte/abgebrochene Downloads ersetzen keine bestehenden Dateien. Dienst-Build/
13 technische Tests bestanden; gezielte Reparatur läuft. Bis zur anschließenden
realen Diagnose keine neue Wirksamkeits-, Zeit- oder Sicherheitsfreigabe.

M17 bleibt extern blockiert: Nutzer bestätigt am 27.10., dass nur ein persönliches
HF-Konto verfügbar ist. Zwei getrennte echte Belastungen sind damit nicht prüfbar.

### Fortsetzung 27.10. (M33/M32, M27)

Die vollständige isolierte Chromium-/WebKit-/workerd-Matrix von 9195426 wurde
mit **Exitcode 0** abgeschlossen; die nachfolgenden Pakete sind damit noch nicht
pauschal abgenommen.

M33 ermöglicht gezielten Vault-Schlüsselwechsel mit vorherigem Leseschlüssel;
Schlüsselkennung ist Bestandteil der authentifizierten Verschlüsselung. Bestehende
Verbindungen und gepinnte Jobs werden ohne neue Identität oder verlängerte Laufzeit
umverschlüsselt. Gleichzeitiges Trennen/Ersetzen darf keinen alten Zugang reaktivieren.
Altes Format bleibt lesbar; vorheriger Schlüssel wird niemals standardmäßig aus einer
zurückgelassenen lokalen Konfiguration erneut hochgeladen. Anleitung in HUGGINGFACE.md.
Neue Vault-Einträge sind pro Profil auf 16 begrenzt, globale Obergrenze bleibt 512.
Alte Einträge erhalten die Zuordnung bei Migration und laufen regulär ab; es gibt
keine pauschale Löschung bestehender Verbindungen. Produktiver Schlüsselwechsel
und gemischte Release-Stände sind nicht verifiziert.

M32 ergänzt geordnetes Schreiben der Ablauf-/Eigentümerindizes vor Geheimnissen.
Ein Fehler kann einen bis zum Ablauf zählenden leeren Slot hinterlassen, aber kein
neues dauerhaft unindiziertes Token. Dies ist keine vollständige atomare Multi-Key-
Transaktion und ersetzt nicht die verbleibenden Crash-/Wiederherstellungstests.

M27 lädt bei Spielerfilterwechsel nur die bereits geschützte paginierte Videoliste;
globale Aggregationen und Speicherabgleich entfallen. Regression zählt Aggregat-
Requests und prüft veraltete Antworten sowie Auswahl/Scroll-/Wiedergabeverhalten.
Alle acht History-/Statistikläufe in Chromium/WebKit auf Node/workerd bestanden;
fehlendes WebKit-Startskript wurde durch offiziellen Download wiederhergestellt.
Root-Build/186 Unit-Tests einschließlich Rotation, Legacy-Format, paralleler
Profilgrenzen und Fehler vor Tokenablage bestanden. HF-workerd und persönlicher
Chromium-HF-Ablauf nach Rotation bestanden; finaler Schreibablauf zusätzlich in
workerd erneut bestanden. Der vollständige frühere
Gesamtlauf bleibt auf 9195426 bezogen und wird nicht auf neue Pakete übertragen.
Keine produktive Datenbank-, Schlüssel-, Firewall- oder Deploymentänderung.

### Laufendes Folgepaket nach f37e0da

M36 stellt beim Reload die bekannte Generierungsstufe mit Auftragsbeginn wieder her.
Queue/Inferenz stammen aus tatsächlichen Gradio-Ereignissen; eine Abfrage wird nicht
als sicher laufende GPU-Berechnung ausgegeben. CF speichert Änderungen; der Client
akzeptiert Fortschritt nur für den aktuellen Raum/Auftrag. Kein scheinpräziser
Prozentbalken, getrennte Zeit ohne sekündliche Screenreader-Ansage. M20 unterscheidet
Archivstufen Download, Moderation, Inventar und Speicherung, jeweils mit validierter
Release-/Auftragskennung ohne Fehlertext/Privatdaten.

P0-Freigabevertrag gehärtet: Der tatsächliche private, gehashte Messbericht muss
vorliegen, zur laufenden Software-/Modellversion gehören und ausreichende Gruppen,
harmlose DE-/EN-Fälle sowie echte vollständig decodierte Fünfsekundenvideos belegen.
Fallentscheidungen, Fehlfreigaben/Fehlalarme, Latenz und Ablauf werden nachgerechnet.
Eine bloße SHA-/Fallzahlbehauptung oder der kleine Diagnosetest qualifiziert nicht.
Das ersetzt keine menschliche Qualitäts-/Lizenzprüfung und liefert weiterhin
keinen bestätigten Schutz gegen CSAM/fehlende Einwilligung. Kein Freigabebericht
erzeugt, echte KI weiterhin gesperrt.

Abnahme bisher: Root-Build/181 Unit-Tests, Dienst-Build/10 technische Tests; neuer
Slow-Mock-Reload-Test unter Chromium bestanden. Gesamtmatrix deckte noch gemeinsame
HF-Identitäten in alten Archiv-/Quota-Fixtures auf. Diese erhalten separate Konten;
Quota-Prüfung testet nun ausdrücklich einen schwachen dritten Spieler, individuelle
Reserven und Aufruflimits. Gezielte Prüfung von Archivpartien, Quota, acht Videos mit
Zusatzrunden und Status/Reload in Chromium/WebKit bestanden. Dienst-Build/10 Tests
auch nach finaler strikter Einzelzeitgrenze bestanden; Gesamtabnahme noch offen.

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

Fortsetzung: M23 prüft eindeutige bestätigte HF-Subjekte vor Beitritt und Spielstart
in Node und Cloudflare. Zuschauer dürfen dieselbe Identität nutzen, erhalten aber
keine Wahlberechtigung. Eine während der Node-Prüfung geänderte Spielerliste wird
erneut abgewiesen statt ungeprüft übernommen. Bestehende Budget-Deduplizierung bleibt
für Altholds erhalten. Browsertests mit simuliertem HF: Chromium/WebKit jeweils
sechs persönliche Videoaufträge, zusätzliche Profilidentität mit demselben HF-Konto
abgewiesen, Zuschauerbeitritt erlaubt. Dies beweist keine reale HF-Abrechnung.

M25 erweitert die Verbindungsfrist auf 90 Sekunden. Die DO-Regression prüft Rückkehr,
Zurücksetzen der Bereitschaft sowie die neue exakte Ablaufgrenze; expliziter Austritt
bleibt sofort. Keine Gleichsetzung mit einer Prüfung auf echten Mobilgeräten.

P0-HTTP-Diensthärtung: Abbruchsignal begrenzt nun auch einen unvollständigen Body;
Timeout beendet den Upload und gibt den Prüfplatz frei. Defektes UTF-8 und komprimierte
Anfragen werden vor Inferenz zurückgehalten. Dienst-Build und acht technische Tests
bestanden. Geänderter Dienstcode invalidiert die bisherige Runtime-Version; der alte
fehlgeschlagene Diagnosebericht bleibt historische Evidenz, keine Qualifikation.

Externe Zusatzprüfung: HF-Connector authentifizierte das kostenlose Konto, besitzt
jedoch kein `read-billing`; damit kein echter Kontingent-/Abrechnungsnachweis. Der
früher erwähnte eigene Testspace war über diese Verbindung nicht abrufbar. Kein
Space wurde erstellt oder verändert, keine Jobs/Bezahlaufrufe ausgeführt. Das
vorgeschriebene MCP `slop_urself` ist weiterhin nicht verfügbar.

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
3. **P2 – Architektur:** Live-/Bestandsabnahme der Mehrfachidentitäten (M23), Raum-UUIDs (M24), mobile
   Realgeräteprüfung (Rest M25), versionierte Migrationen und DB-/Inventarmessung
   (M26–M29), verbleibende Crashfenster/Jobbereinigung/Schlüsselrotation (M31–M33).
   M26/M28/M44 benötigen den vorgeschriebenen DB-Zugang beziehungsweise isolierte
   Wiederherstellungsprüfungen; produktiv nicht als verifiziert behauptet.
4. **P2 – Nutzbarkeit/Abnahme:** Prompt-/Warteführung (M35–M36), verbleibende
   Screenreader-/Realgeräte-/Entwurfsprüfung (M37/M39/M41), Restore- und Release-
   abnahme (M44–M45). M21/M38/M40 sind im Code mit Regressionen umgesetzt.
5. Optionale Spielerweiterungen M46–M54 bleiben hinter den Sicherheitsabhängigkeiten.
   Bestehende öffentliche SEO-Endpunkte benötigen keinen weiteren robots-Fix.


### Fortsetzung 27.10.: Moderationsprotokoll (M02/M03), keine Sicherheitsfreigabe

Ein strikt versionierter, optionaler `labels-v1`-Diagnosemodus wurde gegen dieselben
acht synthetischen Bild-/Textfälle und ein stummes Fünf-Frame-Video geprüft. Alle
acht Textentscheidungen scheitern am vollständigen Enum-Vertrag; alle vier harmlosen
Fälle bleiben damit fälschlich zurückgehalten. Das Video endet nach 27.764ms mit
technischem Fehler. Vier formal bestandene kritische Holds sind wegen des gemeinsamen
Formatfehlers **kein** Beleg semantischer Erkennung. Dienst-Build und 15 technische
Tests bestanden. Der Standard bleibt striktes JSON, der tatsächliche Modell-Lock
unverändert; andere Protokolle haben eigene Versionsfingerabdrücke. Kein kostenpflichtiger
Aufruf, keine GPU, kein Deployment, keine Qualifikation. Weitere identische Messungen
ohne neue technische Hypothese werden nicht wiederholt. Evidenz:
[ausschließlich synthetischer CPU-Bericht](audits/2026-10-27-moderation-labels-diagnostic.json).


### M04: nachträgliche Sperren in laufenden Archivpartien (27.10.)

Node und Room-DO prüfen den aktuellen Clip vor Abschluss einer Wertung sowie vor
Vergabe von Rate-Bonuspunkten erneut. Ein 10s-Check (auch nach Hibernation) überspringt
einen inzwischen gesperrten Clip ohne Punkte und entfernt Prompt/Abgaben aus dem
aktuellen Raumzustand. Der folgende Spielzug bleibt erreichbar. Unklare/fehlende
Sperrantworten halten die Wertung zurück; asynchron veraltete Antworten dürfen kein
neues Video überspringen. Bereits im Browser heruntergeladene Bytes können nicht
zurückgerufen werden; neue Medienabrufe bleiben wie bisher sofort gesperrt.
Build/191 Units bestanden, einschließlich Persistenz/Wiederanlauf und Statusausfall.
Die vollständige isolierte Chromium/WebKit/workerd-Matrix läuft noch; keine
produktive Verifikation und keine vollständige Moderationsabnahme daraus ableiten.


### M31/M32/M33: wiederholbare Tokenbereinigung und KDF-Version (27.10.)

Persönliche Kontingentpläne behalten die Auftrags-/Eigentümerzuordnung, bis der
angeheftete Jobtoken tatsächlich entfernt ist. Fehler beim Entfernen oder beim
anschließenden Planschreiben werden beim nächsten Abschluss erneut verarbeitet;
das persönliche Budget wird dabei nicht doppelt verbraucht. Die normale HF-
Verbindung bleibt bestehen. Regression injiziert beide Speicherfehler und einen
Neustart. Eine weitere DO-Regression verliert gezielt den Veröffentlichungsschritt
nach fertiger Generierung: Neustart verwendet denselben Archivauftrag, ohne neuen
Tokenabruf, Upload oder GPU-Auftrag. Bereits vorhandene Archivtests prüfen dessen
idempotenten Objektschlüssel. Das ersetzt nicht sämtliche Crashfenster von M31.

Neue optionale Passwort-Hashes tragen einen expliziten v1-Vertrag. Alte Hashes
bleiben lesbar; unbekannte Versionen, Algorithmen und Kosten werden vor Berechnung
abgelehnt. Die bestehenden 100.000 PBKDF2-SHA256-Iterationen bleiben unverändert;
keine unbelegte Erhöhung oberhalb des Worker-Vertrags. Dies macht Passwörter nicht
verpflichtend. Vor einem produktiven Rollout müssen alle lesenden Instanzen das
neue Format verstehen; ein Rollback auf einen alten Reader nach neuen v1-Schreibungen
ist nicht abgenommen. Keine Passwort-/DB-/Secretänderung in Produktion erfolgt.

Root-Build und 196 Units bestanden. Zusätzlich KDF-Anmeldung mit echtem workerd,
falschem/fehlendem Passwort und Profilpersistenz nach DO-Eviction bestanden. Die
vollständige konsistente Browser-/workerd-Matrix läuft noch.

### M29: unabhängige persönliche Kontingentansichten (27.10., teilweise)

Lesende Abfragen für unterschiedliche bestätigte HF-Subjekte laufen parallel statt
jeweils auf die vorige Netzwerkantwort zu warten. Gemeinsame Identitäten bleiben
vorher gruppiert. Regression erzwingt überlappende Requests und prüft zwei getrennte
Tokens sowie den knappsten Spieler als Rundengrenze. Reservierungen/Mutationen bleiben
serialisiert und prüfen frisch. Keine gemessene produktive Beschleunigung, keine
Erhöhung eines Kontingents und keine reale Abrechnungsabnahme daraus ableiten.
Dienst-Queue-Messung und weitere Zusammenführung gleichartiger Reads bleiben offen.


### M35: nachvollziehbare Promptaufbereitung (27.10.)

`shared/video-prompt.ts` ist die gemeinsame Quelle für Validierung, Normalisierung,
effektiven Prompt und Negativvorgaben. Vorprüfung und Provider erhalten denselben
Text wie die optionale, per Tastatur erreichbare Klartextvorschau. Promptinhalt wird
als Text eingefügt, nicht als HTML interpretiert. Wiederhergestellte Entwürfe aktualisieren
die Vorschau. Gespeichert wird weiterhin nur die Nutzeranweisung ohne Zusätze.

Die pauschalen Identitäts-/Einzelaufnahmebefehle entfallen zugunsten von Hinweisen,
die ausdrücklich gewünschte Transformationen und Effekte respektieren. Ein kleiner
harmloser Vertragskatalog prüft Bewegung, Verwandlung, Szenenwechsel, Normalisierung
und identische Providerwerte. Das ist keine nachgewiesene Verbesserung der echten
Wan-Videoqualität; dafür gelten weiterhin Moderations-/Modell-/Budgetfreigaben.
Root-Build/196 Units bestanden; Chromium-Vorschautests auf Node/workerd bestanden,
WebKit und restliche Gesamtmatrix noch laufend. Neue Prüfungen sind in CI registriert.


### Abschluss der unterbrochenen Regressionen, 27.10.

Quellstand **5c12107** wurde nach Verlust des alten Prozesses und seiner temporären
Logs konsistent mit Node 24.22.1 neu gebaut. **196 Unit-Tests, 15 technische
Moderationsdiensttests und die vollständige Chromium/WebKit/Node/workerd-Matrix
bestanden, jeweils Exit 0.** Dazu gehören die neuen Promptvorschau- und KDF-Prüfungen.
Der frühere gemischte Source-/dist-Lauf gilt weiterhin als fehlgeschlagen; für den
später verschwundenen Prozess wird kein Ergebnis erfunden. Die aktuelle vollständige
Prüfung enthält alle Quellpakete bis 5c12107. Logs/Browsercache liegen nun unter
`.local/`, statt auf einen weiteren Erhalt von `/tmp` angewiesen zu sein.

[Ergebnisnachweis mit Quellstand und Loghashes](audits/2026-10-27-regression-results.json).
Tests nutzen isolierte Daten und simulierte externe Verträge. **Keine reale HF-
Abrechnung, keine produktive Datenbank-/WAF-/Backupabnahme, kein Push/Deployment.**
M02/M03 bleiben mangels bestandener semantischer Moderation und Videolaufzeit offen;
M05 benötigt den kontrollierten Erzeuger, M17 ein zweites echtes HF-Konto. Das
vorgeschriebene `slop_urself`-MCP fehlt weiterhin für DB-abhängige Maßnahmen.
Die neuen lokalen Regressionserfolge heben die KI-Sperre ausdrücklich nicht auf.


### Fortsetzung 28.10.: reale Kontentrennung, keine GPU-Abrechnung (02989e8)

Das lokale, nur auf Loopback erreichbare Prüffenster nutzt den produktiven
`HfConnections`-/`PlayerQuotaBudget`-Code mit ausschließlich RAM-Ablage. Eine eigene
Netzwerk-Allowlist lässt nur die festgelegten HF-OAuth-, Identitäts- und Quota-
Endpunkte zu; Inferenz, Zahlungen und Weiterleitungsziele sind ausgeschlossen.
Der Nutzer hat beide kostenlosen Testkonten persönlich auf HF freigegeben.

**Real lesend belegt:** zwei unterschiedliche HF-Identitäten; Fremdprofilzugriff
abgewiesen; tatsächliche Jobtoken über whoami dem richtigen Konto zugeordnet;
absichtlich vertauschter Jobtoken abgewiesen. Quota vor/nach unverändert: A
175,592746 von 300 Sekunden, B 300 von 300 Sekunden. Das sind zeitpunktbezogene
Providerangaben, keine garantierte künftige Kapazität. Die Jobreservierungen waren
lokale Simulationen. Null Generierungen, kein Nachweis tatsächlicher Einzelbelastung.
Prüffenster beendet, RAM-Zugänge verworfen. Neue echte Aufträge brauchen nach den
Moderations-/Modellabnahmen eine gesonderte Umfangsfreigabe und neue HF-Anmeldung.
[Bereinigter Bericht](audits/2026-10-28-hf-readonly.json).

Die öffentliche Wan-Quelle war RUNNING, API-kompatibel und auf derselben Source-SHA
fca7f5a33da3057bae497de5cd70f49ce75e6c02; kein kontrollierter Gewichts-/Modellvertrag
konfiguriert. [Read-only-Nachweis](audits/2026-10-28-wan-readiness.json). Eine SHA und
eine Modell-Selbstauskunft attestieren keine tatsächlich geladenen Gewichte.

### M02/M03: konkrete Formdiagnose und native Framewiederverwendung (9d53aeb)

Der ursprüngliche Eingabe-Tokenpräfix wird vor der Inferenz kopiert. Nur ein
unveränderter Präfix mit begrenzter einzeiliger Fortsetzung wird decodiert. Die
Diagnose speichert ausschließlich feste Formklassen, niemals Rohantworten.
Ein gezielter harmloser Lauf belegte `decorated_label` als Ursache einer
Formatablehnung. Das separate experimentelle Protokoll `labels-v2` akzeptiert nur
vollständige Enum-Wörter, passende einfache/doppelte Anführungszeichen oder genau
einen Satzpunkt/Ausrufezeichen. Kein Extrahieren aus Prosa/JSON, keine Substring-
Freigabe. JSON-Standard, Modell-Lock, Risikoschwellen und Freigabesperren bleiben.

Die vollständige sichere Folgediagnose war **nicht erfolgreich**: vier harmlose
Bildfälle nicht freigegeben, davon drei technische Zeitüberschreitungen; ein weiterer
kritischer Fall technisch fehlgeschlagen. Drei kritische Fälle zurückgehalten, aber
keine allgemeine Erkennungszusage. Alle Medien waren synthetisch und nicht intim.
Zeitmessungen unter paralleler Testlast sind keine isolierte Leistungsmessung.
[Formdiagnose](audits/2026-10-28-moderation-shape.json),
[Folgediagnose](audits/2026-10-28-moderation-labels-v2.json).

Byteidentische, vollständig in nativer Auflösung decodierte Frames teilen nur
innerhalb derselben Anfrage ein gültiges Urteil. Jeder unterschiedliche Frame wird
weiter geprüft. Das synthetische Standbildvideo hatte fünf vollständig geprüfte
Frames, davon einen einzigartigen; 9.873ms, weiterhin `review`. Das ist ausdrücklich
kein 80-/81-Frame-Wan-Benchmark. Ein Qualifikationsbericht muss nun mindestens 80
unterschiedliche native Frames pro Testvideo nachweisen. Dienst-Build und 19
technische Tests bestanden; keine qualification.json und keine Sicherheitsfreigabe.

### M05/M17/M25/M31/M34: Provider- und Quota-Grenzen (b4fb861)

Gespeicherter Host muss zur offiziellen Space-Metadatenauflösung passen, bevor
irgendein persönlicher Token dorthin geht. Source-/Runtime-/Modellrevision erneut
nach Upload vor dem GPU-POST sowie vor und nach Ergebnisabruf prüfen. Eine
Modelländerung bei laufendem Auftrag erhält dessen unklaren Status und Reservierung;
kein neuer Auftrag, keine ungeprüfte Veröffentlichung. Historische bereits fertig
gespeicherte Ergebnisse werden nicht nachträglich als neu geprüft ausgegeben.

Der erste neue Gesamtlauf deckte einen echten Plattformfehler auf: workerd lehnt
`redirect:error` ab. Die neue Quota-Härtung und bereits bestehende persönliche
Job-/Moderationspfade waren betroffen. Kompatible `manual`-Abrufe mit Nicht-2xx-
Ablehnung verhindern weiterhin automatisches Folgen. Der direkte workerd-Test
belegt funktionierende Quota-/Job-/Moderationsaufrufe und Abweisung von 307,
überlangen Bodies und fremder Jobidentität. OAuth-Grant-/Profilantworten sind
begrenzt und ohne automatische Weiterleitung. Der vollständige OAuth-/Device-
DO-Test besteht einschließlich Wiederherstellung nach Eviction. Externe Verträge
hier simuliert: kein GPU-Verbrauch oder realer Provider-Abrechnungsnachweis.

Quota-Antworten begrenzen/validieren und unnötige Billingfelder verwerfen;
Resetzeitpunkte normalisieren. Ein Kontingentreset löscht keine laufenden/unklaren
Job-Holds. Konservative vorhandene TTL bleibt bestehen. Tests prüfen auch
Modellwechsel während Upload, Modellwechsel nach Ergebniseingang, fremde Hosts,
malforme Uploadantworten und Null GPU-POSTs bei vorzeitigem Abbruch.

### M04/M09/M31: nachträgliche Sperren auch in klassischen Runden (2491d05)

Frisch generierte `/api/videos/`-Dateien werden nun wie Archiv-Replays vor
Punkte-/Ratebonus und periodisch alle zehn Sekunden erneut auf Sperren geprüft.
Statusausfall hält die Wertung zurück; ein gesperrtes Video verliert Prompt,
Stimmen und Rateabgaben ohne Bonus. Der letzte Clip kann die Partie ohne Punkte
beenden. Node und DO behandeln die Änderung; die DO-Regression prüft Ausfall,
Hibernation, Wiederkehr, Nullpunkte und Quota-Freigabe. Das löscht keine bestehenden
Archivdateien und widerruft keine bereits heruntergeladenen Bytes. Altarchivprüfung,
Einsprüche und bereits früher abgeschlossene Wertungen bleiben gesonderte Aufgaben.

### Teststand dieser Pakete

Quellstand **2491d05**: Root-Build/206 Unit-Tests und vollständige Chromium/WebKit-
Node/workerd-Matrix **Exit 0**, 97 PASS-Nachweise. Moderations-Build/19 technische
Tests bestanden; die semantische Diagnose scheitert weiterhin (Exit 2). Ein
Zwischenlauf scheiterte an macOS-Browserstartrechten, nicht an einem UI-Befund;
der autorisierte Folgelauf bestand. Kein Push, Deployment, produktiver Datenzugriff
oder Aufheben der Generierungssperre.
[Quellstände und Loghashes](audits/2026-10-29-regression-results.json).

### M31: ungültige HF-Auftragskennungen, 29.10. (50de998)

Eine erfolgreiche HTTP-POST-Antwort ohne brauchbare Event-ID beweist keinen
abgelehnten GPU-Auftrag. Typ/festes Format und maximal 120 Zeichen werden vor
Übernahme geprüft. Bei ungültiger Antwort bleibt der bereits dauerhaft gespeicherte
`submitting`-Auftrag ohne neue GPU-Anfrage erhalten. Sieben Fehlerformen prüfen
Zahl, Objekt, leeren/überlangen String, Pfad, Steuerzeichen und null; weder Fallback
noch Resume dürfen einen zweiten POST senden. Danach Build/207 Unit-Tests und
direkte workerd-Grenztests Exit 0. Die komplette Browsermatrix wurde für diesen
kleinen API-Guard nicht nochmals ausgeführt; ihr erfolgreicher Quellstand bleibt
2491d05. Keine zusätzlichen HF-/GPU-Aufträge oder Produktionsänderungen.


### 29.10.: DB-Zugang, tatsächliche Umbenennung, Moderations-Hintergrundschnittstelle

Der Nutzer hat den projektgebundenen vorhandenen Neon-Zugang und anschließend
explizit die Umbenennung des tatsächlichen Datenbanknamens beauftragt. `.clinerules`
erlaubt jetzt ausschließlich das bekannte Slop-Projekt über Neon-MCP. Per MCP zuerst
Branch/Datenbanken/Schema-Metadaten geprüft: production, neondb, sechs Tabellen,
keine weiteren DB-Verbindungen. Rename-API änderte den Namen auf Slop_Urself bei
unveränderter DB-ID 281758. Danach Cloudflare-DATABASE_URL-Secret und beide ignorierten
lokalen Konfigurationsdateien ohne Ausgabe der Werte umgestellt. MCP bestätigt
current_database()=Slop_Urself und sechs Tabellen. Homepage/Sitemap danach HTTP 200.
Kein neues Anwendungspaket deployed, keine Tabellen/Nutzerdatensätze verändert.
Der alte MCP-Blocker ist behoben; WAF-/Backup-/Restore-Abnahme dadurch nicht bewiesen.

Der Moderationsdienst bietet zusätzlich authentifizierte /jobs/evaluate und
/jobs/validate sowie Digest-gebundenes Polling. 202 und evaluationOnly erlauben keine
Veröffentlichung. Ein Compute-Slot bleibt auch bei nicht abbrechbarem Modelllauf
belegt; Upload maximal 25s, Hintergrundarbeit 5min. Höchstens vier kurzlebige
Ergebnisdatensätze, erneute Qualifikationsprüfung beim Abruf. Build/20 technische
Diensttests und Root-Build/207 Units bestanden. Noch keine Spielintegration oder
dauerhafte Recovery; RAM-Verlust liefert keine Freigabe. Semantische Abnahme und
bisherige 25s-Qualifikationsgrenze unverändert. Kein echter KI-Auftrag, keine
Behauptung einer produktiv verfügbaren Moderation.

Die aktuelle Sitemap wurde normal sowie mit Googlebot-User-Agent extern abgerufen:
HTTP 200, application/xml, keine Weiterleitung, XML-Namespace/loc korrekt. User-Agent-
Simulation ist kein Google-Servernachweis. Der vom Nutzer eingefügte Hinweis auf
fehlende Style-Informationen ist eine normale XML-Browserdarstellung. Ohne konkreten
GSC-Abrufbefund wird kein HTML-/Sitemap-Fix erfunden.


### 29.10.: zentrale Moderationsdurchsetzung und Hintergrundtransport

`security/moderation-jobs.ts` integriert den bestehenden Hintergrundvertrag in die
zentralen Bild-/Prompt- und Videoprüfpfade. Ein 202-Ticket erlaubt nur Polling auf
dem konfigurierten Ursprung mit gebundenem Digest. Fremde URLs, Redirects,
evaluationOnly, verlorene Tickets, widersprüchliche Pending-Antworten und überlange
Bodies werden abgewiesen; kein automatischer neuer POST nach unbekanntem Status.
Der Client bleibt auf maximal 30 Sekunden begrenzt, bis persistente Ticket-/Alarm-
Orchestrierung die seriellen Raum-/Serviceoperationen entlastet. Dauerhafte Recovery
ist noch nicht implementiert und wird nicht durch diese Transporteinbindung ersetzt.

Ein bisheriger zweiminütiger Freigabe-Cache konnte bei identischem Inhalt eine
zwischenzeitlich abgelaufene Qualifikation verdecken. Er ist entfernt. Nur parallel
laufende Prüfungen werden zusammengeführt, getrennt nach Credential-Hash. Eine neue
Regression prüft zuerst Freigabe und unmittelbar danach Qualifikationsausfall mit
identischem Bild/Prompt: der zweite Aufruf muss erneut prüfen und scheitern.

Zusätzliche Pipeline-Prüfungen beweisen null GPU-Folgeaufrufe bzw. Archivzugriffe
bei fehlender Qualifikation, block/review, evaluationOnly und unvollständigem
Prüfergebnis. Build/211 Unit-Tests und workerd-Grenztests Exit 0. Reine externe
Vertragsfixtures; kein Nachweis semantischer Moderationsqualität oder tatsächlicher
HF-Abrechnung. Keine erneute vollständige Browsermatrix und kein Deployment.
