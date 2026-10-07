# Slop Urself

Das Spiel laeuft auf Cloudflare Workers mit statischen Assets, nativen WebSockets
und einem Durable Object pro Raum. Neon speichert Spieler, Punkte, Runden und
Bewertungen. Der Mac muss fuer die veroeffentlichte Version nicht laufen.

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

Fuer lokale Cloudflare-Tests direkt:
`npx wrangler dev --config cloudflare/wrangler.toml --var AI_PROVIDER:mock --var AUTH_MODE:disabled`
(nach `npm run cf:build`).

`npm run cf:secrets` uebertraegt die benoetigten Secrets aus der ignorierten
.env.local ohne sie im Terminal auszugeben. `npm run cf:local` erzeugt die
ebenfalls ignorierte cloudflare/.dev.vars fuer lokale Worker-Tests.

Lokale .env.local-Werte werden nicht automatisch zu Cloudflare uebertragen.
Die Assets kommen ausschliesslich aus cloudflare/public; .env-Dateien werden
nicht mit hochgeladen. Der Link fuer Freunde lautet:
https://slopurself.jsbk9gv78n.workers.dev. `npm run invite` zeigt denselben
Spiellink. Der Host teilt zusaetzlich den vierstelligen Raumcode.

## Einstieg mit Benutzername

Ein Feld fuer den Benutzernamen (1 bis 15 sichtbare Zeichen) und "Los geht's".
Neue Namen werden in user_profiles gespeichert; ein eindeutiger Datenbankindex
verhindert doppelte Namen auch bei gleichzeitiger Erstellung. Gross-/Kleinschreibung,
Leerzeichen am Rand und gleichwertige Unicode-Schreibweisen zaehlen als derselbe Name.
"Vorhandenen Namen verwenden" setzt ein bestehendes Profil ohne Passwort fort.
Die Lobby fragt nicht erneut nach einem Namen.

Eine signierte HTTP-only-Browsersitzung bleibt fuer 30 Tage erhalten und wird
erneuert. AUTH_COOKIE_SECRET wird dafuer als Cloudflare-Secret benoetigt.
Neon Auth, Mail-Adressen, Passwoerter und ein zusaetzlicher Spiel-Zugangscode
werden nicht mehr verwendet. Ohne Datenbank sind lokale Testprofile nur im
Arbeitsspeicher vorhanden; mit Neon bleiben Profil und Statistik-ID gespeichert.

Das ist bewusst keine geschuetzte Anmeldung: Jeder, der einen bestehenden
Benutzernamen kennt, kann dieses Profil verwenden. Die Seite ist damit nicht
auf Freunde beschraenkt. Vorhandene Neon-Auth-Daten und Spielhistorie werden
nicht geloescht. AUTH_MODE=disabled ist nur mit AI_PROVIDER=mock wirksam und
dient ausschliesslich lokalen Tests.

## Kostenlose KI

Standard: `wan22,wan22-fast,ltx`, ueber kostenlose Hugging-Face-Spaces.

- Wan 2.2: Saravutw/WAN2.2_I2V_LIGHTNING_4-8step_custom
- `wan22-fast`: nativer 4-Schritte-Modus desselben Wan-2.2-Spaces.
- LTX: Lightricks/ltx-video-distilled
- Optional `wan`: multimodalart/wan2-1-fast. Dieser Space unterstuetzt derzeit
  nur bis zu 3,4 Sekunden und wird bei der Mindestdauer von 5 Sekunden uebersprungen.

Die Host-Adresse und Parameterreihenfolge werden aus der aktuellen Space-API
gelesen. Parameter werden ueber Namen zugeordnet, gegen Wertebereiche geprueft
und erst dann wird das Bild hochgeladen. Fehler und Zeitueberschreitungen fuehren
zum naechsten Provider. Es wird kein kostenpflichtiger Inference-Dienst benutzt.

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

Wan 2.2 nutzt bevorzugt 8 Schritte. Reicht das Budget unter Beruecksichtigung
aller reservierten Videos nicht, folgt der native 4-Schritte-Sparmodus, danach
LTX. Weniger Schritte koennen die Qualitaet verringern; alle Modi erzeugen
mindestens 5 Sekunden. Wan verwendet Guidance 1 und keine Frame-Interpolation,
LTX Guidance 1 und Texture-Verbesserung. Die LTX-Option ui_frames_to_use betrifft
Eingabevideos und bestimmt bei Image-to-Video nicht die Ausgabelaenge.

Die Rundengrenze wird aus dem echten Restkontingent unter
https://huggingface.co/api/spaces/zero-gpu/quota berechnet: verbleibende
GPU-Zeit und verbleibende Aufrufe, abzüglich Budgets laufender Partien.
Eine Runde ist ein vollstaendiger Durchgang: jeder Spieler erstellt ein Video.
Die Kostenberechnung ist fuer Generierung und Rundenauswahl identisch:
Wan 2.2 mit 8 Schritten benoetigt konservativ 154 GPU-Sekunden, der
4-Schritte-Modus 92 und LTX 120. Grundlage ist die GPU-Dauer im jeweiligen
Space-Quellcode, einschliesslich maximalem Bildformat und 2x-Kosten fuer xlarge.
Reserviert wird der guenstigste konfigurierte Modus mit mindestens 5 Sekunden.
Die Grenze ist `floor(verfuegbare Videos / Spielerzahl)`;
die verfuegbaren Videos ergeben sich aus GPU-Zeit, Aufrufen und Reservierungen.
Bei 185 GPU-Sekunden passen zwei Videos im 4-Schritte-Modus ins Budget:
eine vollstaendige Runde fuer zwei Spieler (184 GPU-Sekunden). Fuer drei
Spieler sind mindestens 276 GPU-Sekunden erforderlich. Die UI zeigt nur die
aktuell maximale Rundenzahl. Acht Schritte werden nur versucht, wenn sie die
noch ausstehenden Videos nicht gefaehrden.
Laengere Videos erhoehen das Budget automatisch.
AI_GPU_SECONDS_PER_ROUND ist trotz des historischen Namens eine optionale
Untergrenze je Video: 0 nutzt die modellabhaengigen Kosten, ein hoeherer Wert
erhoeht sie. AI_ROUND_LIMIT gilt nur im Mock-Modus.

Die Auswahl wird regelmaessig und vor dem Erstellen aktualisiert. In der
Raum-Lobby richtet sich die Grenze nach der tatsaechlichen Spielerzahl; der
Host kann die Runden dort anpassen. Zwei Runden mit drei Spielern ergeben
sechs Videos. Verlassen Spieler die Partie, entfallen ihre ausstehenden
Erstellungen und deren Reservierungen. Bereits gestartete KI-Jobs bleiben
bis zum Abschluss reserviert. Bei laufenden Spielen nach altem Format bleibt
die alte Einzelvideo-Rundenzaehlung erhalten; neue Partien verwenden Durchgaenge.
Nach dem letzten geplanten Durchgang liest das Spiel das echte Restkontingent
erneut. Reicht es fuer alle verbleibenden Spieler, kann der Host am Endbildschirm
eine Zusatzrunde starten. Jeder erstellt genau ein weiteres Video. Vor jedem
Start werden GPU-Zeit und Aufruflimit erneut geprueft und global reserviert;
das funktioniert auch nach einem Reload oder Kontingent-Reset. Die Anzahl
vorab reservierbarer Runden ist deshalb nicht die absolute Zahl moeglicher Videos.
Die Reserve ist konservativ; schneller beendete Jobs koennen weiteres Budget
fuer Zusatzrunden lassen. Ein bestimmter tatsaechlicher Verbrauch wird nicht versprochen.
Punkte und Videozaehlung laufen in derselben Partie weiter. Die Datenbank entfernt
beim Fortsetzen die bisherige Endwertung und setzt sie am naechsten Ende erneut,
ohne Spiele, Punkte oder Siege doppelt zu zaehlen. Auf Cloudflare bleibt dieser
Wiederaufnahme-Schreibvorgang mit den Rundenwrites in der dauerhaften Retry-Queue.
Bei getrennten Spielern wird bis zur Wiederverbindung oder deren Ausscheiden gewartet.
Beim Start wird serverseitig erneut geprueft und global reserviert; parallele Raeume
koennen nicht dasselbe Kontingent einplanen. Bei unbekanntem oder aufgebrauchtem
Kontingent sind keine neuen Spiele moeglich. Fallbacks duerfen das Budget
anderer oder spaeterer Runden nicht verbrauchen.
Aufwendigere laufende Versuche bleiben bis zum Abschluss reserviert, auch
bevor Hugging Face einen wartenden Job im Restkontingent abgezogen hat.
Wiederholungen muessen erneut genug Budget fuer alle noch ausstehenden Videos
haben, damit sie das Kontingent des naechsten Spielers nicht verbrauchen.
Es werden keine kostenpflichtigen
Overquota-Credits aktiviert. HF kann sein Limit aendern, und Nutzung desselben
Accounts ausserhalb des Spiels oder verbrauchte Fehlversuche koennen das Budget
trotzdem reduzieren. ZeroGPU-Limits gelten fuer den HF-Account; mehrere Spaces
vervielfachen dieses Kontingent nicht. Warteschlangen und fremde Space-Ausfaelle
koennen die Generierung blockieren. Bild und Prompt werden an externe Spaces
uebertragen; deren Loeschfristen kann die App nicht erzwingen.

## KI-Wiederaufnahme und Diagnose

Cloudflare speichert den Provider, die externe Event-ID, Parameter und den
Auftragsstatus im Durable Object. Originalbilder werden dafuer nicht gespeichert.
Nach einem Worker-Neustart oder unterbrochenem Ergebnisstream wird derselbe
Auftrag erneut abgefragt, ohne einen weiteren GPU-Auftrag zu starten. Ergebnisse
verlassener Spieler werden nicht angezeigt oder archiviert; deren Jobs werden
im Hintergrund abgefragt, um abgeschlossene Budgetreservierungen freizugeben.
Auch fehlgeschlagene Budgetfreigaben werden dauerhaft wiederholt.

Nur ein ausdruecklich fehlgeschlagener Provider-Auftrag erlaubt einen neuen
Fallback. Geht die Antwort auf das Start-POST verloren, ist die externe Job-ID
unbekannt: Es wird kein zweiter Auftrag auf Verdacht gesendet. Nach 15 Minuten
erhaelt der Ersteller eine Fehlermeldung. Fuer ungeklaerte Auftraege bleibt die
konservative Reservierung bis zu ihrem bestehenden Zwei-Stunden-TTL geschuetzt.
Eine externe Space-Loeschung oder ein aus dem HF-Cache entferntes Ergebnis
kann die App nicht reparieren. Beim lokalen Node-Server funktioniert die
Wiederaufnahme nach Verbindungsabbruechen, nicht nach einem Prozessneustart.

Serverlogs enthalten strukturierte JSON-Ereignisse mit Provider, Schritten,
Videodauer, Laufzeit, Fallback-Versuchen und technischen Fehlerkategorien.
Bilder, Prompts, HF-URLs, Tokens und Benutzernamen werden dabei nicht geloggt.
Lokal erscheinen die Ereignisse im Terminal; auf Cloudflare sind Worker Logs
aktiviert. Alternativ: `npx wrangler tail --config cloudflare/wrangler.toml`.
Die GPU-Kosten bleiben Schaetzwerte; es wird keine genaue Verbrauchsmessung
je Video behauptet.

## Anfragebegrenzung

Der Einstieg bleibt ohne Passwort, per Benutzername und Raumcode. Der Link
allein ist kein privater Zugangsschutz; bekannte Namen koennen weiterhin
uebernommen werden. Schnelle Mehrfachanfragen werden serverseitig begrenzt:
60 Namensaktionen und 120 Konfigurations-/Statistikanfragen je Minute und IP,
120 Spielnachrichten je Minute und Spieler. HTTP-Antworten bei Ueberschreitung
enthalten Status 429 und `Retry-After`. IPs liegen in Cloudflare-Rate-Buckets
nur als mit dem Sitzungsschluessel gesalzene Hashes vor. Abgelaufene Buckets
werden bei der naechsten Anfrage verworfen und die Anzahl ist begrenzt. Das ist ein leichter Schutz fuer eine
Freundesgruppe, kein vollstaendiger Missbrauchsschutz.

Anonyme Seitenaufrufe lesen kein HF-Kontingent. Die Anzeige wird fuer maximal
fuenf Sekunden zwischengespeichert; Spielstart und Generierung pruefen weiterhin
frisch und autoritativ. Das UI zeigt weiterhin nur die maximale Rundenzahl.

## Speicherung

Das Schema liegt in db/schema.sql und wird beim ersten Datenbankzugriff angelegt.
Spieler behalten ihre ID bei einem Reload. Neue Statistikwerte werden anhand
der verifizierten Konto-ID zusammengefasst: Namensaenderungen behalten die
Punkte, gleiche Namen anderer Konten werden nicht vermischt. Alte namenbasierte
Eintraege bleiben als Legacy-Statistik erhalten und werden nicht automatisch
einem neuen Konto zugeordnet.

Runde, Stimmen, Punktestand und gegebenenfalls Endwertung werden in einer
Transaktion gespeichert. Auf Cloudflare liegen fehlgeschlagene Rundenwrites
zusaetzlich im Durable-Object-Speicher und werden wiederholt. Die lokale
Entwicklungsversion protokolliert DB-Fehler, hat aber keine dauerhafte Wiederholung.

Generierte MP4-Dateien werden in einem privaten Neon-Object-Storage-Bucket
archiviert und ueber die angemeldete App gestreamt (einschliesslich Byte-Ranges).
VIDEO_ARCHIVE_MB=512 begrenzt das Archiv; bevor es voll wird, werden die aeltesten
Videos geloescht. Punkte und Runden bleiben dabei in Postgres erhalten.
Ein Video darf hoechstens 15 MB gross sein; das Archivlimit ist auf 1 GB gedeckelt.
Die Statistik zeigt Archivgroesse und Videohistorie.
Bei einem Archiv-Ausfall bleibt ein temporaerer HF-Link mit Warnung erhalten.
Bereits abgelaufene alte HF-Links koennen nicht nachtraeglich gerettet werden.
Originalbilder werden nicht in Neon gespeichert.

## Tests

```bash
npm run build
npm test
npx playwright install chromium webkit
npm run test:ci
npm audit
```

`.github/workflows/ci.yml` fuehrt bei Push und Pull Request Build, Unit-Tests
und Browser-Tests in Chromium und WebKit aus. `test:ci` startet und beendet
isolierte Mock-Server selbst. Weder produktive DB-/Storage-Zugangsdaten noch
ein echter HF-Token sind notwendig; es wird keine GPU-Zeit verbraucht.
Browser-Screenshots liegen im System-Tempverzeichnis oder in `TEST_ARTIFACT_DIR`.

Browser-Test gegen einen separat gestarteten Mock-Server:

```bash
npm run test:e2e -- http://127.0.0.1:3000
TEST_BROWSER_ENGINE=webkit npm run test:e2e -- http://127.0.0.1:3000
```

Fuer Cloudflare zuerst `npm run cf:build`, dann
`npx wrangler dev --config cloudflare/wrangler.toml --port 3311 --var AI_PROVIDER:mock --var AUTH_MODE:disabled`
und `npm run test:e2e -- http://127.0.0.1:3311`.
Der Browsertest prueft die automatische Cloudflare-Wiederverbindung zusaetzlich.

`npm run test:db` nutzt die Neon-URL aus .env.local, arbeitet ausschliesslich
mit temporaeren Tabellen auf einer direkten (ungepoolten) Verbindung und
veraendert keine vorhandenen Spieldaten.

`node --import tsx tests/startup.e2e.mts http://127.0.0.1:3000` prueft
Ladefehler und die dynamische Rundenauswahl gegen einen Mock-Testserver.
`node --import tsx tests/quota.e2e.mts` startet einen isolierten Testserver
auf Port 3315 und prueft die spielerabhaengige Begrenzung mit simuliertem
HF-Kontingent. Es werden keine echten Videos erzeugt oder Produktivdaten gespeichert.
`node --import tsx tests/extension.e2e.mts` prueft auf Port 3316 freiwillige
Zusatzrunden mit zwei Spielern, sechs simulierten Videos, gemeinsamen Punkten,
Reload und erschoepftem Kontingent. Auch dieser Test verbraucht keine GPU-Zeit.
`npm run test:auth` prueft einen lokalen Server auf Port 3312 mit aktivem
Profileinstieg, Mock-KI und ohne Datenbank. `TEST_PROFILE_DB=true` aktiviert
einen gezielten Datenbank-Test gegen einen solchen Server mit Neon: Dabei
werden keine Raeume angelegt, nur das exakt neu erstellte Testprofil wird
danach entfernt. DATABASE_URL_UNPOOLED wird fuer diese Bereinigung benoetigt.
