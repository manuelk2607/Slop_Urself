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

Standardmaessig nutzt das Projekt die Mock-AI, damit beim Testen keine Tokens verbraucht werden.

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
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require" HF_TOKEN=dein_token USE_MOCK_AI=false AI_ROUND_LIMIT=5 npm run dev
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

## Echte KI optional aktivieren

Zum Entwickeln und Testen sollte die Mock-AI aktiv bleiben. Fuer echte Hugging-Face-Generierung kannst du spaeter so starten:

```bash
HF_TOKEN=dein_token USE_MOCK_AI=false npm run dev
```

Ohne `USE_MOCK_AI=false` bleibt die Mock-AI aktiv.
