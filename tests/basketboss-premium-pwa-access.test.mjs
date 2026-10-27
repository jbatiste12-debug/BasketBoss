import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const code=await fs.readFile(new URL('../service-worker.js',import.meta.url),'utf8');

function harness(){
  const listeners={};
  const requests=[];
  const scope='https://guarded-preview.example/';
  const self={registration:{scope},location:{origin:scope.slice(0,-1)},
    skipWaiting:async()=>{},clients:{claim:async()=>{}},
    addEventListener:(type,fn)=>{listeners[type]=fn}};
  const caches={
    open:async()=>({addAll:async urls=>{
      requests.push(...urls);
      // Emulate Cloudflare Access redirect if an installation tries to pre-cache the manifest.
      if(urls.some(x=>new URL(x).pathname.endsWith('manifest.webmanifest')))
        throw new Error('Access login redirect blocked manifest pre-cache');
    }}),
    match:async()=>null,
    keys:async()=>[],
    delete:async()=>true,
  };
  vm.runInNewContext(code,{self,caches,URL,Request,Response,fetch:async()=>Response.error()},{filename:'service-worker.js'});
  return {listeners,requests,scope};
}

test('install succeeds without requesting Access-protected manifest',async()=>{
  const {listeners,requests}=harness();
  let work;
  listeners.install({waitUntil:p=>{work=p}});
  await work;
  assert.ok(requests.some(x=>x.endsWith('/index.html')),'offline shell still includes home page');
  assert.ok(requests.every(x=>!x.includes('manifest.webmanifest')),'manifest must be excluded');
  assert.ok(requests.every(x=>!x.endsWith('/recipes.json')),'protected recipe catalogue never pre-cached');
});

test('manifest and API routes bypass service-worker caching',()=>{
  const {listeners,scope}=harness();
  for(const path of ['manifest.webmanifest','api/bb173/status','api/recipes/premium']){
    let responded=false;
    listeners.fetch({request:new Request(scope+path),respondWith:()=>{responded=true}});
    assert.equal(responded,false,`${path} should be network-only`);
  }
});

test('public 100-recipe bundle remains network-only, not cache-first',()=>{
  const {listeners,scope}=harness();
  let promise;
  listeners.fetch({request:new Request(scope+'recipes.json'),respondWith:p=>{promise=p}});
  assert.ok(promise,'recipes.json must be handled with no-store network fetch');
});
