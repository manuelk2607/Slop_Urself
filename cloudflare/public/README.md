# Cloudflare public assets

`npm run build` copies static files and generated browser bundles from `public/`
into this directory. Edit their sources in `public/` and `src/client/`, not here.
Wrangler uploads only this directory; never place credentials or server files in it.
