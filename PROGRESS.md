# Audit-Umsetzung – Stand 29. Oktober 2026

## Auftrag und Grenzen

Offene Maßnahmen aus `docs/IMPLEMENTATION-2026-10-25.md` und beiden Audits vom
24.10. priorisiert implementieren. Branch `codex/audit-remediation`; alle vorherigen
Commits erhalten. Kein Push/Deployment in diesem Auftrag. Echte KI bleibt gesperrt,
bis Moderation, Modellkontrolle und individuelle HF-Abrechnung qualifiziert sind.
Keine bezahlten Aufträge, rechtswidrigen Testmedien oder produktiven Datenänderungen.

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
