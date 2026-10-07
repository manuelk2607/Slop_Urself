# Technische Pruefung vom 6./7. Oktober 2026

## Behobene Fehler

- Spielablauf: Punktvergabe genau einmal, stabile Spieler-IDs nach Reload,
  vollstaendige Wiederherstellung von Lobby, Generierung, Voting und Ergebnissen.
- Verlassen und Wiederverbindung: laufende Ersteller-Runde wird abgebrochen,
  spaet eintreffende KI-Ergebnisse werden verworfen, der naechste Spieler wird
  nicht uebersprungen. Netzwerkabbrueche haben 15 Sekunden Wiederverbindungszeit.
- Cloudflare-Netzwerk: automatische WebSocket-Wiederverbindung, keine
  HTML-Antwort mehr auf die Socket.IO-Script-Anfrage und keine Raum-Snapshots
  fuer Verbindungen ohne Mitgliedschaft. Sitzungsschluessel bleiben privat.
- KI: tatsaechliche Space-Hostnamen und API-Parameter werden gelesen; bisher
  vertauschte Parameter sind korrigiert. Mindestdauer 5 Sekunden, korrekte
  Abschlussereignisse, Zeitlimits und Fallback von Wan 2.2 mit 8 auf 4 Schritte,
  danach LTX. Einheitliche, bildformatabhaengige Kostenschaetzung fuer alle Modi.
- Persistenz: Runden, Stimmen, Punktestand und Endwertung werden atomar
  gespeichert. Cloudflare wiederholt fehlgeschlagene Rundenwrites aus dem
  Durable-Object-Speicher. Raumcode-Kollisionen ueberschreiben keine Historie.
- Statistik/UI: reine Warteraeume zaehlen nicht als gespielte Partien,
  abgegebene Stimmen bleiben beim Reload erkennbar, Bildauswahl und laufende
  Videos werden nicht durch jeden Snapshot zurueckgesetzt. Mobile Statistik,
  Tastatur-Fokus, Dateiformate und Feedback fuer abgelaufene Videos verbessert.
- Abhaengigkeiten: bekannte npm-Audit-Sicherheitsluecken geschlossen und
  unbenutzten Gradio-Client entfernt. Datenbank-TLS wird nicht mehr pauschal
  ohne Zertifikatspruefung konfiguriert.
- Kontingent: offizielles HF-ZeroGPU-Restkontingent wird gelesen. Rundenauswahl,
  serverseitige Startpruefung und globale Reservierung beruecksichtigen GPU-Zeit
  und Aufruflimit. Vollstaendige Runden beruecksichtigen die Spielerzahl:
  zwei Runden mit drei Spielern reservieren sechs Videos. Lobby-Grenzen werden
  bei Beitritt/Verlassen aktualisiert; ausstehende Erstellungen von Spielern,
  die verlassen haben, entfallen. Fallbacks schuetzen reserviertes Budget.
  Die Rundengrenze beruecksichtigt den guenstigsten konfigurierten 5-Sekunden-Modus,
  ohne das gemeinsame HF-Kontingent mehrfach zu zaehlen. Aufwendigere laufende
  Jobs bleiben auch vor dem HF-Kontingentabzug geschuetzt.
- Zusatzrunden: Nach dem geplanten Ende wird das aktuelle Restkontingent neu
  gelesen. Nur der Host kann eine weitere vollstaendige Runde fuer alle
  verbleibenden Spieler reservieren. Raum, Spieler-IDs, Punkte und Historie
  bleiben erhalten; Endwertung und Sieg werden beim Fortsetzen zurueckgesetzt,
  damit die verlaengerte Partie in der Statistik nicht doppelt zaehlt.
- Identitaet: bewusst vereinfachter Einstieg nur mit Benutzername. Neue
  Profile haben eine feste ID und eine eindeutige normalisierte Namenskennung.
  Doppelte Erstellung ist serverseitig und per Datenbankindex gesperrt.
  Signierte HTTP-only-Browsersitzungen erhalten die ID nach Reload; vorhandene
  Namen lassen sich ohne Passwort weiterverwenden. Legacy-Statistiken bleiben erhalten.
- Archiv: private Neon-MP4-Dateien, 512-MB-Limit, automatische Loeschung
  aeltester Videos und authentifizierte Range-Auslieferung. Originalbilder
  werden nicht im eigenen Archiv gespeichert.
- Seitenstart: sichtbarer Lade-/Fehlerzustand statt leerem Rechteck. Browser-
  Bundles liegen getrennt von Node-Ausgaben, sodass ein unterbrochener
  TypeScript-Build keine CommonJS-Datei als Browser-Script ausliefert.
- KI-Ausfallsicherheit: dauerhaftes Journal mit Event-ID und Auftragsstatus,
  Wiederaufnahme derselben Ergebnisabfrage nach Worker-Neustart oder Netzfehler.
  Keine blinden Fallbacks bei ungeklaerten POST-Antworten. Abgebrochene Ersteller-
  Jobs werden im Hintergrund abgeschlossen, Budgetfreigaben dauerhaft wiederholt.
- Leichter Zugriffsschutz: keine neuen Passwoerter, aber begrenzte HTTP- und
  Spielnachrichten. Anonyme Aufrufe fragen kein echtes HF-Kontingent ab;
  Anzeige-Cache und frische Startpruefung sind getrennt. Technische KI-Logs
  enthalten keine Bilder, Prompts oder Tokens. CI fuer Push und Pull Request.

## Verifikation

- TypeScript-Build fuer Node, Browser und Cloudflare erfolgreich.
- 53 automatisierte Tests fuer Spiellogik, KI-Protokoll, Worker, Quota,
  Archiv und Zugriffskontrolle bestanden.
- Mehrere getrennte Browser-Sitzungen: drei Spieler, zwei vollstaendige Runden
  mit sechs Videos, Punkten und Endwertung,
  Reload, neues Spiel, Ersteller verlaesst, Wiederverbindung und Statistiken.
  Chromium und WebKit bestanden; Desktop und mobile Darstellung geprueft.
- Neon: Transaktionen, doppelte Rundenspeicherung, Endwertung, Statistik und
  Rollback mit temporaeren Tabellen geprueft. Keine Produktiv-Spielzeilen
  angelegt oder veraendert. Cloudflare-DB-Schreibpfad nicht live belastet.
- Oeffentliche Cloudflare-Seite, Konfiguration und Statistik antworteten;
  Worker-Bindings/Secrets und Deployment-Bundle geprueft.
- Echter Wan-2.2-Test mit einem oeffentlichen Busfoto: abspielbares Video,
  5,06 Sekunden, 624 x 832 Pixel. Der Bus bewegt sich sichtbar auf die Kamera
  zu, passend zum Testprompt. Kleine Bildverformungen sind weiterhin sichtbar.
- npm audit: keine gemeldeten Sicherheitsluecken zum Pruefzeitpunkt.
- Browser-Profileinstieg: nur ein Namensfeld, Duplikatpruefung, Namensuebernahme,
  Reload, Raumwiederherstellung und Abmeldung. PostgreSQL-Namenseindeutigkeit
  einschliesslich gleichzeitiger Erstellung in temporaeren Tabellen getestet.
- Echte HF-Kontingentabfrage und privates Neon-S3-Archiv getestet: MP4-Upload,
  Byte-Range 206 und anschliessende Loeschung ausschliesslich des Testvideos.
- Simulierte fehlende Browser-Datei, Backend-Ausfall, Rundenauswahl 1 statt
  100 und Sperre bei Kontingent 0 in Chromium und WebKit bestanden.
- Spielerabhaengiges Kontingent mit Fallback-Sparmodus geprueft: 185 GPU-Sekunden
  erlauben eine vollstaendige Zwei-Spieler-Runde mit zwei 5-Sekunden-Videos.
  Ein dritter Spieler benoetigt mehr Budget. Beitritt und
  Verlassen passen die Auswahl an; drei Spieler mit zwei Runden reservieren
  sechs Videos. Wiederholungen schuetzen alle noch ausstehenden Erstellungen.
- KI-Protokolltests pruefen den 4-Schritte-Aufruf bei knappen 185 Sekunden,
  8 Schritte bei ausreichend Budget und erneute Kontingentpruefung vor Fallbacks.
  Kein weiterer echter GPU-Job fuer diese Fallback-Erweiterung gestartet;
  die Bildqualitaet des 4-Schritte-Modus ist nicht live verifiziert.
- Zusatzrunden in Chromium und WebKit sowie gegen den lokalen Cloudflare-Worker
  getestet: Zwei Spieler erreichen sechs Videos in drei Durchgaengen bei
  simuliertem guenstigem Verbrauch. Hostberechtigung, erneute Kontingentpruefung,
  doppelte Startanfragen, Reload und mobiles Layout bestanden. Kein echter
  GPU-Job. Neon-Transaktionen pruefen dieselbe Partie vor und nach Fortsetzung;
  Worker-Tests pruefen die dauerhafte Write-Warteschlange bei Datenbankausfall.

## Verbleibende Grenzen

- Kein produktives Deployment im Rahmen dieser Pruefung. Der Git-Push allein
  aktiviert die Aenderungen noch nicht auf Cloudflare. Ein neuer HF_TOKEN in .env.local aktualisiert
  nicht automatisch den Cloudflare-Secret.
- Kostenloses Hugging Face garantiert weder Verfuegbarkeit noch Prompttreue.
  ZeroGPU-Kontingente gelten pro Account, nicht additiv pro Fallback-Space.
  Die Rundenkosten sind konservativ aus den Space-Einstellungen geschaetzt;
  HF-Nutzung ausserhalb des Spiels oder GPU-verbrauchende Fehlversuche koennen
  bereits reservierte Budgets vermindern. Es gibt keine bezahlten Credits.
- Bereits abgelaufene historische HF-Links lassen sich nicht retten.
  Bei einem Archiv-Ausfall bleibt ein temporaerer Link mit Warnung erhalten.
  Die App kann externe Loeschfristen der HF-Spaces nicht erzwingen.
- Der Benutzername ist bewusst kein Identitaetsnachweis: Jeder kann einen
  bekannten Namen verwenden und damit unter diesem Profil spielen. Die Seite
  ist nicht auf Freunde beschraenkt; Neon-Auth-Anmeldung und Zugangscode sind entfernt.
- Ein verlorenes HF-Start-POST ohne Event-ID kann nicht eindeutig wiederhergestellt
  werden. Es wird kein zweiter Auftrag auf Verdacht gestartet; nach 15 Minuten
  endet der Versuch, seine ungeklaerte Reservierung laeuft erst nach TTL aus.
  Bereits geloeschte Space-Ergebnisse koennen nicht gerettet werden. Beim lokalen
  Node-Prozessneustart gehen laufende Raumzustaende weiterhin verloren.
  Dauerhafte DB-/Quota-Wiederholung gilt fuer Cloudflare, nicht fuer Node.

Start-, Test- und Deployment-Befehle stehen in README.md.
