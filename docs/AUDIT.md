# Technische Prüfung vom 6./7. Oktober 2026

## Behobene Fehler

- Spielablauf: Punktvergabe genau einmal, stabile Spieler-IDs nach Reload,
  vollständige Wiederherstellung von Lobby, Generierung, Voting und Ergebnissen.
- Verlassen und Wiederverbindung: laufende Ersteller-Runde wird abgebrochen,
  spät eintreffende KI-Ergebnisse werden verworfen, der nächste Spieler wird
  nicht übersprungen. Netzwerkabbrüche haben 15 Sekunden Wiederverbindungszeit.
- Cloudflare-Netzwerk: automatische WebSocket-Wiederverbindung, keine
  HTML-Antwort mehr auf die Socket.IO-Script-Anfrage und keine Raum-Snapshots
  für Verbindungen ohne Mitgliedschaft. Sitzungsschlüssel bleiben privat.
- KI: tatsächliche Space-Hostnamen und API-Parameter werden gelesen; bisher
  vertauschte Parameter sind korrigiert. Mindestdauer 5 Sekunden, korrekte
  Abschlussereignisse, Zeitlimits und Fallback von Wan 2.2 mit 8 auf 4 Schritte,
  danach LTX. Einheitliche, bildformatabhängige Kostenschätzung für alle Modi.
- Persistenz: Runden, Stimmen, Punktestand und Endwertung werden atomar
  gespeichert. Cloudflare wiederholt fehlgeschlagene Rundenwrites aus dem
  Durable-Object-Speicher. Raumcode-Kollisionen überschreiben keine Historie.
- Statistik/UI: reine Warteräume zählen nicht als gespielte Partien,
  abgegebene Stimmen bleiben beim Reload erkennbar, Bildauswahl und laufende
  Videos werden nicht durch jeden Snapshot zurückgesetzt. Mobile Statistik,
  Tastatur-Fokus, Dateiformate und Feedback für abgelaufene Videos verbessert.
- Abhängigkeiten: bekannte npm-Audit-Sicherheitslücken geschlossen und
  unbenutzten Gradio-Client entfernt. Datenbank-TLS wird nicht mehr pauschal
  ohne Zertifikatsprüfung konfiguriert.
- Kontingent: offizielles HF-ZeroGPU-Restkontingent wird gelesen. Rundenauswahl,
  serverseitige Startprüfung und globale Reservierung berücksichtigen GPU-Zeit
  und Aufruflimit. Vollständige Runden berücksichtigen die Spielerzahl:
  zwei Runden mit drei Spielern reservieren sechs Videos. Lobby-Grenzen werden
  bei Beitritt/Verlassen aktualisiert; ausstehende Erstellungen von Spielern,
  die verlassen haben, entfallen. Fallbacks schützen reserviertes Budget.
  Die Rundengrenze berücksichtigt den günstigsten konfigurierten 5-Sekunden-Modus,
  ohne das gemeinsame HF-Kontingent mehrfach zu zählen. Aufwendigere laufende
  Jobs bleiben auch vor dem HF-Kontingentabzug geschützt.
- Zusatzrunden: Nach dem geplanten Ende wird das aktuelle Restkontingent neu
  gelesen. Nur der Host kann eine weitere vollständige Runde für alle
  verbleibenden Spieler reservieren. Raum, Spieler-IDs, Punkte und Historie
  bleiben erhalten; Endwertung und Sieg werden beim Fortsetzen zurückgesetzt,
  damit die verlängerte Partie in der Statistik nicht doppelt zählt.
- Identität: bewusst vereinfachter Einstieg nur mit Benutzername. Neue
  Profile haben eine feste ID und eine eindeutige normalisierte Namenskennung.
  Doppelte Erstellung ist serverseitig und per Datenbankindex gesperrt.
  Signierte HTTP-only-Browsersitzungen erhalten die ID nach Reload; vorhandene
  Namen lassen sich ohne Passwort weiterverwenden. Legacy-Statistiken bleiben erhalten.
- Archiv: private Neon-MP4-Dateien, 512-MB-Limit, automatische Löschung
  ältester Videos und authentifizierte Range-Auslieferung. Originalbilder
  werden nicht im eigenen Archiv gespeichert.
- Seitenstart: sichtbarer Lade-/Fehlerzustand statt leerem Rechteck. Browser-
  Bundles liegen getrennt von Node-Ausgaben, sodass ein unterbrochener
  TypeScript-Build keine CommonJS-Datei als Browser-Script ausliefert.
- KI-Ausfallsicherheit: dauerhaftes Journal mit Event-ID und Auftragsstatus,
  Wiederaufnahme derselben Ergebnisabfrage nach Worker-Neustart oder Netzfehler.
  Keine blinden Fallbacks bei ungeklärten POST-Antworten. Abgebrochene Ersteller-
  Jobs werden im Hintergrund abgeschlossen, Budgetfreigaben dauerhaft wiederholt.
- Leichter Zugriffsschutz: keine neuen Passwörter, aber begrenzte HTTP- und
  Spielnachrichten. Anonyme Aufrufe fragen kein echtes HF-Kontingent ab;
  Anzeige-Cache und frische Startprüfung sind getrennt. Technische KI-Logs
  enthalten keine Bilder, Prompts oder Tokens. CI für Push und Pull Request.

## Verifikation

- TypeScript-Build für Node, Browser und Cloudflare erfolgreich.
- 53 automatisierte Tests für Spiellogik, KI-Protokoll, Worker, Quota,
  Archiv und Zugriffskontrolle bestanden.
- Mehrere getrennte Browser-Sitzungen: drei Spieler, zwei vollständige Runden
  mit sechs Videos, Punkten und Endwertung,
  Reload, neues Spiel, Ersteller verlässt, Wiederverbindung und Statistiken.
  Chromium und WebKit bestanden; Desktop und mobile Darstellung geprüft.
- Neon: Transaktionen, doppelte Rundenspeicherung, Endwertung, Statistik und
  Rollback mit temporären Tabellen geprüft. Keine Produktiv-Spielzeilen
  angelegt oder verändert. Cloudflare-DB-Schreibpfad nicht live belastet.
- Öffentliche Cloudflare-Seite, Konfiguration und Statistik antworteten;
  Worker-Bindings/Secrets und Deployment-Bundle geprüft.
- Echter Wan-2.2-Test mit einem öffentlichen Busfoto: abspielbares Video,
  5,06 Sekunden, 624 x 832 Pixel. Der Bus bewegt sich sichtbar auf die Kamera
  zu, passend zum Testprompt. Kleine Bildverformungen sind weiterhin sichtbar.
- npm audit: keine gemeldeten Sicherheitslücken zum Prüfzeitpunkt.
- Browser-Profileinstieg: nur ein Namensfeld, Duplikatprüfung, Namensübernahme,
  Reload, Raumwiederherstellung und Abmeldung. PostgreSQL-Namenseindeutigkeit
  einschließlich gleichzeitiger Erstellung in temporären Tabellen getestet.
- Echte HF-Kontingentabfrage und privates Neon-S3-Archiv getestet: MP4-Upload,
  Byte-Range 206 und anschliessende Löschung ausschließlich des Testvideos.
- Simulierte fehlende Browser-Datei, Backend-Ausfall, Rundenauswahl 1 statt
  100 und Sperre bei Kontingent 0 in Chromium und WebKit bestanden.
- Spielerabhängiges Kontingent mit Fallback-Sparmodus geprüft: 185 GPU-Sekunden
  erlauben eine vollständige Zwei-Spieler-Runde mit zwei 5-Sekunden-Videos.
  Ein dritter Spieler benötigt mehr Budget. Beitritt und
  Verlassen passen die Auswahl an; drei Spieler mit zwei Runden reservieren
  sechs Videos. Wiederholungen schützen alle noch ausstehenden Erstellungen.
- KI-Protokolltests prüfen den 4-Schritte-Aufruf bei knappen 185 Sekunden,
  8 Schritte bei ausreichend Budget und erneute Kontingentprüfung vor Fallbacks.
  Kein weiterer echter GPU-Job für diese Fallback-Erweiterung gestartet;
  die Bildqualität des 4-Schritte-Modus ist nicht live verifiziert.
- Zusatzrunden in Chromium und WebKit sowie gegen den lokalen Cloudflare-Worker
  getestet: Zwei Spieler erreichen sechs Videos in drei Durchgängen bei
  simuliertem günstigem Verbrauch. Hostberechtigung, erneute Kontingentprüfung,
  doppelte Startanfragen, Reload und mobiles Layout bestanden. Kein echter
  GPU-Job. Neon-Transaktionen prüfen dieselbe Partie vor und nach Fortsetzung;
  Worker-Tests prüfen die dauerhafte Write-Warteschlange bei Datenbankausfall.

## Verbleibende Grenzen

- Kein produktives Deployment im Rahmen dieser Prüfung. Der Git-Push allein
  aktiviert die Änderungen noch nicht auf Cloudflare. Ein neuer HF_TOKEN in .env.local aktualisiert
  nicht automatisch den Cloudflare-Secret.
- Kostenloses Hugging Face garantiert weder Verfügbarkeit noch Prompttreue.
  ZeroGPU-Kontingente gelten pro Account, nicht additiv pro Fallback-Space.
  Die Rundenkosten sind konservativ aus den Space-Einstellungen geschätzt;
  HF-Nutzung außerhalb des Spiels oder GPU-verbrauchende Fehlversuche können
  bereits reservierte Budgets vermindern. Es gibt keine bezahlten Credits.
- Bereits abgelaufene historische HF-Links lassen sich nicht retten.
  Bei einem Archiv-Ausfall bleibt ein temporärer Link mit Warnung erhalten.
  Die App kann externe Löschfristen der HF-Spaces nicht erzwingen.
- Der Benutzername ist bewusst kein Identitätsnachweis: Jeder kann einen
  bekannten Namen verwenden und damit unter diesem Profil spielen. Die Seite
  ist nicht auf Freunde beschränkt; Neon-Auth-Anmeldung und Zugangscode sind entfernt.
- Ein verlorenes HF-Start-POST ohne Event-ID kann nicht eindeutig wiederhergestellt
  werden. Es wird kein zweiter Auftrag auf Verdacht gestartet; nach 15 Minuten
  endet der Versuch, seine ungeklärte Reservierung läuft erst nach TTL aus.
  Bereits gelöschte Space-Ergebnisse können nicht gerettet werden. Beim lokalen
  Node-Prozessneustart gehen laufende Raumzustände weiterhin verloren.
  Dauerhafte DB-/Quota-Wiederholung gilt für Cloudflare, nicht für Node.

Start-, Test- und Deployment-Befehle stehen in README.md.
