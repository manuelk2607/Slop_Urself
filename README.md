# Slop Urself

## Lokal starten

```bash
npm install
npm run dev
```

Die App laeuft dann lokal unter:

```text
http://127.0.0.1:3000
```

Standardmaessig nutzt das Projekt die echte LTX-Video-Anbindung ueber Hugging Face. Wenn du beim Entwickeln keine KI-Aufrufe verbrauchen willst, starte lokal mit `AI_PROVIDER=mock npm run dev`.

Die maximale Rundenzahl orientiert sich am KI-Kontingent und liegt standardmaessig bei 5 Runden. Du kannst sie beim Start anpassen:

```bash
AI_ROUND_LIMIT=5 npm run dev
```

## Postgres-Statistiken speichern

Das Spiel funktioniert auch ohne Datenbank. Wenn du eine Postgres-Datenbank verbindest, speichert es Raeume, Spieler, gespielte Runden und Votes fuer die Statistikseite.

Empfohlen: Neon Postgres Free Plan.

1. Erstelle eine Neon-Datenbank.
2. Kopiere die Connection-URL.
3. Starte die App mit `DATABASE_URL`:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require" npm run dev
```

Beim Start legt der Server die benoetigten Tabellen automatisch an. Das Schema liegt zusaetzlich in `db/schema.sql`.

Fuer echte KI plus Statistik:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require" HF_TOKEN=dein_token AI_ROUND_LIMIT=5 npm run dev
```

## Mit Freunden per Cloudflare Quick Tunnel spielen

Cloudflare Quick Tunnel erstellt eine temporaere HTTPS-URL, die auf deinen lokalen Server zeigt. Du brauchst keine eigene Domain, kein Port-Forwarding und keinen bezahlten Account.

1. Starte die App in Terminal 1:

```bash
npm run dev
```

2. Starte den Tunnel in Terminal 2:

```bash
npm run tunnel
```

3. Kopiere die angezeigte URL mit `trycloudflare.com` und schicke sie deinen Freunden.

Wichtig:

- Die URL funktioniert nur, solange beide Terminals laufen.
- Wenn du den Tunnel neu startest, bekommst du eine neue URL.
- Der Server muss auf Port `3000` laufen, damit `npm run tunnel` direkt funktioniert.
- Teile die URL nur mit Leuten, die mitspielen sollen.

## Ohne laufenden Mac hosten

Quick Tunnel ist gut fuer schnelle Tests, aber dein Mac muss dabei laufen. Fuer eine dauerhaft gehostete Version ist eine Cloudflare-Worker-Architektur vorbereitet:

- statische Assets ueber Cloudflare
- native WebSockets statt Socket.IO
- ein Durable Object pro Spielraum
- Hugging-Face-Token und Neon-URL als Cloudflare Secrets

Die Vorbereitungen liegen in `cloudflare/`.

```bash
npm run cf:dev
npm run cf:deploy
```

Vor einem Deploy muessen Secrets gesetzt werden:

```bash
npx wrangler secret put HF_TOKEN --config cloudflare/wrangler.toml
npx wrangler secret put DATABASE_URL --config cloudflare/wrangler.toml
```

Wichtig: Die lokale Express/Socket.IO-Version bleibt weiterhin der stabile Spielserver. Der Cloudflare-Ordner ist die vorbereitete Migration, damit das Spiel spaeter ohne laufenden Mac betrieben werden kann.

## KI konfigurieren

Die echte Hugging-Face-Generierung ist der Standard. Empfohlen fuer den Test mit Freunden:

```bash
HF_TOKEN=dein_token npm run dev
```

Ohne `HF_TOKEN` versucht die App den oeffentlichen Hugging-Face-Space. Wenn der Space Login oder ZeroGPU-Zugriff verlangt, hinterlege einen kostenlosen Hugging-Face-Token.

Wenn du wieder ohne echte KI testen willst:

```bash
AI_PROVIDER=mock npm run dev
```

Empfohlene echte KI-Konfiguration mit kostenloser Fallback-Kette:

```bash
HF_TOKEN=dein_token \
AI_PROVIDER=wan \
AI_PROVIDER_CHAIN=wan,wan22,ltx \
AI_ROUND_LIMIT=5 \
npm run dev
```

Die Provider-Kette versucht nacheinander:

- `wan`: `multimodalart/wan2-1-fast`
- `wan22`: `Saravutw/WAN2.2_I2V_LIGHTNING_4-8step_custom`
- `ltx`: `Lightricks/ltx-video-distilled`

Wenn ein Provider wegen Limit, Queue, Space-Fehler oder API-Fehler scheitert, wird automatisch der naechste versucht.

Die LTX-Anbindung nutzt das Originalbild direkt als Image-to-Video-Eingabe. Der Server erweitert kurze Spieler-Prompts zu einem knappen Action-Prompt, damit die sichtbare Handlung wichtiger ist als ein reiner Kameraschwenk.

Aktuelle LTX-Parameter im Server:

- Prompt: Spieler-Prompt plus Action-Template
- Negative Prompt: blockiert unter anderem `camera pan only`, `zoom only`, `no action` und `motionless subject`
- Aufloesung: `512 x 704`
- Dauer: `5`
- Frames: `9`
- Guidance: `2.5`
- Seed: randomisiert
- Prompt-Enhancer: aus

Diese Werte koennen lokal angepasst werden:

```bash
LTX_DURATION=5 LTX_FRAMES=121 LTX_GUIDANCE=2.5 LTX_ENHANCE_PROMPT=false LTX_HEIGHT=512 LTX_WIDTH=704 npm run dev
```

Alternative zum Experimentieren:

```bash
HF_TOKEN=dein_token \
AI_PROVIDER=wan \
AI_PROVIDER_CHAIN=wan,ltx \
npm run dev
```

Wan-Spaces koennen ihre Gradio-Parameter aendern. Wenn ein Wan-Provider fehlschlaegt, faellt die App automatisch auf den naechsten Provider in `AI_PROVIDER_CHAIN` zurueck.
