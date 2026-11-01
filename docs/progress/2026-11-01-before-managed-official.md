# Slop Urself – Fortsetzungspunkt, 1. November 2026

## Aktives Vier-Dienste-Paket (Fortsetzung 31.10.–01.11.)

- Auftrag: konkrete Moderationsalternative, offizieller Wan-Endpunkt, begrenzte
  Zwei-Konten-GPU-Prüfung vorbereiten, vollständige simulierte Partie; danach
  Commit/Push und sichere Komponenten deployen. Letzter Commit43b6619; lokale
  Änderungen erhalten. Produktion weiterhin e66410fd, echte KI blockiert.
- Nutzer erlaubt **nur kostenlose** OpenAI-Moderationsprüfungen mit synthetischen
  Bildern/Prompts. Kostenpflichtige Kontextprüfung ausdrücklich NICHT freigegeben.
  OPENAI_MODERATION_API_KEY liegt nur in ignorierter .env.local. Keine Schlüssel
  ausgeben/übertragen. Zusätzlich kostenlose Gemini-Kontextprüfung mit synthetischen
  Medien erlaubt; Schlüssel aus Google-AI-Studio-Projekt ohne Abrechnungskonto
  als GEMINI_MODERATION_API_KEY erbeten. Keine Freigabe echter Spielerbilder an
  diese Dienste. Kein GPU-Auftrag freigegeben oder gestartet.
- **Tatsächlicher Gratis-Test abgeschlossen:** 24 API-Aufrufe am31.10.,20/20
  harmlose Prompts akzeptiert;3/4 abstrakte Risikoprompts zurückgehalten. NCII-
  Anfrage übersehen. Kein Wiederholen derselben Stichprobe. Privater Nachweis
  `.local/audit-tests/managed-free-755f8db2-0070-4ec0-9419-0f61989dccb8.json`.
  Dieser Befund qualifiziert weder Bildalter/Einwilligung noch Videoinhalte.
- Implementiert (noch uncommittet): verwalteter Moderationsadapter mit festen
  Modellen/URLs, strenger Antwortprüfung, Abbruch/Timeout, dekodierten PNGs,
  getrenntem Screening ohne Veröffentlichungsfreigabe, SQLite-Anfragebudget
  gegen Neustart-Resets. Vor Geminiergänzung Build/34 technische Tests bestanden.
  Gratis-Gemini-Kontextadapter sowie begrenzte Prüfung ALLER nativen Videoframes
  in Batches vorbereitet; neue Tests/Build noch abschließen. Keine Qualifikation
  geschrieben, keine kostenpflichtigen Aufrufe, keine Dienstbereitstellung.
- Offizieller Wan5B statt lizenzunklarem Merge vorbereitet:20 Artefakt-Pins,
  Revision b8fff7315c768468a5333511427288870b2e9635, Apache2.0-Metadaten,
  34.201.418.400Bytes,50Schritte/121Frames/24fps/large/max120GPU-Sekunden.
  Small configs geladen/gehasht, große Gewichte nur HF-LFS-Hashes, kein Download.
  official.py und einmaliger signierter Jobvertrag in jobs.py angelegt. Nicht
  als vorhandene 4-/8-Schritt-Rezeptur oder erwiesene120s-Laufzeit ausgeben.
- **Nächster Schritt:** Gemini-/Medien-/Budgettests abschließen, Wan-Adapter und
  dessen CPU-/Auth-/Replaytests fertigstellen; dann App-Vertrag gezielt anbinden.
  Fehlende Gemini-Konfiguration präzise anfordern, währenddessen unabhängige
  Arbeit fortführen. Keine alte HF-Anmeldung/Lobby wiederholen; reale Konten-
  und Lobbyprüfung vom30.10. ist erledigt. GPU-Freigabe erst mit ausführbarem
  begrenztem Plan und nach ausreichender Sicherheitsqualifikation anfordern.

## Auftrag und Grenzen

Nutzer autorisiert Commit/Push auf origin/codex/audit-remediation und Cloudflare-
Deployment nach bestandenen Tests. Echte KI bleibt bis zu nachgewiesener Moderations-,
Wan- und Abrechnungsabnahme gesperrt. GPU-Aufträge brauchen separate Umfangs-/Kosten-
freigabe. Keine destruktiven Produktivdatenänderungen. Repository ausschließlich
`/Users/manuelkienmoser/Documents/4 Studium/Sonstiges/SlopUrself`.

## Implementiert und erhalten

- **Vier-Punkte-Paket 30.10., Commit59588a7 auf origin/codex/audit-remediation:**
  Moderationsauswertung trennt technische Ausfälle, semantische FP/FN, fehlende
  Labels und Unsicherheit kleiner Stichproben. Dienst-Build/27 Tests bestanden.
  Bestehende labels-v2-Messung: 8 beschriftet, 4 technische Ausfälle, FP1/1 harmlose
  semantische Fälle, FN0/3 abstrakte Risikoanfragen (Wilson95-Obergrenze56,15%).
  KEINE repräsentative Qualifikation; keine erneute Inferenz auf dem gescheiterten Modell.
  Wan-Kern mit 22 SHA256-/Größen-Pins, festem Rezept, lokalen Safetensors und
  Hash-Lock der Linux/Python3.12-Abhängigkeiten implementiert. Sechs CPU-Tests,
  synthetischer Encoder81Frames/5,0625s/H.264/yuv420p sowie Wiedergabe/Seek/Range
  in Chromium und WebKit bestanden; kein Wan-Modell geladen, keine GPU-Aufträge.
  Modellartefakte68.788.615.789Bytes; Modellkarte nennt Lizenz/Herkunft nur als
  Platzhalter. Native Kompatibilität, gratis Hosting und Endpoint-Adapter bleiben offen.
- Produktionsversuch mit zwei neuen isolierten geschützten Profilen: Registrierung
  und Refresh200, Benutzer bestätigt beide HF-Gerätefreigaben. Übernahme im Spiel
  jedoch503/generische Meldung; keine akzeptierte Verbindung/Quota-Messung und
  keine Lobby-Partie. Test nach20min beendet, eigene Grants getrennt, keine Profile
  gelöscht. Vorversuch erzeugte zwei weitere Testprofile, ebenfalls ohne GPU.
  Private Berichte .local/production-party-{edfd5332,79a806ea}*.json; erster
  ungültiger Namensversuch9b43e7ca wurde mit422 abgewiesen, ohne Kontoanlage.
  Keine Ursache aus allgemeinem503 ableiten. Live-Tail45s ergab keine verwertbaren
  passenden Ereignisse. Nach Benutzer-Anmeldung im IAB-Cloudflare-Dashboard wurden
  gezielt35 Meldungen `[HF] OAuth callback failed quota_unavailable` im letzten
  Stundenfenster gelesen (u.a.10:46–10:48 MEZ). Keine Rohlogs/Secrets gespeichert,
  keine Einstellungen geändert. Identitätsprüfungen liegen vor der Kontingentprüfung;
  anschließende lesende Reproduktion mit dem lokalen Betreiber-PAT liefert mit200
  300/300 und8Runs, aber `runs.resetsAt:null`; derselbe echte Body wurde vom bisherigen
  fetchGpuQuota abgewiesen. Nach Korrektur wird er akzeptiert, ohne Reset zu erfinden.
  Nachgewiesener Schemafehler behoben: nullable Run-Reset wie unbekannten Reset
  behandeln; ungültige andere Typen bleiben verboten. Neuer Unitfall und workerd-
  OAuth-/Kontingenttest nutzen den realen Feldaufbau. Dies ist KEIN Abrechnungsnachweis
  und für sich allein kein Nachweis einer erfolgreichen Produktionsverbindung.
  Diese ist anschließend im separaten Zwei-Konten-Test bestätigt worden (siehe unten).
- Korrektur des nachgewiesenen Diagnoseverlusts: HF-Fehlercodes gehen jetzt durch
  Services-DO/Worker bis zum HTTP-Client, fixe sichere Texte/Logging statt Provider-
  Meldungen; Identitäts-Transportfehler sind klassifiziert. Neue Units und workerd-
  Regression prüfen Quota-Ausfall, Wiederanlauf und denselben versiegelten Einmalgrant.
  Build/230 Units und98PASS komplett bestanden, Session67400 Exit0. Log
  `.local/audit-tests/ci-2026-10-30-four-gates-final.log`, SHA256
  0d958ce3e44c3ed1f8604c55005bafdf6c0cd034087c5fe853c6467bda8edf19.
  **Nach nullable-Reset-Fix Vollmatrix vollständig bestanden, Session51879 Exit0**,
  Build/231Units und98PASS, Log `.local/audit-tests/ci-2026-10-30-quota-null-final.log`,
  SHA256620da86c36ae3a03ac089850f8d9afd40333d463d88d04a5765541f2b61df063.
  Keine laufenden Tests; geprüften Anwendungscode nicht erneut komplett testen.
  Vorlauf scheiterte ausschließlich am fehlenden PLAYWRIGHT_BROWSERS_PATH, zählt
  nicht als Gesamterfolg. Paket gepusht (Remote59588a7010dafedb283bcf27de1223578d737df8
  verifiziert) und veröffentlicht: **e66410fd-369a-4ffa-bbab-8c1f5bbb78bb**.
  Build/Deployment/Release-Smoke erfolgreich; API/Header-UUID stimmen,
  Cloudflare-Bindung blocked+Versionsmetadaten geprüft, öffentliche Seiten200,
  private anonyme APIs401, fremde Origin403. Echte KI weiterhin gesperrt.
  Nach behobenem Parser **reale Zwei-Konten-Lobby-Prüfung abgeschlossen, Exit0**.
  Bericht `.local/production-party-51fc1088-fd80-456b-8721-4a79669b0de3.json`:
  verschiedene HF-Konten serverseitig akzeptiert, persönliche Kontingente vor/nach
  jeweils300/300, Lobby synchron, Reload/Verbindungsabbruch wiederhergestellt,
  Hostberechtigung und serverseitige Upload-/Startsperre bestanden, Mobile375px,
  keine JS-Fehler. Beide eigenen HF-Verbindungen getrennt; Testprofile erhalten.
  Null GPU-Aufträge, keine vollständige Videorunde und kein Belastungsnachweis.
  Session17069 beendet, keine neuen Gerätefreigaben ausstehend.
- **Weiteres Moderationspaket 30.10.:** Aktionsdaten werden JSON-treu ohne rohe
  Chat-/Bild-Begrenzer serialisiert; neuer Code ist Teil des Laufzeitfingerprints.
  Build/29 technische Tests bestanden. Separat versioniertes, nur explizit wählbares
  Rollenexperiment roles-v1 auf einem harmlosen synthetischen Ballbild geprüft:
  review/context_format nach15.638ms, keine semantische Entscheidung. Diagnose
  fehlgeschlagen; kein erfolgreicher Risikotreffer, keine Qualitätsfreigabe,
  keine Lockerung der Auswertung und kein Standardmodellwechsel. Bericht
  `.local/audit-tests/moderation-roles-motion-2026-10-30.json`. Nicht unverändert
  wiederholen. GitHub-CI prüft künftig Dienst-Build/technische Tests sowie den
  Wan-CPU-Vertrag separat ohne Modelle/GPU. Remoteausführung noch unbestätigt.

- Aktuelles geprüftes Paket 30.10.: Gemeinschaftsbilder in Cloudflare
  ebenfalls privat/dauerhaft prüfen, Start bis Freigabe sperren, Besitzer/Phase/
  Variante vor Veröffentlichung erneut prüfen. Neuerstellung vollendet auch die
  Bereinigung nach bereits persistierter Freigabe. Node nutzt private Dateien und
  dieselben Tickets mit begrenzten Retries, Abbruchschutz während des Speicherns
  und reinen Bereinigungs-Retries nach erfolgreicher Prüfung. Node-Spielräume
  bleiben RAM-basiert; Neustart verwirft verwaiste Prüfungen sicher statt einen
  unbekannten Spiel-/GPU-Auftrag wiederherzustellen. Port erst binden, danach
  Orphan-Bereinigung: ein zweiter Prozess auf belegtem Port darf nichts löschen.
- Blockierte KI wird in Konfiguration/Lobby explizit mit null freigegebenen
  Runden angezeigt, Budget-Mutationen vor externer Arbeit abgewiesen. Archivmodus
  bleibt verfügbar. Regressionen für Gemeinschaftsbild-Recovery, Node-Tickets,
  Speicherrennen, zweiten Serverstart und blockierte Service-Budgets ergänzt.
- Vollständige Matrix abgeschlossen, Session69342 **Exit0**: Build/227 Units und
  98 PASS-Prüfschritte (Chromium/WebKit, Node/workerd, Auth/OAuth, Moderation,
  Quota, zehn Spieler/81 Stimmen, Archiv/Varianten/Mobile/A11y). Externe Dienste
  simuliert, null echte GPU-Aufträge. Log
  `.local/audit-tests/ci-2026-10-30-inputs-validated.log`, SHA256
  `64dc1eeb2d2c26ebfcad0e3601a229bcdb7f2749398db26483c5ad224d804dde`.
  Moderationsdienst Build/25 technische Tests bestanden, keine semantische Abnahme.
  Zwei abgebrochene Teilläufe zählen nicht. Wrangler-Dry-Run und separater
  Typcheck des Produktions-Smoke-Tools bestanden; finale Diffprüfung sauber.

- Neues Entwicklungspaket 30.10.: persistente Eingabemoderation für Cloudflare-Spielzüge.
  Private Bildchunks mit Intent vor erstem Chunk, sechsminütiger Retention und
  Alarm vor Speicherung. Room-Recreation übernimmt Ticket und Eingabe; Statusabfrage
  außerhalb serieller Raumqueue. Vor Quota-Beginn erneut Profilinhaber/Sitzung prüfen.
  Provider-Submission-Checkpoint ersetzt anschließend die private Eingabe;
  Austritt, Ablauf, unvollständige Speicherung und blockierte Freigabe bereinigen.
  Verspätete Antworten dürfen weder Eingabe neu speichern noch Quota/GPU starten.
  Keine private Bild-URL/Prompts/Tickets in Snapshots. Neue Stufe „Bild und Prompt
  werden geprüft“, Wiederverbindungsfrist unverändert.
- Lokaler Live-Testbericht unterscheidet jetzt aggregierte Kontingentdifferenz
  ausdrücklich von jobgenauer Abrechnung (billingVerified=false). Keine Live-Jobs
  oder erneuten HF-Anmeldungen in diesem Paket. Keine neuen Modell-/GPU-Downloads.
- Build/222 Units bestanden; 35 gezielte Speicher-/Worker-Tests einschließlich
  DO-Neuerstellung mit persistiertem Zustand. Workerd-Grenzen und Worker/DO-
  Archiv-/Alarm-Integration Exit0, externe Dienste simuliert. Keine neue vollständige
  Browsermatrix damals für dieses Paket; inzwischen durch den Gesamtlauf oben abgedeckt.
  Live-One-Shot-Schutz und Generation-View-Tests ebenfalls bestanden (2/2).
  Commit f814ecc auf origin/codex/audit-remediation gepusht, Remote-SHA abgeglichen.
  Historischer Nachweis: docs/audits/2026-10-30-input-recovery.json. Dieses Paket
  ist jetzt im aktuellen Release 2ff31de enthalten; keine erneute Implementierung nötig.

- Branch codex/audit-remediation; alle früheren Commits erhalten.
- 138068a: verschlüsselte SQLite-Moderationsjobs, Lease/TTL/Recovery/Lost-ACK-Lookup
  im separaten Dienst; `/api/release` für Node/Worker.
- 1f2f4c8: technische Format-/Schema-Holds zählen nicht als semantische Testtreffer.
- f34d6a3: Services-DO persistiert Ausgabe-Moderationsticket und Intent vor POST;
  nach Eviction nur derselbe Job/Lookup, Pending kehrt sofort zurück. Vorhandene
  Room-Archiv-Retries/Alarme treiben weitere Prüfungen. Keine HF-Wiederholung.
  Journal: nur Digest/Ticket/Frist, keine Inhalte/Tokens/Allow-Caches, max.64, TTL6min.
- f6321f5: vollständiger Testnachweis und kompakter Fortschrittsstand committed und
  gepusht. Remote origin/codex/audit-remediation wurde per ls-remote verifiziert.
- Wrangler erzwingt **AI_GENERATION_RELEASE=blocked**. Auch vollständig gesetzte
  Moderationswerte heben die zentrale Sperre echter Ein-/Ausgaben nicht auf.
- tools/release-smoke.mts prüft Release, Header/SEO, anonyme APIs und fremde Origin;
  keine Benutzer-/Raum-/GPU-/Datenbank-Schreibaufrufe. Separat typgeprüft.
- Zehn-Spieler-Test: reduced motion und explizite Vorschau nach 9/9 Stimmen;
  veraltete Testannahme korrigiert, Produktregel unverändert.

## Tests und abgeschlossene Veröffentlichung

- Root-Build, gezielte AI-/Moderationschecks 23/23 bestanden. Moderationsdienst
  erneut gebaut, 25/25 technische Tests. KEINE semantische Qualifikation.
- npm audit --omit=dev: null Befunde. Kein eigener Lint-Schritt vorhanden;
  strikte Typchecks und git diff --check, keinen Lint-Lauf behaupten.
- Voriger **Gesamtlauf abgeschlossen, Exit0**, geprüfter Code f34d6a3. Log
  `.local/audit-tests/ci-2026-10-29-release-validated.log`: 217 Units und 97 PASS-
  Nachweise, komplette Chromium/WebKit/Node/workerd-Matrix. Zehn Spieler/81 Stimmen,
  Wiederverbindung, OAuth, Quota, Archive, Sicherheit, Mobile und A11y enthalten.
  SHA256: 4874e4f3231566d94256e0ee8522e4f65afaaa76aab9dc741e67c9eaa4e8895e.
  Vorheriger Lauf stoppte am veralteten Test und zählt nicht als Gesamterfolg.
- Wrangler deploy --dry-run erfolgreich: getestetes Paket mit Versionsmetadaten
  und AI_GENERATION_RELEASE=blocked. Finaler Diff/Secretmuster-Scan ohne Befund;
  keine .env/.dev.vars/SQLite-Dateien im Git-Index.
- Runtime: Node24.22.1 aus
  `/Users/manuelkienmoser/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`,
  ffmpeg /opt/homebrew/bin; PLAYWRIGHT_BROWSERS_PATH=$PWD/.local/playwright.

## Produktion und externe Nachweise

- **Aktuell veröffentlicht:** Worker **e66410fd-369a-4ffa-bbab-8c1f5bbb78bb**,
  geprüfter Commit **59588a7010dafedb283bcf27de1223578d737df8**, Push auf
  origin/codex/audit-remediation per ls-remote verifiziert. Deployment über bestehenden
  Wrangler-Wrapper mit erneutem Build erfolgreich; keine geänderten statischen Assets.
  URL https://slopurself.maki26.workers.dev . Voriger ebenfalls gesperrter Worker
  34a7a347-aa2e-46f5-a71b-39a120e74055 bleibt der Rollback-Ausgangspunkt.
- Produktiv verifiziert: /api/release und X-Slop-Release stimmen mit UUID überein;
  aktive Cloudflare-Bindung AI_GENERATION_RELEASE=blocked und Versionsbindung per
  versions view bestätigt; config zeigt generationBlocked=true und null Runden.
  Startseite/robots/sitemap/
  config200, korrekte MIME-Typen und gültiges XML, CSP/noindex/no-store passend;
  anonyme Session/Statistik/Bild/WS-Zugriffe401, fremde Registrierung403.
  Authentifizierungsbildschirm bei 320/375px in Chromium/WebKit sichtbar, kein Overflow
  oder JS-Fehler. Dieser anonyme Smoke-Test erstellte keine Benutzer/Räume/GPU-Jobs.
  Der nachfolgende angemeldete Zwei-Konten-Test bestand Anmeldung, Lobby, Reload,
  Wiederverbindung, Hostrechte und KI-Sperren (siehe 51fc-Bericht oben). Eine
  vollständige generierte Produktionspartie und echte Abrechnung bleiben unbestätigt.
  Nachweis: docs/audits/2026-10-30-shared-node-release.json. Keine laufenden Tests
  oder Deployments; lokale Prozesskennung aus dem abgeschlossenen Lauf nicht wiederverwenden.
- Erforderliche Cloudflare-Secretnamen vorhanden, einschließlich HF_OAUTH_CLIENT_ID;
  kein dedizierter Vault-Key (getrennter HKDF-Pfad mit AUTH-Schlüssel getestet),
  keine Moderations-Secrets. Keine Secretwerte ausgegeben oder rotiert.
- Neon-MCP funktioniert. Nur Projekt autumn-leaf-19858358, Branch
  br-soft-math-b1efy5s0, DB Slop_Urself. Schema lesend geprüft: sechs öffentliche
  Tabellen/14Indizes, alle benötigten Spalten. Owner mit CREATE, M26-Rest offen.
  Tabellen16–48kB: kein Nachweis für Indexengpass. Snapshot-Liste/Zeitplan leer;
  kein Restore-/PITR-Nachweis. Keine Schema-/Datenänderung in diesem Release.
- S3-Archiv read-only erreichbar: vier Objekte/2.806.873Bytes, keine Objektänderung.
- robots/sitemap zuvor200 mit korrekten MIME-Typen/XML. Keine SEO-Routingänderung.
  Googlebot-Kennung beweist keinen echten Google-Crawl. WAF/Logretention ungeprüft.

## Offene Maßnahmen nach Priorität

1. P0: Moderationskandidat/Gratis-Hosting qualifizieren. NSFW/SmolVLM bisher bei
   harmlosen Fällen/Format/Latenz gescheitert. Keine identischen Diagnoserunden,
   keine erfundene qualification.json; Korpus-/Fach-/Lizenzabnahme fehlt.
2. P0: Eingabe-/Ausgabetickets, Gemeinschaftsbild und Node-Prüfaufträge sind
   implementiert und im Cloudflare-Release enthalten. Abnahme mit qualifiziertem
   Dienst weiterhin offen. SQLite-Volume
   beim Hoster prüfen: /tmp überlebt keinen garantierten Space-Rebuild.
3. P0: eigener privater Wan-Prototyp existiert, wurde lesend bestätigt: PAUSED,
   SHA ed1bb1cacd00f89c789b1d8d13657d71d49ad4a6. Fester MotionBoost-Merge, aber
   mutable spaces-Installation/AOTI-Quellen und fehlendes slop_model: keine
   Laufzeitfreigabe. Nicht gestartet/geändert. Details wan-service/PROGRESS.md.
4. P0: echte HF-Abrechnung fehlt. Zwei Konten am28.10. lesend isoliert geprüft;
   am30.10. zusätzlich offizielle Anmeldung/persönliche Kontingente und reale
   Zwei-Spieler-Lobby bestätigt. Fremde Jobidentität abgewiesen, Budgets unverändert.
   Eigene Prüfverbindungen danach getrennt.
   Neue offizielle OAuth-Anmeldung erst für freigegebenen GPU-Test, keine Tokens
   im Chat/Repo/Log. Erfolgreiche Authentifizierung ist kein Belastungsnachweis.
5. P1: M04 Altarchiv/Einspruch, M06 sichere Bestandsübernahme, M09/M11 echte Safari-/
   Wan-Ausgabe, M18 vollständige Betroffenen-/HF-/DO-Löschung, M19/M20 externer
   Speicher/Betriebslogs. Vorhandene ACLs/Bans/Ballots/Fokus/Kontraste nicht neu bauen.
6. P2: M24/M26/M28/M44 UUIDs, Migrationen/eingeschränkte Rolle, Querypläne/Restore;
   M31/M32 weitere Crashfenster, M43 Ereignisschemata, M45 Release-/Assetkompatibilität,
   M39 Realgeräte/Screenreader. M46–M54 optional nach Schutzabhängigkeiten.

## Nächster konkreter Schritt

1. Moderationsalternative/Hosting qualifizieren und kontrollierten Wan-Produzenten
   fertigstellen. Negative Diagnosen nicht einfach wiederholen oder Gates lockern.
2. Danach neue persönliche HF-Anmeldungen über den sicheren OAuth-Prüfweg und
   gesondert genehmigten Zwei-Konten-GPU-/Abrechnungstest vorbereiten.
3. Unabhängige P1-Reste laut obiger Liste bearbeiten; für DB-Arbeit ausschließlich
   vorhandenen Neon-MCP nutzen, keine unbekannten Backups/Restore-Erfolge behaupten.
4. Reine Nachweisdokumentation benötigt kein erneutes Deployment. Bei späteren Änderungen kann die oben
   geprüfte Worker-UUID als Ausgangspunkt dienen; nicht auf alte Worker ohne
   KI-Sperre zurückrollen. Echte Generierung bleibt gesperrt.

## Referenzen

Details: docs/IMPLEMENTATION-2026-10-25.md und beide Audits vom24.10.
Aktueller gefilterter Nachweis: docs/audits/2026-10-30-four-gates-validation.json.
Vollständige ältere Checkpoints: docs/progress/2026-10-29-before-release.md.
Alte dort vermerkte Blocker nicht ungeprüft erneut übernehmen.
