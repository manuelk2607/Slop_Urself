# Slop Urself

Das Spiel läuft auf Cloudflare Workers mit statischen Assets, nativen WebSockets
und einem Durable Object pro Raum. Neon speichert Spieler, Punkte, Runden und
Bewertungen. Der Mac muss für die veröffentlichte Version nicht laufen.

## Projektstruktur

```text
src/client/             Browser, Statistikanzeige und Echtzeitverbindungen
src/server/             Node-Server und Cloudflare-Einstieg mit Durable Objects
src/game/               Gemeinsame Spielregeln und Rundenspeicherung
src/ai/                 Generierung, Provider, Kontingent und Diagnose
src/auth/               Benutzerprofile und Browsersitzungen
src/database/           Gemeinsames Schema, Abfragen und Node-/Neon-Treiber
src/storage/            Videoarchiv
src/security/           Anfragebegrenzung
public/                HTML, CSS und statische Medien
tests/                 Unit-, Browser- und Datenbanktests
tools/                 Build und Cloudflare-Einrichtung
cloudflare/            Deployment-Konfiguration und erzeugte Assets
docs/                  Architektur, Protokoll und bisheriger Audit
```

Details zu Modulgrenzen und gemeinsamen Datenbankzugriffen stehen in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
`npm run build` erzeugt den Node-Code in dist und Browser-Bundles in public
und kopiert die öffentlichen Assets nach cloudflare/public. Generierte
JavaScript-Dateien werden nicht von Hand bearbeitet oder eingecheckt.

## Lokal starten

```bash
npm ci
AI_PROVIDER=mock AUTH_MODE=disabled npm run dev
```

URL: http://127.0.0.1:3000. Ist der Port belegt, z. B. mit
`PORT=3001 AI_PROVIDER=mock AUTH_MODE=disabled npm run dev` starten.
Der lokale Server verwendet Socket.IO und dieselbe Spiellogik und KI-Anbindung
wie Cloudflare. Ohne DATABASE_URL gibt es keine dauerhafte Statistik.

## Cloudflare

```bash
npm run cf:local
npm run cf:dev -- --var AI_PROVIDER:mock --var AUTH_MODE:disabled
npm run cf:secrets
npm run cf:deploy
```

Für lokale Cloudflare-Tests direkt:
`npx wrangler dev --config cloudflare/wrangler.toml --var AI_PROVIDER:mock --var AUTH_MODE:disabled`
(nach `npm run cf:build`).

`npm run cf:secrets` überträgt die benötigten Secrets aus der ignorierten
.env.local ohne sie im Terminal auszugeben. `npm run cf:local` erzeugt die
ebenfalls ignorierte cloudflare/.dev.vars für lokale Worker-Tests.

Lokale .env.local-Werte werden nicht automatisch zu Cloudflare übertragen.
Bei "Die Browsersitzung ist noch nicht eingerichtet." fehlt der
AUTH_COOKIE_SECRET im Worker oder er ist kürzer als 32 Zeichen. Ein vorhandener
lokaler Schlüssel kann gezielt mit `npm run cf:secrets -- AUTH_COOKIE_SECRET`
übertragen werden, ohne andere Secrets zu ersetzen. Der Upload prüft die
Schlüssellänge. Ein Austausch eines bereits verwendeten Schlüssels meldet
Browser ab, löscht aber keine Profile oder Statistiken.
Die Assets kommen ausschließlich aus cloudflare/public; .env-Dateien werden
nicht mit hochgeladen. Der Link für Freunde lautet:
https://slopurself.manuelk2607.workers.dev. `npm run invite` zeigt denselben
Spiellink. Der Host teilt zusätzlich den vierstelligen Raumcode.

Alle Spielansichten liegen unter `/`. Cloudflare verwendet keinen SPA-Fallback:
fehlende Icons und andere unbekannte Dateien liefern 404 statt der Spielseite.
Die automatischen Safari-Pfade `/apple-touch-icon.png` und
`/apple-touch-icon-precomposed.png` liefern beide dasselbe PNG-Symbol.

## Einstieg mit Benutzername

Ein Feld für den Benutzernamen (1 bis 15 sichtbare Zeichen) und zwei klar
getrennte Aktionen: "Neuen Benutzer registrieren" für neue Namen und
"Vorhandenen Benutzer anmelden" für bereits registrierte Namen.
Neue Namen werden in user_profiles gespeichert; ein eindeutiger Datenbankindex
verhindert doppelte Namen auch bei gleichzeitiger Erstellung. Groß-/Kleinschreibung,
Leerzeichen am Rand und gleichwertige Unicode-Schreibweisen zählen als derselbe Name.
Die Anmeldung setzt ein bestehendes Profil ohne Passwort fort. Ein unbekannter
Name wird dabei nicht automatisch registriert; die Fehlermeldung verweist auf
die Registrierung. Bei einem vergebenen Namen wird auf die Anmeldung verwiesen.
Die Lobby fragt nicht erneut nach einem Namen.

Eine signierte HTTP-only-Browsersitzung bleibt für 30 Tage erhalten und wird
erneuert. AUTH_COOKIE_SECRET wird dafür als Cloudflare-Secret benötigt.
Neon Auth, Mail-Adressen, Passwörter und ein zusätzlicher Spiel-Zugangscode
werden nicht mehr verwendet. Ohne Datenbank sind lokale Testprofile nur im
Arbeitsspeicher vorhanden; mit Neon bleiben Profil und Statistik-ID gespeichert.

Das ist bewusst keine geschützte Anmeldung: Jeder, der einen bestehenden
Benutzernamen kennt, kann dieses Profil verwenden. Die Seite ist damit nicht
auf Freunde beschränkt. Vorhandene Neon-Auth-Daten und Spielhistorie werden
nicht gelöscht. AUTH_MODE=disabled ist nur mit AI_PROVIDER=mock wirksam und
dient ausschließlich lokalen Tests.

## Kostenlose KI

Standard: `wan22,wan22-fast,ltx`, über kostenlose Hugging-Face-Spaces.

- Wan 2.2: Saravutw/WAN2.2_I2V_LIGHTNING_4-8step_custom
- `wan22-fast`: nativer 4-Schritte-Modus desselben Wan-2.2-Spaces.
- LTX: Lightricks/ltx-video-distilled
- Optional `wan`: multimodalart/wan2-1-fast. Dieser Space unterstützt derzeit
  nur bis zu 3,4 Sekunden und wird bei der Mindestdauer von 5 Sekunden übersprungen.

Die Host-Adresse und Parameterreihenfolge werden aus der aktuellen Space-API
gelesen. Parameter werden über Namen zugeordnet, gegen Wertebereiche geprüft
und erst dann wird das Bild hochgeladen. Fehler und Zeitüberschreitungen führen
zum nächsten Provider. Es wird kein kostenpflichtiger Inference-Dienst benutzt.

Lokale Konfiguration in der ignorierten .env.local:

```dotenv
AI_PROVIDER=wan22
AI_PROVIDER_CHAIN=wan22,wan22-fast,ltx
HF_TOKEN=DEIN_GUELTIGER_HF_READ_TOKEN
AI_ROUND_LIMIT=5
AI_GPU_SECONDS_PER_ROUND=0
LTX_DURATION=5
LTX_HEIGHT=512
LTX_WIDTH=704
LTX_GUIDANCE=1
DATABASE_URL=DEINE_NEON_POSTGRES_URL
```

Wan 2.2 nutzt bevorzugt 8 Schritte. Reicht das Budget unter Berücksichtigung
aller reservierten Videos nicht, folgt der native 4-Schritte-Sparmodus, danach
LTX. Weniger Schritte können die Qualität verringern; alle Modi erzeugen
mindestens 5 Sekunden. Wan verwendet Guidance 1 und keine Frame-Interpolation,
LTX Guidance 1 und Texture-Verbesserung. Die LTX-Option ui_frames_to_use betrifft
Eingabevideos und bestimmt bei Image-to-Video nicht die Ausgabelänge.

Die Rundengrenze wird aus dem echten Restkontingent unter
https://huggingface.co/api/spaces/zero-gpu/quota berechnet: verbleibende
GPU-Zeit und verbleibende Aufrufe, abzüglich Budgets laufender Partien.
Eine Runde ist ein vollständiger Durchgang: jeder Spieler erstellt ein Video.
Die Kostenberechnung ist für Generierung und Rundenauswahl identisch:
Wan 2.2 mit 8 Schritten benötigt konservativ 154 GPU-Sekunden, der
4-Schritte-Modus 92 und LTX 120. Grundlage ist die GPU-Dauer im jeweiligen
Space-Quellcode, einschließlich maximalem Bildformat und 2x-Kosten für xlarge.
Reserviert wird der günstigste konfigurierte Modus mit mindestens 5 Sekunden.
Die Grenze ist `floor(verfügbare Videos / Spielerzahl)`;
die verfügbaren Videos ergeben sich aus GPU-Zeit, Aufrufen und Reservierungen.
Bei 185 GPU-Sekunden passen zwei Videos im 4-Schritte-Modus ins Budget:
eine vollständige Runde für zwei Spieler (184 GPU-Sekunden). Für drei
Spieler sind mindestens 276 GPU-Sekunden erforderlich. Die UI zeigt nur die
aktuell maximale Rundenzahl. Acht Schritte werden nur versucht, wenn sie die
noch ausstehenden Videos nicht gefährden.
Längere Videos erhöhen das Budget automatisch.
AI_GPU_SECONDS_PER_ROUND ist trotz des historischen Namens eine optionale
Untergrenze je Video: 0 nutzt die modellabhängigen Kosten, ein höherer Wert
erhöht sie. AI_ROUND_LIMIT gilt nur im Mock-Modus.

Die Rundenzahl wird ausschließlich in der Raum-Lobby eingestellt; neue Räume
starten mit einer Runde. Die Grenze wird dort regelmäßig und bei Beitritt oder
Verlassen aktualisiert und richtet sich nach der tatsächlichen Spielerzahl.
Nur der Host kann die Runden anpassen. Zwei Runden mit drei Spielern ergeben
sechs Videos. Verlassen Spieler die Partie, entfallen ihre ausstehenden
Erstellungen und deren Reservierungen. Bereits gestartete KI-Jobs bleiben
bis zum Abschluss reserviert. Bei laufenden Spielen nach altem Format bleibt
die alte Einzelvideo-Rundenzählung erhalten; neue Partien verwenden Durchgänge.
Nach dem letzten geplanten Durchgang liest das Spiel das echte Restkontingent
erneut. Reicht es für alle verbleibenden Spieler, kann der Host am Endbildschirm
eine Zusatzrunde starten. Jeder erstellt genau ein weiteres Video. Vor jedem
Start werden GPU-Zeit und Aufruflimit erneut geprüft und global reserviert;
das funktioniert auch nach einem Reload oder Kontingent-Reset. Die Anzahl
vorab reservierbarer Runden ist deshalb nicht die absolute Zahl möglicher Videos.
Die Reserve ist konservativ; schneller beendete Jobs können weiteres Budget
für Zusatzrunden lassen. Ein bestimmter tatsächlicher Verbrauch wird nicht versprochen.
Punkte und Videozählung laufen in derselben Partie weiter. Die Datenbank entfernt
beim Fortsetzen die bisherige Endwertung und setzt sie am nächsten Ende erneut,
ohne Spiele, Punkte oder Siege doppelt zu zählen. Auf Cloudflare bleibt dieser
Wiederaufnahme-Schreibvorgang mit den Rundenwrites in der dauerhaften Retry-Queue.
Bei getrennten Spielern wird bis zur Wiederverbindung oder deren Ausscheiden gewartet.
Beim Start wird serverseitig erneut geprüft und global reserviert; parallele Räume
können nicht dasselbe Kontingent einplanen. Bei unbekanntem oder aufgebrauchtem
Kontingent sind keine neuen Spiele möglich. Fallbacks dürfen das Budget
anderer oder späterer Runden nicht verbrauchen.
Aufwendigere laufende Versuche bleiben bis zum Abschluss reserviert, auch
bevor Hugging Face einen wartenden Job im Restkontingent abgezogen hat.
Wiederholungen müssen erneut genug Budget für alle noch ausstehenden Videos
haben, damit sie das Kontingent des nächsten Spielers nicht verbrauchen.
Es werden keine kostenpflichtigen
Overquota-Credits aktiviert. HF kann sein Limit ändern, und Nutzung desselben
Accounts außerhalb des Spiels oder verbrauchte Fehlversuche können das Budget
trotzdem reduzieren. ZeroGPU-Limits gelten für den HF-Account; mehrere Spaces
vervielfachen dieses Kontingent nicht. Warteschlangen und fremde Space-Ausfälle
können die Generierung blockieren. Bild und Prompt werden an externe Spaces
übertragen; deren Löschfristen kann die App nicht erzwingen.

## KI-Wiederaufnahme und Diagnose

Cloudflare speichert den Provider, die externe Event-ID, Parameter und den
Auftragsstatus im Durable Object. Originalbilder werden dafür nicht gespeichert.
Nach einem Worker-Neustart oder unterbrochenem Ergebnisstream wird derselbe
Auftrag erneut abgefragt, ohne einen weiteren GPU-Auftrag zu starten. Ergebnisse
verlassener Spieler werden nicht angezeigt oder archiviert; deren Jobs werden
im Hintergrund abgefragt, um abgeschlossene Budgetreservierungen freizugeben.
Auch fehlgeschlagene Budgetfreigaben werden dauerhaft wiederholt.

Nur ein ausdrücklich fehlgeschlagener Provider-Auftrag erlaubt einen neuen
Fallback. Geht die Antwort auf das Start-POST verloren, ist die externe Job-ID
unbekannt: Es wird kein zweiter Auftrag auf Verdacht gesendet. Nach 15 Minuten
erhält der Ersteller eine Fehlermeldung. Für ungeklärte Aufträge bleibt die
konservative Reservierung bis zu ihrem bestehenden Zwei-Stunden-TTL geschützt.
Eine externe Space-Löschung oder ein aus dem HF-Cache entferntes Ergebnis
kann die App nicht reparieren. Beim lokalen Node-Server funktioniert die
Wiederaufnahme nach Verbindungsabbrüchen, nicht nach einem Prozessneustart.

Serverlogs enthalten strukturierte JSON-Ereignisse mit Provider, Schritten,
Videodauer, Laufzeit, Fallback-Versuchen und technischen Fehlerkategorien.
Bilder, Prompts, HF-URLs, Tokens und Benutzernamen werden dabei nicht geloggt.
Lokal erscheinen die Ereignisse im Terminal; auf Cloudflare sind Worker Logs
aktiviert. Alternativ: `npx wrangler tail --config cloudflare/wrangler.toml`.
Die GPU-Kosten bleiben Schätzwerte; es wird keine genaue Verbrauchsmessung
je Video behauptet.

## Anfragebegrenzung

Der Einstieg bleibt ohne Passwort, per Benutzername und Raumcode. Der Link
allein ist kein privater Zugangsschutz; bekannte Namen können weiterhin
übernommen werden. Schnelle Mehrfachanfragen werden serverseitig begrenzt:
60 Namensaktionen und 120 Konfigurations-/Statistikanfragen je Minute und IP,
120 Spielnachrichten je Minute und Spieler. HTTP-Antworten bei Überschreitung
enthalten Status 429 und `Retry-After`. IPs liegen in Cloudflare-Rate-Buckets
nur als mit dem Sitzungsschlüssel gesalzene Hashes vor. Abgelaufene Buckets
werden bei der nächsten Anfrage verworfen und die Anzahl ist begrenzt. Das ist ein leichter Schutz für eine
Freundesgruppe, kein vollständiger Missbrauchsschutz.

Anonyme Seitenaufrufe lesen kein HF-Kontingent. Die Anzeige wird für maximal
fünf Sekunden zwischengespeichert; Spielstart und Generierung prüfen weiterhin
frisch und autoritativ. Das UI zeigt weiterhin nur die maximale Rundenzahl.

## Speicherung

Das gemeinsame Schema liegt in src/database/schema.ts und wird beim ersten
Datenbankzugriff angelegt. Node und Cloudflare verwenden denselben Repository-Code
für Runden, Stimmen, Punktestände und Statistiken; nur die SQL-Treiber unterscheiden sich.
Spieler behalten ihre ID bei einem Reload. Neue Statistikwerte werden anhand
der verifizierten Konto-ID zusammengefasst: Namensänderungen behalten die
Punkte, gleiche Namen anderer Konten werden nicht vermischt. Alte namenbasierte
Einträge bleiben als Legacy-Statistik erhalten und werden nicht automatisch
einem neuen Konto zugeordnet.

Runde, Stimmen, Punktestand und gegebenenfalls Endwertung werden in einer
Transaktion gespeichert. Auf Cloudflare liegen fehlgeschlagene Rundenwrites
zusätzlich im Durable-Object-Speicher und werden wiederholt. Die lokale
Entwicklungsversion protokolliert DB-Fehler, hat aber keine dauerhafte Wiederholung.

Generierte MP4-Dateien werden in einem privaten Neon-Object-Storage-Bucket
archiviert und über die angemeldete App gestreamt (einschließlich Byte-Ranges).
VIDEO_ARCHIVE_MB=512 begrenzt das Archiv; bevor es voll wird, werden die ältesten
Videos gelöscht. Punkte und Runden bleiben dabei in Postgres erhalten.
Ein Video darf höchstens 15 MB groß sein; das Archivlimit ist auf 1 GB gedeckelt.
Die Statistik zeigt Archivgröße und Videohistorie.
Ein Archiv-Ausfall wird als Fehler gemeldet; ein temporärer HF-Link wird nicht
als erfolgreich vorbereitetes Spielvideo freigegeben.
Bereits abgelaufene alte HF-Links können nicht nachträglich gerettet werden.
Originalbilder werden nicht in Neon gespeichert.

In der Video-Historie filtert "Erstellt von" nach der stabilen Spieler-ID.
Ein Klick auf einen Spielernamen wählt denselben Filter. "Video löschen"
entfernt die private Archivdatei und ihren Video-Link; Punkte, Runden und
Bewertungen bleiben erhalten. "Raum löschen" entfernt auch alle Runden,
Bewertungen und Punkte der Partie per Datenbank-Kaskade. Benutzerkonten bleiben
erhalten. Beide Aktionen benötigen eine Bestätigung und eine angemeldete
Browsersitzung. Laufende Partien sind vor Löschung geschützt. Der Raum wird
auch aus dem Laufzeit-Speicher entfernt, damit er nicht wiederhergestellt wird.

## Tests

```bash
npm run build
npm test
npx playwright install chromium webkit
npm run test:ci
npm audit
```

`.github/workflows/ci.yml` führt bei Push und Pull Request Build, Unit-Tests
und Browser-Tests in Chromium und WebKit aus. `test:ci` startet und beendet
isolierte Mock-Server selbst. Weder produktive DB-/Storage-Zugangsdaten noch
ein echter HF-Token sind notwendig; es wird keine GPU-Zeit verbraucht.
Browser-Screenshots liegen im System-Tempverzeichnis oder in `TEST_ARTIFACT_DIR`.

Browser-Test gegen einen separat gestarteten Mock-Server:

```bash
npm run test:e2e -- http://127.0.0.1:3000
TEST_BROWSER_ENGINE=webkit npm run test:e2e -- http://127.0.0.1:3000
```

Für Cloudflare zuerst `npm run cf:build`, dann
`npx wrangler dev --config cloudflare/wrangler.toml --port 3311 --var AI_PROVIDER:mock --var AUTH_MODE:disabled`
und `npm run test:e2e -- http://127.0.0.1:3311`.
Der Browsertest prüft die automatische Cloudflare-Wiederverbindung zusätzlich.

`npm run test:db` nutzt die Neon-URL aus .env.local, arbeitet ausschließlich
mit temporären Tabellen auf einer direkten (ungepoolten) Verbindung und
verändert keine vorhandenen Spieldaten.

`node --import tsx tests/e2e/startup.e2e.mts http://127.0.0.1:3000` prüft
Ladefehler, die Startseite ohne Rundenauswahl und die begrenzte Rundenauswahl
innerhalb des Raums gegen einen Mock-Testserver.
`node --import tsx tests/e2e/quota.e2e.mts` startet einen isolierten Testserver
auf Port 3315 und prüft die spielerabhängige Begrenzung mit simuliertem
HF-Kontingent. Es werden keine echten Videos erzeugt oder Produktivdaten gespeichert.
`node --import tsx tests/e2e/extension.e2e.mts` prüft auf Port 3316 freiwillige
Zusatzrunden mit zwei Spielern, sechs simulierten Videos, gemeinsamen Punkten,
Reload und erschöpfftem Kontingent. Auch dieser Test verbraucht keine GPU-Zeit.
`npm run test:auth` prüft einen lokalen Server auf Port 3312 mit aktivem
Profileinstieg, Mock-KI und ohne Datenbank. `TEST_PROFILE_DB=true` aktiviert
einen gezielten Datenbank-Test gegen einen solchen Server mit Neon: Dabei
werden keine Räume angelegt, nur das exakt neu erstellte Testprofil wird
danach entfernt. DATABASE_URL_UNPOOLED wird für diese Bereinigung benötigt.
