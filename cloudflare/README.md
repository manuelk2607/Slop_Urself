# Cloudflare migration

This folder prepares the hosted version so the game can run without a local Mac.

Target architecture:

- Static frontend served by Cloudflare Workers assets.
- Native WebSockets instead of Socket.IO.
- One Durable Object instance per room.
- Neon remains the long-term statistics database.
- Hugging Face remains the free image-to-video provider via Cloudflare secrets.

## Commands

```bash
npm run cf:dev
npm run cf:deploy
```

Before deploy, add secrets:

```bash
npx wrangler secret put HF_TOKEN --config cloudflare/wrangler.toml
npx wrangler secret put DATABASE_URL --config cloudflare/wrangler.toml
```

## Status

The Worker/Durable Object backend is scaffolded in `src/worker.ts`. It mirrors the room lifecycle and native WebSocket event names, but the current browser client still uses Socket.IO against the local Express server. The next migration step is a frontend transport adapter that can speak either Socket.IO locally or native WebSockets on Cloudflare.

`wrangler.toml` points static assets at `cloudflare/public` on purpose. Do not point Cloudflare assets at the repository root, because local files such as `.env.local` must never be uploaded.
