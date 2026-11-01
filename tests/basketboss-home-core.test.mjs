import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const api=createRequire(import.meta.url)('../bb-home.js');
const id=(name,unit)=>name.toLowerCase()+'|'+unit;
test('manual total is a maximum over recipe plus lunch need, never a duplicate addition',()=>{
 const recipe=[{key:'Rice',unit:'g',required:600}],lunch=[{name:'Rice',unit:'g',qty:100}];
 assert.equal(api.augment(recipe,lunch,{'rice|g':{name:'Rice',unit:'g',targetQty:1000,pending:true}},id)[0].required,900);
 assert.equal(api.augment(recipe,lunch,{'rice|g':{name:'Rice',unit:'g',targetQty:500,pending:true}},id)[0].required,600);
 assert.equal(recipe[0].required,600);
 assert.equal(api.difference(600,200),400);assert.equal(api.difference(200,600),0);
});
test('manual requests survive new weeks, then cease adding demand only when fulfilled',()=>{
 const target={name:'Milk',unit:'ml',targetQty:1000,pending:true};
 for(let day=0;day<14;day++)assert.equal(api.augment([],[],{milk:target},id)[0].required,1000);
 assert.deepEqual(api.augment([],[],{milk:{...target,pending:false}},id),[]);
});
test('invalid and negative amounts cannot create stock or purchases',()=>{
 for(const value of[-1,NaN,Infinity,'200',null])assert.throws(()=>api.difference(600,value));
 assert.equal(api.augment([],[],{rice:{name:'Rice',unit:'g',targetQty:-200,pending:true}},id).length,0);
});
test('multi-record confirmation rolls every value back on storage verification failure',()=>{
 const data=new Map([['stock','old-stock'],['target','old-target']]);let failed=false;
 const storage={getItem:k=>data.get(k)??null,setItem(k,v){if(k==='target'&&!failed){failed=true;throw Error('quota');}data.set(k,v);},removeItem:k=>data.delete(k)};
 assert.throws(()=>api.atomic(storage,{stock:{rice:200},target:{needed:600}}));assert.equal(data.get('stock'),'old-stock');assert.equal(data.get('target'),'old-target');
 assert.throws(()=>api.atomic(storage,{stock:{}},{stock:'stale'}));assert.equal(data.get('stock'),'old-stock');
});

import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync('index.html','utf8');
const pantryText=html.slice(html.indexOf('const BB307Pantry=(()=>{'),html.indexOf('// BasketBoss 321 v7 original-design PREVIEW'));
const pantryContext=vm.createContext({BB_WHOLE_PRODUCE_GRAMS:{},BBPriceV19:{canonical:s=>String(s).toLowerCase().trim()}});vm.runInContext(pantryText,pantryContext);
const pantry=vm.runInContext('BB307Pantry',pantryContext);
test('real pantry consumption preserves units, never goes negative and does not guess incompatible stock',()=>{
 const result=pantry.reconcileStock({'rice|g':1000,'milk|ml':2000,'onion|each':2},[{key:'Rice',unit:'g',required:600},{key:'Milk',unit:'ml',required:500},{key:'Onion',unit:'each',required:.5}]);
 assert.equal(result.remainingStock['rice|g'],400);assert.equal(result.remainingStock['milk|ml'],1500);assert.equal(result.remainingStock['onion|each'],1.5);
 const mismatch=pantry.reconcileStock({'rice|each':1},[{key:'Rice',unit:'g',required:600}]);assert.equal(mismatch.remainingStock['rice|each'],1);
});
test('cooking commits once, supports another real cook, rejects another actor, and rolls failed commits back',async()=>{
 const map=new Map([['stock',JSON.stringify({'rice|g':1000})],['inventory','{}']]);let fail=false;
 const storage={getItem:k=>map.get(k)??null,setItem(k,v){if(fail&&k==='inventory'){fail=false;throw Error('disk full');}map.set(k,v);},removeItem:k=>map.delete(k)};
 const win={localStorage:storage,location:{search:''},document:{},BBHomeHost:{keys:()=>({stock:'stock',inventory:'inventory'}),stock:()=>JSON.parse(storage.getItem('stock')),recipeIngredients:(_,factor)=>[{key:'rice',unit:'g',required:300*factor}],consume:pantry.reconcileStock,refresh(){},occurrence:()=>null}};
 const home=api.install(win);
 const event={sessionId:'first-cook',recipeId:'rice-dinner',factor:1,actorId:'guest'};
 assert.equal((await home.cooked(event)).ok,true);assert.equal(JSON.parse(storage.getItem('stock'))['rice|g'],700);
 await home.cooked(event);assert.equal(JSON.parse(storage.getItem('stock'))['rice|g'],700,'repeated completion does not consume again');
 assert.equal((await home.cooked({...event,sessionId:'other',actorId:'other-account'})).ok,false);
 fail=true;await assert.rejects(()=>home.cooked({...event,sessionId:'second-cook',factor:2}));assert.equal(JSON.parse(storage.getItem('stock'))['rice|g'],700);
 await home.cooked({...event,sessionId:'second-cook',factor:2});assert.equal(JSON.parse(storage.getItem('stock'))['rice|g'],100,'retry uses the uncommitted cooking session exactly once');
});
