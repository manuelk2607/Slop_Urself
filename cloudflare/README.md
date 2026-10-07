# Cloudflare-Version

Die gehostete Version ist implementiert. Sie verwendet statische Worker-Assets,
native WebSockets mit automatischer Wiederverbindung und einen Durable Object
pro Raum. Hibernation erlaubt dem Raum, zwischen Nachrichten zu schlafen.
Sitzungen und Spielzustand werden im Durable-Object-Speicher gesichert.

Der Einstieg liegt in src/server/cloudflare/worker.ts. HTTP-Routing, Raum-Object
und globales Service-Object sind getrennte Module. Gemeinsame Spielregeln,
KI-Anbindung und Datenbankabfragen liegen unter src und werden auch vom
Node-Server verwendet. Die Ordnerstruktur ist in
[../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) beschrieben, die Spielnachrichten
in [../docs/websocket-protocol.md](../docs/websocket-protocol.md).

Neon speichert die langfristigen Statistiken. Fehlgeschlagene Rundenwrites bleiben
als ausstehende Eintraege gespeichert; Alarms wiederholen sie nach 30 Sekunden.
Alarms bearbeiten auch getrennte Sitzungen nach 15 Sekunden und die
10-Sekunden-Vorschau im Solo-Test.

## Lokal pruefen

```bash
npm run cf:build
npm run cf:local
npx wrangler dev --config cloudflare/wrangler.toml --var AI_PROVIDER:mock --var AUTH_MODE:disabled
```

Lokale Secrets gehoeren in cloudflare/.dev.vars (nicht committen).
Die Werte in .env.local gelten fuer den lokalen Node-Server.

## Deployment

```bash
npm run cf:secrets
npm run cf:deploy
npm run invite
```

wrangler.toml legt Worker-Name, Assets, Durable Object und nicht geheime
KI-Konfiguration fest. Nur cloudflare/public wird als Asset-Verzeichnis verwendet.
Dort duerfen keine Secrets liegen.

cf:secrets uebertraegt HF_TOKEN, DATABASE_URL,
AUTH_COOKIE_SECRET und die zwei privaten Storage-Schluessel aus .env.local.
Der Spiellink benoetigt keinen zusaetzlichen Zugangscode. Jeder Spieler legt
nur einen eindeutigen Benutzernamen an oder verwendet einen bestehenden Namen.
Neon Auth und Passwoerter werden nicht mehr benutzt. Dies ist bewusst keine
Authentifizierung; ein bekannter Name kann von jedem verwendet werden.

SERVICES ist ein zweiter SQLite-Durable-Object-Binding (Migration v2).
Es reserviert das echte kostenlose HF-Kontingent fuer alle Raeume gemeinsam
und serialisiert die Archivierung mit automatischer Loeschung alter Videos.
Die Rundenbegrenzung verwendet den guenstigsten konfigurierten 5-Sekunden-Modus
aus wan22, wan22-fast und ltx. Alle Spaces teilen dasselbe HF-Account-Kontingent;
ihre Budgets werden nicht addiert. Bei 185 GPU-Sekunden erlaubt der native
4-Schritte-Modus eine Runde mit zwei Spielern. Der 8-Schritte-Modus wird nur
versucht, wenn ausreichend Budget fuer die verbleibenden Videos reserviert bleibt.
Nach dem letzten Durchgang bietet das Spiel bei ausreichendem Restkontingent
eine hostgesteuerte Zusatzrunde an. Punkte und Raum bleiben erhalten. Die
Wiederaufnahme wird zusammen mit den Rundenwrites dauerhaft und in Reihenfolge
wiederholt, damit ein vorheriger Endwertungs-Write keine laufende Partie abschliesst.
Es verwaltet zudem die eindeutigen Benutzerprofile in Postgres, beziehungsweise
im Durable-Object-Speicher fuer Tests ohne Datenbank. Browsersitzungen sind
HTTP-only, signiert, 30 Tage gueltig und werden beim Neuladen wiederhergestellt.

Laufende KI-Jobs haben ein dauerhaftes Journal mit externer Event-ID. Alarms
nehmen unterbrochene Ergebnisabfragen nach 15 Sekunden wieder auf; es wird
kein neues Bild hochgeladen und kein neuer GPU-Auftrag gesendet. Das Journal
bleibt auch beim Verlassen des Erstellers erhalten. Ungeklaerte Auftraege
enden nach 15 Minuten mit Fehler; ihr Budget bleibt konservativ bis zum TTL
reserviert. Originalbilder werden nicht fuer die Wiederaufnahme gespeichert.

Der globale Service begrenzt schnelle HTTP-Anfragen mit kurzlebigen,
gehashten IP-Buckets; jeder Raum begrenzt Spielnachrichten. Anonyme
Konfigurationsaufrufe verbrauchen keine HF-API-Abfragen. Angezeigte Quota-Werte
werden kurz gecacht, Start-/Generierungspruefungen bleiben frisch.
Es gibt bewusst kein zusaetzliches Spielpasswort. Worker Logs protokollieren
KI-Provider, Dauer und technische Fehler ohne Bilder, Prompts oder Tokens.

CI: `npm run test:ci`; GitHub Actions prueft jeden Push und Pull Request mit
Mock-KI, ohne Produktivdaten oder echte GPU-Auftraege.
