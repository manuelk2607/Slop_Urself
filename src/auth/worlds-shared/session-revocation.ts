import { importJWK, jwtVerify, SignJWT } from 'jose';
import { boundedBody } from './oidc.ts';

export const sessionRevokedEvent = 'https://schemas.openid.net/secevent/caep/event-type/session-revoked';
export const sessionRevocationPath = '/auth/events/session-revoked';
export const sessionEventContentType = 'application/secevent+jwt';
export const sessionEventMaxDelay = 24 * 60 * 60 * 1000;
const tokenAgeSeconds = 300;
const clockSkewSeconds = 5;

type PinnedKey = { kid: string; kty: 'OKP'; crv: 'Ed25519'; x: string };
export type SessionRevocation = {
  eventId: string;
  identityIssuer: string;
  subject: string;
  revokedThrough: number;
};
export type SessionEventTrust = {
  signer: string;
  audience: string;
  identityIssuer: string;
  key: PinnedKey;
};

const kidPattern = /^[A-Za-z0-9_-]{1,64}$/;
const eventIdPattern = /^[A-Za-z0-9_-]{16,128}$/;
const base64UrlKey = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function sessionEventPublicKey(serialized: string | undefined): PinnedKey | undefined {
  if (!serialized) return;
  try {
    const key = record(JSON.parse(serialized));
    if (key?.kty !== 'OKP' || key.crv !== 'Ed25519' ||
        typeof key.kid !== 'string' || !kidPattern.test(key.kid) ||
        typeof key.x !== 'string' || !base64UrlKey.test(key.x) ||
        Object.keys(key).some(name => !['kid', 'kty', 'crv', 'x'].includes(name))) return;
    return { kid: key.kid, kty: 'OKP', crv: 'Ed25519', x: key.x };
  } catch { return; }
}

export async function signSessionRevocation(
  event: SessionRevocation,
  signer: string,
  audience: string,
  key: { kid: string; privateKey: CryptoKey },
  now = Date.now(),
) {
  return new SignJWT({
    sub_id: { format: 'iss_sub', iss: event.identityIssuer, sub: event.subject },
    events: {
      [sessionRevokedEvent]: { event_timestamp: Math.floor(event.revokedThrough / 1000) },
    },
  })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'secevent+jwt', kid: key.kid })
    .setIssuer(signer)
    .setAudience(audience)
    .setJti(event.eventId)
    .setIssuedAt(Math.floor(now / 1000))
    .sign(key.privateKey);
}

async function verifiedRevocation(raw: string, trust: SessionEventTrust, now: number): Promise<SessionRevocation> {
  const { payload, protectedHeader } = await jwtVerify(raw, await importJWK(trust.key, 'EdDSA'), {
    algorithms: ['EdDSA'],
    typ: 'secevent+jwt',
    issuer: trust.signer,
    audience: trust.audience,
    requiredClaims: ['iat', 'jti', 'sub_id', 'events'],
    maxTokenAge: tokenAgeSeconds,
    clockTolerance: clockSkewSeconds,
    currentDate: new Date(now),
  });
  const subject = record(payload.sub_id);
  const events = record(payload.events);
  const revokedAt = record(events?.[sessionRevokedEvent])?.event_timestamp;
  if (protectedHeader.kid !== trust.key.kid || payload.aud !== trust.audience ||
      payload.sub !== undefined || payload.nonce !== undefined ||
      typeof payload.jti !== 'string' || !eventIdPattern.test(payload.jti) ||
      !Number.isSafeInteger(payload.iat) || !events || Object.keys(events).length !== 1 ||
      subject?.format !== 'iss_sub' || subject.iss !== trust.identityIssuer ||
      typeof subject.sub !== 'string' || subject.sub.length < 1 || subject.sub.length > 512 ||
      typeof revokedAt !== 'number' || !Number.isSafeInteger(revokedAt) ||
      revokedAt > payload.iat! || revokedAt * 1000 < now - sessionEventMaxDelay) {
    throw new Error('Invalid session revocation event');
  }
  return {
    eventId: payload.jti,
    identityIssuer: trust.identityIssuer,
    subject: subject.sub,
    revokedThrough: revokedAt * 1000,
  };
}

export async function receiveSessionRevocation(
  request: Request,
  trust: SessionEventTrust,
  apply: (event: SessionRevocation) => Promise<void>,
  now = Date.now(),
) {
  const headers = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' };
  const url = new URL(request.url);
  if (url.href !== trust.audience) return new Response(null, { status: 404, headers });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...headers, Allow: 'POST' } });
  if (request.headers.get('content-type') !== sessionEventContentType)
    return new Response(null, { status: 415, headers });

  let event: SessionRevocation;
  try {
    event = await verifiedRevocation(await boundedBody(request, 4096), trust, now);
  } catch {
    return Response.json({ err: 'invalid_request' }, { status: 400, headers });
  }
  try {
    // The receiver must commit an idempotent update before acknowledging it.
    await apply(event);
    return new Response(null, { status: 202, headers });
  } catch {
    return new Response(null, { status: 503, headers });
  }
}
