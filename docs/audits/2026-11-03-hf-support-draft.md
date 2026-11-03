# HF-Supportanfrage – veröffentlicht

Veröffentlicht am 3. November 2026: [huggingface/hub-docs#2966](https://github.com/huggingface/hub-docs/issues/2966).
Der erneut abgerufene öffentliche Titel und Inhalt entsprechen dem freigegebenen Text.
Nur der englische Fragetext wurde übertragen; interne Nachweise bleiben hier.

## Title

Supported way to bind a ZeroGPU proxy identity to an authenticated API caller

## Question

We operate a public, free ZeroGPU Gradio Space with a mounted FastAPI app.
Before an explicitly bounded two-user test, our application verifies each
caller's own Hugging Face bearer credential with `GET /api/whoami-v2`.
Both distinct users authenticate successfully and their own
`GET /api/spaces/zero-gpu/quota` reports 300 available seconds.

We have **not scheduled any GPU task**. We do not claim a billing defect.
Our application's fail-closed preflight cannot yet establish the association
between the caller and the opaque proxy identity. This may be an unsupported
assumption in our validation rather than a Hugging Face error.

For both callers, a protected CPU-only request receives `X-IP-Token` with the
claim names `ip`, `user`, `uuid`, `error`, `exp`. Its `user` is a string that
matches neither the verified immutable user ID nor canonical username.
There is no explicit error or expiry failure. We have not exposed the token
or any claim values. A separate personal read-token diagnostic has the same
result, so this is not established as an OAuth-specific failure.

Tested transports (CPU-only, without any inference):

- Personal bearer authorization, with the same application credential.
- A short-lived token from the official Space `/jwt` endpoint, using the
  official Gradio client's `__sign` transport.
- A resource-token header and a cookie comparison, neither establishing a
  personal identity binding.

Runtime: `spaces==0.51.3`; native source:
[reviewed producer revision](https://huggingface.co/spaces/Manuel2607/SlopUrself-Wan22-Validated/tree/15a332bbb6bd6a389c6a2ec92867846509732f22).
Hardware remains free ZeroGPU; model is prepared but inference is disabled.

Could you clarify:

1. Is `X-IP-Token.user` intentionally opaque, and is comparing it with a
   whoami user ID/username unsupported?
2. What supported, read-only endpoint or attestation can associate the
   ZeroGPU scheduling identity with the independently authenticated API caller?
3. Do OAuth access tokens with `openid profile read-billing` support the same
   individual ZeroGPU quota attribution as a personal read token? Is any
   additional permission specifically required for ZeroGPU, independently of
   paid Inference Providers?
4. Does HF provide an authoritative per-job usage/account receipt, or only
   aggregate remaining-quota observations?

We must not fall back to the Space owner's credential or a shared IP quota.
We need a supported attribution contract before relaxing any identity check.
We will not post credentials, proxy tokens, cookies, private logs or media.

## Lokaler Nachweis und nächster Schritt

- Produktive Worker-/Services-Version bei beiden aktuellen Proben:
  `4b62baad-18a8-4489-9f1e-5e5925146f1a`.
- Beide persönlichen Identitäten bestätigt; Proxy-Vergleichskategorie
  `opaque-unrelated`, `actor_mismatch`, `gpuCalls=0`.
- Keine bestätigte falsche Belastung; tatsächliche Belastung noch ungeprüft.
- Veröffentlichung ausdrücklich freigegeben und anschließend per getrenntem GET geprüft.
- Rückmeldung des Anbieters steht aus; keine zweite Supportanfrage oder neue HF-Codes erforderlich.
- Eine Anbieterbestätigung allein beweist noch keine individuelle Belastung:
  danach bleiben die genau zwei genehmigten Gratisaufträge und ihre getrennten
  Vor-/Nachmessungen sowie Wiedergabe/Abstimmung/Archivprüfung erforderlich.
