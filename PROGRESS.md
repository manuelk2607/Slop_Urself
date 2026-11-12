# Slop Urself – Worlds-Integration

Featurebranch `feature/worlds-hub-sso`. Produktion und ihre Konten bleiben
unverändert. Der eigene Worker `slopurself-worlds-pilot` verwendet nur den
wiederhergestellten QA-Zweig, simulierte Generierung und noindex/no-store.
Ausführliche Protokolle: `docs/WORLDS-PILOT.md`.

## Produktive Worlds-Anmeldung

Die erste Freigabe ist auf die vorhandene Slop-Domain, den produktiven
Neon-Endpunkt und den registrierten Slop-OIDC-Client begrenzt. Verknüpfte
Profile melden sich zentral an. Für ausstehende Übernahmen bleibt der
bisherige Zugang erreichbar. Die HF-Pflicht gilt auch im Übergang.

Produktionsabgleich mit ausschließlich lesenden Abfragen am 12.11.:
Das bereits in QA übernommene passwortlose Profil stimmt über stabile
Profil-ID und Auth-Version mit dem Produktionsprofil überein. Produktion
enthält 13 Profile, 15 Spieler, 4 Runden, 2 Stimmen und 4 Videoeinträge.
Die Mapping-Tabelle fehlt. Der bestehende Sicherungszweig ist Kind der
Produktionsdatenbank und Ausgangspunkt des bereits geprüften QA-Restores.
Neon meldet sechs Stunden Wiederherstellungshistorie.

Das bestehende Migrationstool hat einen getrennten Produktionsmodus.
Er installiert die Worlds-Tabellen und übernimmt genau ein ausdrücklich
freigegebenes Profil in derselben Transaktion. Die Rücknahme verlangt
dieselbe Freigabereferenz, entfernt gezielt die Zuordnung und beendet
deren Worlds-Sitzungen. Vor Anwendung einen aktuellen Neon-
Wiederherstellungspunkt und die aktive Cloudflare-Version festhalten.
Nach Anwendung Profil-ID, Quelltabellen, zentralen Browser-Login und
HF-Pflicht prüfen. Bei Rücknahme den gespeicherten Worker-Stand aktivieren.

Die produktive Schaltung steht aus. Der vorhandene Cloudflare-
Deployment-Zugang gilt für den Testworker. Wrangler hat aktuell keinen
Zugang zum Produktionsworker. Die Produktionsdatenbank wurde nur gelesen.

Der Sender für Migrationsnachweise verwendet die gemeinsame, exakt
referenzierte Implementierung aus `@worlds-hub/auth` 0.1.6. Zustellziel,
Audit-Status und Datenbankverhalten bleiben wie zuvor. Lokal bestanden
178 Tests, Typprüfung und Build. GitHub **43197870625** bestand mit
179 Tests, PostgreSQL, Chromium und WebKit.

## Zentrale Abmeldung – 12.11.2026

Der Worlds-Client 0.1.5 akzeptiert signierte Sitzungswiderrufe vom Hub.
Der Projektserver sperrt damit frühere Worlds-Sitzungen und bisherige
lokale Tokens desselben verknüpften Profils. Profilzuordnung, Passwortversion
und eigenständige Hugging-Face-Verbindung bleiben erhalten.
178 lokale Tests, Typprüfung und Build bestanden. Ein Test mit lokalem
Postgres prüft die Signatur, Wiederholung, beide bisherigen Anmeldewege,
ein unbeteiligtes Profil und eine neuere Worlds-Sitzung.

Release `1a89485` bestand GitHub-CI **43190980122** mit Chromium und
WebKit. **43192117425** installierte die Widerrufstabelle im isolierten
Zweig `br-sparkling-firefly-b1pssf1o` und veröffentlichte den Empfänger
mit öffentlichem Testschlüssel. Aktive Version
`c024fc41-f994-48e3-ad6f-dd367812c6c6` lieferte HTTP 200 und noindex.
Die Live-Prüfung mit simuliertem zentralen Anmeldedienst und dem echten
Hub-Sender sperrte die vorherige passwortlose lokale Sitzung und die
vorherige Worlds-Sitzung. Die neuere Worlds-Sitzung, das Kontrollprofil
und die bestehende Projektzuordnung funktionierten weiter. Beide
künstlichen Testprofile und ihre Sitzungseinträge wurden entfernt.

Das echte Testkonto hatte vor der gemeinsamen Hub-Abmeldung eine
aktive Slop-Sitzung. Der erste Versand scheiterte in der Hub-Laufzeit.
Nach der Korrektur bestätigte Slop beim geplanten Wiederholungsversuch
den ursprünglichen Widerruf vom 12.11. um 11:02:39 MEZ. In der
QA-Datenbank blieben keine alten Sitzungen des Kontos. Der Hub-
Testschalter wurde anschließend zurückgenommen.

## Bestehendes Profil und zentrale Anmeldung

- Genau eine betreibergeprüfte QA-Zuordnung: das vom Eigentümer benannte
  passwortlose Profil Manuel zur beim zentralen Aussteller verifizierten
  Identität. Vorschau/Rollback und spätere Anwendung erfolgreich; sechs
  Quelltabellen nach Zahl und Prüfsumme identisch, 13 Profile unverändert.
- Echter zentraler Anmeldelink kehrt ohne neues Passwort, Code oder Consent
  zur Spiel-Lobby mit demselben Profil zurück. Lokale Abmeldung und erneute
  automatische SSO-Wiederkehr geprüft. Keine Räume oder echten Videos angelegt.
- Gültige alte Tokens behalten ihr ursprüngliches Ablaufdatum; Refresh verlängert
  sie nicht. Neue lokale Username-Anmeldung für zugeordnete Profile wird
  abgewiesen. HF-Vault, Kontingente, Jobs und Generierungssperren bleiben separat.
- Ablaufmeldung DE/EN führt zur zentralen Anmeldung. Kontolink übernimmt
  bestehenden Stil und sichtbaren Tastaturfokus; keine lokalen Passwortfelder
  im Worlds-Modus.

## Geprüfter und veröffentlichter Stand

Code `6bf3740`. Vollständige CI **42592633591** erfolgreich: **178/178 Unit-Tests
ohne Skips**, Node-/Worker- und Werkzeugtypen, echte PostgreSQL-17-Parallelität
sowie vollständige Chromium-/WebKit-Spiel- und Auth-Integration.
Veröffentlichung **42593695422** erfolgreich.

Aktive Version nach abschließender Rücknahme:
`fc844a11-1d66-40d6-b7e1-99b6981922f9`.
Live bestätigt: Ausgangsversion, HTTP 200, noindex/no-store. Keine Änderung der
Produktions-Origin, der produktiven Datenbank oder persönlicher HF-Verbindungen.

## Reale Deployment-Rücknahme abgeschlossen

Workflow **42593917604** erfolgreich: Kandidat
`5f7c87d4-585a-4319-b892-e768815c24e1` zunächst bei **0 Prozent** normalem Verkehr.
Alle **15 statisch ausgelieferten Dateien** beider Versionen wurden unter
nachgewiesener Laufzeit-ID mit dem geprüften Build verglichen. Digest:
`4a092c26ab07e0f1dd20768361c15cbcc1d1a5e815f186fd0ba83b3a672ad3aa`.
Code, Runtime, sämtliche Bindings, Secrets-Metadaten, Commit und Konfiguration
waren identisch. Anschließend Kandidat bei 100 Prozent (Deployment
`dce3b87d-bd56-4dbb-8781-e043d3e86695`), private Smoke-Prüfung bestanden,
Ausgangsversion wiederhergestellt und per Management-API/Laufzeit-ID bestätigt.
Alle sechs QA-Quelltabellen danach erneut nach Zahl und Prüfsumme identisch.

Der erste Lauf 42591696625 bestand bereits die Dateiprüfung und stellte die
Ausgangsversion wieder her, brach aber bei der sofortigen Nachkontrolle ab.
Lesende Diagnose 42592201712 bestätigte Wechsel und Rückkehr. Die begrenzte
Wartezeit auf bekannte Zwischenzustände behebt diese Bestätigung; kein
Schreibaufruf wird wiederholt und kein fremdes Deployment überschrieben.
Der bisherige strenge Anbieter-Manifestvergleich bleibt unverändert.

## Offen / nächster konkreter Schritt

Die Deployment-Rücknahme blockiert die nächste Phase nicht mehr. Weiter offen:
unterstützter globaler Logout, Kontolöschung, sichere Eigentumsnachweise für die
übrigen Profile, neue lokale Profile aus zentralen Identitäten und reale
HF-/Rollenabnahme vor produktiver Aktivierung. Kein allgemeiner Import fremder
Sessions oder Passwort-Hashes in Managed Auth nachgewiesen. Zentraler Login
ersetzt keine Eigentumsprüfung und schaltet keine Generierung frei.

Produktionsinventar: 13 Profile, davon 9 ohne Passwort, 15 Spieler, 4 Runden,
2 Stimmen, 4 Videos; **0 produktive Worlds-Zuordnungen**. Nächster Schritt ist der
vollständige normale Konto-/Migrationsablauf, danach kontrollierter produktiver
Rollout mit eigener Berechtigung für den produktiven Worker. Der begrenzte
Testworker-Token wird dafür nicht wiederverwendet.
