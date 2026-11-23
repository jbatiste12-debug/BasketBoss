import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';

const root=fileURLToPath(new URL('..',import.meta.url)),require=createRequire(import.meta.url);
const baseline=process.env.BB_POPOVER_HOTPATH_BASELINE==='1';
let chromium,browser,source;
for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
before(async()=>{
 source=baseline?execFileSync('git',['show',(process.env.BB_POPOVER_HOTPATH_BASELINE_REF||'96fccbd')+':bb-plan-premium-polish.js'],{cwd:root,encoding:'utf8'}):await fs.readFile(path.join(root,'bb-plan-premium-polish.js'),'utf8');
 if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
});
after(async()=>{await browser?.close();});
const options={skip:!chromium?'Chromium unavailable':false,timeout:30000};
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function fixture(run){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;min-height:2600px;font:16px system-ui}#app{padding:40px 16px}#bbpolAutofillCard{padding:12px;border:1px solid green;width:320px}summary,button,input{min-height:44px;margin:4px}summary{cursor:pointer}details{border:1px solid #ddd}</style><main id="app" data-bb-compact-plan="true"><section id="bbpolAutofillCard"><details id="bbSimpleBudget"><summary><span>Budget</span></summary><input aria-label="Budget" value="200"></details><details id="bbSimpleMealPreferences"><summary>Preferences</summary><p>Preferences body</p></details><details id="bbnextPlanAutofill"><summary>Auto-fill help</summary><p>Help body</p></details><section id="bbIngredientPicker"><button id="bbAvoidIngredientTab" aria-expanded="false">Ingredients</button></section><button id="plainTap">Feeding +</button><input id="plainInput" aria-label="Draft"></section></main><button id="outside">Outside</button>`);
 await page.evaluate(()=>{
  window.__popoverProbe={reads:0,owners:0,ingredientClicks:0};
  const card=document.getElementById('bbpolAutofillCard'),original=card.getBoundingClientRect;
  card.getBoundingClientRect=function(...args){if(new Error().stack.includes('sizePlanPopovers'))window.__popoverProbe.reads++;return original.apply(this,args);};
  document.getElementById('plainTap').addEventListener('click',()=>window.__popoverProbe.owners++);
  const ingredients=document.getElementById('bbAvoidIngredientTab');ingredients.addEventListener('click',()=>{window.__popoverProbe.ingredientClicks++;ingredients.setAttribute('aria-expanded',String(ingredients.getAttribute('aria-expanded')!=='true'));});
 });
 await page.addScriptTag({content:source});await frames(page);
 try{await run(page);assert.deepEqual(errors,[]);}finally{await context.close();}
}
const reset=page=>page.evaluate(()=>{window.__popoverProbe.reads=0;});
const count=page=>page.evaluate(()=>window.__popoverProbe.reads);
const expectedHeight=page=>page.evaluate(()=>{const card=document.getElementById('bbpolAutofillCard'),bottom=visualViewport?visualViewport.height+visualViewport.offsetTop:innerHeight;return Math.max(120,Math.min(480,Math.floor(bottom-card.getBoundingClientRect().bottom-116)))+'px';});
const actualHeight=page=>page.locator('#bbpolAutofillCard').evaluate(node=>node.style.getPropertyValue('--bbpc-popover-height'));

test('closed Plan popovers do not measure layout on ordinary button taps or text keys',options,()=>fixture(async page=>{
 await reset(page);
 const first=await page.evaluate(()=>{document.getElementById('plainTap').click();return {...window.__popoverProbe};});
 assert.equal(first.owners,1,'the existing button owner runs synchronously exactly once');
 await page.locator('#plainInput').focus();await reset(page);
 await page.keyboard.type('200');await frames(page);
 const typed=await count(page);
 assert.deepEqual({tap:first.reads,typing:typed},{tap:0,typing:0},'ordinary closed-state tap and text keys must not force card geometry');
}));

test('closed Plan popovers do not schedule card layout for scroll and resize',options,()=>fixture(async page=>{
 await reset(page);await page.setViewportSize({width:390,height:760});await frames(page);
 await page.evaluate(()=>scrollTo(0,180));await frames(page);
 assert.equal(await count(page),0);
}));

test('closed Plan decoration mutations do not force geometry while active popovers still refit',options,()=>fixture(async page=>{
 await page.evaluate(()=>{
  const app=document.getElementById('app'),card=document.getElementById('bbpolAutofillCard');
  app.classList.add('bbnext-plan');
  for(const name of ['bbnext-plan-actions','bb81-pro-filters']){
   const node=document.createElement('div');node.className=name;card.append(node);
  }
 });
 await frames(page);await reset(page);
 await page.evaluate(async()=>{
  const actions=document.querySelector('.bbnext-plan-actions');
  for(let i=0;i<3;i++){
   const note=document.createElement('span');note.textContent='Current presentation '+i;actions.append(note);
   await new Promise(resolve=>queueMicrotask(resolve));
  }
 });
 await frames(page);
 assert.equal(await count(page),0,'closed observer passes must not synchronously flush card layout');
 await page.locator('#bbSimpleBudget>summary').click();await frames(page);
 assert.equal(await page.locator('#bbSimpleBudget').evaluate(node=>node.open),true);
 await reset(page);
 await page.evaluate(()=>document.querySelector('.bbnext-plan-actions').append(document.createElement('span')));
 await frames(page);
 assert.ok(await count(page)>0,'an actual open popover retains fitting after its content changes');
 assert.equal(await actualHeight(page),await expectedHeight(page));
}));

for(const id of ['bbSimpleBudget','bbSimpleMealPreferences','bbnextPlanAutofill'])test('original '+id+' summary opens with current sizing and keeps its native close behavior',options,()=>fixture(async page=>{
 await page.setViewportSize({width:390,height:760});await frames(page);await reset(page);
 const openingHeight=await expectedHeight(page);
 await page.locator('#'+id+'>summary').click();await frames(page);
 assert.equal(await page.locator('#'+id).evaluate(node=>node.open),true);
 assert.ok(await count(page)>=1,'an actual summary opening remains measured');
 // Native default action changes the details height after click propagation;
 // the original listener sizes before that same default action on both versions.
 assert.equal(await actualHeight(page),openingHeight,'first open uses current pre-default-action geometry');
 await reset(page);await page.setViewportSize({width:390,height:900});await frames(page);
 assert.ok(await count(page)>=1,'an open popover follows real viewport changes');
 assert.equal(await actualHeight(page),await expectedHeight(page));
 await reset(page);await page.evaluate(()=>scrollTo(0,180));await frames(page);
 assert.ok(await count(page)>=1,'an open popover follows real scrolling');
 assert.equal(await actualHeight(page),await expectedHeight(page));
 await reset(page);await page.evaluate(()=>visualViewport.dispatchEvent(new Event('resize')));await frames(page);
 assert.ok(await count(page)>=1,'an open popover retains visual-viewport resize sizing');
 await page.locator('#'+id+'>summary').click();await frames(page);
 assert.equal(await page.locator('#'+id).evaluate(node=>node.open),false,'second click retains native details toggling');
}));

test('Escape and outside taps retain all original disclosure, ingredient-owner and focus actions',options,()=>fixture(async page=>{
 await page.evaluate(()=>{for(const node of document.querySelectorAll('details'))node.open=true;});await frames(page);
 await page.locator('#bbSimpleBudget input').focus();
 await reset(page);await page.keyboard.press('Escape');await frames(page);
 assert.deepEqual(await page.locator('details').evaluateAll(nodes=>nodes.map(node=>node.open)),[false,false,false]);
 assert.equal(await page.evaluate(()=>document.activeElement.parentElement.id),'bbnextPlanAutofill','Escape focuses the existing last closed summary');
 await page.locator('#bbAvoidIngredientTab').click();await frames(page);
 assert.equal(await page.locator('#bbAvoidIngredientTab').getAttribute('aria-expanded'),'true');
 await page.keyboard.press('Escape');await frames(page);
 assert.equal(await page.locator('#bbAvoidIngredientTab').getAttribute('aria-expanded'),'false');
 assert.equal(await page.evaluate(()=>window.__popoverProbe.ingredientClicks),2,'close delegates once to the existing ingredient owner');
 assert.equal(await page.evaluate(()=>document.activeElement.id),'bbAvoidIngredientTab');
 await page.locator('#bbSimpleBudget>summary').click();await frames(page);
 await page.locator('#outside').click();await frames(page);
 assert.equal(await page.locator('#bbSimpleBudget').evaluate(node=>node.open),false);
 const directory=path.join(os.tmpdir(),'basketboss-ui-previews','plan-popover-hotpath');await fs.mkdir(directory,{recursive:true});
 await fs.writeFile(path.join(directory,baseline?'baseline.json':'current.json'),JSON.stringify(await page.evaluate(()=>window.__popoverProbe),null,2));
}));
