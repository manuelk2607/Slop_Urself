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

Empfohlene erste echte KI-Konfiguration:

```bash
HF_TOKEN=dein_token \
HF_SPACE_ID=Lightricks/ltx-video-distilled \
HF_PREDICT_ENDPOINT=/image_to_video \
AI_ROUND_LIMIT=5 \
npm run dev
```

Die LTX-Anbindung nutzt das Originalbild direkt als Image-to-Video-Eingabe. Es gibt keine vorgeschaltete InstructPix2Pix-Bildtransformation mehr und der Prompt wird nicht automatisch mit starken Stilwoertern erweitert.

Aktuelle LTX-Parameter im Server:

- Prompt: exakt der Spieler-Prompt
- Negative Prompt: `blurry, low quality, distorted, static, motionless`
- Aufloesung: `512 x 704`
- Dauer: `4`
- Frames: `9`
- Guidance: `1.6`
- Seed: randomisiert

Alternative zum Experimentieren:

```bash
HF_TOKEN=dein_token \
AI_PROVIDER=wan \
HF_SPACE_ID=multimodalart/wan2-1-fast \
HF_PREDICT_ENDPOINT=/predict \
npm run dev
```

Wan-Spaces koennen ihre Gradio-Parameter aendern. Wenn diese Variante fehlschlaegt, muss die konkrete Space-API einmal mit `@gradio/client` inspiziert und die Parameterliste in `generateWanVideo` angepasst werden.
