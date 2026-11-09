import test from 'node:test';
import assert from 'node:assert/strict';
import {routePwa700} from '../bb-server-lib/bb-pwa700-routing.js';
import {onRequest} from '../functions/_middleware.js';

const aliases=new Map([
 ['/app','app'],['/app/','app'],['/app.html','app'],['/index','app'],['/index.html','app'],
 ['/make-a-meal','make-a-meal'],['/make-a-meal.html','make-a-meal'],
 ['/tutorial','tutorial'],['/tutorial.html','tutorial'],
 ['/basketboss-latest-guide','basketboss-latest-guide'],['/basketboss-latest-guide.html','basketboss-latest-guide'],
 ['/pricing-sandbox','pricing-sandbox'],['/pricing-sandbox.html','pricing-sandbox'],
 ['/compare','compare'],['/compare.html','compare'],
 ['/subscriptions','subscriptions'],['/subscriptions.html','subscriptions']
]);

function fixture({path='/app',method='GET',query='',status=200}={}){
 const requests=[];let nextCalls=0;
 const request=new Request('https://basketboss.co.uk'+path+query,{method,headers:{Cookie:'session=private-cookie',Authorization:'Bearer private-token','X-Private-Marker':'private-marker'}});
 const fallback=new Response('original route',{status:202,headers:{'X-Original-Route':'yes'}});
 const env={ASSETS:{fetch:async assetRequest=>{
  requests.push(assetRequest);
  return new Response(method==='HEAD'?null:'isolated catalogue700 document',{status,headers:{'Content-Type':'text/html; charset=utf-8',ETag:'"original-etag"','X-Asset-Marker':'kept','Cache-Control':'public, max-age=604800'}});
 }}};
 return {request,env,requests,fallback,nextCalls:()=>nextCalls,run:()=>routePwa700({request,env,next:async()=>{nextCalls++;return fallback;}})};
}

test('all app and companion aliases resolve internally to isolated PWA700 pages without redirects',async()=>{
 for(const [path,document]of aliases){
  const f=fixture({path}),response=await f.run();
  assert.equal(response.status,200,path);
  assert.equal(response.headers.get('Location'),null,path);
  assert.equal(await response.text(),'isolated catalogue700 document',path);
  assert.equal(f.nextCalls(),0,path);assert.equal(f.requests.length,1,path);
  const destination=new URL(f.requests[0].url);
  assert.equal(destination.origin,'https://basketboss.co.uk',path);
  assert.equal(destination.pathname,'/pwa700/'+document,path);
  assert.equal(f.requests[0].method,'GET',path);
 }
});

test('auth callbacks retain their browser query without forwarding credentials into static asset cache keys',async()=>{
 const query='?code=opaque-auth-code&type=recovery&bbcook=salmon-en-croute-with-spinach&return_to=%2Fapp%3Ftab%3Dplan';
 for(const path of ['/app','/index.html','/make-a-meal.html']){
  const f=fixture({path,query}),response=await f.run();
  assert.equal(response.status,200);assert.equal(new URL(f.requests[0].url).search,'');
  assert.equal(new URL(f.request.url).search,query);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
  assert.equal(response.headers.get('Location'),null,'internal serving leaves the browser callback URL intact');
 }
});

test('entry pages revalidate and preserve asset response metadata without forwarding account credentials',async()=>{
 const f=fixture(),response=await f.run(),assetRequest=f.requests[0];
 assert.match(response.headers.get('Cache-Control'),/\bno-cache\b/);
 assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
 assert.equal(response.headers.get('X-Robots-Tag'),'noindex, nofollow');
 assert.equal(response.headers.get('Content-Type'),'text/html; charset=utf-8');
 assert.equal(response.headers.get('ETag'),'"original-etag"');
 assert.equal(response.headers.get('X-Asset-Marker'),'kept');
 for(const name of ['Authorization','Cookie','X-Private-Marker'])assert.equal(assetRequest.headers.get(name),null,name);
});

test('HEAD serves the same route and metadata with no response body',async()=>{
 const f=fixture({method:'HEAD',path:'/app.html',query:'?tab=plan'}),response=await f.run();
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].method,'HEAD');
 assert.equal(new URL(f.requests[0].url).pathname,'/pwa700/app');
 assert.equal(new URL(f.requests[0].url).search,'');
 assert.equal(new URL(f.request.url).search,'?tab=plan');
 assert.equal(response.status,200);assert.equal(await response.text(),'');
 assert.equal(response.headers.get('Content-Type'),'text/html; charset=utf-8');
 assert.match(response.headers.get('Cache-Control'),/\bno-cache\b/);
});

test('entry aliases reject writes and OPTIONS without fetching an asset or calling downstream routes',async()=>{
 for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS']){
  const f=fixture({method}),response=await f.run();
  assert.equal(response.status,405,method);
  assert.equal(response.headers.get('Allow'),'GET, HEAD',method);
  assert.equal(f.requests.length,0,method);assert.equal(f.nextCalls(),0,method);
 }
});

test('marketing, APIs, legacy data and nonexact paths pass through untouched',async()=>{
 for(const path of ['/','/welcome','/welcome.html','/api/recipes/premium','/api/recipes/v700/premium','/api/household','/recipes.json','/normalized-ingredient-database.json','/bb-premium-preview-config.js','/service-worker.js','/manifest.webmanifest','/pwa700/app','/app/nested','/app.html/extra','/application','/App','/index.js']){
  const f=fixture({path,query:'?keep=exact'}),response=await f.run();
  assert.equal(response,f.fallback,path);assert.equal(f.requests.length,0,path);assert.equal(f.nextCalls(),1,path);
 }
});

test('asset HTTP failures retain their status rather than granting a synthetic successful entry page',async()=>{
 for(const status of [404,503]){
  const f=fixture({status}),response=await f.run();
  assert.equal(response.status,status);assert.equal(f.nextCalls(),0);
  assert.match(response.headers.get('Cache-Control'),/\bno-cache\b/);
 }
});

test('the actual Pages middleware routes app entries and leaves the public marketing root downstream',async()=>{
 for(const path of ['/app','/']){
  const f=fixture({path});let nextCalls=0;
  const response=await onRequest({request:f.request,env:f.env,next:async()=>{nextCalls++;return f.fallback;}});
  assert.equal(nextCalls,path==='/'?1:0);
  assert.equal(f.requests.length,path==='/'?0:1);
  assert.equal(response.status,path==='/'?202:200);
 }
});
