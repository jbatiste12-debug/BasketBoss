import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const homeModule=createRequire(import.meta.url)('../bb-home.js');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function bbHomeSchoolLunchMeal('),end=html.indexOf('function bbHomeLunchForShopping(',start);
assert.ok(start>=0&&end>start);
const days=['Monday','Tuesday','Wednesday','Thursday','Friday'];
function fixture(){
 const lunch={children:2,days:{Monday:[{name:'Bread',qty:2,unit:'slice'},{name:'Cheddar',qty:20,unit:'g'}],Tuesday:[{name:'Bread',qty:2,unit:'slice'},{name:'Cheddar',qty:20,unit:'g'}],Sunday:[{name:'Bread',qty:100,unit:'slice'}]}};
 const occurrence=(recipe,day,kind)=>'2026-11-09|'+kind+'|'+day+'|'+recipe;
 const scope=vm.createContext({BB321Lunch:{LUNCH_DAYS:days},bb321LunchState:lunch,bbHomeOccurrence:occurrence});vm.runInContext(html.slice(start,end),scope);
 const values=new Map([['stock',JSON.stringify({'bread|slice':20,'cheddar|g':500,'rice|g':400})],['inventory','{}'],['lunch-plan',JSON.stringify(lunch)]]);
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const dinner={kind:'dinner',recipeId:'rice-dinner',name:'Rice dinner',day:'Monday',factor:1,occurrence:occurrence('rice-dinner','Monday','dinner'),ingredients:[{key:'Rice',unit:'g',required:100}]};
 const host={refresh(){},id:(name,unit)=>name.toLowerCase()+'|'+unit,keys:()=>({stock:'stock',inventory:'inventory'}),stock:()=>JSON.parse(storage.getItem('stock')),completionKeys:()=>['lunch-plan'],schoolLunchWeekMeals:()=>scope.bbHomeSchoolLunchWeekMeals(),dayMeals:day=>[...(day==='Monday'?[dinner]:[]),...scope.bbHomeSchoolLunchWeekMeals().filter(item=>item.day===day)]};
 const win={localStorage:storage,location:{search:''},document:{},BBHomeHost:host};const home=homeModule.install(win);
 return {scope,lunch,storage,values,home,stock:host.stock,event:{actorId:'guest'}};
}
test('actual school-lunch host helper scales children, includes weekdays only and shares Day occurrence identities',()=>{
 const h=fixture(),rows=JSON.parse(JSON.stringify(h.scope.bbHomeSchoolLunchWeekMeals()));
 assert.deepEqual(rows.map(row=>row.day),['Monday','Tuesday']);assert.equal(rows[0].ingredients[0].required,4);assert.equal(rows[0].ingredients[1].required,40);
 assert.equal(rows[0].occurrence,'2026-11-09|lunch|Monday|lunchbox:Monday');assert.ok(rows.every(row=>row.kind==='lunch'));
});
test('actual host plus weekly core deducts lunch totals once and the following Day done deducts dinner only',async()=>{
 const h=fixture(),preview=h.home.previewLunchWeek(h.event);assert.equal(preview.ok,true,preview.message);
 assert.equal(preview.rows.find(row=>row.name==='Bread').required,8);assert.equal(preview.rows.find(row=>row.name==='Cheddar').required,80);
 const results=await Promise.all([h.home.finishLunchWeek({...h.event,expected:preview.fingerprint}),h.home.finishLunchWeek({...h.event,expected:preview.fingerprint})]);
 assert.equal(results.filter(result=>result.already).length,1);assert.deepEqual(h.stock(),{'bread|slice':12,'cheddar|g':420,'rice|g':400});
 const day=h.home.previewDay({...h.event,day:'Monday'});assert.equal(day.ok,true,day.message);assert.equal(day.rows.length,1);assert.equal(day.rows[0].name,'Rice');
 await h.home.finishDay({...h.event,day:'Monday',expected:day.fingerprint});assert.deepEqual(h.stock(),{'bread|slice':12,'cheddar|g':420,'rice|g':300});
});
test('changing the actual child count invalidates the reviewed weekly quantities without changing stock',async()=>{
 const h=fixture(),preview=h.home.previewLunchWeek(h.event),before=JSON.stringify(h.stock());h.lunch.children=3;h.storage.setItem('lunch-plan',JSON.stringify(h.lunch));
 const result=await h.home.finishLunchWeek({...h.event,expected:preview.fingerprint});assert.equal(result.ok,false);assert.equal(JSON.stringify(h.stock()),before);
});
test('invalid child count and unknown lunch quantities remain reviewable rather than inventing a known zero',()=>{
 const h=fixture();h.lunch.children=1.5;assert.throws(()=>h.scope.bbHomeSchoolLunchWeekMeals(),/number of children/);
 h.lunch.children=2;h.lunch.days.Monday[0].qty=null;assert.equal(h.scope.bbHomeSchoolLunchWeekMeals()[0].ingredients[0].required,null);
 const preview=h.home.previewLunchWeek(h.event);assert.equal(preview.ok,true);assert.ok(preview.issues.length>0);assert.deepEqual(h.stock(),{'bread|slice':20,'cheddar|g':500,'rice|g':400});
});
