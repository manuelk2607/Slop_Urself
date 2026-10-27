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

## Einmaliger persönlicher Live-Nachweis

Das vorbereitete Werkzeug ist **nicht** Teil der CI und wurde für diesen
Implementierungsauftrag nicht mit einem echten GPU-Auftrag ausgeführt.
Nach gesonderter Entscheidung kann es bewusst gestartet werden:

Voraussetzung sind `npm ci`, ein mit `npx playwright install chromium`
installierter Browser und eine lokale grafische Sitzung. Den Befehl aus dem
Repository-Verzeichnis ausführen; das Werkzeug liest keine lokalen HF-Tokens.

```sh
node --import tsx tools/hf-live-check.mts --execute-one-free-video --hf-user=DEIN-HF-NAME
```

Es verwendet ausschließlich `https://slopurself.maki26.workers.dev`, prüft echte
KI und fünf Sekunden Dauer, erstellt ein isoliertes passwortgeschütztes Testprofil
und öffnet ein sichtbares Chromium-Fenster. Dort im Spiel das eigene HF-Konto
per Gerätecode freigeben. Zugangsdaten ausschließlich auf Hugging Face eingeben.
Das erwartete Konto und dessen tatsächlich gemeldetes Kontingent werden geprüft.
Ein quadratisches synthetisches Bild und ein Economy-Prompt ergeben genau einen
Auftrag. Ein unklarer Status löst keine weitere Einreichung aus.

Vor Browser-/Netzwerkzugriff prüft das Werkzeug `.local/hf-live-evidence.json`
und sperrt parallele Ausführungen über eine exklusive Lock-Datei. Noch **vor**
dem Einreichen setzt es dauerhaft `submittedAt`. Danach ist jeder weitere
automatische Versuch gesperrt, auch nach Fehler oder Prozessabbruch. Diese
Sperre nicht löschen, um einen unklaren Auftrag blind erneut zu starten.
Ein verwaister Lock erfordert ebenfalls manuelle Prüfung.

Als vollständiger Erfolg zählen archivierte MP4-Wiedergabe, Byte-Range HTTP 206,
gespeicherte Statistik sowie dasselbe HF-Konto vor/nach dem Auftrag mit real
gesunkenem Kontingent. Fehlender Verbrauchsnachweis ist kein Erfolg. Die ignorierte
Evidenz enthält nur IDs, Prüfstatus und Quotenwerte, keine Tokens, Cookies oder
Passwörter. Nur die eigene Test-HF-Verbindung wird getrennt; Testprofil, Partie
und Video bleiben für die Nachprüfung bestehen. Nicht mit Produktions-Secrets
oder fremden Browserprofilen starten.

Der GitHub-Actions-Lauf zu `d166133` ist ein separater externer Nachweis und wird
nicht aus erfolgreichen lokalen Tests abgeleitet. Netzwerkfehler werden anhand
der aktuellen Antwort eingeordnet: Ein verweigerter CONNECT-Tunnel scheitert
vor der API; erst bei erreichbarem GitHub sind API-Authentifizierung und Rechte
zu prüfen. Die frühere ausgefallene Cloud-Umgebung ist kein Befund für diesen Mac.

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

Jeder Spieler muss vor dem Erstellen oder Betreten eines Raums sein eigenes
HF-Konto verbinden. Das gilt auch für Spieler in Archivpartien. Zuschauer
benötigen nur ein Spielerprofil und den Raumcode. Die Mock-KI ist ausgenommen.
Während einer laufenden Runde ist die Kontoverwaltung gesperrt; bei einem
abgelaufenen Zugang öffnet der Server die Wiederverknüpfung. Eine
Wiederverbindung muss dasselbe HF-Konto verwenden, für das die Runden
reserviert wurden. Bei einem neuen Konto eine neue Partie starten.

Ohne persönliche Verbindung blockiert der Server den Spielerbeitritt und
neue KI-Aufträge. Ein nicht erreichbarer oder abgelaufener persönlicher Zugang
wird nie durch einen Server-Token ersetzt. Jeder Auftrag pinnt den Zugang des
Erstellers; auch Ergebnisabruf und erlaubte Fallbacks verwenden genau diesen
Zugang. Bereits eingereichte Aufträge werden nach einer Browsertrennung mit
demselben gepinnten Zugang weiter abgefragt, solange dieser gültig ist.

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
Schlüsselableitung der bestehende `AUTH_COOKIE_SECRET` verwendet. Für neue
Installationen einen unabhängigen zufälligen Vault-Schlüssel verwenden.

Kontrollierter Schlüsselwechsel (nur vorbereitet, nicht automatisch ausgeführt):

1. Neuen zufälligen `HF_OAUTH_ENCRYPTION_KEY` und vorübergehend den bisherigen
   Schlüssel als `HF_OAUTH_PREVIOUS_ENCRYPTION_KEY` setzen. Bei bisheriger HKDF-
   Ableitung ist der alte Wert von `AUTH_COOKIE_SECRET` der vorherige Schlüssel.
2. Beide gezielt übertragen und die geprüfte neue Software veröffentlichen:
   `npm run cf:secrets -- HF_OAUTH_ENCRYPTION_KEY HF_OAUTH_PREVIOUS_ENCRYPTION_KEY`.
   Neue Zugänge nutzen nur den aktuellen Schlüssel. Bestehende Verbindungen,
   OAuth-Zwischenstände und gepinnte Aufträge werden beim Lesen umverschlüsselt;
   ihre Ablaufzeit, Identität und Kontingentzuordnung bleiben erhalten.
3. Nach vollständigem Wechsel aller Instanzen und Ablauf der alten Zugänge
   (maximal acht Stunden) den vorherigen Schlüssel aus Cloudflare und der lokalen
   Konfiguration entfernen. Er wird vom Standard-Secret-Upload nicht mitgesendet.

Bei kompromittiertem Schlüssel keine Übergangsfrist verwenden, sondern sofort
entfernen und betroffene Nutzer neu verbinden lassen. Ohne vorherigen Schlüssel
bleiben alte verschlüsselte Einträge gesperrt. Eine Rückkehr zu alter Software ohne
Unterstützung des neuen Vault-Formats erfordert ebenfalls erneute HF-Anmeldung;
Spielprofile und Statistiken sind davon unabhängig. Produktive Rotation und
gemischte Deployments müssen vor Freigabe gesondert abgenommen werden.

Pro Profil sind höchstens 16 neue aktive Vault-Einträge für Verbindungen,
Anmeldezwischenstände und gepinnte Aufträge erlaubt; insgesamt bleibt die Grenze
bei 512. Einträge verfallen regulär und werden beim Trennen/Bereinigen entfernt.
Vorhandene Alteinträge werden bei Migration zugeordnet, nicht pauschal gelöscht.

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
laufen automatisch ab. Nach einer erfolgreichen einmaligen Tokenausgabe wird
das Ergebnis bereits verschlüsselt im offenen Vorgang gesichert. Vorübergehende
Profil- oder Kontingentfehler wiederholen nur die Prüfung, nicht den Tokenabruf;
die ursprüngliche Tokenablaufzeit bleibt erhalten. Endgültig ungültige Codes
werden verworfen und können neu gestartet werden.
Der frühere PKCE-Callback bleibt für bereits begonnene
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
der Freigabe als nutzbare KI-Verbindung prüft der Server auch `/oauth/userinfo`, `/api/whoami-v2`
und die echte ZeroGPU-Kontingentabfrage. Fehlende Kontingentrechte werden
abgewiesen, nicht durch geschätzte 300 Sekunden ersetzt. Die tatsächliche
Zuordnung einer GPU-Generierung muss zusätzlich mit einem budgetgedeckten
Live-Auftrag überprüft werden. Ein Zugriffsscope für Inference Providers
ist kein Beleg für ZeroGPU-Zugriff; keine breiteren Rechte auf Verdacht
erteilen.

Ein zentraler `HF_TOKEN` wird für das Spiel nicht mehr benötigt und beim
Standard-Secret-Upload nicht mehr übertragen. Ein eventuell vorhandener Wert
wird von echten Spielaufträgen nie verwendet. Die früher verifizierte zentrale
HF-Identität bleibt ausschließlich für bestehende Reservierungen zugeordnet.
HF-Anmeldung und
Kontingentanzeigen blockieren keine Budgetfreigaben anderer Räume; Änderungen
an Reservierungen bleiben serialisiert und prüfen das Kontingent erneut.

Quellen: [HF OAuth](https://huggingface.co/docs/hub/oauth),
[HF ZeroGPU](https://huggingface.co/docs/hub/spaces-zerogpu),
[HF Kontingentabfrage und erforderliche Leserechte](https://huggingface.co/docs/huggingface_hub/en/guides/manage-spaces#track-your-zerogpu-quota).
