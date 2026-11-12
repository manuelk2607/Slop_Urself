import { importJWK, SignJWT } from 'jose';
import { hash } from './store.ts';
import { sessionEventPublicKey } from './session-revocation.ts';

export const migrationReceiptType = 'worlds-migration-receipt+jwt';

export type MigrationReceipt = {
  subject: string;
  localAccountId: string;
  revision: number;
  state: 'confirmed' | 'revoked';
};

type ReceiptSenderSettings = {
  project: string;
  origin: string;
  identityIssuer: string;
  url: string;
  kid: string;
  privateJwk: string;
};

export async function migrationReceiptSender(settings: ReceiptSenderSettings) {
  const { project, origin, identityIssuer, url, kid } = settings;
  const target = new URL(url);
  const issuer = new URL(identityIssuer);
  if (!/^[a-z0-9-]{1,64}$/.test(project) ||
      target.protocol !== 'https:' || target.href !== target.origin + '/api/migrations/receipts/' + project ||
      !origin.startsWith('https://') || new URL(origin).origin !== origin ||
      issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash) {
    throw new Error('Invalid Worlds receipt configuration');
  }

  let signingKey: Awaited<ReturnType<typeof importJWK>>;
  try {
    const { kty, crv, x, d } = JSON.parse(settings.privateJwk);
    const publicKey = sessionEventPublicKey(JSON.stringify({ kid, kty, crv, x }));
    if (!publicKey || typeof d !== 'string' || !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(d)) throw new Error();
    signingKey = await importJWK({ ...publicKey, d }, 'EdDSA');
  } catch {
    throw new Error('Invalid Worlds receipt signing key');
  }

  return async (receipt: MigrationReceipt): Promise<'acknowledged' | 'conflict'> => {
    const { subject, localAccountId, revision, state } = receipt;
    if (!subject || subject.length > 512 || !localAccountId ||
        !Number.isSafeInteger(revision) || revision < 1 || (state !== 'confirmed' && state !== 'revoked')) {
      throw new Error('Invalid Worlds migration receipt');
    }
    const body = await new SignJWT({
      identity_issuer: identityIssuer,
      account_ref: await hash('worlds:' + project + ':' + localAccountId),
      revision,
      state,
    }).setProtectedHeader({ alg: 'EdDSA', typ: migrationReceiptType, kid })
      .setIssuer(origin).setSubject(subject).setAudience(target.href)
      .setIssuedAt().setExpirationTime('2m').sign(signingKey);

    let response: Response, result: { result?: unknown; error?: unknown } | null;
    try {
      response = await fetch(target.href, {
        method: 'POST', headers: { 'content-type': 'application/jwt' }, body,
        redirect: 'error', signal: AbortSignal.timeout(5000),
      });
      result = await response.json() as typeof result;
    } catch {
      throw new Error('Worlds receipt endpoint is unavailable');
    }
    if (response.ok && (result?.result === 'stored' || result?.result === 'duplicate' || result?.result === 'stale')) {
      return 'acknowledged';
    }
    if (response.status === 409 && result?.error === 'RECEIPT_CONFLICT') return 'conflict';
    throw new Error('Worlds receipt endpoint refused delivery');
  };
}
