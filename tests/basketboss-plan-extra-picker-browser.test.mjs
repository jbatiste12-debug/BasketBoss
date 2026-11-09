import test,{before,after,describe} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);let chromium,browser;
try{({chromium}=require(process.env.BB_PLAYWRIGHT_MODULE||'playwright'));}catch{}
const source=await readFile(new URL('../bb-plan-extras.js',import.meta.url),'utf8');
const css=await readFile(new URL('../bb-plan-extras.css',import.meta.url),'utf8');
const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
body{margin:0;padding:16px;font:16px sans-serif}button{font:inherit}#app{min-height:1000px}
</style><body data-bbnext-view="plan"><main id="app"><h1>My week</h1><button id="breakfast">Add breakfast</button><button id="dessert">Add dessert</button></main><script>
window.actor='alice';window.session='session-a';window.generation=1;window.premium=true;window.failSave=false;window.notices=[];window.selected=[];
window.state={planned:[{recipeId:'dinner',day:'Thursday',servings:4}],plannedBreakfasts:[],plannedDesserts:[]};
window.rows=[{id:'oats',name:'Apple overnight oats',category:'Breakfast & Brunch',mins:10},
 {id:'premium-eggs',name:'Scrambled eggs and smoked salmon',category:'Breakfast & Brunch',mins:15,premium:true},
 {id:'brownies',name:'Chocolate brownies',category:'Desserts',mins:35,dessert:true},
 {id:'premium-crumble',name:'Apple and blackberry crumble',category:'Desserts',mins:50,dessert:true,premium:true},
 {id:'focaccia',name:'Rosemary focaccia',category:'Baking',mins:90,dessert:true},
 {id:'dinner',name:'Chicken pasta bake',category:'Family Meals',mins:40}];
window.BBDuration={format:mins=>mins+' mins'};
window.openPicker=kind=>{
 const field=kind==='breakfast'?'plannedBreakfasts':'plannedDesserts';
 const context=()=>JSON.stringify([actor,session,generation,state[field]]);
 const recipes=()=>rows.filter(recipe=>premium||!recipe.premium);
 const select=(id,day)=>{selected.push({id,day});if(failSave)return false;state[field].push({recipeId:id,day,servings:4});return true;};
 const options={win:window,day:'Thursday',recipes,context,select,notify:message=>notices.push(message)};
 return kind==='breakfast'?BBPlanExtras.openBreakfastPicker(options):BBPlanExtras.openDessertPicker({...options,eligible:recipe=>recipe.dessert===true});
};
document.getElementById('breakfast').onclick=()=>openPicker('breakfast');document.getElementById('dessert').onclick=()=>openPicker('dessert');
</script>`;

const check=(name,run)=>test(name,{skip:!chromium?'Playwright unavailable; set BB_PLAYWRIGHT_MODULE to run planner picker browser regressions':false},run);
async function fixture(run,{width=390,height=844}={}){
 const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.route('http://planner-picker.test/**',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.goto('http://planner-picker.test/app');await page.addScriptTag({content:source});
  await run(page);assert.deepEqual(errors,[]);
 }finally{await context.close();}
}
async function open(page,kind='dessert'){
 await page.locator('#'+kind).click();await page.getByRole('dialog').waitFor();
}
const choice=(page,id)=>page.locator('[data-bb-dessert-choose="'+id+'"]');
async function unchanged(page){
 assert.deepEqual(await page.evaluate(()=>state),{planned:[{recipeId:'dinner',day:'Thursday',servings:4}],plannedBreakfasts:[],plannedDesserts:[]});
}

describe('optional meal picker browser interactions',()=>{
 before(async()=>{if(chromium)browser=await chromium.launch({headless:true,...(process.env.BB_CHROMIUM_PATH?{executablePath:process.env.BB_CHROMIUM_PATH}:{}),args:['--no-sandbox']});});
 after(async()=>{await browser?.close();});

 for(const kind of ['breakfast','dessert'])check(kind+' opens a labelled day picker without focusing search or leaving Plan',()=>fixture(async page=>{
  await open(page,kind);
  assert.equal(await page.getByRole('heading',{name:'Choose '+kind,exact:true}).count(),1);
  assert.match(await page.getByRole('dialog').innerText(),/Thursday/);
  assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('bb-plan-picker-close')),true);
  assert.equal(await page.evaluate(()=>document.body.dataset.bbnextView),'plan');
  assert.equal(await page.locator('.bb-plan-picker-search').evaluate(node=>getComputedStyle(node).fontSize),'16px');
  await unchanged(page);
 }));

 check('dessert choices use the host predicate including legacy bakes and excluding dinners or breakfasts',()=>fixture(async page=>{
  await open(page);
  assert.deepEqual(await page.locator('[data-bb-dessert-choose]').evaluateAll(nodes=>nodes.map(node=>node.dataset.bbDessertChoose)),['brownies','premium-crumble','focaccia']);
  assert.match(await page.getByRole('status').innerText(),/3/);
  await page.locator('.bb-plan-picker-search').fill('blackberry');
  assert.deepEqual(await page.locator('[data-bb-dessert-choose]').evaluateAll(nodes=>nodes.map(node=>node.dataset.bbDessertChoose)),['premium-crumble']);
  assert.match(await page.getByRole('status').innerText(),/1/);
  await page.locator('.bb-plan-picker-search').fill('no such pudding');
  assert.equal(await page.locator('[data-bb-dessert-choose]').count(),0);
  assert.match(await page.getByRole('status').innerText(),/No matching/i);
 }));

 for(const kind of ['breakfast','dessert'])check(kind+' respects Free access and refreshes availability before selection',()=>fixture(async page=>{
  await page.evaluate(()=>premium=false);await open(page,kind);
  const attribute=kind==='breakfast'?'data-bb-breakfast-choose':'data-bb-dessert-choose';
  assert.equal(await page.locator('['+attribute+'^="premium-"]').count(),0);
  await page.getByRole('button',{name:'Close '+kind+' recipes',exact:true}).click();
  await page.evaluate(()=>premium=true);await open(page,kind);
  const id=kind==='breakfast'?'premium-eggs':'premium-crumble';
  assert.equal(await page.locator('['+attribute+'="'+id+'"]').count(),1);
  await page.evaluate(()=>premium=false);await page.locator('['+attribute+'="'+id+'"]').click();
  assert.deepEqual(await page.evaluate(()=>selected),[]);
  assert.equal(await page.locator('['+attribute+'="'+id+'"]').count(),0);
  assert.equal(await page.getByRole('dialog').count(),1);
  await unchanged(page);
 }));

 check('choosing a dessert passes the exact target day and leaves the dinner and breakfast slots unchanged',()=>fixture(async page=>{
  await open(page);await choice(page,'brownies').click();
  await page.getByRole('dialog').waitFor({state:'detached'});
  assert.deepEqual(await page.evaluate(()=>selected),[{id:'brownies',day:'Thursday'}]);
  assert.deepEqual(await page.evaluate(()=>state),{planned:[{recipeId:'dinner',day:'Thursday',servings:4}],plannedBreakfasts:[],plannedDesserts:[{recipeId:'brownies',day:'Thursday',servings:4}]});
  assert.equal(await page.evaluate(()=>document.body.dataset.bbnextView),'plan');
 }));

 for(const exit of ['Close','Escape'])check(exit+' dismisses the picker without selecting or changing any meals',()=>fixture(async page=>{
  await open(page);
  if(exit==='Escape')await page.keyboard.press('Escape');else await page.getByRole('button',{name:'Close dessert recipes',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'detached'});assert.deepEqual(await page.evaluate(()=>selected),[]);await unchanged(page);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'dessert');
 }));

 check('a refused host save keeps the picker open and the meal plan unchanged',()=>fixture(async page=>{
  await page.evaluate(()=>failSave=true);await open(page);await choice(page,'brownies').click();
  assert.equal(await page.getByRole('dialog').count(),1);await unchanged(page);
  await page.evaluate(()=>failSave=false);await choice(page,'brownies').click();
  await page.getByRole('dialog').waitFor({state:'detached'});
  assert.deepEqual(await page.evaluate(()=>state.plannedDesserts),[{recipeId:'brownies',day:'Thursday',servings:4}]);
 }));

 for(const change of ['actor','session','generation','slots'])check('changed '+change+' rejects the stale choice without calling the host',()=>fixture(async page=>{
  await open(page);
  await page.evaluate(change=>{if(change==='actor')actor='bob';if(change==='session')session='session-b';if(change==='generation')generation++;if(change==='slots')state.plannedDesserts.push({recipeId:'focaccia',day:'Thursday',servings:4});},change);
  await choice(page,'brownies').click();await page.getByRole('dialog').waitFor({state:'detached'});
  assert.deepEqual(await page.evaluate(()=>selected),[]);assert.match(await page.evaluate(()=>notices.at(-1)),/changed/i);
  assert.equal(await page.evaluate(()=>state.plannedDesserts.some(slot=>slot.recipeId==='brownies')),false);
 }));

 check('session-change event immediately closes stale recipe choices without planning food',()=>fixture(async page=>{
  await open(page);await page.evaluate(()=>{actor='bob';dispatchEvent(new Event('basketboss:session-changed'));});
  await page.getByRole('dialog').waitFor({state:'detached'});assert.deepEqual(await page.evaluate(()=>selected),[]);await unchanged(page);
 }));

 check('opening another optional meal replaces the prior picker without selecting food',()=>fixture(async page=>{
  await open(page);await page.evaluate(()=>openPicker('breakfast'));
  assert.equal(await page.getByRole('dialog').count(),1);
  assert.equal(await page.getByRole('heading',{name:'Choose breakfast',exact:true}).count(),1);
  assert.deepEqual(await page.evaluate(()=>selected),[]);await unchanged(page);
 }));

 for(const viewport of [{width:360,height:780},{width:390,height:400}])check('search, count and scrolling choices stay separate at '+viewport.width+'×'+viewport.height,()=>fixture(async page=>{
  await page.evaluate(()=>{rows.push(...Array.from({length:40},(_,index)=>({id:'pudding-'+index,name:'Family pudding '+index,category:'Desserts',mins:20,dessert:true})));});
  await open(page);
  const boxes=await page.evaluate(()=>{
   const box=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
   const list=document.querySelector('.bb-plan-picker-list');
   return{dialog:box('dialog'),search:box('.bb-plan-picker-search'),count:box('.bb-plan-picker-empty'),list:box('.bb-plan-picker-list'),scroll:list.scrollHeight>list.clientHeight};
  });
  assert.ok(boxes.dialog.y>=0&&boxes.dialog.bottom<=viewport.height+1,JSON.stringify(boxes));
  assert.ok(boxes.dialog.x>=0&&boxes.dialog.right<=viewport.width+1,JSON.stringify(boxes));
  assert.ok(boxes.search.bottom<=boxes.count.y+1,JSON.stringify(boxes));
  assert.ok(boxes.count.bottom<=boxes.list.y+1,JSON.stringify(boxes));
  assert.ok(boxes.list.height>=50,JSON.stringify(boxes));assert.equal(boxes.scroll,true);
  await page.locator('.bb-plan-picker-search').fill('Family pudding 39');
  assert.equal(await page.locator('[data-bb-dessert-choose]').count(),1);
 },viewport));
});
