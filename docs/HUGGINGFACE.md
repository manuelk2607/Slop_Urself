# Persönliches KI-Kontingent

## Prüfstatus

Der Anmeldeweg verwendet den offiziellen OAuth-Gerätecodefluss. Der vorherige
Callback-Aufruf lieferte bei HF auch nach der Zustimmung HTTP 404; ein
automatisches Neuladen behob das nicht zuverlässig und wurde entfernt.
Der Gerätecodefluss wurde mit der registrierten App, den Berechtigungen
`openid profile read-billing` und der echten ZeroGPU-Abfrage erfolgreich
geprüft (300 von 300 GPU-Sekunden). Die Anwendung prüft Profil und Kontingent,
bevor sie die Verbindung speichert. Seit 18. Oktober 2026 ist auch der
vollständige produktive Ablauf auf Cloudflare einschließlich Freigabe,
automatischer Übernahme und Wiederabruf nach Reload bestätigt. GitHub CI
sowie lokale Chromium-/WebKit-Tests sind erfolgreich.
Ein persönlicher Live-Videoauftrag und
dessen tatsächliche Kontingentabbuchung sind weiterhin separat zu prüfen.

## Für Mitspieler

1. Ein kostenloses [Hugging-Face-Konto](https://huggingface.co/join) erstellen
   und die E-Mail-Adresse bestätigen. Ein eigenes Space, PRO-Abo oder
   manuell angelegter API-Schlüssel ist nicht notwendig.
2. Mit dem bisherigen Benutzernamen im Spiel anmelden. Unter **KI-Konto**
   auf **Hugging Face verbinden** klicken.
3. Den angezeigten achtstelligen Code kopieren und **Bei Hugging Face
   bestätigen** öffnen. Auf HF den Code eingeben und fortfahren.
4. Bei Hugging Face anmelden, die angezeigten Berechtigungen prüfen und
   die Verbindung bestätigen. Neben dem öffentlichen Profil benötigt das
   Spiel `read-billing`, um das ZeroGPU-Kontingent zu lesen. Dieser Scope
   umfasst auch die Auskunft, ob eine Zahlungsmethode hinterlegt ist;
   das Spiel ruft nur das Kontingent ab. Er erlaubt keine Zahlungen.
   Anschließend zum Spiel-Tab zurückkehren. Das Spiel erkennt die Freigabe
   automatisch. Der Code läuft nach spätestens zehn Minuten ab; dann erneut
   verbinden. **Abbrechen** beendet die ausstehende Verbindung.

Das HF-Passwort wird ausschließlich auf `huggingface.co` eingegeben, nie
im Spiel. Die Verbindung gilt nur für diesen Browser auf diesem Gerät und
läuft spätestens nach acht Stunden ab; danach erneut verbinden. Andere
Geräte brauchen ihre eigene HF-Verbindung. Der bisherige Benutzername
allein reicht nicht, um einen gespeicherten HF-Zugang zu übernehmen.

Vor dem Spielstart kann jeder in der Lobby sein eigenes HF-Konto verbinden.
Während einer laufenden Runde ist die Kontoverwaltung gesperrt. Eine
Wiederverbindung muss dasselbe HF-Konto verwenden, für das die Runden
reserviert wurden. Bei einem neuen Konto eine neue Partie starten.

Ohne persönliche Verbindung bleibt das gemeinsame Serverkontingent erhalten.
Ein nicht erreichbarer oder abgelaufener persönlicher Zugang wird nicht
heimlich durch das gemeinsame Konto ersetzt. Auch Archivpartien bleiben
ohne persönliche HF-Anmeldung möglich.

## Runden und Grenzen

- HF nennt für kostenlose Konten aktuell fünf Minuten, also bis zu 300
  gewichtete GPU-Sekunden. Bereits außerhalb des Spiels verbrauchte Zeit
  steht nicht erneut zur Verfügung; das Spiel liest das echte Restbudget.
- Jeder Ersteller nutzt seinen eigenen Zugang. Die maximale Rundenzahl ist
  das Minimum der verfügbaren vollständigen Runden aller beteiligten
  HF-Konten. Teilen sich mehrere Spieler ein HF-Konto, wird dessen Budget
  unter ihnen aufgeteilt, nicht mehrfach gezählt. Das gilt auch, wenn eine
  persönliche Verbindung dasselbe Konto wie der Server verwendet.
- Beispiel mit vollen unabhängigen Konten: Zwei Spieler können bei einer
  Planung von 79 Sekunden pro Video jeweils drei Videos erstellen, also
  drei gemeinsame Runden mit insgesamt sechs Videos. Ein einzelner gemeinsamer
  300-Sekunden-Topf erlaubt unter denselben Annahmen nur eine volle Runde.
  Qualität, tatsächliche GPU-Nutzung, verfügbare Aufrufe und laufende
  Reservierungen können die Zahl reduzieren. Keine Verfügbarkeitsgarantie.
- Fehlversuche können Kontingent kosten. Bekannte Aufträge werden wieder
  abgefragt, nicht auf Verdacht neu gestartet. Laufende Aufträge behalten
  ihren ursprünglich autorisierten Zugang bis zum Abschluss oder dessen
  Ablauf, auch wenn der Ersteller die Partie verlässt.

## Einrichtung für den Betreiber

Die bestehende Cloudflare-Architektur bleibt erhalten. Benutzer, Punkte und
Statistiken werden nicht migriert; OAuth-Zugänge liegen verschlüsselt im
Service-Durable-Object, getrennt von öffentlichen Spielzuständen. Lokal
liegen sie verschlüsselt unter `.local/hf/` mit eingeschränkten Dateirechten.
Dieses Verzeichnis ist von Git ausgeschlossen. Testläufe können einen
eigenen Pfad über `HF_LOCAL_STORAGE_DIR` verwenden.

### Registrierte öffentliche OAuth-App

Für lokale Tests und eine feste Spieladresse empfohlen:

1. Unter [HF OAuth-Apps](https://huggingface.co/settings/applications/new)
   eine öffentliche App ohne Client-Secret anlegen, Name **Slop Urself**.
2. Nur `openid`, `profile` und `read-billing` verwenden. Die zusätzliche
   Leseberechtigung ist für die Kontingentabfrage nötig. Keine E-Mail-,
   Repository-, Schreib-, Kauf-, Jobs- oder Endpoint-Berechtigungen
   einschalten. Tokenlaufzeit acht Stunden.
3. Rückleitungen registrieren:
   `https://slopurself.maki26.workers.dev/api/hf/callback` und
   `http://127.0.0.1/api/hf/callback`. Für `localhost` ist ein eigener
   Eintrag erforderlich. HF erlaubt bei HTTP-Loopback-Adressen variable Ports.
4. Die öffentliche Client-ID lokal in `.env.local` als
   `HF_OAUTH_CLIENT_ID` eintragen. Kein Client-Secret erforderlich.
5. Nach bestandenem Test die Konfiguration und den neuen Anwendungscode
   veröffentlichen. Die bestehenden Upload-Werkzeuge unterstützen die
   optionalen HF-OAuth-Konfigurationswerte:

```sh
npm run cf:secrets -- HF_OAUTH_CLIENT_ID
npm run cf:deploy
```

`HF_OAUTH_ORIGIN` kann optional auf die feste Spiel-Origin eingeschränkt
werden. Dann funktioniert dieselbe Konfiguration nicht unter einer anderen
Origin, etwa localhost. `HF_OAUTH_ENCRYPTION_KEY` ist optional und muss
mindestens 32 Zeichen haben; ohne diesen Wert wird mit separater HKDF-
Schlüsselableitung der bestehende `AUTH_COOKIE_SECRET` verwendet. Eine
Rotation des verwendeten Schlüssels macht alte HF-Verbindungen unlesbar;
Spieler müssen sich dann erneut verbinden.

### Alternative ohne manuelle App-Registrierung

Auf einer veröffentlichten HTTPS-Adresse stellt die Anwendung
`/.well-known/oauth-cimd` bereit. Wenn `HF_OAUTH_CLIENT_ID` nicht gesetzt
ist, wird diese URL als Client-ID verwendet. Lokal per HTTP ist hingegen
eine registrierte Client-ID nötig. Ob HF eine konkrete CIMD-Konfiguration
akzeptiert, muss beim echten Anmeldetest geprüft werden; Mock-Tests sind
kein Nachweis dafür.

## Datenschutz und Prüfung

Ein zufälliges HTTP-only-Browsercookie bindet den Gerätecodefluss an die
angemeldete Spielprofil-ID und die Spieladresse. Der geheime `device_code`
bleibt AES-GCM-verschlüsselt auf dem Server; nur der kurze Bestätigungscode
gelangt ins UI. Die Abfragen halten das HF-Pollingintervall einschließlich
`slow_down` ein. Offene Bestätigungen lassen sich nach Reload fortsetzen und
laufen automatisch ab. Der frühere PKCE-Callback bleibt für bereits begonnene
Anmeldungen verfügbar. Zugriffstokens werden ebenfalls mit AES-GCM
verschlüsselt und nicht an den Browser, in Raumdaten, Statistiken oder
Anwendungslogs ausgegeben. Die App speichert keine HF-Passwörter und fragt
keine E-Mail-Adressen ab. Abgelaufene Zugangsdaten werden entfernt.

**Verbindung trennen** entfernt den Zugang auf diesem Gerät vom Spielserver;
bereits autorisierte laufende Aufträge behalten nur ihren eigenen Zugang
für die Ergebnisabfrage bis zum Abschluss oder Ablauf. Zusätzlich kann die
App unter [HF Connected Apps](https://huggingface.co/settings/connected-applications)
widerrufen werden. An HF übertragene Bilder unterliegen weiterhin den
Speicherregeln des verwendeten Space.

Eine OAuth-Anmeldung allein reicht nicht als Kompatibilitätsnachweis. Vor
dem Speichern prüft der Server auch `/oauth/userinfo`, `/api/whoami-v2`
und die echte ZeroGPU-Kontingentabfrage. Fehlende Kontingentrechte werden
abgewiesen, nicht durch geschätzte 300 Sekunden ersetzt. Die tatsächliche
Zuordnung einer GPU-Generierung muss zusätzlich mit einem budgetgedeckten
Live-Auftrag überprüft werden. Ein Zugriffsscope für Inference Providers
ist kein Beleg für ZeroGPU-Zugriff; keine breiteren Rechte auf Verdacht
erteilen.

Quellen: [HF OAuth](https://huggingface.co/docs/hub/oauth),
[HF ZeroGPU](https://huggingface.co/docs/hub/spaces-zerogpu),
[HF Kontingentabfrage und erforderliche Leserechte](https://huggingface.co/docs/huggingface_hub/en/guides/manage-spaces#track-your-zerogpu-quota).
