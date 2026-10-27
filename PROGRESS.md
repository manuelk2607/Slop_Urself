# Audit-Umsetzung – Stand 27. Oktober 2026

## Auftrag und Grenzen

Offene Maßnahmen aus `docs/IMPLEMENTATION-2026-10-25.md` und beiden Audits vom
24.10. priorisiert implementieren. Branch `codex/audit-remediation`; alle vorherigen
Commits erhalten. Kein Push/Deployment in diesem Auftrag. Echte KI bleibt gesperrt,
bis Moderation, Modellkontrolle und individuelle HF-Abrechnung qualifiziert sind.
Keine bezahlten Aufträge, rechtswidrigen Testmedien oder produktiven Datenänderungen.

## Aktueller Fortsetzungspunkt

- Quellstand **5c12107**, alle bestehenden Commits erhalten. Konsistenter Neubuild
  und 196 Units **57381 Exit 0**, technischer Moderationsdienst **96633 Exit 0**
  mit 15 Tests, vollständige Chromium/WebKit/Node/workerd-Matrix **83903 Exit 0**.
  Alle Prozesse beendet; keine erneute identische Prüfung nötig ohne Codeänderung.
- Dauerhafte Logs unter `.local/audit-tests`, Browsercache `.local/playwright`.
  Öffentlicher Ergebnisnachweis mit Code-/Loghashes:
  `docs/audits/2026-10-27-regression-results.json`. Nur lokale isolierte Abnahme.
- Prozess 95986 und /tmp-Logs waren nach Unterbrechung verschwunden; kein alter
  Gesamterfolg behauptet. Fehlgeschlagener Mischstand 42975 bleibt als Vorlauf
  dokumentiert. Der neue kohärente Gesamtlauf ersetzt diese fehlende Abnahme.
- Kein Push/Deployment, keine realen HF-/DB-/Speicheraufrufe. Produktive Sicherheit
  weiterhin nicht freigegeben; semantische Diagnosefehler bleiben offene P0-Grenze.
- Fortsetzen bei den unten priorisierten offenen Punkten; vorhandene Schutzregeln,
  getestete UI-/Quota-Pakete und fehlgeschlagene CPU-Versuche nicht wiederholen.

## Neue abgeschlossene Implementierungspakete

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
   beide sichere Diagnoserunden scheitern an Qualität/Format und Videolaufzeit.
   Keine qualification.json erzeugt. Keine identischen Wiederholungen ohne neue
   technische Hypothese. Kostenloses Hosting und repräsentative Fachprüfung offen.
2. **Kontrollierter Wan-Erzeuger nicht abgenommen.** Öffentlicher Community-Space
   am 26.10. RUNNING/API-kompatibel geprüft, keine freigegebene Modellkonfiguration.
   SHA-/Replica-Deklaration ist keine kryptografische Gewichtsattestierung.
   Echte Wan-/Safari-Ausgabe und kostenfreies Overrun-Verhalten bleiben offen.
3. **M17:** Nutzer bestätigt nur EIN reales HF-Konto. Zwei-Konten-Abrechnungstest
   nicht möglich. Unit-/workerd-/Browser-Stubs sind kein Providerabrechnungsnachweis.
4. **MCP `slop_urself` fehlt**, am 27.10. erneut in verfügbaren Tools geprüft.
   Keine produktive DB-Inspektion/Migration, kein Ersatz über allgemeinen Neon-Zugang.
   Produktions-WAF, Backups, Logeinstellungen und Dateiretention nicht verifiziert.

## Nächste konkrete Schritte

1. Lokale Pakete vollständig abgenommen und dokumentiert. Keine neue identische
   Gesamtsuite nötig. Weiter mit P0-Abhängigkeiten beziehungsweise unabhängigem P1-Rest.
2. P0 mit geeignetem Moderationskandidaten/Hardware und kontrolliertem Wan fortsetzen,
   ohne Fail-Closed-Gate zu umgehen. Zweites Konto erst nutzen, wenn verfügbar.
3. P1-Reste: M04 Altarchiv/Einspruch/Status weiterer Spielansichten; M06 Bestands-
   migration; reale M09/M11-Ausgabe; M18 vollständige Betroffenen-/HF-/DO-Löschung;
   M19 externer Speicher; produktive M20-Logeinstellungen. DB-Abhängigkeiten beachten.
4. Unabhängige P2-Pakete danach: übrige M31/M32-Crashfenster, M43 gemeinsame
   Ereignisverträge, M45 Asset-/Releasekompatibilität, verbleibende M35-Qualitätsabnahme
   und A11y/Realgeräte. M24/M26/M28/M44 benötigen vorgeschriebenen DB-/Restorezugang.
5. M22-Normalisierung/Historienwahlliste und M46–M54 nach Sicherheitsabhängigkeiten.
   Keine kosmetische Priorität vor offenen Sicherheitslücken. robots.txt laut Audit
   erreichbar und lokale SEO-Regressionen bestehen; keinen unbelegten Fix wiederholen.
