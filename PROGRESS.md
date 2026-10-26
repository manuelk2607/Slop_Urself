# Audit-Umsetzung – fortgesetzt am 26. Oktober 2026

Aktiver Auftrag: Auditpunkte in getesteten Paketen umsetzen; Branch codex/audit-remediation.
Pakete: 1 Stimmen/Austritte; 2 Identität/Objektrechte/Requestgrenzen;
3 Moderationsgates/Medien/Provider; 4 Recovery/Betrieb; 5 UX/Performance/Abnahme.
Keine produktive Schemaänderung oder Veröffentlichung. MCP slop_urself fehlt;
deshalb Schemaarbeit offen. Kein validierter kostenloser Moderationsdienst vorhanden:
fehlende Prüfung muss geschlossen bleiben, niemals durch Allow-Platzhalter ersetzen.
## Aktueller Implementierungsstand

### Aktueller Fortsetzungspunkt (nach f37e0da, uncommittet)

- M36: gemeinsame echte Stufen Queue/Inferenz/Abfrage/Archiv statt Prozentwerten;
  Auftragsbeginn und Stufe im Raumsnapshot, CF persistiert Fortschritt. Reload
  übernimmt Uhrzeit/Job-ID; verspätete fremde Fortschritte ignoriert. Separater
  Zähler ohne Live-Region-Daueransagen. Chromium-Slow-Mock-Test bestanden.
- M20: Archivfehler unterscheiden Download, Ausgabemoderation, Inventar und
  Speicherung; Job/Release korreliert, keine Rohfehler/URLs/Prompts. Regression.
- Root-Build/181 Unit-Tests bestanden. Gesamtlauf stoppte an historischer Fixture:
  Archiv-/Quota-Tests verbanden mehrere Profile mit demselben HF-Konto, was M23
  jetzt korrekt sperrt. Fixtures auf separate IDs/Tokens/Kontingente umgestellt;
  schwaches drittes Konto und persönliche Reservierungen werden explizit geprüft.
- Gezielte Chromium/WebKit-Prüfung party/quota/extension/generation läuft in
  Session 90892, Log /tmp/slop-updated-hf-fixtures.log. Nach Bestehen vollständige
  Matrix neu starten; vorherige Läufe NICHT als Gesamterfolg werten.
- P0: Moderationsfreigabe benötigt jetzt den tatsächlichen gehashten, versions-
  gebundenen Bericht, ausreichende Fall-/Videodeckung und berechnete Fehlerraten/
  Latenz statt bloßer eingetragener SHA. Dienst-Build/10 technische Tests bestanden.
  Neu: src/evidence.ts, im Runtime-Hash enthalten. Kein qualifizierender Bericht
  erstellt, keine Freigabe; derzeitiger echter Benchmark weiterhin fehlgeschlagen.
- Nächster Schritt: gezielten Browserlauf abnehmen/reparieren, volle CI, Diensttests
  nach finalem kleinen Zeitgrenzen-Check erneut; dann aktuelle Pakete committen.
  Keine produktiven Änderungen, kein Push/Deployment. Sämtliche lokalen Commits erhalten.

### P0-Paket (26.10., nach bfd749e) – Implementierung getestet, Freigabe gesperrt

- Moderation prüft sämtliche Spuren, lehnt bislang unmoderierten Ton/
  Zusatzspuren ab; strikter Modell-JSON-/Scorevertrag; Abbruchsignal und erneute
  Qualifikationsprüfung nach Inferenz. FFmpeg-9-Kompatibilität via fps_mode.
- Echter lokaler CPU-Diagnoseversuch mit ausschließlich synthetischen Motiven:
  Node 26 brach nativ bei Kontextmodellinitialisierung ab (Exit 134); Node 24
  erreichte Modellinitialisierung nicht erfolgreich (Exit 1). Keine semantischen
  Fälle ausgewertet, keine Qualitätsfreigabe, keine GPU-Aufträge. Fehler wird
  gezielt diagnostiziert, keine blinden Wiederholungen. Evaluator jetzt beaufsichtigt
  nativen Kindprozess und protokolliert auch Abstürze als fehlgeschlagene Prüfung.
- Root: Jobtoken wird vor Inferenz gegen tatsächliche HF-whoami-ID des reservierten
  Spielers geprüft; Regression für unveränderte Metadaten bei falschem Token ergänzt.
- Wan: neue Parameterprüfung lehnt unbekannte Modell-/LoRA-Defaults, doppelte oder
  fehlende Eingaben ab. tools/ai-readiness.ts prüft nur öffentliche Metadaten/API und
  zählt aktive lokale Verbindungen; keinerlei GPU-/Schreibaufrufe.
- Ergebnis der echten, begrenzten CPU-Diagnose unter Node 24: beide Modelle mit
  separat geprüftem Cache initialisiert; 9 Fälle, 0 bestanden, 7 technische Ausfälle,
  2 harmlose Anfragen review. Keine Aussage zur Erkennung unzulässiger Inhalte.
  Evidenz: docs/audits/2026-10-26-moderation-diagnostic.json. Qualität ungeeignet/
  nicht freigegeben; keine illegalen Medien, keine GPU-Aufträge.
- Echter Wan-Endpunkt erreichbar/RUNNING und API kompatibel; keine freigegebene
  Modellkonfiguration. Lokal 0 aktive HF-Verbindungen; Produktiv-Vault und tatsäch-
  liche Abrechnung unverifiziert. Keine kostenpflichtigen Tests gestartet.
- Root-Build/170 Tests und Moderations-Build/7 technische Tests bestanden.
  Vollständige Chromium-/WebKit-/workerd-Matrix bestanden (Exit 0), danach kleine
  gebaute Bodybegrenzung der Identitätsantwort mit Unit-Tests erneut geprüft.
- Sicherheitsfreigabe weiterhin NICHT erteilt. Nächster Schritt: unabhängige P1-
  Pakete M19 Kapazität vor GPU-Start und M09 Wiedergabe/Enthaltung; M18/schema-
  bezogene Aufgaben bleiben wegen vorgeschriebenem, fehlendem slop_urself-MCP offen.

### P1-Paket M19 – lokal geprüft

- Nach d2a3a94: M19 reserviert max. 15 MiB pro Job vor quota/begin;
  Reservierungen gelten 30 Minuten, bleiben über Services-Neustart erhalten,
  werden idempotent freigegeben und bei FIFO/Upload anderer Räume abgezogen.
  Vorabprüfung löscht keine Dateien und kontaktiert keinen KI-Provider.
- M19: Root-Build/171 Unit-Tests bestanden. Zusätzlicher Test prüft parallele
  Raumreservierung, Wiederherstellung, Fremdraum-Abweisung und Ablauf. Aktuell
  persönliche HF-Browserstrecke mit simulierter S3-Vorabprüfung bestanden (Chromium).
- Danach M09: explizite, phasengebundene Enthaltung sowie begrenzte Betrachtungs-
  zeit/Erstellerbestätigung vor automatischer Endwertung; keine Schemaänderung.

### P1 M09/M20 und P2 M27 – lokal geprüft, Gesamtlauf noch wiederholen

- M09: explizite Enthaltung über bestehende ballot-/runde-/video-
  gebundene Abgabe (intern 0, nicht als Rating persistiert). Neue Gruppen-Videos
  warten nach schnellen Stimmen auf Erstellervorschau oder ausdrückliche Freigabe;
  nach höchstens 45 Sekunden kann fehlende Bestätigung die Runde nicht blockieren.
  Solo bleibt manuell. Medien-Played-Bereiche liefern nur ein UX-Signal, keinen
  kryptografischen Wiedergabenachweis. Preview-Ack ebenfalls phasengebunden.
- M09 Build/178 Unit-Tests bestanden. Neue Vierfach-Browserprüfung bestanden: frühe
  Stimmen, Reload, reduzierte Bewegung, Enthaltungen und Videoausfall. Danach
  komplette lokale Browser-/Cloudflare-Matrix deckte eine Revanche-Race auf:
  alter Bereitschaftsstatus blieb bis zum neuen Snapshot sichtbar. Korrigiert;
  anschließender isolierter Teilnehmer-/Revanchetest in allen vier Browser-/Server-
  kombinationen bestanden. Gesamtlauf erneut auszuführen, nicht als grün behaupten.
- M20: Wrangler entfernt Querywerte aus Observability; CF-Version-Binding und
  validierte Release-IDs in HTTP/AI-Diagnose. Keine produktive Cloudflare-Änderung.
- M27: Speicheranzeige bündelt gleichzeitige Listenabrufe und cached sie fünf
  Sekunden; jede physische App-Mutation invalidiert, Kapazität/FIFO bleiben frisch.
  Kein Reconcile aus veraltetem/fehlgeschlagenem Inventar; drei Regressionen.
- Keine Schemaänderung; Enthaltungen werden nicht als Null-Sterne-Stimmen in die
  DB geschrieben. Historische Enthaltungszählung/volle Betroffenenlöschung offen.
- Folgepaket M23: verifizierte HF-Subjekte vor Spielerbeitritt und Spielstart
  eindeutig verlangen. Zuschauer haben kein Stimmrecht und dürfen dieselbe
  Identität verwenden. Node prüft nach asynchroner Abnahme die unveränderte
  Spielerliste erneut. Alte Budgetreservierungen bleiben dedupliziert erhalten.
- M25: 90 statt 15 Sekunden Rückkehrfrist; explizites Verlassen bleibt sofort.
  DO-Regression prüft Rückkehr und exakte Ablaufgrenze mit neuer Trennung.
- P0-Dienst: unvollständige Uploads werden bei Timeout tatsächlich beendet und
  geben den Prüfplatz frei. Ungültiges UTF-8/Encoding gelangt nicht zur Inferenz.
  Dienst-Build/8 technische Tests bestanden; keine neue semantische Freigabe.
- M23 Chromium und WebKit: simulierte persönliche Konten mit sechs Videos plus
  Alias-Ablehnung und erlaubter Zuschauerrolle bestanden. Keine reale Abrechnung.
- Lesende HF-Verbindung authentifiziert kostenloses Konto, jedoch ohne read-billing;
  eigener alter Testspace darüber nicht abrufbar. Kein Kontingentnachweis/Deployment.
- Nächster Schritt: Root-Abnahme/Commit dieses Folgepakets, dann M36 Status nach
  Reload und volle lokale Matrix. P0 bleibt gesperrt; slop_urself-MCP weiterhin fehlt.

### Bereits abgeschlossene Pakete

- a4e896e: M08/M22 – Wertungskennung, Runde/Video prüfen; angenommene Stimmen bleiben bei Austritt erhalten.
- f4e28e0: M06/M07/M13 und Teile M25/M27/M30 – Eigentumsnachweis statt Namenslogin,
  dauerhafte HF-Zuordnung, scoped History/Videozugriffe und Delete/Restore-Rechte,
  Bodylimits, Statistik-Reads parallel und Node-Videos gestreamt. Build/153 Unit-Tests bestanden.
- Implementiert, externe Abnahme offen: M01–M03/M05/M10–M12/M14 – serverseitiger
  PNG/JPEG-Decode, versions-/digestgebundene Eingabe-/Ausgabegates, Provider-Pinning
  und Archiv-Retry ohne neuen GPU-Auftrag. Eigener CPU-Dienst vorbereitet, ungeprüft.
- Benutzerentscheidung: eigenen kostenlosen Moderationsdienst vorbereiten, anschließend
  Verfügbarkeit/Qualität prüfen. Keine manuelle Freigabelösung. Der Dienst bleibt bis
  dokumentierter Qualifikation geschlossen; keine realen Medien-/GPU-Tests durchgeführt.
- Abhängigkeiten: body-parser 2.4.0, Zod 4.6.7; jpeg-js für bounded Decode ergänzt.
- Aktuelle Abnahme: Root-Build/Typprüfungen und 168 Unit-Tests bestanden. Vollständiger
  isolierter Chromium-/WebKit-/workerd-Gesamtlauf mit Exitcode 0 bestanden; anschließend
  eng begrenzte Legacy-HF-Medienausnahme mit vier zusätzlichen Browserchecks geprüft.
  Produktionsabhängigkeiten in Root und CPU-Dienst: npm audit meldete jeweils 0 Befunde.
- Nächstes Paket implementiert: M04 Melden/Sperren mit unabhängiger Adminfreigabe und
  persistenten Sperren auf allen Archivdownloads; M15 CSP/Frame-/Berechtigungsheader;
  M13/M16 Byte-/Aktionsbudgets und Join-Timeout; M12 stabiler Archivschlüssel bei
  verlorener PUT-Antwort. Einschließlich Worker-Sperrtest auf GET/HEAD/Range/Download.
- CPU-Dienst: indirektes verwundbares sharp gezielt auf 0.35.5 aktualisiert,
  Transformers-Decode/Resize mit nativer Bibliothek geprüft. Service-Build und 5 Tests
  bestanden. Qualifikation hängt zusätzlich am tatsächlichen Code-/Dependency-Hash.
- Fortsetzung 26.10.: persistente Archivreservierungen (M19), erneuert durch Raum-
  Alarme, schützen aktive Wiedergaben über Services-Neustarts. Neue Archivpartien
  filtern gesperrte Clips (M04). Datenbank-/Raumlogs enthalten keine rohen Fehler-
  meldungen/Queries/Tokens mehr (M20 teilweise).
- Bedienungspaket umgesetzt: Kontraste (M21), reduzierte Bewegung samt manuellem
  Video-Retry (M38), gemeinsame Plätze (M40), Screen-Fokus (M37), stabile Position
  der Raumaktionen/dynamische Viewporthöhe (M39 teilweise), verständlicher Hinweis
  auf noch unbestätigte Profilidentität und Restore-Rechte (M06/M07 UX).
- Raumlayout oben verankert; Modalzentrierung erhalten. Geometrie-/A11y-Regressionen
  und realistische Range-Auslieferung der lokalen Safari-Archivfixture bestanden.
  CI nutzt temporäre, isolierte HF-/Moderations-/Archivablagen.
- Eigene Modellrevisionen/ONNX-Dateien per öffentlichem HF-Metadatenabruf bestätigt.
  Keine Modellgewichte geladen, keine semantische Klassifikationsqualität zugesichert.
- Nächster Schritt: qualifizierten Moderationsdienst und kontrollierten Wan-Stand
  real abnehmen, Bestandsidentität/individuelle HF-Abrechnung prüfen; anschließend
  verbleibende P1- und P2-Pakete laut docs/IMPLEMENTATION-2026-10-25.md umsetzen.
- Keine produktive Schemaänderung, kein Push oder Deployment.

## Vorheriger Auditstand

Historische Analyse vom 24.10.; kein erneuter Analyseauftrag. Aktueller Umsetzungsstand oben.

Ziel: Priorisierter Maßnahmenkatalog inklusive belegter HF/Wan-Sicherheitsanalyse.
Nur Analyse und Berichte; keine Implementierung, Deployments oder echten GPU-Jobs.

- Ausgangspunkt: f59a1a7; Arbeitsverzeichnis sauber vor Berichtserstellung.
- Geprüft: KI, OAuth/Vault/Quota, Worker/DO, Node, Spielzustände, SQL, UI, Archiv und Live-SEO.
- Belegt: Space ohne sichtbare Moderation; safe_mode nur GPU-Reserve; live fremder Modell-Merge;
  offene Profilanmeldung/globaler History-Zugriff; veraltete Stimmen akzeptiert; defektes PNG akzeptiert.
- Extern: robots/sitemap 200; aktive Worker-Version 2136ab45; WAF-API weiterhin ohne Leserecht.
- Verifikation: Build und 145 Unit-Tests mit Exitcode 0 bestanden; isolierter Chromium/WebKit-Lauf
  lieferte PASS-Ausgaben bis zu den abschließenden Worker-E2Es. Abschließender Exitcode nach
  Sitzungsverlust nicht abrufbar, daher keine uneingeschränkte lokale CI-Erfolgsaussage.
- Zusätzlich: Googles eigenes Prüftool rief robots.txt am 24.10. um 13:16:53 UTC mit 200 text/plain ab.
- Erstellt: docs/audits/2026-10-24-website.md (54 Maßnahmen) und
  docs/audits/2026-10-24-content-safety.md (Providerbelege, mehrstufige Moderation, Kosten/Grenzen).
- Abgeschlossen: 54 eindeutige Maßnahmen mit Priorität, Begründung, Aufwand und Komponenten;
  Roadmap, Quick Wins und Sicherheitskonzept. IDs, Prioritätsreihenfolge, lokale Links und
  Diff-Whitespace geprüft. Geändert wurden ausschließlich Berichts-/Fortschrittsdateien.
- Nächster Schritt: Nutzer entscheidet über Umsetzung; nichts committed, gepusht oder deployed.
- Offen: Reale HF-Abrechnung/Qualität, produktive DB/ACL/Backups und vollständige WAF-Einsicht
  sind explizite Auditgrenzen. Keine Live-Generierung oder DB-Inspektion durchgeführt.
