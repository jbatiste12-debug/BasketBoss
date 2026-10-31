import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const start=index.indexOf("const BB_AF_DAYS=['Monday'");
const end=index.indexOf('/* END_BASKETBOSS_AUTOFILL_VARIETY_ROTATION_V1 */',start);
assert.ok(start>0&&end>start,'Auto-fill code is present in the page');
const code=index.slice(start,end);
const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
function harness(catalog,freeIds=new Set(catalog.map(r=>r.id))){
 const storage=new Map(),state={planned:[],bb81Batch:null};
 let canPersist=true,canStore=true,renders=0,notices=[];
 const localStorage={
  getItem:k=>storage.get(k)??null,
  setItem:(k,v)=>{if(!canStore)throw Error('storage failed');storage.set(k,v)},
  removeItem:k=>storage.delete(k)
 };
 const ctx={
  RECIPES:catalog,state,localStorage,console,
  bb176AllowedRecipe:id=>freeIds.has(id),
  bb172IsDessertOrNonDinner:r=>/dessert|breakfast|brunch|lunch|snack|baking/i.test((r.category||'')+' '+(r.tag||'')),
  bb81Under30:()=>true,bb81KidOK:()=>true,bb81BatchOK:()=>true,
  bb81ProteinScore:()=>3,bb83FridgeStockKeys:()=>new Set(),
  bb172QuickDinners:()=>({}),persist:()=>canPersist,render:()=>{renders++},
  notify:msg=>notices.push(msg)
 };
 vm.createContext(ctx);vm.runInContext(code,ctx);
 const api=vm.runInContext('({draw:bbAfDraw,commit:bbAfCommit,dinner:bbAfDinner,tags:bbAfTags,read:bbAfRead,SEEN:BB_AF_SEEN,LAST:BB_AF_LAST})',ctx);
 return {api,state,storage,localStorage,setPersist:x=>canPersist=x,setStore:x=>canStore=x,notices,get renders(){return renders}};
}
function verifyWeek(h,week){
 assert.equal(week.length,7);
 for(let i=0;i<week.length;i++){
  const p=week[i],r= h.recipes.find(x=>x.id===p.recipeId);
  assert.ok(h.api.dinner(r), 'only eligible, non-date-night dinners');
  const info=h.api.tags(r);
  const classified=week.map(x=>h.api.tags(h.recipes.find(t=>t.id===x.recipeId)));
  for(const field of ['protein','primary','style']){
   if(info[field])assert.ok(classified.filter(x=>x[field]===info[field]).length<=2,field+' is capped at 2');
  }
  if(info.heavyDairy)assert.ok(classified.filter(x=>x.heavyDairy).length<=2,'cheese-heavy max 2');
  if(i){
   const prev=classified[i-1];
   assert.ok(!info.protein||info.protein!==prev.protein,'no consecutive protein');
   assert.ok(!info.heavyDairy||!prev.heavyDairy,'no consecutive heavy dairy');
  }
 }
}
const real=JSON.parse(fs.readFileSync(new URL('../recipes.json',import.meta.url),'utf8'));
test('the real Free catalogue rotates at least five complete varied seven-dinner weeks',()=>{
 const h=harness(real);h.recipes=real;
 const eligible=real.filter(h.api.dinner);
 assert.ok(eligible.length>=35,'enough genuine family dinners in current catalogue');
 const seen=new Set();
 for(let i=0;i<5;i++){
  const old=h.state.planned,result=h.api.draw(DAYS,old);
  assert.ok(result,'seven-dinner selection exists for re-roll '+(i+1));
  verifyWeek(h,result.additions);
  for(const item of result.additions){
   assert.ok(!seen.has(item.recipeId),'recipe never repeats before reset');
   seen.add(item.recipeId);
  }
  assert.equal(h.api.commit(old,JSON.stringify(old),'{}',null,result),true);
  assert.equal(h.state.planned.length,7);
  h.state.planned=[]; // Clear week must not clear rotation history.
 }
 assert.equal(seen.size,35);
 assert.equal(h.api.read(h.api.SEEN).length,35);
});
test('last batch cannot reappear immediately when the eligible history resets',()=>{
 const h=harness(real);h.recipes=real;
 const eligible=real.filter(h.api.dinner);
 const last=eligible.slice(0,7).map(r=>r.id);
 h.storage.set(h.api.SEEN,JSON.stringify(eligible.slice(0,-4).map(r=>r.id)));
 h.storage.set(h.api.LAST,JSON.stringify(last));
 const result=h.api.draw(DAYS,[]);
 assert.ok(result?.reset,'less than seven unseen recipes resets cycle');
 assert.equal(result.additions.length,7);
 assert.ok(result.additions.every(x=>!last.includes(x.recipeId)));
});
test('failed plan saves restore history and old dinners',()=>{
 const h=harness(real);h.recipes=real;
 const before=h.api.read(h.api.SEEN),old=h.state.planned;
 const chosen=h.api.draw(DAYS,old);
 assert.ok(chosen);
 h.setPersist(false);
 assert.equal(h.api.commit(old,JSON.stringify(old),'{}',null,chosen),false);
 assert.equal(h.state.planned.length,0);
 assert.deepEqual(h.api.read(h.api.SEEN),before);
 h.setPersist(true);
 h.setStore(false);
 assert.equal(h.api.commit(old,JSON.stringify(old),'{}',null,chosen),false);
 assert.equal(h.state.planned.length,0);
});
test('100 Free and 320 Premium eligible dinner IDs respect access and never pick locked recipes',()=>{
 const pool=Array.from({length:320},(_,i)=>({
  id:'catalog-'+i,name:['Chicken','Beef','Pork','Salmon','Turkey','Chickpea','Tofu','Lamb'][i%8]+' dinner '+i,
  category:'Family dinner',tag:['ONE-PAN','ONE-POT','TRAYBAKE','QUICK FIX','BUDGET','ROAST','STEW','SLOW COOKER'][Math.floor(i/8)%8],
  servings:4,ingredients:[[['Chicken breast','Beef mince','Pork mince','Salmon fillets','Turkey mince','Chickpeas','Tofu','Lamb shoulder'][i%8],'500 g'],['Mixed vegetables','300 g']]
 }));
 for(const n of [100,320]){
  const h=harness(pool,new Set(pool.slice(0,n).map(r=>r.id)));h.recipes=pool;
  const result=h.api.draw(DAYS,[]);
  assert.ok(result, n+' eligible recipes must permit a varied week');
  assert.equal(result.additions.length,7);
  verifyWeek(h,result.additions);
  assert.ok(result.additions.every(x=>Number(x.recipeId.split('-')[1])<n),'membership limits honoured');
 }
});
test('UI removes Saturday date night and Sunday free night without duplicating Auto-fill',()=>{
 assert.equal(index,app,'mirrored entrypoints stay identical');
 assert.match(index,/Seven different family dinners, Monday to Sunday/);
 assert.match(index,/Saturday <b>Family dinner<\/b>/);
 assert.match(index,/Sunday <b>Family dinner<\/b>/);
 assert.doesNotMatch(index,/Five family feasts \+ one date-night dinner/);
 assert.equal(index.match(/async function bb172AutoFillSixDinners\(\)/g)?.length,1);
 assert.equal(index.match(/async function bb81AutoFillPro\(\)/g)?.length,1);
 assert.match(index,/function bbAfCommit\(/);
});
