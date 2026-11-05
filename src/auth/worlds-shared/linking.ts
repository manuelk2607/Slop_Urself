/** Per-project linking only. All inputs are results of trusted server-side reauthentication,
 * never identity values deserialized from an HTTP body. No email matching is supported. */
export interface CentralProof { issuer:string; subject:string; authenticatedAt:number; sessionId:string }
export interface LegacyProof { accountId:string; authenticatedAt:number; method:'password'|'managed-reauth'|'hf-owner-review' }
export interface LinkBinding { issuer:string; subject:string; localId:string; sessionId:string; expires:number }
export interface LinkStore {
  stage(proofHash:string,binding:LinkBinding):Promise<void>;
  /** Must atomically consume proof, enforce both uniqueness constraints, and write audit.
   * Return false for expired/conflicting/replayed proofs. Never overwrite an existing link. */
  consumeAndLink(proofHash:string,sessionId:string,now:number):Promise<boolean>;
  lookup(issuer:string,subject:string):Promise<string|null>;
}
import { token, session, readCookie, SESSION_COOKIE, type AuthConfig } from './oidc.ts';
import { hash } from './store.ts';
const PROOF_LIFETIME=300_000;
const recent=(at:number,now:number)=>Number.isFinite(at)&&at<=now&&now-at<PROOF_LIFETIME;
export async function prepareLink(central:CentralProof,legacy:LegacyProof,store:LinkStore,now=Date.now()) {
  if(!central.issuer.startsWith('https://')||!central.subject||!central.sessionId||!legacy.accountId||!recent(central.authenticatedAt,now)||!recent(legacy.authenticatedAt,now))throw new Error('Fresh proof of both accounts required');
  const expires=Math.min(central.authenticatedAt,legacy.authenticatedAt)+PROOF_LIFETIME;
  const proof=token();
  await store.stage(await hash(proof),{issuer:central.issuer,subject:central.subject,localId:legacy.accountId,sessionId:central.sessionId,expires});
  return proof;
}
export async function confirmLink(proof:string,validatedSessionId:string,store:LinkStore,now=Date.now()) {
  if(!/^[A-Za-z0-9_-]{32,128}$/.test(proof)||!validatedSessionId)throw new Error('Invalid proof');
  if(!await store.consumeAndLink(await hash(proof),validatedSessionId,now))throw new Error('Expired, replayed or conflicting link');
}
export async function projectAccount(issuer:string,subject:string,store:LinkStore) {
  const local=await store.lookup(issuer,subject);if(!local)throw new Error('PROJECT_ACCOUNT_NOT_LINKED');return local;
}
export interface GenerationPermission { localAccountId:string; personalHf:{accountId:string;expiresAt:number}|null; moderationAllowed:boolean }
/** Adapter precondition only; existing HF credential validation/quota/job gates must still run. */
export function canGenerate(p:GenerationPermission,now=Date.now()) { return p.moderationAllowed&&!!p.personalHf&&p.personalHf.accountId===p.localAccountId&&p.personalHf.expiresAt>now; }

/** Derive the central proof only from a validated, recently reauthenticated session. */
export async function centralProof(request:Request,config:AuthConfig,now=Date.now()):Promise<CentralProof> {
  const current=await session(request,config),raw=readCookie(request,SESSION_COOKIE);
  if(!current||!raw||current.authenticatedAt===undefined||!recent(current.authenticatedAt,now))throw new Error('CENTRAL_REAUTHENTICATION_REQUIRED');
  return {issuer:current.issuer,subject:current.sub,authenticatedAt:current.authenticatedAt,sessionId:await hash(raw)};
}
