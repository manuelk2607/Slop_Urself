import {test} from 'node:test';
import assert from 'node:assert/strict';
import {messages,requestLocale} from '../../src/i18n/worlds';
import {escapeWorlds,worldsPage} from '../../src/auth/worlds-page';
test('Worlds account catalogs match and language selection respects explicit preference and weighted browser language',()=>{
 assert.deepEqual(Object.keys(messages.de).sort(),Object.keys(messages.en).sort());
 const locale=(query='',headers:HeadersInit={})=>requestLocale(new Request('https://pilot.test/auth/worlds'+query,{headers}));
 assert.equal(locale('?',{'accept-language':'fr;q=1,en-GB;q=0.8,de;q=0.2'}),'en');
 assert.equal(locale('',{'accept-language':'en;q=0,de;q=.5'}),'de');assert.equal(locale('',{'accept-language':'fr'}),'de');
 assert.equal(locale('',{cookie:'__Host-worlds-locale=en','accept-language':'de'}),'en');
 assert.equal(locale('?ui_locales=de',{cookie:'__Host-worlds-locale=en'}),'de');
});
test('account pages load existing styling and their own script with restrictive private headers; names are escaped',async()=>{
 const page=worldsPage('<p>'+escapeWorlds('<script>alert("x")</script>')+'</p>','en');const html=await page.text();
 assert.match(html,/<html lang="en"/);assert.match(html,/href="\/style.css"/);assert.match(html,/src="\/assets\/worlds-account.js"/);
 assert.doesNotMatch(html,/<script>alert/);assert.equal(page.headers.get('cache-control'),'no-store');assert.match(page.headers.get('x-robots-tag')!,/noindex/);
 assert.match(page.headers.get('content-security-policy')!,/form-action 'self' https:;/);
 assert.doesNotMatch(page.headers.get('content-security-policy')!,/unsafe-inline|unsafe-eval/);assert.equal(page.headers.get('referrer-policy'),'same-origin');
});
