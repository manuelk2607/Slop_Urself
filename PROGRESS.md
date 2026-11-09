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
Pilotveröffentlichung `42515687781` erfolgreich. Aktive Version
`514bc3d9-e302-49f8-a6e0-b229152d6dc8`, Deployment
`dfd89eff-6a83-4441-9ed7-4240bcad0db9`. Live werden beide Ablaufmeldungen
ausgeliefert; echter Browser-Reload behält Manuel angemeldet.
Zusätzliche read-only Diagnose prüft Feldnamen der neueren Cloudflare-
Versionsmetadaten; weder Werte noch Geheimnisse werden protokolliert. Neun
gezielte Prüfer-/Rücknahmetests und separate Typprüfung bestanden. Eine reine
Inspektion benötigt keine neue vollständige Anwendungs-CI; jede Veröffentlichung
und jeder tatsächliche Versionswechsel verlangen sie weiterhin für exakt ihren
Commit. Der bestehende Rücknahmevergleich bleibt unverändert streng. Diagnosecommit
`fc4fc60` bestand auch die vollständige CI `42515706390` in Chromium und WebKit
(163 Unit-Tests plus bestehende PostgreSQL-/Browserintegration). Reine Inspektion
`42515850838` bestätigt auch in der neueren API ausschließlich Asset-Konfiguration,
keinen Manifesthash; keine kompatiblen Kandidaten und kein Versionswechsel.

## Tatsächlich ausgelieferte Testversion nachweisen

Die isolierte Worker-Konfiguration ergänzt die offizielle Versionsmetadaten-
Bindung. Ausschließlich der Testworker liefert daraus eine öffentliche Versions-ID
im Antwortheader. Eingesendete Header werden dafür nicht verwendet; produktive
Antworten und WebSocket-Handshakes bleiben erhalten. Die lesende Pilotprüfung
kann eine angeforderte Version gegen die tatsächliche Laufzeit-ID prüfen und
weist einen stillen Rückfall auf die bisherige Version ab.

166 Unit-Tests, Node-/Worker-Typprüfungen, Build und die separate Typprüfung des
Rücknahmewerkzeugs bestanden. Elf gezielte Rücknahme-/Diagnosetests prüfen auch
fehlende/falsche IDs, manipulierte Requestheader und WebSocket-Erhalt.
Vollständige GitHub-CI und Veröffentlichung dieses Pakets sind noch ausstehend.
Der bestehende Asset-Manifestvergleich bleibt streng; dieses Paket allein
beweist keine durchgeführte Deployment-Rücknahme. Nächster Schritt ist die
Versionsabnahme im Testworker, danach ein Kandidat mit 0 Prozent Normalverkehr
und tatsächlich verifizierten Asset-Prüfsummen.

## Kontrollierte Rücknahme mit vollständigem Dateinachweis

Zusätzlich vorbereitet: Ein vollständiger Build bindet Commit und SHA-256-
Dateiliste als öffentliche Metadaten an die Testversion. Das Werkzeug lädt aus
demselben geprüften Build einen Kandidaten hoch und stellt ihn zuerst auf
**0 Prozent normalen Verkehr**. Jeder Abruf muss durch die Laufzeit-ID die
richtige Version beweisen; alle statisch ausgelieferten Dateien müssen mit dem
geprüften Build übereinstimmen. Code, Runtime, sämtliche Bindings, Secrets-
Metadaten und Konfiguration müssen ebenfalls identisch sein. Der bisherige
Vergleich mit Anbieter-Manifesthash bleibt unverändert.

Erst danach ist der kurze vollständige Wechsel zum identischen Kandidaten mit
anschließender garantierter Rückstellung vorgesehen. Fehler und nachträgliche
fremde Deployments stoppen den Ablauf; kein `force`, keine Änderung gebundener
Daten. Tests prüfen Prüfsummenfehler, stillen Versionsrückfall, konkurrierende
Deployments sowie unklare Antworten nach bereits ausgeführten Änderungen.
Dies ist noch kein tatsächlicher Rücknahmenachweis. Die neue vollständige CI,
Veröffentlichung mit Versions-/Buildnachweis und der externe Ablauf stehen aus.

## Offen / nächster Schritt

Die reale Deployment-Rücknahme fehlt: Cloudflare liefert beim Versionsvergleich
keinen Asset-Manifesthash. Die vorhandene strenge Prüfung stoppt deshalb sicher,
statt Gleichheit zu behaupten. Globale Abmeldung, weitere echte Daten-/Rollen-/
HF-Zuordnungen und produktiver Cutover bleiben offen. Produktionsinventar:
13 Profile, davon 9 ohne Passwort, 15 Spieler, 4 Runden, 2 Stimmen, 4 Videos;
keine produktiven Worlds-Zuordnungen. Kein allgemeiner Fremd-Session-/Hashimport
in die zentrale Managed-Auth-Instanz nachgewiesen. Nur die geprüfte QA-Zuordnung
ist abgeschlossen; niemandem werden Namen oder E-Mails automatisch zugeordnet.
