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
als ausstehende Einträge gespeichert; Alarms wiederholen sie nach 30 Sekunden.
Alarms bearbeiten auch getrennte Sitzungen nach 15 Sekunden und die
Solo-Tests bleiben in der Video-Vorschau, bis der Spieler "Ergebnis ansehen"
wählt; es gibt keinen automatischen Ablauf-Timer.

## Lokal prüfen

```bash
npm run cf:build
npm run cf:local
npx wrangler dev --config cloudflare/wrangler.toml --var AI_PROVIDER:mock --var AUTH_MODE:disabled
```

Lokale Secrets gehoeren in cloudflare/.dev.vars (nicht committen).
Die Werte in .env.local gelten für den lokalen Node-Server.

## Deployment

```bash
npm run cf:secrets
npm run cf:deploy
npm run invite
```

wrangler.toml legt Worker-Name, Assets, Durable Object und nicht geheime
KI-Konfiguration fest. Nur cloudflare/public wird als Asset-Verzeichnis verwendet.
Dort dürfen keine Secrets liegen.

`npm run cf:deploy` prüft vor dem Upload alle erforderlichen Cloudflare-Secrets,
einschließlich beider Storage-Schlüssel. Fehlen sie, wird das Deployment mit
einer konkreten Fehlermeldung abgebrochen. Echte KI-Aufträge werden ohne
eingerichtetes Archiv ebenfalls abgelehnt, bevor GPU-Kontingent verbraucht wird.
Das Video wird vor VOTING archiviert. Ein fehlgeschlagener Archiv-Abruf wird
nicht als erfolgreich vorbereitetes Video mit temporärem Link veröffentlicht.

cf:secrets überträgt HF_TOKEN, DATABASE_URL,
AUTH_COOKIE_SECRET und die zwei privaten Storage-Schlüssel aus .env.local.
Der Spiellink benötigt keinen zusätzlichen Zugangscode. Jeder Spieler legt
nur einen eindeutigen Benutzernamen an oder verwendet einen bestehenden Namen.
Neon Auth und Passwörter werden nicht mehr benutzt. Dies ist bewusst keine
Authentifizierung; ein bekannter Name kann von jedem verwendet werden.

SERVICES ist ein zweiter SQLite-Durable-Object-Binding (Migration v2).
Es reserviert das echte kostenlose HF-Kontingent für alle Räume gemeinsam
und serialisiert die Archivierung mit automatischer Löschung alter Videos.
Die Rundenbegrenzung verwendet den günstigsten konfigurierten 5-Sekunden-Modus
aus wan22, wan22-fast und ltx. Alle Spaces teilen dasselbe HF-Account-Kontingent;
ihre Budgets werden nicht addiert. Bei 185 GPU-Sekunden erlaubt der native
4-Schritte-Modus eine Runde mit zwei Spielern. Der 8-Schritte-Modus wird nur
versucht, wenn ausreichend Budget für die verbleibenden Videos reserviert bleibt.
Nach dem letzten Durchgang bietet das Spiel bei ausreichendem Restkontingent
eine hostgesteuerte Zusatzrunde an. Punkte und Raum bleiben erhalten. Die
Wiederaufnahme wird zusammen mit den Rundenwrites dauerhaft und in Reihenfolge
wiederholt, damit ein vorheriger Endwertungs-Write keine laufende Partie abschliesst.
Es verwaltet zudem die eindeutigen Benutzerprofile in Postgres, beziehungsweise
im Durable-Object-Speicher für Tests ohne Datenbank. Browsersitzungen sind
HTTP-only, signiert, 30 Tage gültig und werden beim Neuladen wiederhergestellt.

## Benutzerverwaltung

Die normale Anmeldung bleibt ohne Passwort. Nur das festgelegte Besitzerkonto
kann die Benutzerverwaltung mit einem zusätzlichen privaten Schlüssel freischalten.
Eine Anmeldung mit dem Besitzernamen allein reicht dafür nicht aus.

```bash
npm run admin:setup -- Manuel
npm run cf:secrets -- ADMIN_ACCOUNT_ID ADMIN_ACCESS_KEY
npm run cf:deploy
```

`admin:setup` ordnet ein bereits registriertes Konto per ID zu und erzeugt einen
privaten Schlüssel. Er steht in `.admin-access.txt` und `.env.local`; beide Dateien
sind von Git ausgeschlossen und werden nicht als Website-Assets ausgeliefert.
Unter Statistiken erscheint beim Besitzer die Benutzerverwaltung. Der Schlüssel
wird dort zum Freischalten eingegeben. Die Freigabe gilt höchstens 24 Stunden,
endet beim Abmelden und kann mit „Sperren“ sofort beendet werden. Freunde
bekommen nur den normalen Spiellink, nicht den Verwaltungsschlüssel.

Jede Benutzerlöschung verlangt eine Bestätigung. Das Besitzerkonto ist geschützt.
Gelöschte Konten verlieren HTTP-Zugriff, Token-Erneuerung und beim nächsten
Spielbefehl ihre aktive Verbindung. Gespielte Partien, Videos und Punkte bleiben
in der Historie; ein neu registrierter gleicher Name erhält eine neue Konto-ID.
Für erneute Einrichtung des gleichen Besitzers bleibt der Schlüssel unverändert.
Ein bewusstes Ändern von `ADMIN_ACCESS_KEY` und erneuter Secret-Upload widerruft
alle Verwaltungsfreigaben.

Die Video-Historie besitzt einen Bearbeitungsmodus mit Mehrfachauswahl, auch über
Spielerfilter hinweg. Eine Bestätigung gilt für die gesamte Auswahl. Videos werden
zunächst ausgeblendet und können 30 Sekunden lang über „Rückgängig“ wiederhergestellt
werden, auch nach einem Neuladen desselben Tabs. Erst danach entfernt ein globaler
Durable-Object-Alarm die Datei; er benötigt keinen offenen Browser und keinen Mac.
Storage-Ausfälle werden erneut versucht. Punkte und Bewertungen bleiben bei einer
Video-Löschung bestehen. Fehlgeschlagene Einträge bleiben ausgewählt.
Die automatische Archivbereinigung überspringt Dateien mit noch laufender
Rückgängig-Frist. Neue Uploads und Video-Löschungen werden dafür global serialisiert.

Videos und ihre Metadaten liegen in `video_history`, ohne Fremdschlüssel auf Räume,
Runden oder Benutzer. Vorhandene Videos werden beim ersten Schema-Update ohne
Kopieren der Dateien übernommen. Eine unveränderliche Video-ID verhindert, dass
ein wiederverwendeter Raumcode alte Videos überschreibt. Ersteller und Prompt
bleiben auch nach Raumlöschungen verfügbar und filterbar. Kleine Löschmarker
verhindern, dass verspätete Rundenwrites endgültig entfernte Videos wieder anlegen.

Auch Räume besitzen diesen Bearbeitungsmodus. Beim bestätigten Löschen werden nur
Runden, Bewertungen und Spielpunkte entfernt, nicht die Videos oder Benutzerkonten.
„Rückgängig“ für ein Video stellt keine gelöschte Partie wieder her. Laufende Räume
und ihre Videos werden weiterhin serverseitig geschützt; unabhängige Videos eines
früheren Raums bleiben auch bei einer neuen Partie mit gleichem Code bearbeitbar.
Die bestehende Speichergrenze mit automatischer Entfernung alter Dateien gilt
weiterhin. Bereits vor dieser Umstellung endgültig gelöschte Dateien sind nicht
wiederherstellbar.

Laufende KI-Jobs haben ein dauerhaftes Journal mit externer Event-ID. Alarms
nehmen unterbrochene Ergebnisabfragen nach 15 Sekunden wieder auf; es wird
kein neues Bild hochgeladen und kein neuer GPU-Auftrag gesendet. Das Journal
bleibt auch beim Verlassen des Erstellers erhalten. Ungeklärte Aufträge
enden nach 15 Minuten mit Fehler; ihr Budget bleibt konservativ bis zum TTL
reserviert. Originalbilder werden nicht für die Wiederaufnahme gespeichert.

Der globale Service begrenzt schnelle HTTP-Anfragen mit kurzlebigen,
gehashten IP-Buckets; jeder Raum begrenzt Spielnachrichten. Anonyme
Konfigurationsaufrufe verbrauchen keine HF-API-Abfragen. Angezeigte Quota-Werte
werden kurz gecacht, Start-/Generierungsprüfungen bleiben frisch.
Es gibt bewusst kein zusätzliches Spielpasswort. Worker Logs protokollieren
KI-Provider, Dauer und technische Fehler ohne Bilder, Prompts oder Tokens.

CI: `npm run test:ci`; GitHub Actions prüft jeden Push und Pull Request mit
Mock-KI, ohne Produktivdaten oder echte GPU-Aufträge.
