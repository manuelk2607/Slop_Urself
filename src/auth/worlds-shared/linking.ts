/** Per-project linking only. All inputs are results of trusted server-side authentication,
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

/** Only an official Managed Auth server-side getSession result may produce this
 * proof. A public nickname, guest cookie, passwordless username JWT or browser
 * supplied session/account object is not proof of ownership. Never copy the
 * provider's session token, cookie, password or email into this structure. */
export interface ManagedSessionProof {
  kind:'managed-auth-session';issuer:string;accountId:string;sessionId:string;
  createdAt:number;expiresAt:number;validatedAt:number;privileged:boolean;
}
const MANAGED_VALIDATION_WINDOW=15_000;
const nonempty=(value:unknown,max=2048):value is string=>typeof value==='string'&&value.length>0&&value.length<=max;
const secureIssuer=(value:string)=>{
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash;}
  catch{return false;}
};
async function managedBinding(central:CentralProof,source:ManagedSessionProof,now:number){
  if(!Number.isFinite(now)||!secureIssuer(central.issuer)||!nonempty(central.subject,512)||!nonempty(central.sessionId)||!recent(central.authenticatedAt,now))throw new Error('CENTRAL_REAUTHENTICATION_REQUIRED');
  if(source.kind!=='managed-auth-session'||!secureIssuer(source.issuer)||!nonempty(source.accountId,512)||!nonempty(source.sessionId)||
    !Number.isFinite(source.createdAt)||!Number.isFinite(source.expiresAt)||!Number.isFinite(source.validatedAt)||
    source.createdAt>source.validatedAt||source.validatedAt>now||now-source.validatedAt>=MANAGED_VALIDATION_WINDOW||
    source.expiresAt<=now||source.expiresAt<=source.createdAt||typeof source.privileged!=='boolean')throw new Error('MANAGED_SESSION_PROOF_REQUIRED');
  // Persistent linking of a locally privileged account still requires a fresh
  // source authentication or a separately reviewed owner-verification route.
  if(source.privileged&&!recent(source.createdAt,now))throw new Error('LEGACY_REAUTHENTICATION_REQUIRED');
  const binding=await hash(JSON.stringify(['worlds-managed-session-link-v1',central.issuer,central.subject,
    central.sessionId,central.authenticatedAt,source.issuer,source.accountId,source.sessionId,source.createdAt,source.privileged]));
  const expires=Math.min(now+PROOF_LIFETIME,central.authenticatedAt+PROOF_LIFETIME,source.expiresAt,
    source.privileged?source.createdAt+PROOF_LIFETIME:Infinity);
  return {binding,expires};
}
/** Ordinary existing managed sessions can prove their owner without pretending
 * that an older login just happened. Both sources must be revalidated at confirm. */
export async function prepareManagedSessionLink(central:CentralProof,source:ManagedSessionProof,store:LinkStore,now=Date.now()){
  const {binding,expires}=await managedBinding(central,source,now),proof=token();
  await store.stage(await hash(proof),{issuer:central.issuer,subject:central.subject,localId:source.accountId,sessionId:binding,expires});
  return proof;
}
export async function confirmManagedSessionLink(proof:string,central:CentralProof,source:ManagedSessionProof,store:LinkStore,now=Date.now()){
  const {binding}=await managedBinding(central,source,now);
  return confirmLink(proof,binding,store,now);
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
