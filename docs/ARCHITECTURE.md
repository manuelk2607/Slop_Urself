# Architektur

## Party-Erweiterungen

`src/game/options.ts` normalisiert klassische Zusatzregeln, Archivmodus und
optionale Phasendauer. `src/game/archive-play.ts` wählt begrenzte Archivpools
ohne Wiederholung und startet die gespeicherten Videos. Kein Replay wird als
neue Erstellung persistiert. `GameRepository.playableArchive()` liest nur
vorhandene, nicht gelöschte private Archivpfade, maximal 200 Metadatensätze.
Es ist keine zusätzliche DB-Migration für Archivpartien erforderlich.

`src/game/phases.ts` enthält die gemeinsame Deadline- und Abschlusslogik.
Node führt sie per unref-Intervall aus; Cloudflare persistiert die Deadline
und plant einen DO-Alarm. Veraltete Host-Kommandos werden anhand des
Phasenschlüssels verworfen. Generierungen haben keine überspringbare Deadline;
das bestehende Jobjournal und globale GPU-Reservierungen bleiben maßgeblich.
`src/client/party.ts` zeigt Server-Countdown, Host-Abschluss und Archivrangliste.

## Gemeinsamer Kern

`src/game/participants.ts` enthält Teilnehmergrenzen, Bereitschaft, Rollenprüfung
und das Erzeugen frischer Revanche-Räume. Spieler und Zuschauer werden getrennt
gespeichert; nur Spieler gelangen in Budgetlisten, Runden und Statistiken.
Öffentliche Snapshots projizieren erlaubte Felder statt private Teilnehmerobjekte
zu verbreiten. Revanche-Übergaben enthalten nur die eigene neue Raum-/Spieler-ID
und den eigenen Sitzungsschlüssel. Node verschiebt Socket.IO-Mitgliedschaften
direkt. Cloudflare initialisiert das Ziel idempotent und lässt Browser unabhängig
wiederverbinden; die geplante Übergabe bleibt vor jedem Netzaufruf gespeichert.
Eine neue Revanche wartet auf offene alte Rundenwrites. Node behält fehlgeschlagene
Writes in Reihenfolge im Speicher; Cloudflare behält seine dauerhafte Retry-Queue.

`src/game/rules.ts` definiert Raumzustand, Spielphasen, Spielerwechsel,
Bewertungen und Punkte. `src/game/persistence.ts` wandelt abgeschlossene
Runden in das gemeinsame Datenbankformat um.
`options.ts` validiert kombinierbare Varianten und verteilt geheime Aufgaben.
`images.ts` verwaltet das gemeinsame Ausgangsbild in begrenzten temporären
Chunks; Snapshots enthalten nur eine mitgliedschaftsgeschützte URL. Der
Raumzustand hält Aufgaben, Rateversuche und deren einmalige Auswertung.
`roomSnapshot(room, viewerId)` liefert geheime Daten ausschließlich dem
jeweiligen Spieler; die Prüfphase `GUESS_REVIEW` wird wie Voting persistiert.

`src/ai` enthält Providerdefinitionen, Image-to-Video-Generierung,
Kontingentreservierungen und datensparsame Diagnose. Lokaler Server und
Cloudflare verwenden diese Implementierungen unverändert.
`providers.ts` teilt Qualitätswahl und Budgetformel zwischen Reservierung und
Generierung. Neue Inputs werden mit `images.ts` auf die verbindlich begrenzten
Bildformate geprüft; die kleinere Reserve beruht nicht auf einer bloßen Schätzung
beliebiger Uploads. Automatik nutzt ausschließlich Wan 2.2 mit 8 oder 4 Schritten.
Die Gradio-Schnittstelle bindet Upload, Auftrag und Ergebnisabfrage anhand von
`x-proxied-replica` an dieselbe HF-Replik. Das KI-Journal speichert diese
Replikat-URL auch für Wiederverbindungen. Von Gradio zurückgegebene Datei-URLs
derselben Herkunft behalten die Bindung bis zur dauerhaften Archivierung;
externe CDN-URLs bleiben unverändert.
`gradio.ts` liest Queue-Ereignisse fortlaufend und übernimmt nur den bestätigten
Abschluss derselben Event-ID. Der Abruf wartet nicht auf das Schließen einer
dauerhaft offenen SSE-Verbindung. Neue Wan-Aufträge speichern ihre Queue-Sitzung
für Wiederholungen; alte Call-Aufträge behalten ihren bisherigen Abrufweg.
Anbieterfehler werden in feste, datensparsame Hinweise übersetzt, niemals mit
ungefilterten Prompts, Pfaden oder Anmeldedaten ausgegeben.

`src/auth` verwaltet Benutzerprofile und signierte Browsersitzungen.
`passwords.ts` implementiert optionales PBKDF2-SHA256 mit 100.000 Iterationen,
zufälligem Salt und konstantzeitlichem Hashvergleich. Nur neue Registrierungen
oder separat freigeschaltete Admin-Operationen können einen Hash setzen.
`auth_version` bindet JWTs an den aktuellen Profilzustand, standardmäßig `0`
für bestehende Profile und Tokens. Passwortänderungen rotieren diese Version;
HTTP und WebSocket-Kommandos validieren sie gegen den Profilstore. Auch HF-
Anmeldevorgänge und Admin-Freigaben behalten die passende Auth-Version.
Vor neuen personalisierten Snapshots wird ebenfalls frisch autorisiert. Pro
Verbindung wird höchstens eine solche Prüfung gleichzeitig ausgeführt; nach der
Prüfung wird der aktuelle Zustand gelesen, damit verzögerte Antworten keine
ältere Phase über eine neuere schreiben. Ein DB-Ausfall widerruft nicht pauschal
gültige Sitzungen, gibt aber auch keine ungeprüften privaten Snapshots frei.
`src/security` begrenzt schnelle Anfragen. `src/storage` archiviert Videos
und entfernt bei Bedarf die ältesten Dateien.

## Datenbank

`src/database/schema.ts` ist die einzige Quelle für das SQL-Schema,
einschließlich Benutzerprofilen. Die Initialisierung wird pro Repository
einmal ausgeführt; nach einem Fehler kann sie erneut versucht werden.

`repository.ts` enthält parameterisierte Schreiboperationen und die
Transaktionen für Runden, Stimmen und Endwertungen. Spieler und Stimmen
werden gesammelt statt einzeln geschrieben. `statistics.ts` definiert die
gemeinsamen Statistikabfragen; `types.ts` ihre Datenverträge und die
kleine SQL-Treiberschnittstelle.
Runden speichern Aufgaben und Rateversuche, Stimmen ihre beiden optionalen
Bewertungskriterien und Spieler ihre kumulierten Rate-Bonuspunkte. Diese
Ergänzungen sind additive Migrationen; die Runden-Transaktion bleibt atomar
und wiederholbar, ohne Bonuspunkte erneut zu addieren.

`video-history.ts` definiert unabhängige Video-Metadaten und die Übernahme bereits
gespielter Videos. Raum-Fremdschlüssel betreffen diese Daten nicht. Unveränderliche
Video-IDs bleiben auch nach Raumlöschungen und wiederverwendeten Raumcodes gültig.
Die Löschfrist liegt in Postgres; Löschmarker verhindern versehentliches Wiederanlegen.
Sammelwiederherstellung nutzt eine einzige parameterisierte CTE mit einem
gemeinsamen `statement_timestamp()`. Berechtigte Videos werden atomar aktiviert,
vorhandene Runden wieder verknüpft und Ergebnisse pro angefragter ID geliefert.
`src/shared/history.ts` definiert die 200-ID-Grenze und Ergebnistypen, während
`src/server/body.ts` den Körper beim Lesen auf maximal 8 KiB begrenzt.
`evicted_at` markiert automatisch entfernte Dateien, ohne Metadaten und Spielpunkte
zu löschen. `pagination.ts` kodiert validierte Cursor; Datum plus unveränderliche
Video-ID bzw. Raumcode bilden stabile Keysets mit einer Vorschauzeile pro Seite.

`node.ts` verwendet den bestehenden pg-Verbindungspool. `neon.ts` verwendet
Neons HTTP-Treiber für Cloudflare. Beide liefern denselben Repository-Code
mit unterschiedlichen Transaktionsadaptern. Node-spezifische Pakete werden
nicht in den Worker importiert. Ohne konfigurierte Datenbank bleibt der
bisherige lokale Testbetrieb erhalten.

## Server

`src/server/node.ts` stellt HTTP und Socket.IO bereit. Er verwendet die
gemeinsame Spiellogik und speichert Runden über den Node-Datenbankadapter.

`src/server/cloudflare/worker.ts` ist der HTTP-Einstieg. `room.ts` verwaltet
ein RoomDurableObject mit WebSockets, gespeichertem Spielzustand, KI-Journal,
Alarmen und dauerhafter Datenbank-Retry-Queue. `services.ts` verwaltet das
globale ServiceDurableObject für Profile, Kontingent und Archivierung.
`runtime.ts` und `types.ts` enthalten ihre gemeinsamen Plattformhelfer und
Bindings. Durable-Object-Namen und Speicherschlüssel bleiben erhalten.

`src/server/statistics.ts` teilt Lösch- und Wiederherstellungsregeln zwischen beiden
Servern. Der globale Service serialisiert Archivierung, reversible Video-Löschung
und endgültige Dateibereinigung. Sein Alarm verarbeitet abgelaufene Löschfristen
unabhängig von offenen Tabs. Node verwendet dafür einen Timer und nimmt ausstehende
Bereinigungen nach einem Neustart wieder auf.
`src/server/archive.ts` gleicht vollständige S3-Bestandslisten mit der Datenbank ab.
Bestandsprüfung, Archivierung und Löschung laufen innerhalb derselben Archiv-Queue;
Speicherfehler dürfen niemals als leerer Bestand interpretiert werden.

Die Transport- und Lebenszykluslogik bleibt plattformspezifisch: Node und
Durable Objects haben unterschiedliche Anforderungen an Verbindungen,
Transaktionen und Wiederaufnahme nach einem Neustart.

## Browser

`src/client/app.ts` verbindet Ansichten und Spielereignisse. `auth.ts`
verwaltet den Profileinstieg; `startup.ts` den Ladezustand. `realtime.ts`
kapselt Socket.IO und native WebSockets hinter einer Schnittstelle.
`statistics.ts` rendert die Statistik mit den gemeinsamen Datenbanktypen.
`history-selection.ts` verwaltet die Mehrfachauswahl; `history-undo.ts` die zeitlich
begrenzte Rückgängig-Aktion mit Wiederaufnahme aus dem Tab-Speicher.
`variants.ts` kapselt Lobby-Optionen, gemeinsames Bild, Aufgabenbewertung und
Freitext-Rateversuche. `images.ts` bereitet Uploads im Canvas ohne Beschnitt vor;
die Server prüfen die daraus resultierenden Abmessungen unabhängig davon.
Neue Räume sind klassisch; Zusatzregeln sind zunächst deaktiviert und zugeklappt.
Der KI-Qualitätsmodus ist davon unabhängig. Mock-KI allein deaktiviert weder
Profile noch die normale Anmelden-/Registrieren-Ansicht.

HTML, CSS und das Mock-Video liegen in `public/`. Der Build bündelt die
TypeScript-Einstiegspunkte zu `public/script.js` und `public/startup.js`.
Nur diese Browser-Abhängigkeiten werden gebündelt, nicht Servercode.

## Build Und Tests

`tools/build.ts` entfernt alte dist-Ausgaben, prüft beide TypeScript-Konfigurationen,
erzeugt Node-Module und Browser-Bundles und kopiert public nach cloudflare/public.
Alle Betriebsarten verwenden damit dieselben öffentlichen Quelldateien.

`tests/unit` prüft Spielregeln, KI, Dienste und Repository-Verträge.
`tests/e2e` prüft den Browserfluss, Einstieg, Kontingent und Zusatzrunden.
`classic.e2e.mts` kombiniert normale Profile mit Mock-KI und prüft den Standard-
Ablauf mit eigenen Bildern und Prompts, normalen Stimmen sowie das Zurücksetzen
von Varianten. Er läuft zusätzlich gegen einen Cloudflare-Runtime mit aktiver
Profil-Anmeldung statt ausschließlich gegen Auth-Bypass-Testserver.
`tests/integration/db.integration.mts` prüft echtes PostgreSQL ausschließlich mit
temporären Tabellen. `video-history-branch.mts` ist ein zusätzlicher, bewusst
aufzurufender Migrationstest für einen isolierten Neon-Testbranch, niemals für
den Produktivhost. Gemeinsame Testhilfen liegen in `tests/support`.
`tests/run-ci.mts` startet isolierte Mock-Server für Chromium und WebKit
und beendet sie danach wieder. Diese Tests verbrauchen keine GPU-Zeit.
`tests/support/cloudflare.ts` startet zusätzlich den echten Worker mit seinen
SQLite-Durable-Objects in workerd und blockiert ausgehende Netzwerkzugriffe.
Die Browser-Suiten laufen dort ebenfalls. `cloudflare-runtime.mts` ersetzt nur
die externen Neon-HTTP-/S3-Verträge und prüft Routing, Ranges, Downloads und
den persistenten Löschalarm nach Object-Eviction ohne offene Browser.

`participants.e2e.mts` prüft optionalen Passwortschutz, Bereitschaft, laufenden
Zuschauerbeitritt, Wiedergabe/Reload und Revanche auf beiden Backends. Erst nach
vollständiger Wiederverbindung wird die Teilnehmerzahl geprüft.
`undo-batch.e2e.mts` hält frühe Antworten bis zum Eintreffen aller Pakete zurück
und prüft erneute Versuche nach einem temporären Fehler.
`features-db.mts` verlangt eine explizite lokale `TEST_DATABASE_URL` und PostgreSQL
17; temporäre Tabellen prüfen Migration sowie Fristen während eines langsamen
SQL-Statements. GitHub Actions verwendet getrennte Chromium-/WebKit-Jobs auf
Node 24, `fail-fast: false`, je 25 Minuten und eigene Fehlerartefakte.
`tools/hf-live-check.mts` ist ein ausdrücklich aktivierbarer manueller Nachweis,
nicht Teil der CI und ohne automatische GPU-Wiederholungen.
