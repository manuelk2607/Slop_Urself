# Slop Urself

Das Spiel läuft auf Cloudflare Workers mit statischen Assets, nativen WebSockets
und einem Durable Object pro Raum. Neon speichert Spieler, Punkte, Runden und
Bewertungen. Der Mac muss für die veröffentlichte Version nicht laufen.

Für echte Partien verbindet jeder Spieler vor dem Raumbeitritt sein persönliches
Hugging-Face-Konto. Videos, Fallbacks und Budgetreservierungen nutzen nur den
Zugang des jeweiligen Erstellers. Es gibt kein gemeinsames Ersatzkontingent.
Die maximale Rundenzahl richtet sich nach dem kleinsten verfügbaren Spielerbudget.
Zuschauer brauchen keine HF-Verbindung; lokale Mock-Tests sind ausgenommen.
Die kurze Anleitung steht in [docs/HUGGINGFACE.md](docs/HUGGINGFACE.md).

Die öffentliche Startseite ist ohne Anmeldung und JavaScript lesbar. Canonical,
Open Graph, strukturierte Daten, Sitemap, robots.txt und Google-Verifizierung
liegen in `public/` und werden in den Cloudflare-Build übernommen. Einzelheiten
zur Indexierung und Search Console: [docs/SEO.md](docs/SEO.md).

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
AI_PROVIDER=mock npm run dev
```

URL: http://127.0.0.1:3000. Ist der Port belegt, z. B. mit
`PORT=3001 AI_PROVIDER=mock npm run dev` starten.
Der lokale Server verwendet Socket.IO und dieselbe Spiellogik und KI-Anbindung
wie Cloudflare. Ohne DATABASE_URL gibt es keine dauerhafte Statistik.
Mock-KI und Profil-Anmeldung sind unabhängig: Der normale Benutzername-Einstieg
bleibt auch mit Mock-Videos aktiv. `AUTH_MODE=disabled` ist ausschließlich ein
ausdrücklicher Testmodus für automatisierte Tests, nicht der normale lokale Start.
Die Profil-Anmeldung benötigt auch lokal einen `AUTH_COOKIE_SECRET` mit mindestens
32 Zeichen in .env.local. Ohne Datenbank sind lokale Testprofile vom veröffentlichten
Spiel getrennt und bleiben nur bis zum nächsten Server-Neustart erhalten.

## Cloudflare

```bash
npm run cf:local
npm run cf:dev -- --var AI_PROVIDER:mock
npm run cf:secrets
npm run cf:deploy
```

Für lokale Cloudflare-Tests direkt:
`npx wrangler dev --config cloudflare/wrangler.toml --var AI_PROVIDER:mock`
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
https://slopurself.maki26.workers.dev. `npm run invite` zeigt denselben
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
Offene Profile lassen sich weiterhin ohne Passwort anmelden. Bei der Registrierung
kann freiwillig ein Passwort (12 bis 200 Zeichen) im eingeklappten Passwortbereich
gesetzt werden. Geschützte Profile verlangen dieses Passwort bei der Anmeldung.
Ein unbekannter
Name wird dabei nicht automatisch registriert; die Fehlermeldung verweist auf
die Registrierung. Bei einem vergebenen Namen wird auf die Anmeldung verwiesen.
Die Lobby fragt nicht erneut nach einem Namen.

Eine signierte HTTP-only-Browsersitzung bleibt für 30 Tage erhalten und wird
erneuert. AUTH_COOKIE_SECRET wird dafür als Cloudflare-Secret benötigt.
Neon Auth, Mail-Adressen und ein zusätzlicher Spiel-Zugangscode
werden nicht mehr verwendet. Ohne Datenbank sind lokale Testprofile nur im
Arbeitsspeicher vorhanden; mit Neon bleiben Profil und Statistik-ID gespeichert.

Ohne freiwilligen Passwortschutz ist ein Name bewusst kein Identitätsnachweis:
Jeder, der den Namen kennt, kann ein offenes Profil verwenden. Die Seite ist nicht
auf Freunde beschränkt. Vorhandene Neon-Auth-Daten und Spielhistorie werden
nicht gelöscht. AUTH_MODE=disabled ist nur mit AI_PROVIDER=mock wirksam und
dient ausschließlich lokalen Tests.

Passwörter werden serverseitig mit PBKDF2-SHA256, 100.000 Iterationen und einem
zufälligen 16-Byte-Salt gehasht. Bestehende Profile können ausschließlich über die
separat freigeschaltete Benutzerverwaltung geschützt oder zurückgesetzt werden.
Der Schlüsselschalter am jeweiligen Benutzer öffnet einen Dialog mit exakter
Namensbestätigung. Eine Anmeldung unter dem Besitzernamen genügt nicht.
Passwortänderungen widerrufen alte HTTP-Sitzungen und alte WebSocket-Befehle;
betroffene Browser müssen sich neu anmelden. Auch eine alte Admin-Freigabe des
Besitzers wird ungültig. SQL ergänzt ausschließlich `password_hash` und
`auth_version`; vorhandene Profil-IDs und Spieldaten bleiben erhalten.

### Bereitschaft, Zuschauer und Revanche

Bis zu zehn Spieler und zusätzlich zwanzig Zuschauer können einen Raum nutzen.
Neben Beitreten gibt es die Aktion **Mit diesem Code zuschauen**, auch während
einer laufenden Partie. Zuschauer erhalten öffentliche Spielstände und Videos,
erstellen und bewerten aber nicht und benötigen kein GPU-Budget. Private Aufgaben,
Rateeingaben und Zugangsdaten werden nicht übertragen. Reload stellt ihre Rolle
wieder her; verlässt der letzte Spieler den Raum, kehren Zuschauer zum Einstieg zurück.

**Ich bin bereit** zeigt die persönliche Bereitschaft. Die Host-Option
**Nur starten, wenn alle bereit sind** ist standardmäßig aus. Wenn aktiviert,
prüft der Server vor dem Start und nach Budgetabfragen alle Spieler erneut.
Änderungen an Besetzung, Rundenzahl, Optionen oder gemeinsamem Bild setzen die
Bereitschaft zurück; ein Verbindungsabbruch entfernt die eigene Bereitschaft.

**Revanche mit dieser Gruppe** am Endbildschirm ist nur für den Host verfügbar,
wenn alle Spieler verbunden sind. Ein neuer Raum übernimmt die verbundenen
Spieler und Zuschauer sowie die Optionen, aber keine Punkte, Videos oder Aufgaben.
Sitzungsschlüssel und Raumcode sind neu. Ein gemeinsames Ausgangsbild muss erneut
ausgewählt werden, das Budget wird neu geprüft. Die alte Partie bleibt in der
Statistik. Revanche und Zusatzrunde sind verschiedene Aktionen: Eine Zusatzrunde
setzt die bestehende Partie und Punktzahl fort.

### Videos gesammelt wiederherstellen

Rückgängig bleibt unmittelbar nach jeder Videolöschung für 30 Sekunden verfügbar,
auch nach Reload im selben Tab. Die Auswahl wird über
`POST /api/stats/videos/restore` mit `{ "ids": ["123", "124"] }` übertragen:
maximal 200 positive PostgreSQL-bigint-Strings je Anfrage, dedupliziert,
maximal 8 KiB Anfragekörper, Same-Origin und angemeldete Sitzung erforderlich.
Größere Auswahlen starten mehrere Pakete gleichzeitig. Ein SQL-Statement prüft
die individuellen Fristen gemeinsam am Anweisungsbeginn und verknüpft vorhandene
Runden wieder. Die Antwort enthält pro ID `restored`, `expired`, `not_found` oder
`unavailable`. Wiederholungen sind idempotent; temporäre Fehler bleiben bis zur
jeweiligen Frist erneut versuchbar. Gelöschte Räume werden nicht neu angelegt.

## Kostenlose KI

Standard: `wan22,wan22-fast`, über einen kostenlosen Hugging-Face-Space.

- Wan 2.2: Saravutw/WAN2.2_I2V_LIGHTNING_4-8step_custom
- `wan22-fast`: nativer 4-Schritte-Modus desselben Wan-2.2-Spaces.

LTX ist kein automatischer Fallback mehr. Der bisherige Adapter bleibt nur für
alte Konfigurationen und die Wiederaufnahme bereits gestarteter Aufträge erhalten.

Die Host-Adresse und Parameterreihenfolge werden aus der aktuellen Space-API
gelesen. Parameter werden über Namen zugeordnet, gegen Wertebereiche geprüft
und erst dann wird das Bild hochgeladen. Fehler und Zeitüberschreitungen führen
zum nächsten Provider. Es wird kein kostenpflichtiger Inference-Dienst benutzt.

Lokale Konfiguration in der ignorierten .env.local:

```dotenv
AI_PROVIDER=wan22
AI_PROVIDER_CHAIN=wan22,wan22-fast
AI_IMAGE_PROFILE=bounded
AI_ROUND_LIMIT=5
AI_GPU_SECONDS_PER_ROUND=0
LTX_DURATION=5
DATABASE_URL=DEINE_NEON_POSTGRES_URL
```

Der Host wählt in der Raum-Lobby zwischen Automatik, Qualität (nur 8 Schritte)
und Sparmodus (nur 4 Schritte). Automatik bevorzugt 8 Schritte, sofern dadurch
kein reserviertes Video gefährdet wird; sonst nutzt sie den nativen
4-Schritte-Modus desselben Wan-2.2-Modells. Weniger Schritte können die Qualität
verringern. Alle Modi erzeugen mindestens 5 Sekunden, mit Guidance 1 und ohne
Frame-Interpolation. `LTX_DURATION` ist der historische Konfigurationsname für
die Dauer auch bei Wan.

Der Browser bereitet Bilder ohne Abschneiden oder Verzerren vor: 832 × 624 im
Querformat, 624 × 832 im Hochformat, 640 × 640 bei quadratischen Bildern.
Abweichende Seitenverhältnisse werden mit schwarzen Rändern ergänzt. Neue Räume
prüfen diese Abmessungen serverseitig; beliebige größere Inputs können die
kleinere Budgetreserve daher nicht umgehen. Es werden JPEGs mit Qualität 92 %
übertragen; Originaldateien bleiben lokal.

Die Rundengrenze wird aus dem echten Restkontingent unter
https://huggingface.co/api/spaces/zero-gpu/quota berechnet: verbleibende
GPU-Zeit und verbleibende Aufrufe, abzüglich Budgets laufender Partien.
Eine Runde ist ein vollständiger Durchgang: jeder Spieler erstellt ein Video.
Die Kostenberechnung ist für Generierung und Rundenauswahl identisch:
Für die vorbereiteten Bilder plant Wan 2.2 mit 8 Schritten
126 GPU-Sekunden ein, der 4-Schritte-Modus 79. Quadratische Bilder benötigen
100 bzw. 67 Sekunden. Grundlage ist die GPU-Dauer im
[Space-Quellcode](https://huggingface.co/spaces/Saravutw/WAN2.2_I2V_LIGHTNING_4-8step_custom/blob/main/app.py),
einschließlich 2x-Kosten für xlarge, kalibriert mit den Live-Messungen vom
16. Oktober (etwa 73–75 Sekunden für vier Schritte und 122 Sekunden für acht
Schritte) plus Reserve. Das ist eine Planung, keine Laufzeitgarantie. Die Lobby reserviert den größten zulässigen
Bildtyp und den günstigsten Modus der gewählten Qualitätseinstellung.
Pro unabhängigem HF-Konto ergeben sich die verfügbaren Videos aus GPU-Zeit,
Aufrufen und eigenen Reservierungen. Die Raumgrenze ist das Minimum dieser
persönlichen Videobudgets. Nutzen mehrere Profile dasselbe HF-Konto, werden
dessen Videos durch die Anzahl dieser Profile geteilt, statt sie mehrfach zu zählen.
Das kostenlose Gesamtbudget beträgt derzeit fünf Minuten, also 300 Sekunden.
Es wird aus `quota.base` gelesen, nicht mit dem Restbudget verwechselt oder
pro Fallback addiert. `quota.current` ist bereits GPU-gewichtet und wird nicht
noch einmal halbiert. Bei vollen 300 Sekunden passen nach dieser sicheren
Planung drei Sparmodus-Videos oder zwei Qualitätsvideos je eigenem Konto ins
Budget. Zwei Spieler mit je 300 Sekunden können deshalb drei Sparmodus-Runden
mit insgesamt sechs Videos reservieren. Zusätzliche Runden werden nach Abschluss
anhand der wirklichen persönlichen Restzeiten geprüft. Bei jeweils 185 Sekunden
passen zwei Sparmodus-Runden; maßgeblich bleibt der Spieler mit dem kleinsten
verfügbaren Budget. Die UI zeigt nur die
aktuell maximale Rundenzahl. Acht Schritte werden nur versucht, wenn sie die
noch ausstehenden Videos nicht gefährden.
Längere Videos erhöhen das Budget automatisch.
AI_GPU_SECONDS_PER_ROUND ist trotz des historischen Namens eine optionale
Untergrenze je Video: 0 nutzt die modellabhängigen Kosten, ein höherer Wert
erhöht sie. AI_ROUND_LIMIT gilt nur im Mock-Modus.

### Einladungen, Zeitlimits und Archivpartien

Der Kopierknopf im Raum erzeugt einen Link wie `/?room=AB12`. Der Raumcode
bleibt während Anmeldung und Registrierung erhalten. Beitreten erfolgt bewusst
über den Beitrittsknopf; nach erfolgreichem Beitritt oder beim Erstellen eines
anderen Raums wird der Parameter entfernt, damit ein altes Spiel nicht erneut
geöffnet wird. Es werden keine Sitzungs- oder Anmeldeschlüssel geteilt.

Optional kann der Host 1, 2, 3 oder 5 Minuten pro Eingabe-, Bewertungs- und
Rateauflösungsphase einstellen. Standard ist ohne Zeitlimit. Die Frist kommt
vom Server, bleibt bei Reload erhalten und wird auf Cloudflare durch Alarme
ausgeführt. Fehlende Stimmen sind Enthaltungen und werden nicht als
Null-Sterne-Bewertungen gespeichert. Unbestätigte Rateversuche bekommen keinen
Bonus. Der Host kann eine Phase mit Bestätigung vorzeitig abschließen.
Laufende KI-Generierungen werden dabei nie übersprungen oder erneut gestartet.

Die Raum-Lobby bietet außerdem `Archiv: Best-of wählen` und `Archiv: Prompt
erraten`. Beide nutzen bis zu 200 aktuelle, verfügbare, nicht zum Löschen
markierte Archivvideos, ohne Wiederholung innerhalb einer Partie. Sie
funktionieren auch bei leerem GPU-Kontingent. Best-of erlaubt allen Spielern
eine Stimme; die Rangfolge ergibt sich aus der Durchschnittsbewertung der
Videos. Beim Prompt-Raten wechselt die Person für die Auflösung nach jedem
Video und bestätigt Treffer wie bei der normalen Ratevariante.
Archivwertungen gelten nur für diese Partie; weder neue Videos noch neue
Erstellungspunkte werden in der Dauerstatistik angelegt. Die Originalvideos,
ihre Ersteller und bisherigen Punkte bleiben unverändert. Zum Weiterspielen
wird eine neue Archivpartie erstellt. Klassisch mit eigenen Bildern bleibt
immer die Voreinstellung neuer Räume.

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

## Spielvarianten

Neue Räume starten immer klassisch: Jeder lädt bei seinem Zug ein eigenes Bild
hoch, gibt einen Prompt ein und die Mitspieler bewerten das daraus erstellte
Video. Die Lobby zeigt diesen Standard als „Klassisch“ an. Optionale Zusatzregeln
sind zunächst zugeklappt; ein Zurücksetzen auf „Klassisch“ deaktiviert alle drei
Regeln, ohne den KI-Qualitätsmodus zu verändern.

Der Host kann die folgenden Optionen in der Raum-Lobby einzeln oder kombiniert
aktivieren. Sie benötigen keine zusätzlichen KI-Aufrufe und verändern nicht die
Reihenfolge: Es ist weiterhin immer genau ein Spieler an der Reihe.

- **Gemeinsames Ausgangsbild:** Der Host lädt ein Bild hoch, das für alle
  Erstellungen der Partie verbindlich ist. Es bleibt bei einem Seiten-Reload
  erhalten. Auf Cloudflare liegt es vorübergehend in 64-KiB-Stücken im
  Raum-Durable-Object, nicht in der Statistik oder im Videoarchiv. Es wird
  nach zwei Stunden, beim Austausch oder nach Verlassen aller Spieler entfernt.
  Ist es während einer Partie abgelaufen, kann der Host vor der nächsten
  Erstellung ein Ersatzbild hochladen; Punkte und Runde bleiben erhalten.
- **Geheime Aufträge:** Jeder Ersteller erhält einen eigenen zufälligen Auftrag.
  Andere Spieler sehen ihn erst beim fertigen Video und bewerten Umsetzung
  und Unterhaltung getrennt mit je 1 bis 5 Punkten. Der gerundete Mittelwert
  zählt als normale Bewertung; Auftrag und Einzelwerte bleiben gespeichert.
- **Prompt erraten:** Die Mitspieler geben zusammen mit ihrer Bewertung einen
  optionalen Freitext-Tipp ab. Danach markiert ausschließlich der Ersteller
  richtige Antworten. Jeder Treffer bringt dem Ratenden zwei Bonuspunkte;
  anschließend werden Prompt und Tipps aufgelöst. Eingaben, Prüfphase und
  Punkte überstehen einen Reload. Die Statistik zeigt Rate-Bonuspunkte separat.

Geheime Aufträge und noch nicht aufgelöste Tipps werden pro Spieler ausgeliefert,
nicht in einem gemeinsamen öffentlichen Raum-Snapshot.

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

Der Einstieg bleibt per Benutzername und Raumcode möglich; Profilpasswörter sind
freiwillig. Der Link allein ist kein privater Zugangsschutz; bekannte offene
Namen können weiterhin übernommen werden. Schnelle Mehrfachanfragen werden serverseitig begrenzt:
60 Namensaktionen und 120 Konfigurations-/Statistikanfragen je Minute und IP,
120 Spielnachrichten je Minute und Spieler. HTTP-Antworten bei Überschreitung
enthalten Status 429 und `Retry-After`. IPs liegen in Cloudflare-Rate-Buckets
nur als mit dem Sitzungsschlüssel gesalzene Hashes vor. Variable Raum-, Video-
und unbekannte Statistikpfade teilen sich feste Routengruppen. Cloudflare
speichert die Zähler pro Client und Routengruppe in getrennten Durable Objects;
ein Client kann damit keine globale Registry füllen und andere Nutzer sperren.
Lokal bleibt der Speicher begrenzt, ohne bei voller Registry alle neuen Clients
abzuweisen. Abgelaufene Buckets werden beim nächsten Zugriff verworfen.
Das ist ein leichter Schutz für eine
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
Die Statistik zeigt Archivgröße und Videohistorie. Automatisch entfernte Dateien
werden als solche markiert und nicht mehr als verfügbare Videos gezählt.
Ein vollständiger, erfolgreicher Speicherabgleich repariert auch ältere fehlende
Dateien. Bei einem Speicherfehler wird kein leerer Bestand angenommen.
Ein Archiv-Ausfall wird als Fehler gemeldet; ein temporärer HF-Link wird nicht
als erfolgreich vorbereitetes Spielvideo freigegeben.
Bereits abgelaufene alte HF-Links können nicht nachträglich gerettet werden.
Originalbilder werden nicht in Neon gespeichert.

In der Video-Historie filtert "Erstellt von" nach der stabilen Spieler-ID.
Ein Klick auf einen Spielernamen wählt denselben Filter. Videos und Räume lassen
sich seitenweise nachladen; laufende Videos und die Mehrfachauswahl bleiben dabei
erhalten. Der Download-Pfeil sichert verfügbare Archivvideos als MP4.
Bestätigte Video-Löschungen lassen sich 30 Sekunden lang rückgängig machen;
erst danach wird die private Datei entfernt. Punkte, Runden und Bewertungen
bleiben erhalten. "Raum löschen" entfernt Runden, Bewertungen und Spielpunkte
der Partie per Datenbank-Kaskade. Videos samt Ersteller/Prompt und Benutzerkonten
bleiben erhalten. Beide Aktionen benötigen eine Bestätigung und eine angemeldete
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
und Browser-Tests in getrennten Chromium-/WebKit-Matrixjobs auf Node 24 aus:
`fail-fast: false`, jeweils 25 Minuten, eigene Browserinstallation und eindeutige
Fehlerartefakte. `test:ci` startet und beendet
isolierte Node-Mock-Server und die Cloudflare-Laufzeit (workerd/Miniflare) selbst.
Beide Backends durchlaufen Mehrspieler-, Video- und Statistiktests. Ein zusätzlicher
Runtime-Test prüft Byte-Ranges, Downloads und den echten 30-Sekunden-Löschalarm
nach dem Entladen des Service-Durable-Objects. Weder produktive DB-/Storage-Zugangsdaten noch
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

Die neuen Passwort- und Sammelwiederherstellungsprüfungen können ausschließlich
gegen eine lokale PostgreSQL-17-Instanz ausgeführt werden:

```bash
TEST_DATABASE_URL=postgresql://BENUTZER:PASSWORT@127.0.0.1:55437/postgres node --import tsx tests/integration/features-db.mts
```

Der Test verwendet temporäre Tabellen und verweigert entfernte Hosts. Unter
anderem verzögert ein Trigger die SQL-Ausführung über die individuellen
Löschfristen hinaus und prüft dennoch den gemeinsamen Anweisungsbeginn.
`participants.e2e.mts` prüft Bereitschaft, Zuschauer und Revanche mit Mock-KI;
`undo-batch.e2e.mts` prüft gleichzeitig gestartete 200-ID-Pakete und erneute Versuche.

`node --import tsx tests/e2e/startup.e2e.mts http://127.0.0.1:3000` prüft
Ladefehler, die Startseite ohne Rundenauswahl und die begrenzte Rundenauswahl
innerhalb des Raums gegen einen Mock-Testserver.
`node --import tsx tests/e2e/quota.e2e.mts` startet einen isolierten Testserver
auf Port 3315 und prüft die spielerabhängige Begrenzung mit simuliertem
HF-Kontingent. Es werden keine echten Videos erzeugt oder Produktivdaten gespeichert.
`node --import tsx tests/e2e/extension.e2e.mts` prüft auf Port 3316 freiwillige
Zusatzrunden mit zwei Spielern, acht simulierten Videos, gemeinsamen Punkten,
Reload und erschöpftem Kontingent. Auch dieser Test verbraucht keine GPU-Zeit.
`tests/e2e/variants.e2e.mts` prüft die kombinierten Varianten einschließlich
Bildvorbereitung, Gastgeberrechten, privaten Rateversuchen, Wiederherstellung
und Bonuspunkten. Die CI führt ihn gegen Node und echte Cloudflare-Durable-Objects
in Chromium und WebKit aus, ohne echte KI-Aufrufe.
`npm run test:auth` prüft einen lokalen Server auf Port 3312 mit aktivem
Profileinstieg, Mock-KI und ohne Datenbank. `TEST_PROFILE_DB=true` aktiviert
einen gezielten Datenbank-Test gegen einen solchen Server mit Neon: Dabei
werden keine Räume angelegt, nur das exakt neu erstellte Testprofil wird
danach entfernt. DATABASE_URL_UNPOOLED wird für diese Bereinigung benötigt.

## Persönliche Hugging-Face-Konten

Die optionale Verbindung unter **KI-Konto** nutzt pro Ersteller dessen
verifiziertes HF-Kontingent. Prüfstatus vor der Veröffentlichung, Einrichtung,
kurze Anleitung für Freunde und Grenzen stehen in [docs/HUGGINGFACE.md](docs/HUGGINGFACE.md).
