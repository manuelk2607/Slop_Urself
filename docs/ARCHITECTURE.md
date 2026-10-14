# Architektur

## Gemeinsamer Kern

`src/game/rules.ts` definiert Raumzustand, Spielphasen, Spielerwechsel,
Bewertungen und Punkte. `src/game/persistence.ts` wandelt abgeschlossene
Runden in das gemeinsame Datenbankformat um.

`src/ai` enthält Providerdefinitionen, Image-to-Video-Generierung,
Kontingentreservierungen und datensparsame Diagnose. Lokaler Server und
Cloudflare verwenden diese Implementierungen unverändert.

`src/auth` verwaltet Benutzerprofile und signierte Browsersitzungen.
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

`video-history.ts` definiert unabhängige Video-Metadaten und die Übernahme bereits
gespielter Videos. Raum-Fremdschlüssel betreffen diese Daten nicht. Unveränderliche
Video-IDs bleiben auch nach Raumlöschungen und wiederverwendeten Raumcodes gültig.
Die Löschfrist liegt in Postgres; Löschmarker verhindern versehentliches Wiederanlegen.
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

HTML, CSS und das Mock-Video liegen in `public/`. Der Build bündelt die
TypeScript-Einstiegspunkte zu `public/script.js` und `public/startup.js`.
Nur diese Browser-Abhängigkeiten werden gebündelt, nicht Servercode.

## Build Und Tests

`tools/build.ts` entfernt alte dist-Ausgaben, prüft beide TypeScript-Konfigurationen,
erzeugt Node-Module und Browser-Bundles und kopiert public nach cloudflare/public.
Alle Betriebsarten verwenden damit dieselben öffentlichen Quelldateien.

`tests/unit` prüft Spielregeln, KI, Dienste und Repository-Verträge.
`tests/e2e` prüft den Browserfluss, Einstieg, Kontingent und Zusatzrunden.
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
