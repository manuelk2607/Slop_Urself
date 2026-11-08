# Slop Urself – Worlds-Integration

Stand: 08.11.2026. Featurebranch `feature/worlds-hub-sso`.
Produktives Spiel und seine Daten sind nicht umgestellt. Der eigene Worker
`slopurself-worlds-pilot` verwendet ausschließlich den wiederhergestellten
QA-Zweig und simulierte Videogenerierung; noindex/no-store bleibt erhalten.
Ausführliche Protokolle: `docs/WORLDS-PILOT.md`.

## Nachgewiesen

- Version `7ec02df`, vollständige CI `42495932891` und Deploy `42496881577`
  erfolgreich. 162 Tests, Node-/Worker-Typprüfung, Build, Chromium/WebKit und
  echte PostgreSQL-Parallelität einschließlich einmaliger Betreiberfreigabe.
- Profil `Manuel` nach ausdrücklicher Benennung durch den Eigentümer ohne
  Slop-Passwort in QA zugeordnet. Ziel-Subject mit zentral bestätigter Identität
  gegengeprüft. Vorschau/Rollback und spätere Anwendung erfolgreich; alle sechs
  Quelltabellen nach Zahl und Prüfsumme identisch, 13 Profile unverändert.
- Echter zentraler Anmeldelink kehrt ohne Passwort/Code/Freigabe zur bestehenden
  Zuordnung zurück. Spiel-Lobby zeigt das historische Profil. Zusätzlich echte
  lokale Abmeldung und erneute automatische SSO-Rückkehr zum gleichen Profil
  geprüft. Keine Räume angelegt, keine HF-Verbindung oder Generierung verändert.
- Vor der Migration ausgestellte gültige Legacy-Tokens bleiben bis zum bisherigen
  Ablauf erhalten; Refresh verlängert sie nicht. Neue lokale Username-Anmeldung
  für zugeordnete Profile wird abgewiesen. HF-Vault und Jobs bleiben separat.

## Aktuelles Arbeitspaket

Die Meldung nach Sitzungsablauf führt in DE/EN zur zentralen Anmeldung und fordert
keinen lokalen Benutzernamen mehr. Der Worlds-Kontolink übernimmt den vorhandenen
Stil und einen sichtbaren Tastaturfokus. 162 Tests und Build bestanden.
Chromium/WebKit prüfen mit Testantworten den fünfminütigen Refresh, 401,
lokalisierte Ablaufmeldung, ausgeblendete lokale Formulare und erhaltenen Link.
Vollständige GitHub-CI für `35d26ad` ist erfolgreich (`42515091102`).
Die separate Pilotveröffentlichung dieses exakten Stands wurde gestartet.
Zusätzliche read-only Diagnose prüft Feldnamen der neueren Cloudflare-
Versionsmetadaten; weder Werte noch Geheimnisse werden protokolliert. Neun
gezielte Prüfer-/Rücknahmetests und separate Typprüfung bestanden. Eine reine
Inspektion benötigt keine neue vollständige Anwendungs-CI; jede Veröffentlichung
und jeder tatsächliche Versionswechsel verlangen sie weiterhin für exakt ihren
Commit. Der bestehende Rücknahmevergleich bleibt unverändert streng.

## Offen / nächster Schritt

Die reale Deployment-Rücknahme fehlt: Cloudflare liefert beim Versionsvergleich
keinen Asset-Manifesthash. Die vorhandene strenge Prüfung stoppt deshalb sicher,
statt Gleichheit zu behaupten. Globale Abmeldung, weitere echte Daten-/Rollen-/
HF-Zuordnungen und produktiver Cutover bleiben offen. Produktionsinventar:
13 Profile, davon 9 ohne Passwort, 15 Spieler, 4 Runden, 2 Stimmen, 4 Videos;
keine produktiven Worlds-Zuordnungen. Kein allgemeiner Fremd-Session-/Hashimport
in die zentrale Managed-Auth-Instanz nachgewiesen. Nur die geprüfte QA-Zuordnung
ist abgeschlossen; niemandem werden Namen oder E-Mails automatisch zugeordnet.
