import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../bb-meal-image.js',import.meta.url),'utf8');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3vUAAAAASUVORK5CYII=';
const payload=()=>({ok:true,aiGenerated:true,illustrative:true,mealImage:{mimeType:'image/png',dataBase64:png,alt:'untrusted alt is ignored'}});
function harness({autoLoad=true,reply=payload()}={}){
 const events=new Map(),requests=[],created=[],revoked=[];let token='first-session';
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.listeners=new Map();this.hidden=false;this.isConnected=true;this.className='';this.textContent='';this.attributes={};this.ownerDocument=doc;this.naturalWidth=1024;this.naturalHeight=768;this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(/\s+/),...names])].filter(Boolean).join(' ');}};}
  append(...children){for(const child of children){this.children.push(child);child.parent=this;}}
  replaceChildren(...children){for(const old of this.children)old.parent=null;this.children=[];this.append(...children);}
  insertBefore(child,before){const at=this.children.indexOf(before);this.children.splice(at<0?this.children.length:at,0,child);child.parent=this;}
  setAttribute(name,value){this.attributes[name]=value;}
  addEventListener(name,fn){this.listeners.set(name,fn);}
  remove(){if(this.parent){this.parent.children=this.parent.children.filter(x=>x!==this);this.parent=null;}}
  querySelector(selector){for(const child of this.children){if(selector==='.'+child.className)return child;const found=child.querySelector(selector);if(found)return found;}return null;}
  set src(value){this._src=value;if(autoLoad)queueMicrotask(()=>this.listeners.get('load')?.());}
  get src(){return this._src;}
 }
 const doc={createElement:tag=>new Element(tag)};
 const root={document:doc,AbortController,Blob,atob,setTimeout,clearTimeout,setInterval,clearInterval,
  URL:{createObjectURL:blob=>{created.push(blob);return 'blob:meal-'+created.length;},revokeObjectURL:url=>revoked.push(url)},
  addEventListener:(name,fn)=>events.set(name,fn),fetch:async(url,options)=>{requests.push({url,options});return Response.json(reply);}};
 const sandbox={window:root,module:{exports:{}},Uint8Array,Promise,Set,WeakMap};vm.runInNewContext(source,sandbox);
 const host=new Element('div'),getToken=()=>token;
 return {root,host,requests,created,revoked,getToken,token:value=>{token=value;},emit:(name,event={})=>events.get(name)?.(event),api:root.BBMealImage,
  attach:options=>root.BBMealImage.attach(host,{ticket:'t'.repeat(120),recipe:{title:'Chicken pasta'},getToken,...options})};
}

test('meal picture loads asynchronously from a bearer-protected ticket and has an honest illustration caption',async()=>{
 const h=harness(),handle=h.attach();
 assert.match(h.host.children[0].children[1].textContent,/Creating a picture/);
 assert.equal((await handle.done).ok,true);
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/api/bb173/meal-image');
 assert.equal(h.requests[0].options.headers.Authorization,'Bearer first-session');
 assert.deepEqual(JSON.parse(h.requests[0].options.body),{ticket:'t'.repeat(120)});
 assert.equal(h.requests[0].options.cache,'no-store');
 const image=h.host.children[0].querySelector('.bbmi-photo');assert.equal(image.alt,'AI illustration of Chicken pasta');assert.match(image.src,/^blob:/);
 assert.match(h.host.children[0].children.at(-1).textContent,/AI illustration of this recipe/);
 assert.equal(h.created.length,1);handle.cancel();assert.deepEqual(h.revoked,['blob:meal-1']);
});

test('invalid, absent and failed images leave a compact failure or hidden host, never stock art',async()=>{
 for(const reply of [{...payload(),mealImage:{mimeType:'image/svg+xml',dataBase64:png}},{...payload(),mealImage:{mimeType:'image/png',dataBase64:'https://attacker.invalid/photo'}}]){
  const h=harness({reply}),handle=h.attach();assert.equal((await handle.done).ok,false);assert.equal(h.created.length,0);
  assert.ok(h.host.className.includes('bb-meal-image--unavailable'));assert.match(h.host.children[0].children.at(-1).textContent,/recipe is ready/);handle.cancel();
 }
 const h=harness(),handle=h.attach({ticket:null});assert.equal((await handle.done).ok,false);assert.equal(h.host.hidden,true);assert.equal(h.requests.length,0);
});

test('a different account cannot display an earlier response, even without a session event',async()=>{
 const h=harness();let resolve;
 const handle=h.attach({fetch:(url,options)=>{h.requests.push({url,options});return new Promise(done=>{resolve=done;});}});
 h.token('second-session');resolve(Response.json(payload()));
 assert.equal((await handle.done).reason,'stale');assert.equal(h.host.hidden,true);assert.equal(h.created.length,0);
});

test('account deletion and a newer recipe cancel an in-flight image before it can appear',async()=>{
 for(const event of ['basketboss:account-deletion-started','basketboss:account-deletion-deleted','basketboss:session-changed','pagehide']){
  const h=harness();let aborted=false;
  const handle=h.attach({fetch:(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(Error('cancelled'));}))});
  h.emit(event);assert.equal((await handle.done).reason,'stale');assert.equal(aborted,true);assert.equal(h.host.hidden,true);
 }
 const h=harness();let aborted=false;
 const old=h.attach({fetch:(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(Error('cancelled'));}))});
 const current=h.attach();assert.equal((await old.done).reason,'stale');assert.equal(aborted,true);assert.equal((await current.done).ok,true);current.cancel();
});

test('a loaded object URL is revoked immediately on account change and pending image decode is cancelled',async()=>{
 const h=harness({autoLoad:false}),handle=h.attach();
 await new Promise(resolve=>setImmediate(resolve));assert.equal(h.created.length,1);
 h.emit('basketboss:session-changed');assert.equal((await handle.done).reason,'stale');assert.deepEqual(h.revoked,['blob:meal-1']);assert.equal(h.host.hidden,true);
});

test('stale recipe revisions and deletion state prevent any image request',async()=>{
 const stale=harness(),a=stale.attach({isCurrent:()=>false});assert.equal((await a.done).ok,false);assert.equal(stale.requests.length,0);
 const deleting=harness();deleting.root.BBAccountDeletion={isDeleting:()=>true};const b=deleting.attach();assert.equal((await b.done).ok,false);assert.equal(deleting.requests.length,0);
});

test('a finished picture is cleared on focus if its session changed while the app was backgrounded',async()=>{
 const h=harness(),handle=h.attach();assert.equal((await handle.done).ok,true);h.token('new-session');h.emit('focus');
 assert.equal(h.host.hidden,true);assert.deepEqual(h.revoked,['blob:meal-1']);
});
