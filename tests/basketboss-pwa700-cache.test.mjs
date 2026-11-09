import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {inlineArray} from '../tools/catalogue700/build-client.mjs';

const root=new URL('../',import.meta.url),origin='https://basketboss.co.uk',scope=origin+'/';
const read=name=>fs.readFileSync(new URL(name,root),'utf8');
const worker=read('service-worker.js'),inventory=read('pwa700/precache.js');
const expectedContext={self:{}};vm.runInNewContext(inventory,expectedContext);
const expectedUrls=Array.from(expectedContext.self.BB700_PWA_PRECACHE),version=expectedContext.self.BB700_PWA_CACHE_VERSION;

function harness(imported=inventory){
 const handlers={},stored=new Map(),opened=[],deleted=[],writes=[],requests=[];let offline=false;
 const address=value=>new URL(typeof value==='string'?value:value.url,scope).href;
 const assets=pathname=>{
  const aliases={'/':'welcome.html','/welcome':'welcome.html','/app':'pwa700/app.html','/app/':'pwa700/app.html','/app.html':'pwa700/app.html','/index.html':'pwa700/app.html','/index':'pwa700/app.html'};
  const name=aliases[pathname]||pathname.replace(/^\//,'');
  let file=new URL(name,root);if(!fs.existsSync(file))file=new URL(name+'.html',root);
  return fs.existsSync(file)?fs.readFileSync(file):Buffer.from('Public compatibility fixture');
 };
 const fetch=async(value,options)=>{const url=address(value);requests.push({url,options});if(offline)throw Error('offline');return new Response(assets(new URL(url).pathname),{headers:{'Cache-Control':'public, max-age=0'}});};
 const cache={async addAll(urls){for(const url of urls)stored.set(address(url),await fetch(url));},async put(value,response){writes.push(address(value));stored.set(address(value),response.clone());}};
 const caches={open:async name=>{opened.push(name);return cache;},keys:async()=>['basketboss-premium-secure-shell-20261108-v77-planner1','basketboss-v20261102-audited-images-v2',...opened],delete:async name=>{deleted.push(name);return true;},match:async(value,options)=>{const key=address(value);let result=stored.get(key);if(!result&&options?.ignoreSearch){const wanted=new URL(key);wanted.search='';result=[...stored.entries()].find(([entry])=>{const other=new URL(entry);other.search='';return wanted.href===other.href;})?.[1];}return result?.clone();}};
 const self={registration:{scope},location:{origin},clients:{claim:async()=>{}},skipWaiting:async()=>{},addEventListener:(name,fn)=>{handlers[name]=fn;}};
 let context;
 context=vm.createContext({self,caches,fetch,URL,Request,Response,Headers,importScripts(url){assert.equal(new URL(url).pathname,'/pwa700/precache.js');vm.runInContext(imported,context);}});
 vm.runInContext(worker,context);
 const lifecycle=async name=>{let pending;handlers[name]({waitUntil(value){pending=value;}});await pending;};
 return {stored,opened,deleted,writes,requests,install:()=>lifecycle('install'),activate:()=>lifecycle('activate'),offline(){offline=true;},request(path,{navigate=false,authorization=false,method='GET'}={}){
  let response;const pending=[];
  const request={url:new URL(path,scope).href,method,mode:navigate?'navigate':'cors',headers:new Headers(authorization?{Authorization:'Bearer synthetic-only'}:{})};
  handlers.fetch({request,respondWith(value){response=value;},waitUntil(value){pending.push(value);}});
  return {response,async complete(){const result=await response;await Promise.all(pending);return result;}};
 }};
}

test('real web700 inventory precaches exact public asset versions and uses its byte-derived cache identity',async()=>{
 const h=harness();await h.install();
 assert.equal(h.opened[0],'basketboss-premium-secure-shell-20261109-v78-web700-'+version);
 for(const path of expectedUrls)assert.ok(h.stored.has(new URL(path,scope).href),path);
 assert.equal(expectedUrls.some(url=>new URL(url,scope).pathname.endsWith('.webmanifest')),false,'Access-protected manifest cannot block offline installation');
 const free=await h.stored.get(scope+'pwa700/recipes.json').clone().json();assert.equal(free.length,200);assert.ok(free.every(recipe=>recipe.premium!==true&&recipe.accessTier!=='premium'));
 const html=await h.stored.get(scope+'app').clone().text();assert.equal(inlineArray(html,'RECIPES').value.length,200);assert.match(html,/api\/recipes\/v700\/premium\?catalogue=700/);
 for(const key of h.stored.keys())assert.doesNotMatch(new URL(key).pathname,/\/(?:api|functions|bb-server-lib|sql|native|dist)\/|\.(?:private|sealed)\.json/);
});

test('700 PWA opens the correct app and generated modules offline after the legacy worker is replaced',async()=>{
 const h=harness();await h.install();await h.activate();h.offline();
 assert.ok(h.deleted.includes('basketboss-premium-secure-shell-20261108-v77-planner1'));
 assert.equal(h.deleted.some(name=>name.endsWith(version)),false);
 assert.equal(h.deleted.includes('basketboss-v20261102-audited-images-v2'),false);
 for(const path of ['/app','/app?from=homescreen','/app/','/app.html','/index.html']){
  const html=await (await h.request(path,{navigate:true}).complete()).text();assert.equal(inlineArray(html,'RECIPES').value.length,200,path);
 }
 for(const name of ['bb-premium-preview-config.js','bb-recipe-planning.js','bb-membership-compare.js','make-a-meal.js']){
  const url=expectedUrls.find(value=>value.startsWith('/pwa700/'+name+'?'));assert.ok(url,name);
  const response=await h.request(url).complete();assert.equal(response.status,200);assert.equal(await response.text(),read('pwa700/'+name));
 }
});

test('a changed public generation gets a distinct cache and rejects protected import entries',async()=>{
 const nextVersion=version[0]==='a'?'b'.repeat(64):'a'.repeat(64),h=harness(inventory.replace(version,nextVersion));await h.install();assert.ok(h.opened[0].endsWith(nextVersion));assert.notEqual(h.opened[0],'basketboss-premium-secure-shell-20261109-v78-web700-'+version);
 for(const url of ['/api/recipes/v700/premium?catalogue=700','https://elsewhere.example/public.js','/app?code=private','/archive.sealed.json','/bb-server-lib/internal.js','/manifest.webmanifest']){
  assert.throws(()=>harness('self.BB700_PWA_CACHE_VERSION='+JSON.stringify(version)+';self.BB700_PWA_PRECACHE='+JSON.stringify([url])+';'),/Invalid public PWA cache inventory/);
 }
});

test('the 700 worker still bypasses private API responses and credential-bearing requests',async()=>{
 const h=harness();await h.install();const writes=h.writes.length;
 for(const path of ['/api/recipes/v700/premium?catalogue=700','/api/subscription/status','/api/cook-assistant','/api/tts'])assert.equal(h.request(path).response,undefined,path);
 assert.equal(h.request('/app',{navigate:true,authorization:true}).response,undefined);
 assert.equal(h.request('/pwa700/recipes.json',{authorization:true}).response,undefined);
 await h.request('/app?code=synthetic',{navigate:true}).complete();assert.equal(h.requests.at(-1).options.cache,'no-store');assert.equal(h.requests.at(-1).options.referrerPolicy,'no-referrer');assert.equal(h.writes.length,writes);
});
