import test,{before,after,describe} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {routePwa700} from '../bb-server-lib/bb-pwa700-routing.js';

const require=createRequire(import.meta.url),root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
let chromium;
try{({chromium}=require(process.env.BB_PLAYWRIGHT_MODULE||'playwright'));}catch{}
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.jpg':'image/jpeg','.mp3':'audio/mpeg'};
const redirects=new Map(fs.readFileSync(path.join(root,'_redirects'),'utf8').split('\n').map(line=>line.trim().split(/\s+/)).filter(parts=>parts.length===3&&parts[2]==='200').map(([from,to])=>[from,to]));
function asset(request){
 const url=new URL(request.url),name=redirects.get(url.pathname)||(url.pathname==='/'?'/welcome.html':url.pathname);
 let file=path.resolve(root,'.'+decodeURIComponent(name));
 if(!file.startsWith(root+path.sep))return new Response('Not found',{status:404});
 if(!fs.existsSync(file)&&!path.extname(file))file+='.html';
 if(!fs.existsSync(file)||!fs.statSync(file).isFile())return new Response('Not found',{status:404});
 return new Response(request.method==='HEAD'?null:fs.readFileSync(file),{headers:{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache, max-age=0, must-revalidate'}});
}

describe('real browser generated700 offline shell',()=>{
 let browser,server,origin;
 before(async()=>{
  if(!chromium)return;
  server=http.createServer(async(req,res)=>{
   try{
    const request=new Request(origin+req.url,{method:req.method,headers:req.headers}),url=new URL(request.url);
    const response=url.pathname.startsWith('/api/')
     ?new Response(JSON.stringify({authenticated:false,tier:'free',premium:false,premiumAccess:false,ok:false,error:'Synthetic browser fixture'}),{status:url.pathname.startsWith('/api/recipes/')?403:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})
     :await routePwa700({request,env:{ASSETS:{fetch:asset}},next:async()=>asset(request)});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
   }catch{res.writeHead(500);res.end('Synthetic browser fixture failed');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(process.env.BB_CHROMIUM_PATH?{executablePath:process.env.BB_CHROMIUM_PATH}:{}),args:['--no-sandbox']});
 });
 after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});
 test('upgrades the legacy cache, keeps only public catalogue data and opens the app and companion offline',{skip:!chromium?'Playwright is unavailable; set BB_PLAYWRIGHT_MODULE to run browser regression':false,timeout:60000},async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}}),errors=[],missing=[];
  try{
   // No third-party service, personal account or AI provider is contacted.
   await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   context.on('response',response=>{if(response.status()===404&&new URL(response.url()).origin===origin)missing.push(new URL(response.url()).pathname);});
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   await page.goto(origin+'/privacy.html',{waitUntil:'domcontentloaded'});
   const installed=await page.evaluate(async()=>{
    const old='basketboss-premium-secure-shell-20261108-v77-planner1',images='basketboss-v20261102-audited-images-v2';
    await (await caches.open(old)).put('/stale-legacy-probe',new Response('old'));
    await (await caches.open(images)).put('/image-probe',new Response('keep'));
    await navigator.serviceWorker.register('/service-worker.js');
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
    const names=await caches.keys(),active=names.find(name=>name.startsWith('basketboss-premium-secure-shell-20261109-v78-web700-'));
    if(!active)throw Error('The generated700 worker did not activate');
    const cache=await caches.open(active),keys=await cache.keys(),free=await (await cache.match('/pwa700/recipes.json')).json();
    const html=await (await cache.match('/app')).text();
    for(const url of ['/api/recipes/v700/premium?catalogue=700','/api/subscription/status','/api/cook-assistant','/api/tts'])await fetch(url);
    await fetch('/app?code=synthetic-cache-probe');
    // A unique authorised static request must bypass Cache Storage too.
    await fetch('/pwa700/recipes.json?synthetic-authorised-probe=1',{headers:{Authorization:'Bearer synthetic-browser-fixture'}});
    const after=(await cache.keys()).map(request=>new URL(request.url).pathname+new URL(request.url).search);
    return {oldEvicted:!names.includes(old),imagesRetained:names.includes(images),freeCount:free.length,publicOnly:free.every(recipe=>recipe.premium!==true&&recipe.accessTier!=='premium'),has700Endpoint:html.includes('/api/recipes/v700/premium?catalogue=700'),protectedKeys:after.filter(url=>url.startsWith('/api/')||url.includes('synthetic-cache-probe')||url.includes('synthetic-authorised-probe')),inventory:keys.map(request=>new URL(request.url).pathname+new URL(request.url).search)};
   });
   assert.equal(installed.oldEvicted,true);assert.equal(installed.imagesRetained,true);assert.equal(installed.freeCount,200);assert.equal(installed.publicOnly,true);assert.equal(installed.has700Endpoint,true);assert.deepEqual(installed.protectedKeys,[]);
   assert.ok(installed.inventory.includes('/bb-receipt-inventory-core.mjs?v=20261105-business1'));
   assert.ok(installed.inventory.includes('/bb-pantry-policy.js'));
   await context.setOffline(true);
   const app=await page.goto(origin+'/app?from=offline-browser-regression',{waitUntil:'domcontentloaded'});assert.equal(app.status(),200);
   await page.waitForFunction(()=>!!window.BBPantrySelection&&!!document.getElementById('app'));
   assert.match(await page.locator('body').innerText(),/200 free recipes/i);
   const offline=await page.evaluate(async inventory=>{
    const checks=[];
    for(const name of ['bb-ui-continuity.js','shopping-inventory.js','bb-premium-preview-config.js']){
     const url=inventory.find(url=>url.startsWith('/pwa700/'+name+'?'));if(!url)throw Error('Missing generated asset '+name);
     const response=await fetch(url);checks.push({name,status:response.status,size:(await response.text()).length});
    }
    const free=await (await fetch('/pwa700/recipes.json')).json();
    const core=await import('/bb-receipt-inventory-core.mjs?v=20261105-business1');
    return {checks,freeCount:free.length,coreLoaded:!!core,controlled:!!navigator.serviceWorker.controller};
   },installed.inventory);
   assert.equal(offline.controlled,true);assert.equal(offline.freeCount,200);assert.equal(offline.coreLoaded,true);
   for(const check of offline.checks){assert.equal(check.status,200,check.name);assert.ok(check.size>0,check.name);}
   const companion=await page.goto(origin+'/make-a-meal.html?from=offline-browser-regression',{waitUntil:'domcontentloaded'});assert.equal(companion.status(),200);
   assert.match(await page.content(),/200 free recipes/i);
   assert.deepEqual(missing,[],'No static files may be missing during installation or offline use');assert.deepEqual(errors,[],'The offline app and companion must not throw JavaScript errors');
  }finally{await context.close();}
 });
});
