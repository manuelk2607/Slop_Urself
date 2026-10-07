# Architektur

## Gemeinsamer Kern

`src/game/rules.ts` definiert Raumzustand, Spielphasen, Spielerwechsel,
Bewertungen und Punkte. `src/game/persistence.ts` wandelt abgeschlossene
Runden in das gemeinsame Datenbankformat um.

`src/ai` enthaelt Providerdefinitionen, Image-to-Video-Generierung,
Kontingentreservierungen und datensparsame Diagnose. Lokaler Server und
Cloudflare verwenden diese Implementierungen unveraendert.

`src/auth` verwaltet Benutzerprofile und signierte Browsersitzungen.
`src/security` begrenzt schnelle Anfragen. `src/storage` archiviert Videos
und entfernt bei Bedarf die aeltesten Dateien.

## Datenbank

`src/database/schema.ts` ist die einzige Quelle fuer das SQL-Schema,
einschliesslich Benutzerprofilen. Die Initialisierung wird pro Repository
einmal ausgefuehrt; nach einem Fehler kann sie erneut versucht werden.

`repository.ts` enthaelt parameterisierte Schreiboperationen und die
Transaktionen fuer Runden, Stimmen und Endwertungen. Spieler und Stimmen
werden gesammelt statt einzeln geschrieben. `statistics.ts` definiert die
gemeinsamen Statistikabfragen; `types.ts` ihre Datenvertraege und die
kleine SQL-Treiberschnittstelle.

`node.ts` verwendet den bestehenden pg-Verbindungspool. `neon.ts` verwendet
Neons HTTP-Treiber fuer Cloudflare. Beide liefern denselben Repository-Code
mit unterschiedlichen Transaktionsadaptern. Node-spezifische Pakete werden
nicht in den Worker importiert. Ohne konfigurierte Datenbank bleibt der
bisherige lokale Testbetrieb erhalten.

## Server

`src/server/node.ts` stellt HTTP und Socket.IO bereit. Er verwendet die
gemeinsame Spiellogik und speichert Runden ueber den Node-Datenbankadapter.

`src/server/cloudflare/worker.ts` ist der HTTP-Einstieg. `room.ts` verwaltet
ein RoomDurableObject mit WebSockets, gespeichertem Spielzustand, KI-Journal,
Alarmen und dauerhafter Datenbank-Retry-Queue. `services.ts` verwaltet das
globale ServiceDurableObject fuer Profile, Kontingent und Archivierung.
`runtime.ts` und `types.ts` enthalten ihre gemeinsamen Plattformhelfer und
Bindings. Durable-Object-Namen und Speicherschluessel bleiben erhalten.

Die Transport- und Lebenszykluslogik bleibt plattformspezifisch: Node und
Durable Objects haben unterschiedliche Anforderungen an Verbindungen,
Transaktionen und Wiederaufnahme nach einem Neustart.

## Browser

`src/client/app.ts` verbindet Ansichten und Spielereignisse. `auth.ts`
verwaltet den Profileinstieg; `startup.ts` den Ladezustand. `realtime.ts`
kapselt Socket.IO und native WebSockets hinter einer Schnittstelle.
`statistics.ts` rendert die Statistik mit den gemeinsamen Datenbanktypen.

HTML, CSS und das Mock-Video liegen in `public/`. Der Build buendelt die
TypeScript-Einstiegspunkte zu `public/script.js` und `public/startup.js`.
Nur diese Browser-Abhaengigkeiten werden gebuendelt, nicht Servercode.

## Build Und Tests

`tools/build.ts` entfernt alte dist-Ausgaben, prueft beide TypeScript-Konfigurationen,
erzeugt Node-Module und Browser-Bundles und kopiert public nach cloudflare/public.
Alle Betriebsarten verwenden damit dieselben oeffentlichen Quelldateien.

`tests/unit` prueft Spielregeln, KI, Dienste und Repository-Vertraege.
`tests/e2e` prueft den Browserfluss, Einstieg, Kontingent und Zusatzrunden.
`tests/integration` prueft echtes PostgreSQL ausschliesslich mit temporaeren
Tabellen. Gemeinsame Testhilfen liegen in `tests/support`.
`tests/run-ci.mts` startet isolierte Mock-Server fuer Chromium und WebKit
und beendet sie danach wieder. Diese Tests verbrauchen keine GPU-Zeit.
