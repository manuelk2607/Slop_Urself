# Slop Urself – Fortsetzungspunkt, 2. November 2026

## Auftrag / unveränderte Grenzen

Vier Pakete: Moderation, kontrollierter Wan-Producer, persönliche HF-Abrechnung,
vollständige reale Multiplayer-Partie. Branch `codex/audit-remediation`;
Commit/Push und sichere getestete Deployments autorisiert. Nur kostenlose
synthetische Moderationstests erlaubt; bezahlte OpenAI-Kontexttests abgelehnt.
Gemini laut Nutzer Free/ohne verknüpftes Abrechnungskonto, nicht per API verifiziert.
Keine Freigabe echter Spielerbilder an neue Moderationsdienste. Begrenzte Live-Freigabe vorhanden: genau zwei harmlose Videos ab5s, eines je
getrenntem HF-Konto, höchstens120 large-ZeroGPU-Sekunden je Konto/240 insgesamt,
ausschließlich Gratiskontingent, keine Wiederholung oder bezahlte Hardware. Noch
kein GPU-Auftrag gestartet; Inhaltsprüfung und konkrete Betreiberfreigabe fehlen. Keine Produktivdaten löschen.
34,2GB Download/Initialisierung ausschließlich im bestehenden kostenlosen HF-
ZeroGPU-Space ausdrücklich genehmigt; keine Gewichte auf dem Mac, kein bezahlter
Speicher/Hardware. Diese Vorbereitung ist inzwischen tatsächlich abgeschlossen.

## Erledigt / gemessen

- Kontrollierter offizieller Wan5B-Adapter samt persönlichem Identitätscheck,
  signiertem exaktem Auftrag, lokaler und dauerhafter CF-Einmal-Freigabe vor GPU,
  privaten kurzlebigen Videos und striktem eigenem50-Schritte-Profil implementiert.
  Keine stillen4-/8-Schritt-/Modellwechsel. Bestehende Spielkonfiguration unverändert.
- Native HF-Abhängigkeiten tatsächlich installiert, vollständiger offizieller
  Snapshot b8fff7315c768468a5333511427288870b2e9635 ausschließlich extern geladen:
 20Dateien/34.201.418.400Bytes, alle lokalen SHA256 auf dem Host geprüft,
  native Modellinitialisierung und SDK-Startup abgeschlossen. Das ist noch kein
  Inferenz-/Qualitäts-/Abrechnungsnachweis oder kryptografisches Laufzeitattest.
- Drei konkret gemessene Hostfehler behoben:HF injiziert hashlose pip-Argumente
  und Gradio-oauth/mcp-Extras; kompletter Hash-Lock läuft nun als pre-requirements,
  identische exakte Bootstrap-Pins folgen. Pydantic2.12.5 erfüllt die Extras.
  ZeroGPU benötigt Registrierung und den Gradio-launch-Startup-Hook:leerer
  Loopback-Handshake ohne Generation, dann schließen. API-SSR explizit aus,
  da dessen Node-Server zuvor7860 belegte; MCP/Browser-Verlauf ebenfalls aus.
- Vorbereitung hält die registrierte private GPU-Funktion von sämtlichen API-/
  Queuepfaden getrennt; zusätzliche Abweisung vor Aufruf. Tatsächliches HTTP200:
  modelLoaded=true, preparationOnly=true, generationAvailable=false. /config
  behauptet keine generierungsbereite Modellidentität. Generische Dateirouten,
  ungültige private Downloads und direkte call-API tatsächlich404. Kein Upload.
- Moderationsbackend:explizite Provider/Versionen, vollständiges natives Frame-
  Decoding, begrenzte parallele Batches, feste HTTPS-Endpunkte, strikte Antworten,
  SQLite-Anfragebudget und verschlüsselte Prüfjobs. Nicht qualifiziert, nicht als
  produktiver Spielerbilddienst freigegeben. Provider-Safety-Hold wird getrennt
  von Kategorienbewertung erfasst, nie als fachlicher Erfolgsnachweis.
- Neue4kostenlose synthetische Gemini-Prüfungen:harmloser Kontrollfall erlaubt,
  Grafikmissbrauch-Intent blockiert, Minderjährigen-/Override-Intent vom Provider
  zurückgehalten. Letztere2nicht semantisch klassifiziert. Frühere Messungen:
  Gemini20harmlose Fälle/NCII bestanden, drei81-Frame-Videos vollständig geprüft;
  OpenAI-Gratis-Screen übersah NCII. Kein Ersatz für repräsentative Qualifikation.
- CI repariert:FFmpeg/FFprobe im Sicherheitsjob explizit installieren. WebKit-
  Linux umging native Medienabfanglogik; vollständige Safari-nahe Matrix jetzt
  Standard-macos-15, strikte HTTP200-/CSP-Positiv-/Negativprüfung bleibt erhalten.
  Repo PUBLIC tatsächlich geprüft; Standardrunner laut GitHub kostenlos.
  PostgreSQL17-Integration bleibt auf Ubuntu, keine Produktiv-DB angefasst.

## Veröffentlichungen / Tests

- Codecommits45a167a,0fd8fbb,6deff11 auf origin/codex/audit-remediation gepusht.
  Veröffentlichter Anwendungscode:6deff11c5cf7f25bb8f15e2a1eed02aa80171b2a.
- GitHub41415239997 vollständig SUCCESS:safety-cpu, Chromium, WebKit/macOS,
  einschließlich isolierter PostgreSQL17-Prüfungen im Linux-Job. Link:
  https://github.com/manuelk2607/Slop_Urself/actions/runs/41415239997
- Lokal237App-Units,38Moderationstests,21Wan-CPU/HTTP-Tests, vier strikte CSP-
  Browser-/Node-/workerd-Ziele, echter leerer lokaler Gradio-Handshake, Builds,
  Typprüfung, YAML-/Diff-/Secretprüfung bestanden. Frühere volle lokale Matrix
  mit98Integrations-/Browser-Prüfschritten bleibt dokumentiert, nicht erneut behauptet.
- Cloudflare Worker9dd44862-e6cc-4117-af51-0fe330d9c616 auf
  https://slopurself.maki26.workers.dev veröffentlicht und extern nachgetestet:
  Releasekennung/Header, Startseite/Metadaten/CSP, robots/sitemap200 incl.Bot-UA,
  private APIs401, fremde Herkunft403, Producer-Claim503, KI-Sperre=true.
  Kein Schreib-/Inferenzaufruf. Bot-UA ist kein echter Google-Crawl-Nachweis.
  Vorversion6c6d1e83-10cf-41a5-b876-306245af4f52 wäre der Rollback-Punkt.
- Privater HF-Test-Space aktuell3172be7f814084160c62ee55cc6411466b1dda1d,
  neun Quelldateien unabhängig gegen Paket6deff11 gehasht, tatsächlich RUNNING,
  current/requested zero-a10g unverändert. Kein Storage-/Hardware-/Sichtbarkeits-
  Wechsel. Statvfs meldet Hostpool-Bytes, keinen eigens gebuchten Speicher.
- Dokumentationsabschluss ist ein eigener reiner Nachweis-Commit; kein weiterer
  Anwendungscode. Zusätzliche ungetrackte Workspace-Datei ist unverändert erhalten.

## Live-Validierung 2.11. – aktueller Fortsetzungspunkt

- Tatsächliche kostenlose Gemini-HTTP-Prüfung:38 Fälle,23/23 harmlose Bilder und
  Videos erlaubt,15/15 Risikoabsichten zurückgehalten,0 beobachtete Fehlfreigaben/
  Fehlalarme,0 verbleibende Transportfehler. Darunter3 echte synthetische5,06s-
  H264-Clips mit jeweils81/81 nativen unterschiedlichen Frames. Drei Risiko-
  Antworten sind nur provider_safety_hold, kein Kategoriennachweis. Daher keine
  allgemeine Qualifikation/qualification.json. Fingerprint675ec282faff6844dfc4472da2cde68a1f4651b64ec4bab2cc0985e08458a424.
  Ein durch künstliche Wartezeit im Test-Fetch ausgelöster Video-Timeout wurde
  gezielt nach Entfernung dieser Wartezeit nur für den betroffenen Clip wiederholt
  (2 Requests); die37 abgeschlossenen Fälle wurden nicht erneut abgefragt.
- Tatsächliche Negativprüfungen:ohne Berechtigung401, ungeprüftes /validate503,
  falscher Digest503, ungültiges Video503/kein Modellaufruf. Keine Schutzprüfung
  gelockert, keine fachliche Prüfung durch Keyword-Listen ersetzt.
- Zwei feste browser-/servernormalisierte synthetische Motive separat real
  geprüft:gelber Ball hüpft, roter Würfel dreht sich; jeweils exakter wirksamer
  Spielprompt, beide semantisch allow/clear. Diese Ergebnisse sind evaluationOnly,
  keine allgemeine Produktionsfreigabe. Beide tatsächlich dargestellten Motive
  warten jetzt auf die gesonderte manuelle Betreiberabnahme im Chat.
- Zwei echte Produktionsprofile LiveA_825b2353/LiveB_825b2353 vom Nutzer mit
  unterschiedlichen HF-Konten verbunden. Persönliche Restkontingente vor jedem
  GPU-Auftrag bisher300/300; RaumF4DD mit beiden Spielern, Reload und tatsächliche
  Offline-/Online-Wiederverbindung synchron erfolgreich. Keine Videorunde oder
  Abrechnung geprüft. Isolierte Browserverbindung anschließend beendet/geschlossen;
  Ursache nicht belegt. Keine Cookies/Tokens exportiert. Nicht erneut anmelden
  lassen, solange Producer und eng begrenzter Prüfpfad nicht fertig sind.
- Saubere öffentliche kostenlose Kopie Manuel2607/SlopUrself-Wan22-Validated vom
  Nutzer genehmigt und per HF-API erstellt (HTTP200, zero-a10g angefordert).
  Bestehender privater Space samt Historie bleibt unverändert privat. Kopie
  zunächst nur README/.gitattributes, keine Generierung, Gewichte oder App geladen.
- Native Ergänzung:öffentliche Kopie startet ausschließlich mit exakt zwei
  festgelegten unveränderlichen HF-IDs; echte whoami-Identität, keine Namenfreigabe.
  Fremdkonto sowie fehlende/ungültige Begrenzung scheitern geschlossen.23 CPU- und
  echte Gradio-HTTP-Tests bestanden; beide neuen TS-Werkzeuge strikt typgeprüft.
- Neue Werkzeuge:reproduzierbare reale Moderationsmessung samt begrenztem Retest
  und exaktem Testpaar; separater Whitelist-/Hash-/Parent-Commit-geprüfter öffentlicher
  Uploader. Alter privater Uploader und dessen Pausen-/Sichtbarkeitsregeln bleiben
  unverändert. Öffentliche Kopie bleibt preparationOnly, keine Owner-Inferenztokens.
  Commit e0f5ccf9d5398599a6607aa454447f8bcd367b35 auf
  origin/codex/audit-remediation gepusht, Remote-Hash unabhängig bestätigt.
- Öffentliche Kopie jetzt tatsächlich veröffentlicht:HF-Quelle/runtime beide
  5f2ee9d8e2aeea6a5f9b3dc1344159c6d8291763, RUNNING, current/requested zero-a10g.
  Alle9 öffentlichen Paketdateien unabhängig gehasht. Native Remote-Protokolle:
  20Dateien/34.201.418.400Bytes hashgeprüft, Modellinitialisierung/SDK-Startup
  bestanden, jeweils gpuCalls=0. Tatsächliches /healthz200:modelLoaded=true,
  preparationOnly=true,generationAvailable=false. /config meldet kein bereites
  slop_model, generische Dateiroute/ungültiges Privatvideo404. Bestehende private
  Kopie authentifiziert geprüft:weiterhin privat,Quelle3172be7 unverändert.
- Basisimage warnt über das ungenutzte datasets5.0.0 versus fsspec/HF-Hub-Pins.
  Native Initialisierung trotzdem erfolgreich; kein Beleg für funktionierende
  Inferenz. Kein kostenpflichtiger Speicher, keine Gewichte auf dem Mac.
- Anwendung auf Cloudflare unverändert; /api/config erneut200, KI blockiert,
  HF-Pflicht aktiv, kein Mock,0 KI-Runden. GitHub41456053185 zu e0f5ccf ist jetzt
  vollständig SUCCESS:safety-cpu, Chromium und natives WebKit/macOS. Zusätzliche
  Produktions-Gate-Vorprüfung im Uploader strikt typgeprüft; Nachweis-/Werkzeug-
  Commit3131acf ebenfalls gepusht. Keine neue CF-Anwendung veröffentlicht.

## Weiterhin offen / nächster konkreter Schritt

1. Die dargestellten zwei Motive manuell bestätigen lassen. Ohne diese Antwort
   keine konkrete Betreiberfreigabe behaupten oder Testkampagne aktivieren.
2. Native Veröffentlichung/Vorbereitung ist abgeschlossen (oben). Nicht erneut
   hochladen, Gewichte laden oder neue Anmeldungen anfordern. Nächster technischer
   Schritt ist der folgende streng begrenzte Spiel-/Moderations-Prüfpfad; der
   vorbereitete Producer bleibt bis zu dessen Abnahme in preparationOnly.
3. Eng begrenzten, persistenten Zwei-Fälle-Testpfad implementieren/prüfen, der
   genau genehmigte Bilder/Prompts/Konten und maximal einen Auftrag je Konto
   zulässt, ohne die globale KI-Sperre oder fachliche Moderation zu umgehen.
   Ausgabe vor Veröffentlichung vollständig moderieren; bei fehlender fachlicher
   Qualifikation zusätzlich konkrete Betreiberprüfung, keine pauschale Freigabe.
4. Erst wenn bereit, die beiden bestehenden Profile einmal neu verbinden und
   exakt die zwei genehmigten GPU-Aufträge im echten Spiel durchführen. Beide
   Kontingente unmittelbar vor/nach jedem Auftrag beobachten; aggregierte Quota
   ist kein jobgenauer Abrechnungsbeleg. Qualität/5s-Wiedergabe, gegenseitige Votes,
   Endwertung/Archiv prüfen. AI_GENERATION_RELEASE=blocked und allgemeine Upload-
   Sperren bleiben bis tatsächlicher Abnahme erhalten. Vollständige Moderations-
   Qualität/Gratis-Hosting/Datenschutz für beliebige Spielerbilder weiter offen.
5. Übrige P1 ausdrücklich offen:M04 Altarchiv/Einspruch/Betreiberabnahme,
   M06 sichere manuelle Bestandskontozuordnung, M09/M11 echte Wan-/Safari-Ausgabe,
   M18 vollständige Betroffenen-/HF-/DO-Löschung, M19 externe Speicherabnahme,
   RestM20 produktive Logeinstellungen/weitere Stufendiagnose. Lokale Wrangler-
   Redaktion=true/Invocation-Logs=false; Versions-API legt diese Flags nicht offen,
   daher keine unabhängige Produktionsbestätigung behaupten.
6. P2-Reste:M24/M26/M28/M44 UUID-/Migrations-/eingeschränkte-DB-Rolle/Querypläne/
   Restore, M31/M32 weitere Crashfenster, M43 Ereignisschemata, M45 Release-/Asset-
   Kompatibilität, M39 reale Geräte/Screenreader; M46–M54 optionale Erweiterungen.
   Original-Audits24.10. und docs/IMPLEMENTATION-2026-10-25.md nutzen; bereits
   erledigte Archiv-/Auth-/Votes-/Recovery-Arbeiten nicht doppelt bauen.

## Nachweise / Fortsetzung

docs/audits/2026-11-02-live-validation.json enthält die neuesten Live-Teilnachweise;
docs/audits/2026-11-02-preparation.json dokumentiert den vorherigen Vorbereitungsstand;
docs/audits/2026-11-01-managed-official.json und2026-11-01-release.json sind
historische Messstände. Private ignorierte Einzelberichte und Logs liegen in
.local/audit-tests (keine Tokens/Originalantworten). PROGRESS-Vorgänger:
docs/progress/2026-11-02-before-native-ready.md und2026-11-01-before-managed-official.md.
