import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const reduced = createRequire(import.meta.url)('../bb-reduced-purchases.js');
const homeModel = createRequire(import.meta.url)('../bb-home.js');
const html = fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const code = html.slice(html.indexOf('function bbHomeWeekToken('),html.indexOf('function bbHomeRecipeIngredients('));
function fixture(market,at,{helper=true,generation='cycle-one'}={}){
 let clock=Date.parse(at);const NativeDate=Date;
 class ClockDate extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const state={pantryPlanGeneration:generation,planned:[{recipeId:'rice-dinner',day:'Monday'}],plannedDesserts:[{recipeId:'fruit-dessert',day:'Tuesday'}]};
 const context={Date:ClockDate,state,bb307Market:market,DAYS:['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],window:helper?{BBReducedPurchases:reduced}:{}};
 vm.createContext(context);vm.runInContext(code,context);
 return {state,week:()=>context.bbHomeWeekToken(),occurrence:(...args)=>context.bbHomeOccurrence(...args),at:value=>{clock=Date.parse(value);},get now(){return clock;}};
}
function zone(name,run){const previous=process.env.TZ;try{process.env.TZ=name;run();}finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}}
test('US cooking and spending share the same local week through Sunday evening after UTC Monday',()=>zone('America/Los_Angeles',()=>{
 const h=fixture('US','2026-11-02T02:30:00Z'),sunday=h.occurrence('rice-dinner','Monday');
 assert.equal(h.week(),'2026-10-26|cycle-one');assert.equal(h.week().split('|')[0],reduced.week(h.now,'US'));
 h.at('2026-11-02T07:59:00Z');assert.equal(h.occurrence('rice-dinner','Monday'),sunday,'Sunday remains the same completed occurrence');
 h.at('2026-11-02T08:01:00Z');assert.equal(h.week(),'2026-11-02|cycle-one');assert.notEqual(h.occurrence('rice-dinner','Monday'),sunday,'Monday starts a new cooking occurrence');
}));
test('UK and Channel Islands use the same London summer week even when device timezone differs',()=>zone('America/Los_Angeles',()=>{
 for(const market of ['UK','Guernsey','Jersey']){
  const h=fixture(market,'2026-07-05T23:30:00Z');assert.equal(h.week(),'2026-07-06|cycle-one');assert.equal(h.week().split('|')[0],reduced.week(h.now,market));
 }
}));
test('the dependency fallback preserves the local US week instead of falling back to UTC',()=>zone('America/Los_Angeles',()=>{
 const h=fixture('US','2026-11-02T02:30:00Z',{helper:false});assert.equal(h.week(),'2026-10-26|cycle-one');
}));
test('a deliberate new planning cycle changes completion identity without mutating physical stock or price baselines',()=>zone('Europe/London',()=>{
 const h=fixture('UK','2026-11-05T12:00:00Z'),stock=Object.freeze({'rice|g':500}),prices=Object.freeze({rice:1.25}),before=JSON.stringify([stock,prices]);
 const dinner=h.occurrence('rice-dinner','Monday'),dessert=h.occurrence('fruit-dessert','Tuesday','dessert');h.state.pantryPlanGeneration='cycle-two';
 assert.notEqual(h.occurrence('rice-dinner','Monday'),dinner);assert.notEqual(h.occurrence('fruit-dessert','Tuesday','dessert'),dessert);assert.equal(JSON.stringify([stock,prices]),before);
}));
test('a completed Sunday meal written under the former UTC week cannot deplete again after the calendar fix',async()=>{
 const previous=process.env.TZ;process.env.TZ='America/Los_Angeles';
 try{
  let now=Date.parse('2026-11-02T03:00:00Z');const at=Date.parse('2026-11-02T02:30:00Z'),old='2026-11-02|cycle-one|dinner|Monday|rice-dinner',current='2026-10-26|cycle-one|dinner|Monday|rice-dinner';
  const data=new Map([['basketboss_at_home_requirements_v1',JSON.stringify({version:1,byActor:{guest:{targets:{},planned:{[old]:true},cooked:{oldCook:{recipeId:'rice-dinner',day:'Monday',factor:1,at}}}}})],['stock',JSON.stringify({'rice|g':500})],['inventory','{}']]);
  const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)};
  const win={Date:{now:()=>now},BBReducedPurchases:reduced,localStorage:storage,location:{search:''},document:{},BBHomeHost:{conversionContext:()=>({market:'US'}),occurrence:()=>current}};
  const home=homeModel.install(win);assert.equal(home.isCooked(current),true);
  const result=await home.cooked({sessionId:'different-click',recipeId:'rice-dinner',day:'Monday',factor:1,actorId:'guest',occurrence:current,kind:'dinner'});
  assert.equal(result.ok,true);assert.equal(result.already,true);assert.equal(JSON.parse(data.get('stock'))['rice|g'],500);
  assert.equal(home.isCooked(current.replace('cycle-one','cycle-two')),false,'a deliberately replaced plan remains a new cooking cycle');
  now=Date.parse('2026-11-02T08:01:00Z');assert.equal(home.isCooked('2026-11-02|cycle-one|dinner|Monday|rice-dinner'),false,'Sunday’s former UTC key must not count as cooked in the new local Monday week');assert.equal(JSON.parse(data.get('basketboss_at_home_requirements_v1')).byActor.guest.planned[old],true,'the original history stays intact');
  assert.equal(home.isCooked('2026-11-09|cycle-one|dinner|Monday|rice-dinner'),false,'future weeks never inherit this cook');
 }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
