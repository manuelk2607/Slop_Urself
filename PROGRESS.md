# Slop Urself – Worlds-Integration

Featurebranch `feature/worlds-hub-sso`. Der eigene Worker
`slopurself-worlds-pilot` verwendet nur den
wiederhergestellten QA-Zweig, simulierte Generierung und noindex/no-store.
Ausführliche Protokolle: `docs/WORLDS-PILOT.md`.

## Produktive Worlds-Anmeldung

### Besitzerprofil-Rücksprung – 15.11.2026

Der reale Consent und Rücksprung haben die zentrale Identität korrekt mit dem
bestehenden Profil Manuel verknüpft. Die anschließende Spielanmeldung blieb
jedoch aus, weil die Laufzeit das zugleich als Besitzerkonto konfigurierte
Profil pauschal aus Worlds-Spielsitzungen ausschloss. Die Korrektur akzeptiert
nun auch ein bereits betreibergeprüft verknüpftes Besitzerprofil als normales
Spielprofil und erzwingt für dessen lokale Anmeldung Worlds Hub. Öffentliche
Selbstverknüpfung des Besitzerprofils bleibt gesperrt; Verwaltungsrechte
erfordern weiterhin den getrennten Verwaltungsschlüssel.

Lokal bestanden 181 Tests (ein dokumentierter Build-Test übersprungen),
Typprüfung und Build. Commit `a8d2960` bestand GitHub **43731189933** in
PostgreSQL 17 sowie Chromium und WebKit. Produktiv ist Version
`e2e6566b-53d3-4f1d-a368-84c1fd5e6812` aktiv.

Der bestehende Safari-Login zeigte nach Neuladen „Mit diesem Profil spielen“
statt der erneuten Anmeldung. Der Wechsel öffnete die echte Spiel-Lobby als
Manuel. Ohne persönliche HF-Verbindung blieb die Raum-Erstellung mit
„HF verbinden“ gesperrt. Produktiv bestehen genau eine Identitätszuordnung
und eine aktive Worlds-Spielsitzung; kein Widerruf. Die sechs Projektquellen
blieben bei 13 Profilen, 12 Räumen, 15 Spielern, 4 Runden, 2 Stimmen und
4 Videoeinträgen. Sämtliche sechs Prüfsummen stimmen exakt mit dem Stand vor
dieser Korrektur überein.

### Produktive Datenfreigabe – 15.11.2026

Nach ausdrücklicher Freigabe wurde der compute-freie Sicherungszweig
`before-worlds-production-20261115` (`br-summer-frog-b14e2j9y`) direkt von
Produktion angelegt und als bereit bestätigt. Wiederherstellungspunkt:
`0/3C24AC8`. Der geprüfte Produktionslauf bestand zuerst vollständig mit
Rollback und wurde danach einmal angewendet. Er installierte ausschließlich
die additiven Worlds-Tabellen und verknüpfte genau das bestätigte
passwortlose Profil Manuel mit der verifizierten zentralen Identität.

Nach Anwendung: genau eine Worlds-Zuordnung, eine verbrauchte Freigabe,
keine Worlds-Sitzung und kein Widerruf. Die sechs Projektquellen blieben
exakt unverändert: 13 Profile, 12 Räume, 15 Spieler, 4 Runden, 2 Stimmen,
4 Videoeinträge; alle Prüfsummen stimmen mit dem Stand vor der Migration
überein. HF-Verbindungen und Generierung wurden nicht verändert.

Der Produktivworker wurde nach erfolgreicher persönlicher Wrangler-Anmeldung
mit dem abgesicherten Worlds-Modus veröffentlicht. Ausgangsversion
`4b62baad-18a8-4489-9f1e-5e5925146f1a`, neue aktive Version
`bc0caef6-046f-4437-a315-c64e5155e440`, Deployment
`31f34ce2-13b2-4ac9-b879-9382a16abd85`, 100 Prozent Traffic. Alle bisherigen
Spiel-, HF-, Storage- und Durable-Object-Bindings blieben erhalten.

Live bestätigt: Startseite, robots und Sitemap HTTP 200; anonyme private
Session HTTP 401 mit no-store/noindex; Worlds-Loginstart HTTP 303 zum exakten
Hub-Anbieter mit PKCE-S256, registriertem Client/Callback und sicherem
hostgebundenem HttpOnly-Lax-Cookie. Alle sechs Projektquellen stimmen nach dem
Deployment weiterhin per Anzahl und Prüfsumme exakt überein. Die reale
Consent-Seite für Slop Urself wurde mit der vorhandenen zentralen Sitzung
erreicht. Consent, Zuordnung zum Profil Manuel, aktiver Rücksprung in die
Spiel-Lobby und die weiterhin erzwungene HF-Pflicht sind produktiv bestätigt.
Die produktive Abmeldung bleibt noch offen.

Erneuter lesender Produktionsabgleich am 15.11.2026, 09:40:46 UTC,
WAL `0/3C04130`: 13 Profile, 15 Spieler, 12 Räume, 4 Runden, 2 Stimmen
und 4 Videoeinträge. Alle sechs Quelltabellen erhielten neue Prüfsummen.
Das eindeutig benannte passwortlose Profil ist weiterhin einmal vorhanden
und unverändert auf Auth-Version 0. Zu diesem Zeitpunkt fehlten Worlds-
Tabellen und Zuordnungen noch. Die ältere QA-Sicherung bildet den inzwischen gewachsenen
Produktionsstand daher nicht mehr vollständig ab und wird nicht als aktueller
Rücksetzpunkt verwendet. Vor einer Schaltung ist eine neue Sicherung nötig.
Die öffentliche Produktion zeigt weiterhin den bisherigen lokalen Login.

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
Alle sechs Quelltabellen stimmen heute per Prüfsumme mit dem wieder-
hergestellten Stand überein. Neon meldet sechs Stunden Wiederherstellungs-
historie. Cloudflare zeigt `4b62baad` bei 100 Prozent als Ausgangsversion.
Der öffentliche Slop-OIDC-Client ist aktiviert und hat die genaue
Produktions-Callback-Adresse sowie die passende Ressource.

Das bestehende Migrationstool hat einen getrennten Produktionsmodus.
Er installiert die Worlds-Tabellen und übernimmt genau ein ausdrücklich
freigegebenes Profil in derselben Transaktion. Die Rücknahme verlangt
dieselbe Freigabereferenz, entfernt gezielt die Zuordnung und beendet
deren Worlds-Sitzungen. Vor Anwendung einen aktuellen Neon-
Wiederherstellungspunkt und die aktive Cloudflare-Version festhalten.
Nach Anwendung Profil-ID, Quelltabellen, zentralen Browser-Login und
HF-Pflicht prüfen. Bei Rücknahme den gespeicherten Worker-Stand aktivieren.

Die produktive Worker-Schaltung und Datenmigration sind abgeschlossen; alle
Projektquellen blieben unverändert. Die vorübergehende Wrangler-Anmeldung
wird nach der noch offenen persönlichen Browserabnahme wieder entfernt.
Der produktive Schalter und der weiter nutzbare Administrationszugang
in `191501e` sind lokal typgeprüft. GitHub **43204100289** bestätigte
Chromium, WebKit und die PostgreSQL-Integration.

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

### Sicherer Worlds-Produktivweg – 15.11.2026

Der allgemeine Cloudflare-Upload erhält nun vorhandene Dashboard-Variablen.
Worlds lässt sich nur über einen eigenen Produktionsmodus aktivieren; dieser
akzeptiert ausschließlich die fest geprüfte Slop-Datenbank und kontrolliert vor
dem echten Upload alle erforderlichen Worlds-Tabellen. Ein lokaler Trockenlauf
bestätigte bestehende Spiel-/HF-Bindings plus die vier exakten Worlds-Bindings,
ohne Upload. **181/181 ausgeführte Tests** (ein unveränderter CI-Artefakttest
planmäßig übersprungen) und Build bestanden. Produktion wurde nicht verändert.

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
