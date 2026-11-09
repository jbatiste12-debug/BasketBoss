import test,{before,after,describe} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';

// Run with the project's Playwright installation, or set BB_PLAYWRIGHT_MODULE
// and BB_CHROMIUM_PATH when the browser runtime is supplied by the environment.
const require=createRequire(import.meta.url);
let chromium;
try{({chromium}=require(process.env.BB_PLAYWRIGHT_MODULE||'playwright'));}catch{}
let browser;
const source=await readFile(new URL('../bb-ui-continuity.js',import.meta.url),'utf8');
const control=(pos='summary',delta='1')=>'[data-bbfeed-day="Monday"][data-bbfeed-pos="'+pos+'"] button[data-bbfeed-delta="'+delta+'"]';
const html=`<!doctype html><style>body{margin:0}#before{height:800px}#after{height:1600px}.cook-overlay{position:fixed;inset:0;background:white}.cook-panel{height:350px;overflow:auto;margin:30px}#bbBody{min-height:1000px}button{min-height:32px}</style>
<div id="before"></div><main id="app" class="bbnext-plan"></main><input id="other" aria-label="Another choice"><div id="modalRoot"></div><div id="after"></div>
<script>
document.body.dataset.bbnextView='week';window.count=4;window.mode='replace';window.hideExpanded=false;window.ownFocus=true;window.focuses=[];
document.addEventListener('focusin',e=>focuses.push(e.target.id||e.target.closest('[data-bbfeed-pos]')?.dataset.bbfeedPos+':'+e.target.dataset.bbfeedDelta),true);
window.renderPlanner=()=>{
 const app=document.getElementById('app');
 app.innerHTML=['summary','expanded'].map(pos=>'<div data-bbfeed-day="Monday" data-bbfeed-pos="'+pos+'" '+(pos==='expanded'&&hideExpanded?'hidden':'')+'><button type="button" data-bbfeed-delta="-1" '+(count<=1?'disabled':'')+'>Less</button><span>'+count+'</span><button type="button" data-bbfeed-delta="1" '+(count>=12?'disabled':'')+'>More</button></div>').join('');
 for(const b of app.querySelectorAll('button')){
  b.addEventListener('keydown',e=>e.stopPropagation());
  b.onclick=()=>{
   const pos=b.parentElement.dataset.bbfeedPos,delta=b.dataset.bbfeedDelta;count+=Number(delta);
   if(mode==='keep'){b.blur();return;}
   if(mode==='move'){const group=b.parentElement,fragment=document.createDocumentFragment();fragment.append(group);app.append(group);return;}
   renderPlanner();
   const target=app.querySelector('[data-bbfeed-pos="'+pos+'"] [data-bbfeed-delta="'+delta+'"]');
   if(ownFocus)target.focus({preventScroll:true});
   if(mode==='duplicate')app.append(target.parentElement.cloneNode(true));
   if(mode==='hidden')target.parentElement.hidden=true;
   if(mode==='input')document.getElementById('other').focus({preventScroll:true});
   if(mode==='modal'){const dialog=document.createElement('dialog');dialog.innerHTML='<input id="modalInput">';document.body.append(dialog);dialog.showModal();}
   if(mode==='replace')setTimeout(renderPlanner,30);
  };
 }
};renderPlanner();
window.openCook=()=>{
 const root=document.getElementById('modalRoot');window.step=0;root.innerHTML='<div class="cook-overlay" role="dialog" aria-modal="true"><section class="cook-panel" data-phase="prep"><div id="bbBody"></div></section></div>';
 const panel=root.querySelector('.cook-panel'),body=root.querySelector('#bbBody');
 function paint(){body.innerHTML=step===0?'<button id="bbStart">Start</button>':step<4?'<button id="bbNext">Next</button>':'<button id="bbFinish">Close</button>';panel.dataset.phase=step===0?'prep':step<4?'cook':'done';const b=body.querySelector('button');b.onclick=()=>{step++;paint();requestAnimationFrame(()=>panel.scrollTop=120);};}
 paint();
};
</script>`;
async function fixture(run,{reducedMotion='reduce'}={}){
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{await page.setContent(html);await page.addScriptTag({content:source});await run(page);assert.deepEqual(errors,[]);}finally{await context.close();}
}
describe('generated700 keyboard continuity',()=>{
before(async()=>{if(chromium)browser=await chromium.launch({headless:true,...(process.env.BB_CHROMIUM_PATH?{executablePath:process.env.BB_CHROMIUM_PATH}:{}),args:['--no-sandbox']});});
after(async()=>{await browser?.close();});
const check=(name,run)=>test(name,{skip:!chromium?'Playwright is unavailable; set BB_PLAYWRIGHT_MODULE to run the browser regression suite':false},run);
const settle=page=>page.waitForTimeout(100);

for(const pos of ['summary','expanded'])for(const key of ['Enter','Space'])check('two '+key+' activations retain the exact '+pos+' day action through two repaints',()=>fixture(async page=>{
 await page.locator(control(pos)).focus();await page.keyboard.press(key);await settle(page);
 assert.equal(await page.locator(control(pos)).evaluate(node=>node===document.activeElement),true);
 await page.keyboard.press(key);await settle(page);
 assert.equal(await page.evaluate(()=>count),6);assert.equal(await page.locator(control(pos)).evaluate(node=>node===document.activeElement),true);
 assert.equal(await page.locator(control(pos==='summary'?'expanded':'summary')).evaluate(node=>node===document.activeElement),false);
}));

check('moving the same focused planner node out and back repairs its lost focus',()=>fixture(async page=>{
 await page.evaluate(()=>mode='move');await page.locator(control()).focus();await page.keyboard.press('Enter');await settle(page);
 assert.equal(await page.locator(control()).evaluate(node=>node===document.activeElement),true);
 await page.keyboard.press('Enter');await settle(page);assert.equal(await page.evaluate(()=>count),6);
}));

check('keyboard Cook Start and repeated Next retain focus without fighting the renderer scroll',()=>fixture(async page=>{
 await page.evaluate(()=>{scrollTo(0,700);openCook();});await page.locator('#bbStart').focus();
 await page.keyboard.press('Enter');await settle(page);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'bbNext');
 for(const expected of [2,3]){await page.keyboard.press('Enter');await settle(page);assert.equal(await page.evaluate(()=>step),expected);assert.equal(await page.evaluate(()=>document.activeElement.id),'bbNext');}
 assert.equal(await page.locator('.cook-panel').evaluate(node=>node.scrollTop),120);
 const before=await page.evaluate(()=>scrollY);await page.keyboard.press('Enter');await settle(page);
 assert.equal(await page.evaluate(()=>step),4);assert.notEqual(await page.evaluate(()=>document.activeElement.id),'bbFinish');assert.equal(await page.evaluate(()=>scrollY),before);
}));

check('pointer and programmatic activation do not acquire keyboard focus continuity',()=>fixture(async page=>{
 await page.evaluate(()=>{openCook();document.getElementById('bbStart').click();});await settle(page);
 assert.equal(await page.evaluate(()=>document.activeElement.tagName),'BODY');
 await page.evaluate(()=>openCook());await page.locator('#bbStart').click();await settle(page);
 assert.equal(await page.evaluate(()=>document.activeElement.tagName),'BODY');
}));

for(const mode of ['input','modal','duplicate','hidden','keep'])check(mode+' prevents restoration to an unsuitable or explicitly abandoned control',()=>fixture(async page=>{
 await page.evaluate(mode=>{window.mode=mode;ownFocus=false;},mode);await page.locator(control()).focus();await page.keyboard.press('Enter');await settle(page);
 const focused=await page.evaluate(()=>document.activeElement.id||document.activeElement.tagName);
 assert.equal(focused,mode==='input'?'other':mode==='modal'?'modalInput':'BODY');
}));

for(const intent of ['Tab','Escape','pointer','wheel'])check('later '+intent+' intent cancels a pending restoration',()=>fixture(async page=>{
 await page.evaluate(()=>{hideExpanded=true;renderPlanner();});await page.locator(control()).focus();await page.keyboard.press('Enter');
 if(intent==='pointer')await page.locator('#other').click();else if(intent==='wheel')await page.mouse.wheel(0,10);else await page.keyboard.press(intent);
 await settle(page);
 assert.notEqual(await page.evaluate(()=>document.activeElement.closest('[data-bbfeed-pos]')?.dataset.bbfeedPos),'summary');
 if(intent==='Tab'||intent==='pointer')assert.equal(await page.evaluate(()=>document.activeElement.id),'other');
}));

check('a new modal or replaced Cook overlay cannot inherit pending keyboard focus',()=>fixture(async page=>{
 await page.evaluate(()=>{openCook();document.getElementById('bbStart').addEventListener('click',()=>{const root=document.getElementById('modalRoot');root.innerHTML='';openCook();document.getElementById('bbStart').click();},{once:true});});
 await page.locator('#bbStart').focus();await page.keyboard.press('Enter');await settle(page);
 assert.equal(await page.evaluate(()=>document.activeElement.tagName),'BODY');
}));

for(const [count,delta] of [[11,'1'],[2,'-1']])check('serving limit '+(count+Number(delta))+' never falls back to a different action',()=>fixture(async page=>{
 await page.evaluate(n=>{window.count=n;renderPlanner();},count);await page.locator(control('summary',delta)).focus();await page.keyboard.press('Enter');await settle(page);
 assert.equal(await page.locator(control('summary',delta)).isDisabled(),true);assert.equal(await page.evaluate(()=>document.activeElement.tagName),'BODY');
}));

for(const reducedMotion of ['reduce','no-preference'])check('focus repair preserves document scroll with motion setting '+reducedMotion,()=>fixture(async page=>{
 await page.evaluate(()=>scrollTo(0,700));await page.locator(control()).evaluate(node=>node.focus({preventScroll:true}));const before=await page.evaluate(()=>scrollY);
 await page.keyboard.press('Enter');await settle(page);assert.equal(await page.evaluate(()=>scrollY),before);
},{reducedMotion}));

check('installation is idempotent and destroy cancels an already captured action',()=>fixture(async page=>{
 await page.addScriptTag({content:source});await page.evaluate(()=>{ownFocus=false;document.querySelector('[data-bbfeed-pos="summary"] button[data-bbfeed-delta="1"]').addEventListener('click',()=>BBUIContinuity.destroy());});
 await page.locator(control()).focus();await page.keyboard.press('Enter');await settle(page);
 assert.equal(await page.evaluate(()=>document.activeElement.tagName),'BODY');
}));

});
