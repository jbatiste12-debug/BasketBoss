import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('..',import.meta.url)),require=createRequire(import.meta.url);
let chromium,browser;
for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
before(async()=>{if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});});
after(async()=>{await browser?.close();});
const options={skip:!chromium?'Chromium unavailable':false,timeout:30000};
const current=await fs.readFile(new URL('../bb-pantry-stock-levels-ui.js',import.meta.url),'utf8');
const baseline=execFileSync('git',['show','c05180b:bb-pantry-stock-levels-ui.js'],{cwd:root,encoding:'utf8'});
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function fixture(source,{tab='week',deleting=false,hiddenFirst=false,noTarget=false,cancel=null}={}){
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
 await context.route('https://fixture.test/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><main class="shell"><nav class="tabs"><button class="tab active" data-tab="${tab}">Current tab</button></nav><nav id="bbPrimaryNavigation"><button data-bb-nav-item="kitchen">At home</button></nav>${noTarget?'':'<section id="bb172Storefront"'+(hiddenFirst?' hidden':'')+'></section><section id="bbReleaseShopOverview"></section><main id="app"></main>'}</main>`}));
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto('https://fixture.test/');
 await page.evaluate(({deleting,cancel})=>{
  window.__stockProbe={geometry:0,computed:0,requirements:0,targets:[],deletion:0,opens:[],nav:0,actor:'guest',cancel};
  localStorage.setItem('fixture-inventory',JSON.stringify({'cupboard|rice':{name:'Rice',loc:'cupboard',selected:true,qty:null,unit:'g'}}));
  localStorage.setItem('basketboss_cloud_session_v1','initial-session');
  const originalRects=Element.prototype.getClientRects;
  Element.prototype.getClientRects=function(...args){if(new Error().stack.includes('stock-banner-source'))window.__stockProbe.geometry++;return originalRects.apply(this,args);};
  const originalComputed=window.getComputedStyle;
  window.getComputedStyle=function(...args){if(new Error().stack.includes('stock-banner-source'))window.__stockProbe.computed++;return originalComputed.apply(this,args);};
  window.BBAccountDeletion={isDeleting:()=>{window.__stockProbe.deletion++;return deleting;}};
  window.BBHomeHost={keys:()=>({inventory:'fixture-inventory'}),requirements:()=>{window.__stockProbe.requirements++;return [{name:'Rice',unit:'g',required:500}];}};
  window.BBHome={actor:()=>window.__stockProbe.actor,foodTarget:(row,options)=>{window.__stockProbe.targets.push({row,options});return {requiredQuantity:500,canonicalUnit:'g'};}};
  window.BBPantryStockLevels={describe:()=>null};
  window.BBPantryEditor={isCurrent:()=>true};
  window.BBPantryInline={open:key=>window.__stockProbe.opens.push(key)};
  document.querySelector('[data-bb-nav-item="kitchen"]').addEventListener('click',()=>{
   window.__stockProbe.nav++;document.querySelector('.tab.active').dataset.tab='shop';
   if(window.__stockProbe.cancel==='actor')window.__stockProbe.actor='another-actor';
   if(window.__stockProbe.cancel==='session')localStorage.setItem('basketboss_cloud_session_v1','replacement-session');
  });
 },{deleting,cancel});
 await page.addScriptTag({content:source+'\n//# sourceURL=stock-banner-source.js'});await frames(page);await frames(page);
 return {context,page,errors};
}
async function snapshot(h){return h.page.evaluate(()=>({probe:window.__stockProbe,banners:[...document.querySelectorAll('.bbpi-stock-shop-check')].map(node=>({parent:node.parentElement.id,text:node.textContent,button:node.querySelector('button').textContent})),storage:Object.fromEntries(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)]))}));}

test('inactive tab mutations no longer force Shop target layout and preserve read-only state',options,async()=>{
 for(const tab of ['week','discover','shop','overview']){
  const results=[];
  for(const source of [baseline,current]){
   const h=await fixture(source,{tab});try{
    const initial=await snapshot(h);
    for(let i=0;i<3;i++){
     await h.page.evaluate(i=>{const note=document.createElement('p');note.textContent='Current view '+i;document.querySelector('#app').append(note);},i);await frames(h.page);
    }
    const after=await snapshot(h);
    assert.equal(after.probe.requirements,0);assert.equal(after.probe.deletion,0,'original inactive-tab short circuit is intact');
    assert.deepEqual(after.storage,initial.storage);assert.deepEqual(after.banners,[]);assert.deepEqual(h.errors,[]);results.push(after.probe);
   }finally{await h.context.close();}
  }
  assert.ok(results[0].geometry>=4,'baseline flushes the inactive view on initial and later mutations');
  assert.equal(results[1].geometry,0,tab+' mutations must not measure an unused Shop target');
  assert.equal(results[1].computed,0);
 }
});

test('active Shop retains the exact banner, target priority, requirements and original editor navigation',options,async()=>{
 const results=[];
 for(const source of [baseline,current]){
  const h=await fixture(source,{tab:'shop-list',hiddenFirst:true});try{
   const before=await snapshot(h);assert.deepEqual(before.banners,[{parent:'bbReleaseShopOverview',text:'Rice · Check amountCheck stock',button:'Check stock'}]);
   assert.ok(before.probe.geometry>0);assert.ok(before.probe.deletion>0);assert.ok(before.probe.requirements>0);
   await h.page.getByRole('button',{name:'Check stock',exact:true}).click();await frames(h.page);await frames(h.page);
   const after=await snapshot(h);assert.equal(after.probe.nav,1);assert.deepEqual(after.probe.opens,['cupboard|rice']);assert.deepEqual(after.banners,[]);
   assert.deepEqual(after.storage,before.storage);assert.deepEqual(h.errors,[]);
   results.push({banners:before.banners,targets:before.probe.targets,opens:after.probe.opens,storage:after.storage});
  }finally{await h.context.close();}
 }
 assert.deepEqual(results[1],results[0]);
});

for(const cancel of ['actor','session'])test('pending editor navigation still rejects a changed '+cancel,options,async()=>{
 for(const source of [baseline,current]){
  const h=await fixture(source,{tab:'shop-list',cancel});try{
   await h.page.getByRole('button',{name:'Check stock',exact:true}).click();await frames(h.page);await frames(h.page);
   const state=await snapshot(h);assert.equal(state.probe.nav,1);assert.deepEqual(state.probe.opens,[]);assert.deepEqual(h.errors,[]);
  }finally{await h.context.close();}
 }
});

for(const config of [{deleting:true},{noTarget:true}])test('Shop preserves original '+(config.deleting?'account deletion lock':'missing target')+' short circuit',options,async()=>{
 const results=[];
 for(const source of [baseline,current]){
  const h=await fixture(source,{tab:'shop-list',...config});try{
   const state=await snapshot(h);assert.equal(state.probe.requirements,0);assert.deepEqual(state.banners,[]);assert.deepEqual(h.errors,[]);results.push(state);
  }finally{await h.context.close();}
 }
 assert.deepEqual(results[1],results[0]);
});
