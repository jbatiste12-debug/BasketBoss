import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const root=new URL('../',import.meta.url),worker=await fs.readFile(new URL('service-worker.js',root),'utf8');
const origin='https://basketboss.co.uk',scope=origin+'/';
function harness(){
 const handlers={},stored=new Map(),fetched=[],writes=[];let offline=false,privateResponse=false;
 const key=value=>new URL(typeof value==='string'?value:value.url,scope).href;
 const body=url=>new URL(url).pathname==='/app'||new URL(url).pathname==='/app.html'?'APP':new URL(url).pathname==='/'||new URL(url).pathname==='/index.html'||new URL(url).pathname==='/welcome'||new URL(url).pathname==='/welcome.html'?'WELCOME':'PUBLIC ASSET';
 const fetch=async(value,options)=>{
  const url=key(value);fetched.push({url,options});if(offline)throw Error('offline');
  return new Response(privateResponse?'DO NOT CACHE':body(url),{headers:{'Content-Type':/\/[^/.]+(?:\.html)?$/.test(new URL(url).pathname)?'text/html':'text/javascript',...(privateResponse?{'Cache-Control':'private, no-store'}:{})}});
 };
 const cache={
  async addAll(urls){for(const url of urls)stored.set(key(url),await fetch(url));},
  async put(value,response){writes.push(key(value));stored.set(key(value),response.clone());}
 };
 const caches={open:async()=>cache,keys:async()=>[],delete:async()=>true,match:async(value,options)=>{
  const address=key(value);let result=stored.get(address);
  if(!result&&options?.ignoreSearch){const url=new URL(address);url.search='';result=[...stored.entries()].find(([entry])=>{const other=new URL(entry);other.search='';return other.href===url.href;})?.[1];}
  return result?.clone();
 }};
 const self={registration:{scope},location:{origin},clients:{claim:async()=>{}},skipWaiting:async()=>{},addEventListener:(name,fn)=>{handlers[name]=fn;}};
 vm.runInNewContext(worker,{self,caches,fetch,URL,Request,Response},{filename:'service-worker.js'});
 return {stored,fetched,writes,offline(){offline=true;},private(){privateResponse=true;},async install(){let pending;handlers.install({waitUntil:value=>{pending=value;}});await pending;},request(path,{navigate=false,authorization=false,method='GET'}={}){
  const pending=[];let response;
  const request={url:new URL(path,scope).href,method,mode:navigate?'navigate':'cors',headers:new Headers(authorization?{Authorization:'Bearer synthetic-test-only'}:{})};
  handlers.fetch({request,respondWith:value=>{response=value;},waitUntil:value=>pending.push(value)});
  return {response,complete:async()=>{const value=await response;await Promise.all(pending);return value;}};
 }};
}

test('PWA installation precaches current app modules and production pretty entries without protected data',async()=>{
 const h=harness();await h.install();const urls=[...h.stored.keys()];
 assert.ok(urls.includes(scope+'app'));assert.ok(urls.includes(scope+'welcome'));assert.ok(urls.includes(scope+'app.html'));
 for(const page of ['index.html','app.html']){
  const html=await fs.readFile(new URL(page,root),'utf8');
  const assets=[...html.matchAll(/(?:src|href)=["']([^"'<>]+\.(?:js|css|mjs)(?:\?[^"'<>]*)?)["']/g)].map(match=>match[1]);
  for(const asset of assets){if(/^(?:[a-z]+:|\/\/|\/)/i.test(asset))continue;assert.ok(urls.includes(new URL(asset,scope).href),page+': '+asset);}
 }
 for(const address of urls){
  const path=new URL(address).pathname;
  assert.doesNotMatch(path,/\/(?:api|native|dist|bb-server-lib|functions|sql|scripts|tests|docs|node_modules)\//);
  assert.notEqual(path,'/recipes.json');assert.notEqual(path,'/manifest.webmanifest');
 }
});

test('a fresh installed PWA opens /app offline while the public root opens the welcome page',async()=>{
 const h=harness();await h.install();h.offline();
 for(const path of ['app','app?from=homescreen','app/','app.html','index.html','index']){
  assert.equal(await (await h.request(path,{navigate:true}).complete()).text(),'APP',path);
 }
 for(const path of ['/','/?campaign=public','welcome','welcome.html']){
  assert.equal(await (await h.request(path,{navigate:true}).complete()).text(),'WELCOME',path);
 }
});

test('new pantry, shop, navigation and voice modules refresh online and keep their exact offline version',async()=>{
 const assets=['bb-pantry-policy.js?v=20261104-cupboard1','bb-pantry-display.js?v=20261104-regions2','bb-recipe-canonical.js?v=20261104-regions2','bb-pantry-runtime.mjs?v=20261104-regions2','bb-pantry-inline.js?v=20261104-inline2','bb-household-amount.js?v=20261104-groups1','bb-pantry-groups.js?v=20261104-groups1','bb-pantry-groups-ui.js?v=20261104-groups1','bb-day-done.js?v=20261104-regions2','bb-shop-add.js?v=20261104-cycle1','bb-cupboard-staples.js?v=20261104-cupboard2','bb-pantry-autofill.js?v=20261104-cycle1','bb-tab-viewport.js?v=20261104-tabs1','shopping-inventory.js?v=20261104-inline1','bb-cook-voice.js?v=20261104-mentor-stream1','bb-cook-assistant.js?v=20261104-mentor-stream1','bb-cook-tts.js?v=20261104-mentor-stream1','bb-family-landing.css?v=20261104-landing1','bb-family-landing.js?v=20261104-landing1'];
 const h=harness();await h.install();const before=h.fetched.length;
 for(const asset of assets)assert.equal(await (await h.request(asset).complete()).text(),'PUBLIC ASSET');
 assert.equal(h.fetched.length-before,assets.length);assert.ok(h.fetched.slice(before).every(value=>value.options?.cache==='no-store'));
 h.offline();for(const asset of assets)assert.equal(await (await h.request(asset).complete()).text(),'PUBLIC ASSET',asset);
});

test('API, authorization-bearing and server/build/private-file requests bypass Cache Storage',()=>{
 const h=harness();
 for(const path of ['api/cook-assistant','api/tts?clip=private','api/subscription/status','api/subscription/checkout','api/apple/testflight-beta','api/recipes/premium','bb-server-lib/vendor/apple-server-sdk.mjs','functions/api/tts.js','native/runtime.mjs','dist/native/index.html','sql/private.sql','scripts/check.mjs','tests/test.mjs','.env','archive.private.json','bb-server-lib%2Fvendor%2Fapple-server-sdk.mjs','%2Eenv']){
  assert.equal(h.request(path).response,undefined,path);
 }
 assert.equal(h.request('bb-home.js',{authorization:true}).response,undefined);
 assert.equal(h.request('app',{authorization:true,navigate:true}).response,undefined);
 assert.equal(h.request('api/cook-assistant',{method:'POST'}).response,undefined);
 assert.equal(h.stored.size,0);assert.equal(h.fetched.length,0);
});

test('private/no-store responses never overwrite public cached assets or navigation',async()=>{
 const h=harness();await h.install();h.private();
 for(const [path,navigate]of [['bb-cook-voice.js',false],['app',true],['public-test.json',false]]){
  assert.equal(await (await h.request(path,{navigate}).complete()).text(),'DO NOT CACHE');
 }
 assert.equal(h.writes.length,0);assert.equal(await h.stored.get(scope+'app').clone().text(),'APP');assert.equal(h.stored.has(scope+'public-test.json'),false);
});

test('PWA worker and app HTML entrypoints require HTTP revalidation',async()=>{
 const headers=await fs.readFile(new URL('_headers',root),'utf8');
 for(const route of ['/service-worker.js','/app','/app.html','/index.html','/welcome','/welcome.html']){
  const block=headers.split(/\n\s*\n/).find(value=>value.trimStart().startsWith(route+'\n'));
  assert.ok(block,route);assert.match(block,/Cache-Control: [^\n]*no-cache[^\n]*must-revalidate/,route);
 }
});


test('Auth callback query credentials are network-only and never enter Cache Storage',async()=>{
 const h=harness();await h.install();const writes=h.writes.length;
 for(const query of ['code=sample','token_hash=sample&type=recovery','access_token=sample&refresh_token=sample','error_code=otp_expired']){
  await h.request('app?'+query,{navigate:true}).complete();
  assert.equal(h.fetched.at(-1).options.cache,'no-store');assert.equal(h.fetched.at(-1).options.referrerPolicy,'no-referrer');
 }
 assert.equal(h.writes.length,writes);
});
