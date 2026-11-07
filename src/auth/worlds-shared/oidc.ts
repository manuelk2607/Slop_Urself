import * as oauth from 'oauth4webapi';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { hash, type AuthStore, type Session } from './store.ts';
export interface AuthConfig { origin:string; issuer:string; clientId:string; clientSecret?:string; reauthEnabled?:boolean; resource?:string; tokenAuthMethod?:'client_secret_basic'|'client_secret_post'; algorithm:string; store:AuthStore; returnPaths?:readonly string[]; signedOutPaths?:{de:string;en:string} }
export const SESSION_COOKIE='__Host-worlds-session';
const TX_COOKIE='__Host-worlds-transaction';
export const token = () => oauth.generateRandomState();
export const cookie = (name:string,value:string,age:number) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
export function readCookie(request:Request,name:string) {
  const found=(request.headers.get('cookie')??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
  return found.length===1 ? found[0].slice(name.length+1) : undefined;
}
export function safeNext(value:string|null,allowed:readonly string[]=['/','/konto']) { return value&&allowed.includes(value)?value:(allowed.includes('/konto')?'/konto':allowed[0]??'/'); }
export function sameOrigin(request:Request,origin:string) { return request.headers.get('origin')===origin && !['cross-site','none'].includes(request.headers.get('sec-fetch-site')??''); }
export async function session(request:Request,config:AuthConfig):Promise<Session|null> {
  const value=readCookie(request,SESSION_COOKIE);
  if (!value||!/^[A-Za-z0-9_-]{32,128}$/.test(value)) return null;
  const result=await config.store.getSession(await hash(value));
  return result&&result.expires>Date.now()&&result.issuer===config.issuer ? result:null;
}
async function metadata(config:AuthConfig) {
  const issuer=new URL(config.issuer);
  if (issuer.protocol!=='https:'||issuer.username||issuer.password||issuer.search||issuer.hash) throw new Error('Invalid issuer');
  const response=await oauth.discoveryRequest(issuer,{algorithm:'oidc'});
  return oauth.processDiscoveryResponse(issuer,response);
}
const client = (config:AuthConfig):oauth.Client => ({client_id:config.clientId,id_token_signed_response_alg:config.algorithm});
const redirect = (location:string,cookies:string[]=[]) => { const h=new Headers({location,'cache-control':'no-store'});cookies.forEach(c=>h.append('set-cookie',c));return new Response(null,{status:303,headers:h}); };
export async function startLogin(request:Request,config:AuthConfig) {
  if (request.method!=='POST') return new Response(null,{status:405});
  if (!sameOrigin(request,config.origin)) return new Response(null,{status:403});
  const reauth=new URL(request.url).searchParams.get('reauth')==='1';
  if(reauth&&!config.reauthEnabled)return new Response('Erneute Anmeldung ist für diesen Anbieter noch nicht freigegeben.',{status:503});
  const as=await metadata(config);
  if (!as.authorization_endpoint||!as.code_challenge_methods_supported?.includes('S256')) throw new Error('PKCE required');
  const authorization=new URL(as.authorization_endpoint);
  if (authorization.protocol!=='https:') throw new Error('HTTPS required');
  const verifier=oauth.generateRandomCodeVerifier(),state=token(),nonce=oauth.generateRandomNonce(),binding=token();
  const requestUrl=new URL(request.url);
  await config.store.putTransaction(await hash(binding),{verifier,state,nonce,next:safeNext(requestUrl.searchParams.get('next'),config.returnPaths),expires:Date.now()+600_000,reauth});
  authorization.search=new URLSearchParams({client_id:config.clientId,response_type:'code',redirect_uri:config.origin+'/auth/callback',scope:'openid profile email',code_challenge:await oauth.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',state,nonce}).toString();
  if(reauth)authorization.searchParams.set('max_age','300');
  if(config.resource)authorization.searchParams.set('resource',config.resource);
  const uiLocale=requestUrl.searchParams.get('ui_locales');if(uiLocale==='de'||uiLocale==='en')authorization.searchParams.set('ui_locales',uiLocale);
  // Registration, verification and password recovery are handled by the IdP's login UI.
  const headers=new Headers({'cache-control':'no-store','set-cookie':cookie(TX_COOKIE,binding,600)});
  if(request.headers.get('accept')?.includes('application/json'))return Response.json({url:authorization.href},{headers});
  return redirect(authorization.href,[cookie(TX_COOKIE,binding,600)]);
}
export async function callback(request:Request,config:AuthConfig) {
  if (request.method!=='GET') return new Response(null,{status:405});
  const binding=readCookie(request,TX_COOKIE);
  if (!binding) throw new Error('Missing transaction');
  const tx=await config.store.takeTransaction(await hash(binding));
  if (!tx||tx.expires<=Date.now()) throw new Error('Expired transaction');
  const as=await metadata(config),cl=client(config);
  const params=oauth.validateAuthResponse(as,cl,new URL(request.url),tx.state);
  const auth=config.clientSecret?(config.tokenAuthMethod==='client_secret_post'?oauth.ClientSecretPost(config.clientSecret):oauth.ClientSecretBasic(config.clientSecret)):oauth.None();
  const response=await oauth.authorizationCodeGrantRequest(as,cl,auth,params,config.origin+'/auth/callback',tx.verifier,{additionalParameters:config.resource?{resource:config.resource}:undefined});
  // process validates issuer, audience, azp, timestamps, nonce and token response structure.
  // Signature validation is explicit; it is NOT implicit in processing a TLS token response.
  const result=await oauth.processAuthorizationCodeResponse(as,cl,response,{expectedNonce:tx.nonce,requireIdToken:true,maxAge:tx.reauth?300:undefined});
  await oauth.validateApplicationLevelSignature(as,response);
  const claims=oauth.getValidatedIdTokenClaims(result);
  if(!claims?.sub)throw new Error('Missing subject');
  let user: {email?:unknown;email_verified?:unknown;name?:unknown}={email:claims.email,email_verified:claims.email_verified,name:claims.name};
  if(claims.email_verified===undefined||claims.email===undefined){
    const info=await oauth.userInfoRequest(as,cl,result.access_token);
    user=await oauth.processUserInfoResponse(as,cl,claims.sub,info);
  }
  if(user.email_verified!==true||typeof user.email!=='string')throw new Error('Verified email required');
  const expires=Math.min(claims.exp*1000,Date.now()+1800_000);
  if (expires<=Date.now()) throw new Error('Expired identity');
  const raw=token();
  const old=readCookie(request,SESSION_COOKIE);
  if(old) await config.store.deleteSession(await hash(old));
  await config.store.putSession(await hash(raw),{issuer:config.issuer,sub:claims.sub,email:typeof user.email==='string'?user.email:undefined,name:typeof user.name==='string'?user.name:undefined,sid:typeof claims.sid==='string'?claims.sid:undefined,csrf:token(),expires,authenticatedAt:typeof claims.auth_time==='number'?claims.auth_time*1000:undefined});
  // OAuth access/refresh/ID tokens never enter browser storage, cookies, URLs or the session database.
  return redirect(tx.next,[cookie(TX_COOKIE,'',0),cookie(SESSION_COOKIE,raw,Math.floor((expires-Date.now())/1000))]);
}
export async function boundedBody(request:Request,limit:number) {
  if(Number(request.headers.get('content-length')??0)>limit)throw new Error('Request too large');
  const reader=request.body?.getReader();if(!reader)return '';
  const chunks:Uint8Array[]=[];let total=0;
  for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw new Error('Request too large');}chunks.push(value);}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return new TextDecoder().decode(bytes);
}
export async function logout(request:Request,config:AuthConfig) {
  if(request.method!=='POST')return new Response(null,{status:405});
  if(!sameOrigin(request,config.origin))return new Response(null,{status:403});
  const preferred=new URL(request.url).searchParams.get('locale');const target=preferred==='en'?(config.signedOutPaths?.en??'/abgemeldet'):(config.signedOutPaths?.de??'/abgemeldet');
  const current=await session(request,config);
  if(!current)return redirect(target,[cookie(SESSION_COOKIE,'',0)]);
  if(Number(request.headers.get('content-length')??0)>4096)return new Response(null,{status:413});
  const body=await boundedBody(request,4096);
  if(new URLSearchParams(body).get('csrf')!==current.csrf)return new Response(null,{status:403});
  const raw=readCookie(request,SESSION_COOKIE)!;
  await config.store.deleteSession(await hash(raw));
  // Always complete local revocation, even if provider discovery is unavailable.
  return redirect(target,[cookie(SESSION_COOKIE,'',0)]);
}
export async function backchannelLogout(request:Request,config:AuthConfig) {
  if(request.method!=='POST')return new Response(null,{status:405});
  const body=await boundedBody(request,16384);
  const raw=new URLSearchParams(body).get('logout_token');if(!raw)throw new Error('Missing logout token');
  const as=await metadata(config);if(!as.jwks_uri)throw new Error('Missing JWKS');
  const {payload}=await jwtVerify(raw,createRemoteJWKSet(new URL(as.jwks_uri)),{issuer:config.issuer,audience:config.clientId,algorithms:[config.algorithm],maxTokenAge:'5m',requiredClaims:['iat','jti']});
  const events=payload.events as Record<string,unknown>|undefined;
  const event=events?.['http://schemas.openid.net/event/backchannel-logout'];
  if(typeof payload.jti!=='string'||!payload.jti||!event||typeof event!=='object'||Array.isArray(event)||payload.nonce!==undefined||(payload.sub!==undefined&&(typeof payload.sub!=='string'||!payload.sub))||(payload.sid!==undefined&&(typeof payload.sid!=='string'||!payload.sid))||(!payload.sub&&!payload.sid))throw new Error('Invalid logout token');
  if(!await config.store.claimReplay(await hash(config.issuer+':'+payload.jti),Date.now()+600_000))throw new Error('Replay');
  await config.store.revokeIdentity(config.issuer,payload.sub,typeof payload.sid==='string'?payload.sid:undefined);
  return new Response(null,{status:200,headers:{'cache-control':'no-store'}});
}
