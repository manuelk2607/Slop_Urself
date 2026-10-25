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
| M15 | CSP mit exakter eigener WS-Origin, Frame-Einbettung verboten, Geräte-/Zahlungsberechtigungen deaktiviert, Referrer unterdrückt. HTML passiert Worker für passende dynamische Header. | Inline-Stile bleiben wegen vorhandener Darstellung zugelassen; kein neues Inline-JavaScript erlaubt. |
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

Noch nicht verifiziert: Hosting-Verfügbarkeit, tatsächliche Modellinitialisierung/
ONNX-Kompatibilität, Klassifikationsqualität einschließlich Fehlalarmen und
missbräuchlichen Eingaben, Speicherbedarf, Laufzeit aller Frames, Lizenzkette und
reale Löschwirkung beim Hoster. Bis dahin keine semantische Schutzwirkung behaupten.

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

- Root-Build/Typprüfungen erfolgreich; derzeit 164 Unit-Tests bestanden.
- Service-Build und vier Protokoll-/Entscheidungs-/Qualifikation-/native Bildruntime-Tests bestanden.
- Der separate Dienst enthielt indirekt eine ältere verwundbare sharp-Auflösung.
  Gezieltes Override auf 0.35.5, mit tatsächlichem Transformers-Decode/Resize geprüft;
  dessen Produktionsabhängigkeiten melden anschließend ebenfalls 0 npm-Auditbefunde.
- Verwaltungstest im echten lokalen Chromium bestanden; vollständiger isolierter
  Chromium/WebKit-/workerd-Lauf wird abschließend dokumentiert.
- Tests nutzen ausschließlich harmlose Fixtures und simulierte HF-/S3-/DB-Antworten;
  keine GPU-Aufträge, produktiven Löschungen oder Nutzerübernahmen ausgeführt.
- robots.txt/Sitemap-Routing unverändert; neue Header werden mit vorhandenen
  JS-freien SEO-Regressionen geprüft. Kein neuer Produktionsabruf in diesem Paket.

Priorisiert offen: qualifizierte Moderation/Altarchivstatus und Modellfreigabe
(M01–M05), Identitätsmigration/Live-Abrechnung (M06/M17), Wiedergabe-/Enthaltungsregeln
(M09), vollständiges Löschkonzept (M18), aktive Archivreservierungen (M19),
datensparsame Betriebsdiagnostik (M20), Kontrast (M21), Mehrfachidentitäten (M23),
Raum-UUIDs (M24), mobile Wiederkehr (M25), Migrationen/DB-/Inventarmessung (M26–M29),
verbleibende Crashfenster/Jobbereinigung/Schlüsselrotation (M31–M33), UX/A11y
(M35–M41), Wiederherstellbarkeit und Releaseabnahme (M44–M45). Optionale
Spielerweiterungen M46–M54 bleiben hinter den Sicherheitsabhängigkeiten.
