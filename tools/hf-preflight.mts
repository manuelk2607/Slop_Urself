import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import { HfPreflight, readOnlyHfFetch, type TestSlot } from '../src/auth/hf-preflight';

// No token/password input or secret file output. Only the public OAuth client ID
// is selected from existing configuration. All consent grants live in RAM.
const local = await readFile('.env.local', 'utf8').then(parse).catch(() => ({} as Record<string, string>));
const client = process.env.HF_OAUTH_CLIENT_ID || local.HF_OAUTH_CLIENT_ID;
if (!client) throw new Error('Public HF_OAUTH_CLIENT_ID is required; no access token should be supplied.');
const origin = 'http://127.0.0.1:3398';
const nonce = randomBytes(20).toString('base64');
globalThis.fetch = readOnlyHfFetch(globalThis.fetch);
const check = new HfPreflight({ HF_OAUTH_CLIENT_ID: client, AUTH_COOKIE_SECRET: randomBytes(48).toString('base64') }, origin);
const report = process.argv.find(arg => arg.startsWith('--report='))?.slice(9);
const page = `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Slop Urself – sichere HF-Prüfung</title>
<style nonce="${nonce}">body{font:18px system-ui;max-width:750px;margin:2rem auto;padding:1rem;background:#151821;color:#fff}button{font:inherit;padding:.7rem;margin:.5rem}section{border:1px solid #888;padding:1rem;margin:1rem 0}a{color:#9bd3ff}pre{white-space:pre-wrap;overflow-wrap:anywhere}code{font-size:1.4rem}#notice{min-height:2rem}</style>
<h1>Hugging-Face-Konten sicher prüfen</h1><p>Verbinde zwei verschiedene Testkonten direkt bei Hugging Face. Nur öffentliches Profil und Kontingent-Leserechte. Keine Videoaufträge oder Zahlungen. Zugangsdaten bleiben ausschließlich im Arbeitsspeicher und verfallen hier spätestens nach einer Stunde.</p>
<p>Für Konto B bei Hugging Face zum zweiten Testkonto wechseln. Niemals Tokens oder Passwörter hier oder im Chat eingeben.</p>
<section id="A"><h2>Konto A</h2><button data-start="A">Konto A verbinden</button><p class="status">Nicht verbunden</p><code></code><p><a hidden target="_blank" rel="noopener noreferrer">Bei Hugging Face anmelden und freigeben</a></p></section>
<section id="B"><h2>Konto B</h2><button data-start="B">Konto B verbinden</button><p class="status">Nicht verbunden</p><code></code><p><a hidden target="_blank" rel="noopener noreferrer">Bei Hugging Face anmelden und freigeben</a></p></section>
<button id="verify">Identität, Kontingente und lokale Kontoisolation prüfen</button><p id="notice" role="status"></p><pre id="result"></pre>
<script nonce="${nonce}">
let busy=false; const notice=document.querySelector('#notice');
async function command(path){const r=await fetch(path,{method:'POST'});const v=await r.json();if(!r.ok)throw Error(v.error);return v;}
async function refresh(){if(busy)return;busy=true;try{const r=await fetch('/status');if(!r.ok)throw Error('Prüfsitzung beendet');const s=await r.json();for(const id of ['A','B']){const e=document.getElementById(id),v=s[id];e.querySelector('.status').textContent=v.connected?'Verbunden: '+v.username:v.pending?'HF-Freigabe ausstehend':'Nicht verbunden';e.querySelector('button').disabled=!!(v.connected||v.pending);e.querySelector('code').textContent=v.pending?v.userCode:'';const a=e.querySelector('a');a.hidden=!v.pending;if(v.pending){a.href=v.verificationUrl;await command('/poll/'+id);}}}catch(e){notice.textContent=e.message;}finally{busy=false;}}
for(const b of document.querySelectorAll('[data-start]'))b.onclick=async()=>{try{await command('/start/'+b.dataset.start);await refresh();}catch(e){notice.textContent=e.message;}};
document.querySelector('#verify').onclick=async()=>{try{notice.textContent='Prüfung läuft …';const v=await command('/verify');document.querySelector('#result').textContent=JSON.stringify(v,null,2);notice.textContent='Lesende Prüfung abgeschlossen. Keine reale Abrechnung nachgewiesen.';}catch(e){notice.textContent=e.message;}};
setInterval(refresh,5000);refresh();</script></html>`;
let serial: Promise<unknown> = Promise.resolve(), lastCheck = 0;
const server = createServer((request, response) => {
    response.setHeader('cache-control', 'no-store'); response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('x-frame-options', 'DENY'); response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('content-security-policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
    if (request.headers.host !== '127.0.0.1:3398' || request.headers['sec-fetch-site'] === 'cross-site') { response.writeHead(403).end(); return; }
    const path = request.url;
    if (request.method === 'GET' && path === '/') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(page); return; }
    const mutating = request.method === 'POST';
    if (mutating && (request.headers.origin !== origin || Number(request.headers['content-length'] || 0) > 0 || request.headers['transfer-encoding'])) { response.writeHead(403).end(); return; }
    serial = serial.then(async () => {
        response.setHeader('content-type', 'application/json');
        try {
            if (request.method === 'GET' && path === '/status') { response.end(JSON.stringify(await check.status())); return; }
            const slot = /^\/(start|poll)\/([AB])$/.exec(path || '');
            if (mutating && slot) { await check[slot[1] === 'start' ? 'start' : 'poll'](slot[2] as TestSlot); response.end('{}'); return; }
            if (mutating && path === '/verify') {
                if (Date.now() - lastCheck < 60_000) { response.writeHead(429).end(JSON.stringify({ error: 'Bitte eine Minute bis zur nächsten Prüfung warten.' })); return; }
                lastCheck = Date.now(); const evidence = await check.check();
                if (report) await writeFile(report, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
                response.end(JSON.stringify(evidence)); console.info('HF read-only check completed; no inference or billing proof.'); return;
            }
            response.writeHead(404).end('{}');
        } catch {
            response.writeHead(409).end(JSON.stringify({ error: 'Bitte beide unterschiedlichen Konten verbinden. Bei einem Fehler die HF-Freigabe und Kontingentrechte prüfen; es wurde kein Videoauftrag gestartet.' }));
        }
    }).catch(() => { response.destroy(); });
});
const close = () => { check.close(); server.closeAllConnections(); server.close(); };
const timer = setTimeout(close, 3600_000); timer.unref();
process.once('SIGINT', close); process.once('SIGTERM', close);
server.listen(3398, '127.0.0.1', () => console.info(`HF-Prüffenster: ${origin}; Zugangsdaten ausschließlich im RAM, keine Generierung.`));
