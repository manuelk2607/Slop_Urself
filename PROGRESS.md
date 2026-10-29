# Audit-Umsetzung – Stand 29. Oktober 2026

## Weiteres P0-Paket – technische Holds sind kein Qualitätsnachweis

- **M02/M03/M42:** Qualifikationsparser verlangt nun einen zur Entscheidung
  passenden festen `assessmentReason`. Format-/Schemafehler und technische Ausfälle
  dürfen keinen Risikofall als semantisch bestanden zählen. Der Diagnose-Runner
  trennt `safeHold` von inhaltlichem Testerfolg; historische negative Modellberichte
  bleiben unverändert. Keine neuen Modelle geladen, keine Qualitätsfreigabe.
- Dienst-Build/25 technische Tests bestanden. Neue Regressionen verwerfen sechs
  technische/unbekannte Gründe sowie widersprüchliche Entscheidungen. Fachliche
  Korpus-/Qualitätsabnahme, Modelleignung und Gratis-Hosting bleiben offen.
- Voriges Paket lokal committed als `138068a`; kein Push/Deployment. Nächster
  Entwicklungsschritt bleibt die persistente Room-/Service-Orchestrierung, siehe unten.

## Fortsetzung – persistente Dienstjobs und produktiver Versionsabgleich

- **M02/M03/M31, dienstseitig umgesetzt:** Moderationsaufträge werden vor HTTP 202
  in SQLite bestätigt; Eingaben/Resultate AES-256-GCM-verschlüsselt, gebunden an
  Ticket/Digest/Modellversion/Modus. Standardpfad `/tmp/slop-moderation/jobs.sqlite`,
  konfigurierbares geschütztes Volume über `MODERATION_JOB_DB` und separater
  Schlüssel `MODERATION_JOB_KEY`. Datei 0600, vier Tickets, sechs Minuten Retention.
  `/tmp` garantiert keinen Erhalt bei einem Hoster-Rebuild; Volumeabnahme offen.
- Atomare Compute-Lease verhindert parallele Hintergrundberechnung über getrennte
  SQLite-Verbindungen. Nach Prozessabbruch maximal eine erneute Moderationsprüfung;
  keine HF-Inferenz in diesem Dienst. Alte Worker dürfen terminale/abgelaufene
  Ergebnisse nicht überschreiben. Schlüssel-/Versionswechsel übernimmt keine
  Freigaben. Authentifiziertes `/jobs/status` liefert nur Statusanzahlen/Slotbelegung.
  Bei verlorener POST-Verbindung fragt der Spieltransport `/jobs/lookup` mit
  Bearer/Digest/Validierungsmodus ab; kein zweiter POST und keine Übernahme von
  Evaluationstickets. Room-Eviction bleibt unabhängig davon offen.
- Dienst-Build und **24 technische Tests bestanden**, einschließlich Wiederöffnung,
  konkurrierender Claims, verlorener Bestätigung, Verschlüsselung, TTL, falschem
  Schlüssel, Versionswechsel, verspäteter Antwort und HTTP-Wiederanlauf.
  Das ist keine semantische Qualifikation. **Room-/Service-Orchestrierung bleibt
  unvollständig:** Spieltickets sind noch nicht in DO-Checkpoints/Alarmen gespeichert;
  der Spielclient wartet weiterhin 30s. M02/M03 bleiben insgesamt offen.
- **M20/M45:** `/api/release` für Node/Worker ergänzt, mit validierter Release-ID,
  no-store, noindex, GET/HEAD und 503 bei fehlender ID. Keine Secrets/Kontodaten.
  Root-Build, 212/212 Units und workerd-HF-/Moderationsgrenzintegration bestanden.
  Anschließend zusätzlicher Lost-Acknowledgement-Test (8/8 gezielte Release-/
  Moderationschecks) bestanden; Gesamtzahl jetzt 213, Gesamtsuite nach diesem
  kleinen Lookup-Paket nicht erneut ausgeführt.
  Keine neue vollständige Browsermatrix; vor Veröffentlichung nachholen.
- **Produktion jetzt per Cloudflare-API verifiziert:** aktiver Worker
  `ee71b881-67c6-4140-bba4-bca3e96e6e14`, Deployment vom 29.10. durch Secretänderung;
  letztes Anwendungsdeployment am 23.10. (`2136ab45-a14b-4af3-973a-55479bfd18cc`).
  Lokale Auditkorrekturen ab 25.10. sind daher nicht veröffentlicht. Ausgelesen nur
  Bindungsnamen und ausgewählte Modellangaben, keine Secretwerte. Aktive Bindungsliste
  enthält weder MODERATION_* noch WAN_* oder CF_VERSION_METADATA, wohl aber HF_TOKEN.
  Kein Beleg produktiver Moderations-/Modellkontrolle; keine produktive Sicherheits-
  freigabe behaupten. WAF, DB-Backups und tatsächliche Abrechnung nicht geprüft.
- **Nächster konkreter Schritt:** das vorhandene Dienstticket mit persistenten,
  privaten Room-/Service-Checkpoints und Alarmen verbinden (inklusive verlorener
  Empfangsbestätigung), ohne lange serielle Raumoperationen. Danach passende
  Moderationsalternative qualifizieren und kontrollierten Wan-Produzenten abnehmen.
  Zwei-Konten-GPU-Test erst nach diesen Abnahmen und ausdrücklicher Umfangsfreigabe.
- Keine GPU-Aufträge, keine Produktionsdatenänderung, kein Push/Deployment.

## Validierungscheck – 29. Oktober 2026, 10:29 CET

- Repository sauber auf `b7e2163` (`codex/audit-remediation`); keine uncommitteten
  Änderungen. `npm run build` und `npm test` erfolgreich: 211/211 Tests bestanden.
  Die Tests verwenden ausschließlich Mock-/synthetische Providerdaten und sind kein
  Nachweis einer echten HF-Abrechnung oder semantischen Moderationsqualität.
- Produktionsprüfung mit Googlebot-Kennung: Startseite HTTP 200, `/robots.txt`
  HTTP 200 mit `text/plain`, ohne Weiterleitung und mit öffentlichen Regeln;
  `/sitemap.xml` HTTP 200 mit `application/xml` und gültigem `urlset`. Damit ist
  der frühere Robots-/Sitemap-Befund zum Prüfzeitpunkt nicht reproduzierbar.
- Der produktive Abruf liefert keinen auswertbaren `X-Slop-Release`-Header. Deshalb
  ist nicht verifiziert, dass der lokale Stand `b7e2163` deployed ist; lokale
  Sicherheitskorrekturen dürfen nicht automatisch dem Produktionsstand zugerechnet
  werden. Kein Deployment in diesem Validierungsauftrag.
- **Freigabestatus unverändert:** Moderationsqualität, dauerhafte Moderationsjobs,
  kontrollierter Wan-Produzent und tatsächlicher HF-Abrechnungsnachweis fehlen.
  Echte GPU-Generierung bleibt daher gesperrt.

## Auftrag und Grenzen

Offene Maßnahmen aus `docs/IMPLEMENTATION-2026-10-25.md` und beiden Audits vom
24.10. priorisiert implementieren. Branch `codex/audit-remediation`; alle vorherigen
Commits erhalten. Kein Push/Deployment in diesem Auftrag. Echte KI bleibt gesperrt,
bis Moderation, Modellkontrolle und individuelle HF-Abrechnung qualifiziert sind.
Keine bezahlten Aufträge, rechtswidrigen Testmedien oder produktiven Datenänderungen.

## Neuer Fortsetzungspunkt – Moderationsdurchsetzung am 29.10.

- Spielpfade nutzen jetzt denselben begrenzten Moderationstransport für Bild/Prompt
  und Video. Opt-in über MODERATION_URL .../jobs/validate: 202 ist nur ausstehend,
  Polling ausschließlich fester Host/Pfad, Bearer plus exakter Digest; verlorene,
  umgeleitete, malforme oder evaluationOnly-Aufträge geben nicht frei und lösen
  keinen erneuten POST aus. Synchrone /validate-Verträge bleiben kompatibel.
- Echter Fehler behoben: zweiminütiger Allow-Cache konnte eine zwischenzeitlich
  abgelaufene Dienstqualifikation maskieren. Entfernt, nur gleichzeitige Prüfungen
  innerhalb desselben gehashten Credential-Kontexts werden zusammengeführt.
- Regressionen auf generateAiVideo UND archiveVideo belegen bei fehlender
  Qualifikation, block/review, evaluationOnly und unvollständiger Prüfung:
  null HF-/GPU-Folgeaufrufe und null Archivoperationen. Nur synthetische Fixtures,
  keine echte semantische Prüfung, keine produktiven KI-Aufträge.
- Root-Build/211 Units und workerd-Grenzintegration Exit 0. Bericht
  docs/audits/2026-10-29-moderation-enforcement.json. Keine erneute vollständige
  Browsermatrix für diese Transport-/Gateänderung; nichts anderes behaupten.
- DURABLE RECOVERY NOCH OFFEN: Client wartet maximal 30s, damit serielle Raum- und
  Serviceoperationen nicht fünf Minuten blockieren. Der Hintergrunddienst kann
  weiterarbeiten, aber sichere langfristige Spiel-Fortsetzung braucht persistente
  Tickets/Alarme und private Eingaberetention. Keine Freigabe bei Timeout/Neustart.
- Moderationskandidat weiterhin ungeeignet/unqualifiziert, eigener Wan-Produzent
  noch nicht implementiert. Keine neue pauschale Freigabedatei oder Umgehung.
- Kein Push/Anwendungsdeployment in diesem Paket. Die frühere autorisierte
  DB-Secretumstellung ist separat dokumentiert und davon nicht rückgängig gemacht.

## Aktueller Fortsetzungspunkt – neue Arbeiten am 29.10.

- **DB-Zugang entblockt:** Nutzer erlaubt vorhandenen Neon-MCP über angepasste
  `.clinerules`, ausschließlich Projekt autumn-leaf-19858358. Tatsächlicher DB-Name
  auf ausdrücklichen Wunsch per Neon-API von neondb nach **Slop_Urself** geändert.
  DB-ID 281758 unverändert, vorher/nachher sechs öffentliche Tabellen. Schema-Metadaten
  per MCP gelesen, keine Nutzerdatensätze ausgegeben oder geändert. `.env.local`,
  ignorierte `cloudflare/.dev.vars` und produktives DATABASE_URL-Secret angepasst,
  Werte nur intern. Neue Anwendungsversion NICHT deployed, nur Secret aktualisiert.
  Homepage und Sitemap danach 200. Zugriff funktioniert; alten MCP-Blocker nicht
  wiederholen. Produktive WAF-/Backup-/Restore-Abnahme weiterhin offen.
- **M02/M03 Hintergrund-HTTP vorbereitet:** POST /jobs/evaluate bzw. /jobs/validate
  gibt nach gebundenem Upload 202, GET /jobs/{UUID} verlangt Bearer und Digest.
  Ein Compute-Slot, vier kurzlebige Resultate, 25s-Upload-/5min-Arbeitsdeadline.
  Ausstehend/fehlgeschlagen/abgelaufene Qualifikation geben niemals frei.
  Aufträge liegen nur im RAM, Neustart ist ein sicherer Fehlschlag, KEIN dauerhafter
  Recovery-Nachweis. Spielintegration, langlebige Auftragsverwaltung und eine
  qualifizierte Moderationsalternative sind noch offen. Standard-Qualifikation
  und Spiel-Gates nicht gelockert. Dienst-Build/20 Tests, Root-Build/207 Units bestanden.
- **Wan:** offizielle Wan-/Diffusers-/LightX2V-Quellen gelesen; keine neue
  kontrollierte Producer-Implementierung, kein Space-Deployment, keine GPU-Aufträge.
  `wan-service/PROGRESS.md` enthält nur Vorbereitung und offene Rezept-/Versionsfragen.
- **Sitemap real geprüft:** /sitemap.xml normal und mit Googlebot-Kennung extern
  200, application/xml, keine Weiterleitung, gültiges XML mit einer öffentlichen URL.
  Nutzertext „This XML file ... style information“ ist normale Browserdarstellung.
  Echter Google-Abruf/GSC-Bericht nicht vorliegend, keine Stylesheet-/Routingänderung.
- Nächster Schritt: Hintergrundschnittstelle sicher mit dauerhaften Spieljobs
  verbinden; vorher qualifizierbaren Moderationskandidaten/Hosting prüfen. Kontrollierten
  Wan-Produzenten inklusive tatsächlich kompatiblem 4-/8-Schritte-Rezept abschließen.
  DB-abhängige P1-Aufgaben können jetzt nach Schemaabgleich wieder aufgenommen werden.
  Zwei-Konten-Abrechnungstest erst nach Schutzabnahmen und gesonderter Umfangsfreigabe.

## Aktueller Fortsetzungspunkt – 29.10.

- **M17, lesend real geprüft:** zwei verschiedene HF-Konten, fremder Profilzugriff
  abgewiesen, persönliche Jobtoken gegen echte whoami-Identität geprüft, absichtlicher
  Jobtausch abgewiesen. Vor/nach jeweils A 175,592746/300s und B 300/300s unverändert.
  Bericht `docs/audits/2026-10-28-hf-readonly.json`. Keine Inferenz/GPU-Aufträge,
  ausdrücklich keine reale Abrechnungsfreigabe. Prüffenster beendet, Zugangsdaten
  ausschließlich im RAM verworfen; für weitere Live-Prüfung neu verbinden.
- **M05/M31:** Modell-/Hostvertrag nach Upload vor GPU-POST sowie vor/nach laufendem
  Ergebnisabruf erneut prüfen. Fremde gespeicherte Hosts erhalten keinen Token;
  Drift/unbekannter Status bleibt derselbe wartende Auftrag statt Neugenerierung.
  Kleine gebundene JSON-Antworten, echte Quota-Reset-Zeitstempel und aktive Holds.
- **M02/M17/M25:** workerd unterstützt `redirect:error` nicht. Die neue Quota-
  Härtung deckte außerdem bestehende inkompatible Job-/Moderationsaufrufe auf.
  Auf `manual` plus Nicht-2xx-Ablehnung umgestellt; kein Redirect-Following.
  OAuth-Grant-/Profilantworten ebenfalls begrenzt und ohne automatische Weiterleitung.
  Direkte workerd-Grenz- und OAuth-Tests bestanden, kein externer GPU-Aufruf.
- **M02/M03:** native byteidentische Frames nur innerhalb einer Anfrage dedupliziert;
  bewegte Frames vollständig prüfen, Qualifikationsbenchmark >=80 unterschiedliche
  Frames. Kontextpräfix/Antwortform geprüft, keine Rohtexte. Dienst-Build/19 technische
  Tests bestanden. Diagnose `...moderation-shape.json`: einzelner harmloser Fall
  scheitert an dekoriertem Label; separates `labels-v2` prüft nur feste Enum-Formen.
  `...moderation-labels-v2.json`: vier harmlose Bildfälle nicht freigegeben, davon
  drei technische Zeitüberschreitungen; Standbildvideo alle 5 Frames/1 einzigartiger
  Frame in 9.873ms geprüft, weiterhin review. Gleichzeitige Testlast, keine isolierte
  Latenz-/Semantikqualifikation. Standard JSON/Modell-Lock bleibt unverändert,
  keine qualification.json, keine Freigabe. Öffentliche Gewichte im ignorierten
  `.local/moderation-model-cache` geprüft; keine erneuten identischen Diagnoseläufe.
- **M04:** nachträgliche Sperren auch für frisch generierte klassische Archivdateien
  vor Wertung/Ratebonus und alle 10s einschließlich Hibernation; Statusausfall hält
  Wertung zurück. Finaler gesperrter Clip endet ohne Punkte und gibt Raum-Holds frei.
- **Verifiziert abgeschlossen:** Stand 2491d05: Build/206 Units, vollständige
  Chromium/WebKit/Node/workerd-Matrix **Exit 0, 97 PASS-Nachweise**. Moderationsdienst:
  Build/19 technische Tests bestanden, semantische Diagnose Exit 2. Kein pauschales
  Wiederholen dieser Suite. Bericht `docs/audits/2026-10-29-regression-results.json`
  mit Quellständen und Loghashes; Logs dauerhaft in `.local/audit-tests`.
- **50de998 – M31:** fehlerhafte HF-Event-IDs nach POST bleiben ein bereits
  persistierter unklarer `submitting`-Auftrag. Kein Speichern unbrauchbarer IDs,
  kein Fallback-/Resume-Neuauftrag. Sieben ungültige Formen geprüft. Danach erneuter
  Build/207 Units und direkte workerd-Grenztests Exit 0. Die volle Browsermatrix
  wurde nach diesem kleinen API-Guard nicht erneut ausgeführt, nicht so behaupten.
- Die alten Testprozesse sind beendet. Zwischenläufe mit workerd-Redirectfehler
  und eingeschränktem macOS-Browserstart zählen nicht als bestandener Gesamtlauf.
- Kein Push/Deployment und keine reale Generierungs-/Abrechnungserlaubnis. Alle
  bisherigen Commits erhalten. `slop_urself`-MCP am 28.10. weiterhin nicht verfügbar.

## Neue abgeschlossene Implementierungspakete

- **50de998:** M31 ungültige Submission-IDs bleiben unklar statt doppelter GPU-POST.

- **02989e8:** zwei echte HF-Konten lesend isoliert geprüft, sicheres RAM-Prüffenster.
- **9d53aeb:** M02/M03 Präfixprüfung/Framewiederverwendung, separate Labeldiagnose;
  negative Semantiknachweise erhalten, keine Freigabe.
- **b4fb861:** M05/M17/M25/M31/M34 Providerdrift, Quota-Holds, portable HF-/Moderations-
  Abrufe und begrenzte OAuth-Antworten. Workerd-Grenz-/OAuth-Tests bestanden.
- **2491d05:** M04 nachträgliche Sperren auch in klassischen Runden/Hibernation.

- **c9668e7 – M02/M03 Diagnose:** optionales, strikt validiertes labels-v1-Protokoll
  mit eigenem Fingerprint. Standard und Modell-Lock unverändert. CPU-Test Exit 2:
  alle acht Bild-/Textfälle ungültiges Antwortformat, inklusive vier harmloser;
  Fünf-Frame-/5s-Video scheitert nach 27.764ms. Vier kritische Holds wegen Formatfehler
  sind KEIN semantischer Erkennungsnachweis. Keine Qualifikation, keine GPU.
  Bericht `docs/audits/2026-10-27-moderation-labels-diagnostic.json`.
- **59fc356 – M04:** Archiv-Replays prüfen aktuelle Sperre vor Wertung/Ratebonus
  und alle 10s, auch nach Hibernation. Bans überspringen ohne Punkte und entfernen
  aktuellen Prompt/Abgaben; Statusausfall hält Wertung zurück. Veraltete asynchrone
  Antwort verändert keinen neuen Ballot. Unit-/DO-Regressionsprüfungen bestanden.
  Keine Rückrufzusage für bereits heruntergeladene Bytes; kein Altarchiv-Review.
- **2a0fa6e – M31/M32/M33, M29 teilweise:** Job-/Eigentümerzuordnung bleibt bis
  erfolgreicher Tokenbereinigung. Wiederholung nach Bereinigungs-/Planschreibfehler
  verbraucht kein zweites Budget. Verlorener Veröffentlichungsschritt nutzt denselben
  fertigen Archivauftrag ohne neue Inferenz/Tokenabruf. Optionale Passwort-Hashes
  erhalten v1, Legacy-Verifikation bleibt; unbekannte Version/Kosten abgewiesen.
  KDF-Kosten unverändert. Vor Produktion gemischte Reader-/Rollback-Versionen prüfen.
  Unabhängige persönliche Quota-Reads überlappen; Mutationen bleiben frisch/seriell.
- **5c12107 – M35:** gemeinsame Normalisierung/Promptaufbereitung für Vorschau,
  Moderation und Provider. Optionale Klartextvorschau mit Tastatur/Reload; explizite
  Verwandlungen/Szenenwechsel werden nicht pauschal übersteuert. Zwei Vertragstests
  sowie Chromium/WebKit auf Node/workerd bestanden. Keine echte Wan-Qualitätszusage.

## Bisherige Basis – nicht erneut implementieren

Identitäts-/Archiv-/Löschrechte, Ballotbindung und erhaltene Austrittsstimmen,
fail-closed Moderations-/Upload-/Providerverträge, Meldung/Sperre/CSP/Rate-Limits,
sichere Logs, aktive Speicherleases und Reservierung vor GPU, persistente
Generierungsstufen, eindeutige HF-Spieler, 90s-Wiederkehr, Vault-Rotation und
Profilgrenzen, paginierte Videofilter, tablokale Promptentwürfe, Hashprüfung und
atomare Reparatur der ONNX-Artefakte, native Frameauflösung, zugängliche Kontraste,
Fokusführung, gemeinsame Platzierungen und Vorschau/Enthaltung sind bereits gesichert.
Ausführliche Grenzen/ältere Tests stehen im Implementierungsbericht.

## P0: echte Freigabegrenzen

1. **Moderation NICHT qualifiziert.** Nach ONNX-Reparatur laden Modelle, aber
   die bisherigen sicheren Diagnoserunden scheitern an Qualität/Format und Videolaufzeit.
   Keine qualification.json erzeugt. Keine identischen Wiederholungen ohne neue
   technische Hypothese. Kostenloses Hosting und repräsentative Fachprüfung offen.
2. **Kontrollierter Wan-Erzeuger nicht abgenommen.** Öffentlicher Community-Space
   am 28.10. RUNNING/API-kompatibel geprüft, keine freigegebene Modellkonfiguration.
   SHA-/Replica-Deklaration ist keine kryptografische Gewichtsattestierung.
   Echte Wan-/Safari-Ausgabe und kostenfreies Overrun-Verhalten bleiben offen.
3. **M17:** Zwei reale HF-Testkonten lesend erfolgreich isoliert geprüft. Echte
   Video-/Abrechnungsprüfung benötigt separate Umfangsfreigabe und bestandene Schutz-/
   Modellabnahmen. Lesender Erfolg ist kein Belastungsnachweis; RAM-Sitzung beendet.
4. **DB-Zugang am 29.10. entblockt**, siehe neuen Fortsetzungspunkt. Produktive
   WAF, Backups, Logeinstellungen und Dateiretention bleiben unbestätigt.

## Nächste konkrete Schritte

1. Lokale Sicherheits-/Recoverypakete und aktuelle Regressionen abgeschlossen und
  gesichert. Beim nächsten P0-Abhängigkeitsschritt beziehungsweise unabhängigen
   P1-Rest ansetzen; keine erneute identische Gesamtsuite ohne Quelländerung.
2. P0 mit geeignetem Moderationskandidaten/Hardware und kontrolliertem Wan fortsetzen,
   ohne Fail-Closed-Gate zu umgehen. Zwei Konten erst für separat freigegebenen GPU-Test wieder verbinden.
3. P1-Reste: M04 Altarchiv/Einspruch/Status weiterer Spielansichten; M06 Bestands-
   migration; reale M09/M11-Ausgabe; M18 vollständige Betroffenen-/HF-/DO-Löschung;
   M19 externer Speicher; produktive M20-Logeinstellungen. DB-Abhängigkeiten beachten.
4. Unabhängige P2-Pakete danach: übrige M31/M32-Crashfenster, M43 gemeinsame
   Ereignisverträge, M45 Asset-/Releasekompatibilität, verbleibende M35-Qualitätsabnahme
   und A11y/Realgeräte. M24/M26/M28/M44 benötigen vorgeschriebenen DB-/Restorezugang.
5. M22-Normalisierung/Historienwahlliste und M46–M54 nach Sicherheitsabhängigkeiten.
   Keine kosmetische Priorität vor offenen Sicherheitslücken. robots.txt laut Audit
   erreichbar und lokale SEO-Regressionen bestehen; keinen unbelegten Fix wiederholen.
