# Worlds-Pilot für Slop Urself

Der Pilot auf `feature/worlds-hub-sso` verwendet den OIDC-Codeflow mit PKCE
aus Worlds Hub. Der OIDC-Client in `src/auth/worlds-shared/oidc.ts`
entspricht `auth-v0.1.1` aus Worlds-Hub. Er fordert einen maximal fünf
Minuten alten Login mit `max_age=300` an und prüft dessen signierten
Anmeldezeitpunkt. Die übrigen gemeinsamen Dateien stammen aus der
ursprünglichen Integration, Revision `049279b`.

- Standardmäßig antworten die privaten Pilotrouten mit 404. Das Flag
  `WORLDS_PILOT_ENABLED=true` erfordert eine exakte separate HTTPS-Origin
  und einen passenden `WORLDS_PILOT_DATABASE_HOST`. Der produktive Worker
  und sein Neon-Endpunkt einschließlich Pooler werden abgewiesen.
- Das additive Schema wird ausschließlich mit `npm run worlds:schema` im
  ausdrücklich konfigurierten Testziel installiert. `DATABASE_URL` gehört
  in die Geheimnisverwaltung des Testziels. Das Skript gibt die Verbindung
  bei Fehlern nicht aus.
- Der isolierte Client benötigt `WORLDS_ISSUER`, `WORLDS_CLIENT_ID` und
  `WORLDS_RESOURCE`, einen beim Anbieter registrierten `/auth/callback`
  und für Logout-Signale `/auth/backchannel-logout`. Node unterstützt einen
  lokalen HTTPS-Reverse-Proxy mit `WORLDS_TRUST_LOOPBACK_PROXY=true`. Der Proxy
  setzt Host und Protokoll selbst und überschreibt eingehende Forwarded-Header.
  Für Cloudflare steht `cloudflare/wrangler.worlds-pilot.toml` bereit. Der
  Worker `slopurself-worlds-pilot` verlangt das isolierte Datenbankziel und
  nutzt simulierte Videos. Seine Seiten und Assets sind von der Indexierung
  ausgeschlossen. Den Pilot-Client mit exakt
  `https://slopurself-worlds-pilot.maki26.workers.dev/auth/callback` beim
  Anbieter und in der Consent-Registry des Hubs registrieren. Den Pilot erst
  nach Einrichtung des Testziels, der Secrets und des Clients aktivieren.
  Die Konfiguration lässt sich mit `npm run build` und
  `npx wrangler deploy --dry-run --config cloudflare/wrangler.worlds-pilot.toml`
  prüfen.
- `/auth/worlds` startet den Login. Die Verknüpfung verlangt die aktive
  lokale Sitzung, das aktuelle Passwort, frisches signiertes `auth_time`
  und eine ausdrückliche Bestätigung mit CSRF-Schutz. Profile ohne Passwort
  und das Administrationskonto sind im Pilot ausgenommen.
- Die SQL-Transaktion prüft nochmals Sitzung, Ablauf und Passwortversion.
  Zuordnung und Audit schreiben gemeinsam. Das Mapping referenziert die
  vorhandene lokale ID, die auch HF-Anbindung, Kontingente und Jobs verwenden.

`WORLDS_REAUTH_ENABLED` ist grundsätzlich ausgeschaltet. Die separate
Pilotkonfiguration aktiviert es nach dem realen positiven `max_age`-Nachweis
für die noch ausstehende vollständige Browserabnahme. Die produktive
Slop-Konfiguration bleibt unverändert. Die HTTP- und WebSocket-Spielersitzungen verwenden die lokale
ID aus dem Mapping. Bei bereits aktiver lokaler Anmeldung entscheidet der
Benutzer über den Wechsel. Es wird kein Worlds- oder HF-Token an das Spielskript
ausgegeben. Jede Spielaktion prüft die Gültigkeit der Sitzung. Passwortwechsel,
Profilverlust und Abmeldung beenden die betroffenen Spielersitzungen. Die
persönliche HF-Verbindung bleibt an dieselbe lokale ID gebunden und muss
separat gültig sein. Node und die separate Cloudflare-Konfiguration bereinigen
stündlich bis zu 250 abgelaufene Transaktionen, Sitzungen und Replay-Einträge
je Tabelle. Die echte Abnahme setzt die Cloudflare-Anmeldung, das isolierte
Datenbankziel und den registrierten Pilot-Client voraus.

Lokale Abnahme am 5. November 2026. Ein signierter Testanbieter lieferte
Ed25519-ID-Tokens und bestätigte PKCE, Callback-Bindung und Replay-Schutz.
PGlite bestätigte die atomische Zuordnung, auch bei gleichzeitiger Bestätigung,
Passwortwechsel und Sitzungswiderruf. Der workerd-Test prüfte den bestehenden
persönlichen HF-Device-/OAuth-Ablauf, die Einzelkontingente und Abmeldung mit
Testantworten. 147 Tests, Node-/Worker-Typprüfung und Build, Node-Start und
Worker-Trockenlauf bestanden. Der bestehende Produktionsaudit meldete sechs
Befunde auf Basis und Featurebranch mit derselben Paketliste.

Der nachfolgende workerd-Test bestätigte die lokale Profil-ID über die HTTP-API,
den HF-Pflichtdialog über einen echten lokalen WebSocket und die Sperre derselben
Verbindung nach Logout. Auch ein gültiger lokaler Spieltoken kann die
Widerrufsprüfung einer Worlds-Verbindung nicht ersetzen. Der PostgreSQL-Test
prüfte die separate HF-Verbindung, den Schutz vor fremden HF-Verbindungen und
den ausstehenden HF-Codeaustausch nach Logout. Alle externen Antworten in diesen
Tests stammen aus Fixtures.

Der Node-Test mit lokalem PostgreSQL 17 prüfte den Login mit den Headern des
lokalen HTTPS-Proxys, die HF-Sperre über Socket.IO, den Widerruf nach Logout
und die begrenzte Bereinigung einschließlich gültiger Sitzungen. Build,
Pilot-Trockenlauf, 148 Unit-Tests und beide workerd-Integrationen bestanden.

Am 07.11.2026 wurden die Migrationsnachweise und der gemeinsame Anmeldeclient
erneut geprüft. 149 Unit-Tests, Node-/Worker-Typprüfung, Build sowie die
workerd-HF-/Logout-Abnahme bestanden. Die CI von Commit `296e74d` ist für
Chromium und WebKit erfolgreich. Der reale Hub-QA-Anbieter bestätigte
frische ID-Tokens mit positivem `max_age` sowie die erneute Anmeldung
einer gealterten Sitzung. Die vollständige Slop-Browserabnahme bleibt offen.

## Bereitstellung am 08.11.2026

Die Sicherung `br-empty-mouse-b1uodoxw` hält die Produktion
`br-soft-math-b1efy5s0` bei LSN `0/3A99470` ohne eigenen Compute fest.
Die Wiederherstellung `br-sparkling-firefly-b1pssf1o` wurde separat geprüft.
Alle sechs Datentabellen hatten dieselben Zeilenzahlen und Prüfsummen wie
die Quelle. Die 13 Profile blieben nach der additiven Schemaeinrichtung
und dem transaktional zurückgerollten Verknüpfungstest erhalten.

Der eigene öffentliche Client `xHmQeQbWdDlBfOasyyBysjtNwInTdpuG`
verwendet ausschließlich
`https://slopurself-worlds-pilot.maki26.workers.dev/auth/callback`
und die Ressource derselben Pilot-Origin mit `/api`.
Die kostenlose zentrale Identity-Pilotinstanz bleibt der Aussteller.
Die Konfiguration bindet ausschließlich den wiederhergestellten Datenbankhost.

Der ausdrücklich freigegebene Token `slop-worlds-pilot deploy` hat nur
`Workers Scripts Write` und endet am 08.12.2026. Er liegt als
`CLOUDFLARE_API_TOKEN` in der GitHub-Umgebung `worlds-pilot`.
Diese Umgebung akzeptiert ausschließlich den Branch
`feature/worlds-hub-sso`. Die Datenbankverbindung und der separate
Cookie-Schlüssel liegen dort ebenfalls als verschlüsselte Secrets.

Der manuelle Workflow `worlds-pilot.yml` verlangt zunächst die vollständige
erfolgreiche Chromium-/WebKit-CI für seinen Commit. Danach baut und testet
er erneut, deployt den fest vorgegebenen Pilot-Worker und konfiguriert
seine beiden Runtime-Secrets. Der abschließende Smoke prüft die erreichbare
Pilotseite und den privaten Indexierungs- und Cache-Schutz.

Der WebKit-Fehler aus Lauf `42409781590` trat bei einer Spiel-Checkbox auf.
Drei lokale Wiederholungen desselben Worker-Tests mit der passenden
WebKit-Version bestanden. Der vollständige Lauf `42464544452` für
`290f36a` bestand danach beide Browser und die PostgreSQL-Integrationen.

Deploylauf `42465065850` legte den separaten Worker samt Secrets an.
Seine unmittelbare Root-Prüfung traf noch die Verteilung der Secrets
und erhielt 503; der nachfolgende Liveabruf bestätigte 200 samt
`no-store` und `noindex`. Der Workflow wartet jetzt bei 503 begrenzt
bis zu 33 Sekunden, ohne die abschließenden Bedingungen zu lockern.

Die echte Formularnavigation offenbarte außerdem ein Origin-Problem:
`Referrer-Policy: no-referrer` unterdrückte den für native POST-Formulare
benötigten Herkunftsnachweis. Die Pilot-Kontoseite verwendet nun
`same-origin`. An fremde Ziele wird weiterhin kein Referrer gesendet.
Der neue Browser-Regressionstest reproduzierte zunächst 403 und bestätigte
nach der Korrektur den nativen Formularstart. Anfragen mit `Origin: null`
oder fremder Origin bleiben abgewiesen. Beide Browser prüfen dies in der CI.
149 Unit-Tests und der Node-/Worker-Build bestanden lokal erneut.

## Migrationsnachweis und Rücknahme

Das Pilot-Schema verwendet das vorhandene Audit als Versandwarteschlange.
Setze im isolierten Pilot `WORLDS_RECEIPT_URL` auf die vollständige
HTTPS-Adresse `/api/migrations/receipts/slop-urself` des isolierten Hubs.
`WORLDS_RECEIPT_KID` benennt den dort registrierten öffentlichen Schlüssel.
`WORLDS_RECEIPT_KEY` enthält den passenden privaten Ed25519-JWK und gehört
ausschließlich in die Geheimnisverwaltung. Die Produktion des Hubs ist als
Ziel gesperrt. Ohne diese Einstellungen bleibt der Versand aus.

Der stündliche Lauf versucht bis zu zehn bereits protokollierte Änderungen.
Ein fehlender Empfangsnachweis lässt die Zeile zur Wiederholung offen.
Ein Zuordnungskonflikt setzt `receipt_conflict_at` und erfordert eine
manuelle Prüfung von Zuordnung, Aussteller und Audit. Der Versand verwendet
eine Prüfsumme der lokalen Profil-ID und übermittelt keine Anmeldedaten,
HF-Verbindungen oder Spielstände.

Für die Rücknahme im verifizierten Pilotziel prüfe zuerst die gespeicherte
Zuordnung und führe eine transaktionale Löschung mit allen drei
parametrisierten Bedingungen `issuer`, `subject` und `local_user_id` aus.
Bestätige genau eine gelöschte Zuordnung. Der Trigger protokolliert dabei
den Widerruf und löscht die Slop-Worlds-Sitzungen dieses zentralen Kontos.
Die lokale Profil-ID bleibt erhalten. Prüfe anschließend die lokale
Anmeldung und den widerrufenen Nachweis im isolierten Hub.


## Kontrollierte Deployment-Rücknahme

Der manuelle Pilot-Workflow bietet `inspect-rollback` und `exercise-rollback`.
Beide verwenden nur die vorhandene Umgebung `worlds-pilot`, denselben
Branchschutz und dieselbe Deployment-Sperre wie die Bereitstellung. Vorher
muss die vollständige CI für genau diesen Commit erfolgreich sein.

`inspect-rollback` liest ausschließlich die Versionen des fest vorgegebenen
Pilot-Workers und prüft seine private Erreichbarkeit. Ausgegeben werden nur
Versionskennungen, Code-Prüfsumme und Feldnamen der Bindungen. Keine Werte
von Secrets oder Verbindungen erscheinen in den Protokollen.

`exercise-rollback` verlangt eine ausdrückliche andere Versions-UUID und
identischen Code, identische Assets, Ressourcenbindungen, Variablen und
Laufzeiteinstellungen. Ein fehlender Asset-Nachweis sperrt die Übung.
Es gibt keine `force`-Option. Die Cloudflare-Kompatibilitätsprüfung für
undurchsichtige Secret-Versionen bleibt zusätzlich wirksam.

Nach dem Versionswechsel wird die private Seite geprüft und die ursprüngliche
Version auch bei fehlgeschlagener Kandidatenprüfung wiederhergestellt.
Ein möglicherweise bereits wirksamer, aber zeitlich abgebrochener Schreibaufruf
wird erst durch erneutes Lesen geklärt. Zwischenzeitlich von anderen Stellen
bereitgestellte Versionen werden nicht überschrieben. Abschließend werden
Ausgangsversion und private Erreichbarkeit geprüft. Datenbanken, Zuordnungen
und gespeicherte Durable-Object-Daten werden dabei nicht zurückgesetzt.

Acht Regressionstests prüfen Kompatibilität, Fehlerbehandlung, Wiederherstellung,
unklare Schreibantworten, konkurrierende Deployments und den festen Worker.
Vollständige CI `42489252839` bestand beide Browser und PostgreSQL. Der erste
lesende Prüflauf `42489823444` scheiterte ohne Deploymentänderung. Ein zusätzlicher
Test prüft die vollständige private Erreichbarkeitsprüfung einschließlich des
nur einmal gelesenen robots-Inhalts. Die tatsächliche Cloudflare-Übung steht bis
zur erfolgreichen Metadatenprüfung noch aus.


## Echte Anmeldung und Kontodarstellung am 08.11.

Der Nutzer bestätigte die persönliche Anmeldung und Freigabe für Slop Urself
Pilot. Der Browser kehrte nach `/auth/worlds` zurück und zeigte eine aktive
Worlds-Sitzung. Das ist noch keine Verknüpfung eines lokalen Spielprofils.
Die bisherige Kontoseite war ungestaltetes HTML ohne Stylesheet und bot das
Passwortformular auch ohne vorhandene lokale Anmeldung an.

Die Kontoseite lädt jetzt die vorhandene Slop-Gestaltung und einen eigenen
kleinen Sprachclient ohne Initialisierung des Spiels. Status, nächster Schritt,
Profilname und HF-Pflicht sind deutlich sichtbar. Ohne lokale Anmeldung führt
sie zuerst zum vorhandenen Spielprofil. Das Verknüpfungsformular erscheint nur
für ein aktives, passwortgeschütztes Nicht-Admin-Profil und einen frischen
zentralen Nachweis. Die POST-Route prüft dieselben Voraussetzungen weiterhin
unabhängig von der Anzeige. Es wird kein Profil automatisch angelegt/verknüpft.

Getrennte DE/EN-Kataloge verwenden `de`/`en`, den lokalen Schlüssel
`worlds.locale` und einen sicheren hostgebundenen Locale-Cookie. `ui_locales`
reicht die Auswahl beim Login an den Hub weiter. Der Sprachwechsel erhält
Passworteingabe und CSRF-Feld. Die zentrale Profilübernahme durch alle
Anwendungen bleibt ein eigener Integrationsschritt; das übrige Slop-Spiel
ist dadurch nicht vollständig zweisprachig geworden.

Build und beide Typprüfungen, 159 Unit-Tests sowie Chromium und WebKit lokal
bestanden. Die Browser prüften 320 px und Desktop, echte CSS-/Script-Auslieferung
unter der CSP, beide Sprachen, Sprachspeicherung, Voraussetzungen und den
unverändert strengen nativen POST-Origin-Schutz. Der lokale Browserzustand war
synthetisch; persönliche Zugangsdaten wurden nicht im Test verwendet.

Die lesende Cloudflare-Abnahme `42490657075` für `6ff0153` ist erfolgreich.
Sie bestätigt die aktive Version `82cd43c1-82d0-4515-a83a-bb99f3acee90` und
Deployment `7d6c3681-d2ae-42c1-b6fd-2bf908af741e`. Cloudflare liefert für
`ASSETS` nur Name und Typ, keinen Inhaltsnachweis. Deshalb wurde keine ältere
Version als sicher identisch eingestuft und keine Rücknahme ausgeführt.
Die vollständige CI `42489938907` bestand beide Browser und PostgreSQL.
Die Veröffentlichung der neuen Kontodarstellung folgt erst nach ihrer eigenen CI.
