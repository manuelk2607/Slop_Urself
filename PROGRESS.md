# Audit-Umsetzung – Stand 27. Oktober 2026

## Auftrag und Grenzen

Alle offenen Maßnahmen aus `docs/IMPLEMENTATION-2026-10-25.md` und den beiden
Audits vom 24.10. in getesteten Paketen umsetzen. Branch: `codex/audit-remediation`.
Keine erneute Gesamtauditphase. Bestehende Arbeit erhalten. Kein Push/Deployment
in diesem Auftrag. Echte KI bleibt bis belastbarer Moderation, Modellkontrolle
und individueller HF-Abnahme gesperrt. Keine bezahlten Aufträge autorisiert.

## Aktueller Fortsetzungspunkt

- Neu: versioniertes Diagnoseprotokoll `labels-v1`, Standard/Lock unverändert.
  Dienst-Build/15 technische Tests bestanden. Echter CPU-Lauf **86464 beendet,
  Exit 2**: alle acht Fälle ungültiges Format (vier harmlose Fehlklassifikationen),
  Fünf-Frame-Video scheitert nach 27.764ms. Keine semantische Sicherheitsfreigabe.
  Bericht `docs/audits/2026-10-27-moderation-labels-diagnostic.json`.
- In Arbeit M04: Sperrstatus laufender Archivclips vor Wertung/Ratebonus und per
  10s-Check erneut prüfen. Gesperrte Clips ohne Punkte überspringen; Statusausfall
  hält die Wertung zurück. Gemeinsame Regel für Node/DO, Tests für Hibernation,
  Statusausfall und veraltete asynchrone Ergebnisse ergänzt. Noch nicht abgenommen.
- Aktueller Root-Build+Units: **38019**; Logs
  `/tmp/slop-build-ban-2026-10-27.log` und `/tmp/slop-unit-ban-2026-10-27.log`.
  Erster Build meldete fehlende neue FailureStage; korrigiert, Folgeprüfung läuft.
- Keine Modelltests oder Testwebserver mehr aktiv. Kein Push/Deployment.

## Gesicherte Pakete (Auswahl)

- a4e896e/f4e28e0: Phasenbindung, angenommene Stimmen bei Austritt, Identitätsbeweis,
  geschützte Archiv-/Statistikrechte und Eigentümer-/Löschprüfungen.
- 289846e/b8e2dc9/a1e6d23: fail-closed Moderation, Decoder, Provider-Pinning,
  Meldung/Sperren, CSP, Request-/Bytegrenzen, sichere Logs, aktive Archivleases.
- d2a3a94: echte persönliche HF-whoami-Prüfung vor Inferenz, Wan-Parametervertrag,
  strikte Score-/JSON-Verträge, vollständiger Frame-/Spur-/Abbruchvertrag.
- d3eca91: 15-MiB-Kapazitätsreservierung vor persönlichem GPU-Budgetbeginn.
- b49f5da/f37e0da: Vorschau/Enthaltung, Revanche-Race, Releasekorrelation,
  Inventar-Cache, eindeutige HF-Spieler, 90s-Wiederkehr, Upload-Timeout-Abbruch.
- eb72950: Freigabe benötigt echten gehashten Messbericht mit nachgerechneten
  Ergebnissen, Abdeckung und Zeitgrenzen. Keine bloß behauptete SHA/Fallzahl.
- 9195426: persistente Bearbeitungsstufen/Zeiten nach Reload, korrelierte
  Archivstufen; Testkonten besitzen eigene Tokens/Kontingente.
- 07713ba: Vault-Schlüsselrotation/Legacy-Migration ohne Laufzeitverlängerung,
  16 Einträge pro Profil, Cleanup-Index vor Geheimnissen, Disconnect-Race geschützt.
- ed248b8: Videofilter nutzt nur paginierte Liste statt Gesamtstatistik/Inventar.
- 5ebe6a8: kurz gültige tablokale Prompttexte; keine Bild-/Tokenablage.
- 8001c36: ONNX-Größen/LFS-SHA256, atomare credentialfreie Cache-Reparatur,
  begrenztes Upscaling mit Splitting und Prüfung nativer Videoauflösung.

## Verifikation und echte Moderationsgrenze

- Root-Build/189 Unit-Tests bestanden. Vollständige isolierte Chromium/WebKit/
  workerd-Matrix am 27.10. Exit 0 auf dem 188-Unit-/M41-Stand; neue M09/M22-Korrektur
  anschließend separat in vier Kombinationen bestanden. Nicht auf unbekannte
  Produktionsstände oder reale HF-Abrechnung übertragen.
- Dienst-Build/15 technische Tests bestanden; echte FFmpeg-/sharp-Prüfungen,
  Protokoll, Hashbindung und Fehlerfälle. Keine Aussage semantischer Zuverlässigkeit.
- Aktueller Protobuf-Fehler: Decodercache 1.323.696.414 statt 1.450.425.745 Bytes.
  Reparatur verifizierte alle vier Gewichtsdateien per SHA256; Modelle laden danach.
  Keine pauschale Erklärung älterer nativer Abstürze.
- Anschließender echter CPU-Lauf: 8 Eingaben sämtlich review, darunter 4 harmlose;
  5-Frame-/5s-Video scheitert nach 33.997ms. Kein sinnvoller Qualitätsnachweis.
  Evidenz `docs/audits/2026-10-27-moderation-diagnostic.json` in 2bc35ba gesichert.
  Vorverarbeitung: 2048px erzeugte 13–17 Tiles; 1024px fünf, Splitting bleibt aktiv.
- Lokaler Kaltstart der ungebündelten Node-Module dauerte zeitweise ~57s, deshalb
  zwei Hilfsteststarts verworfen (einmal Build noch nicht fertig, einmal Timeout).
  Kein Produkt-Erfolg daraus abgeleitet; finaler Test nutzte bestätigten Mockserver.

## Blocker und nächste Schritte

1. Neues Protokollexperiment mit fehlgeschlagener CPU-Evidenz sichern; keine
   weiteren identischen Wiederholungen. M04-Paket testen und abschließen.
2. Moderation weiterhin NICHT qualifiziert. Fachliche Qualität, vollständige
   Videolatenz und kostenloses Hosting offen; keine qualification.json erzeugt.
3. Kontrollierter Wan-Stand/echte Safari-Ausgabe offen. Öffentlicher Community-
   Endpoint erreichbar geprüft, keine freigegebene Modellkonfiguration.
4. Nutzer bestätigt am 27.10.: nur EIN reales HF-Konto verfügbar. M17-Zwei-Konten-
   Abrechnungsnachweis bleibt offen; simulierte Tests sind kein Ersatz.
5. Vorgeschriebenes MCP `slop_urself` nicht verfügbar. Keine produktiven DB-Checks,
   Schemas/Migrationen. M18/M24/M26/M28/M44 abhängig davon offen; keine WAF-/Restore-
   oder Cloudflare-Account-Konfiguration als geprüft behaupten.
6. Unabhängige Restpakete priorisiert fortsetzen, siehe Implementierungsbericht:
   M04 laufende gesperrte Archivclips, M31/M32 Recovery, M35 Prompttransparenz,
   M43/M45 Protokoll/Assets, danach übrige UX/Spielerweiterungen. robots.txt laut
   Audit erreichbar; keinen unbelegten weiteren robots-Fix einführen.
