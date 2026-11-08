import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {SignJWT} from 'jose';
import {chromium,webkit} from 'playwright';
import {worldsResponse} from '../../src/auth/worlds';
import {sameOrigin,type AuthConfig,SESSION_COOKIE} from '../../src/auth/worlds-shared/oidc.ts';

let origin='';
const secret='synthetic-local-account-signing-secret-only';
const profile={id:'fixture-profile',name:'Test profile',passwordHash:'fixture-only',authVersion:'0'};
const legacy=await new SignJWT({name:profile.name,role:'player',av:'0'}).setSubject(profile.id).setProtectedHeader({alg:'HS256'}).setIssuer('slopurself').setAudience('game').setExpirationTime('5m').sign(new TextEncoder().encode(secret));
const server=createServer(async(incoming,outgoing)=>{
 try{
  const url=new URL(incoming.url!,origin);
  if(['/style.css','/assets/worlds-account.js'].includes(url.pathname)){
   outgoing.writeHead(200,{'content-type':url.pathname.endsWith('.css')?'text/css':'text/javascript'});outgoing.end(await readFile(join('public',url.pathname)));return;
  }
  const fixture=url.searchParams.get('fixture'),headers={...incoming.headers} as Record<string,string>;
  if(fixture)headers.cookie=SESSION_COOKIE+'='+'A'.repeat(43)+(fixture==='profile'?'; slop_auth='+legacy:'');
  const request=new Request(url,{method:incoming.method,headers});
  if(url.pathname==='/auth/start'){
   const ok=incoming.method==='GET'&&incoming.headers['sec-fetch-mode']==='navigate'&&incoming.headers['sec-fetch-dest']==='document';
   outgoing.writeHead(ok?200:403,{'content-type':'application/json'});outgoing.end(JSON.stringify({mode:incoming.headers['sec-fetch-mode'],destination:incoming.headers['sec-fetch-dest']}));return;
  }
  if(incoming.method==='POST'){
   outgoing.writeHead(sameOrigin(request,origin)?200:403,{'content-type':'application/json'});outgoing.end(JSON.stringify({origin:incoming.headers.origin,site:incoming.headers['sec-fetch-site']}));return;
  }
  const config={origin,issuer:'https://identity.test/auth',clientId:'fixture',algorithm:'EdDSA',reauthEnabled:true,
   store:{getSession:async()=>fixture?{issuer:'https://identity.test/auth',sub:'synthetic',csrf:'B'.repeat(43),expires:Date.now()+60000,authenticatedAt:Date.now()}:null}} as AuthConfig;
  const response=await worldsResponse(request,config,{AUTH_COOKIE_SECRET:secret},{find:async()=>profile} as never,async()=>[]);
  outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(await response.text());
 }catch{outgoing.writeHead(500);outgoing.end();}
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const engine=process.env.TEST_BROWSER_ENGINE==='webkit'?webkit:chromium;
let browser;
try{
 browser=await engine.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH||undefined});
 const page=await browser.newPage({viewport:{width:320,height:800},locale:'de-DE'}),errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.name));
 await page.goto(origin+'/auth/worlds');
 assert.equal(await page.locator('body').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(18, 20, 26)');
 assert.equal(await page.locator('main').evaluate(node=>getComputedStyle(node).borderRadius),'18px');
 const started=page.waitForResponse(response=>new URL(response.url()).pathname==='/auth/start');
 await page.getByRole('link',{name:'Mit Worlds anmelden',exact:true}).click();const initial=await started;
 assert.equal(initial.status(),200);assert.deepEqual(await initial.json(),{mode:'navigate',destination:'document'});
 for(const forged of ['null','https://untrusted.test'])assert.equal((await fetch(origin+'/auth/login',{method:'POST',headers:{origin:forged}})).status,403);
 await page.goto(origin+'/auth/worlds?fixture=central');
 assert.equal(await page.locator('input[name=password]').count(),0);await page.getByText('Deine Worlds-Anmeldung ist aktiv.',{exact:false}).waitFor();
 await page.goto(origin+'/auth/worlds?fixture=profile');
 const password=page.locator('input[name=password]'),value='synthetic form preservation';await password.fill(value);
 const csrf=await page.locator('[name=csrf]').first().getAttribute('value');
 await page.getByRole('button',{name:'English',exact:true}).click();assert.equal(await page.locator('html').getAttribute('lang'),'en');
 assert.equal(await page.getByLabel('Password of your active Slop Urself profile').inputValue(),value);assert.equal(await page.locator('[name=csrf]').first().getAttribute('value'),csrf);
 assert.ok((await page.locator('form[action*="/auth/worlds/link"]').getAttribute('action'))?.includes('ui_locales=en'));
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.equal(await page.getByRole('button',{name:'English',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(await page.getByRole('button',{name:'English',exact:true}).evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(241, 242, 246)');
 const posted=page.waitForResponse(response=>response.request().method()==='POST');
 await page.getByRole('button',{name:'Link this profile to Worlds',exact:true}).click();const postResult=await posted;
 assert.equal(postResult.status(),200);assert.deepEqual(await postResult.json(),{origin,site:'same-origin'});
 await page.goto(origin+'/auth/worlds?fixture=central');

 if(process.env.TEST_ARTIFACT_DIR){await page.goto(origin+'/auth/worlds?fixture=central');await page.screenshot({path:join(process.env.TEST_ARTIFACT_DIR,'slop-worlds-account-'+engine.name()+'.png'),fullPage:true});}
 await page.getByRole('button',{name:'Deutsch',exact:true}).click();assert.equal(await page.locator('html').getAttribute('lang'),'de');
 await page.reload();await page.getByRole('button',{name:'English',exact:true}).click();await page.reload();assert.equal(await page.locator('html').getAttribute('lang'),'en');
 await page.setViewportSize({width:1440,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
 console.log('PASS styled Worlds account DE/EN mobile/desktop, profile prerequisites, locale/form state, persistence and native same-origin form; foreign origins denied');
}finally{await browser?.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
