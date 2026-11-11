import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as receiptCore from '../bb-receipt-inventory-core.mjs';

const require=createRequire(import.meta.url);
const policy=require('../bb-pantry-policy.js'),deduction=require('../bb-pantry-deduction.js');
const canonical=require('../bb-recipe-canonical.js'),homeModule=require('../bb-home.js');
const id=(food,unit)=>policy.canonicalName(food)+'|'+unit;
const conversion={pantryMode:true,market:'Guernsey',basis:{wholeProduce:false,spoons:false}};
const almost=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<=1e-9,label+': '+actual+' != '+expected);
const permutations=rows=>rows.length<2?[rows]:rows.flatMap((row,index)=>permutations(rows.filter((_,other)=>other!==index)).map(rest=>[row,...rest]));

test('Cook proposals conserve physical grams and kilograms for zero, tiny, partial and surplus balances',()=>{
 for(const required of [0,.000001,.333333,300,700])for(const owned of [0,.000001,.111111,450,1000])for(const unit of ['g','kg']){
  const key='rice|'+unit,scale=unit==='kg'?1000:1,stock={[key]:owned/scale},before=JSON.stringify(stock);
  const result=deduction.proposal({stock,ingredients:[{key:'Rice',unit:'g',required}],id,conversion});
  const used=result.rows[0].deduct,left=(result.remainingStock[key]||0)*scale;
  almost(used,Math.min(required,owned),'deduct');almost(left,Math.max(0,owned-required),'remaining');
  assert.equal(JSON.stringify(stock),before,'a preview must not change the saved source');assert.ok(used>=0&&left>=0);
 }
});

test('generic and specifically named requests share each physical source once regardless of ingredient order',()=>{
 const requests=[{key:'Brown rice',unit:'g',required:250},{key:'White rice',unit:'g',required:300},{key:'Rice',unit:'g',required:200}];
 for(const generic of [0,250,450,1000])for(const exact of [0,200,500])for(const ingredients of permutations(requests)){
  const stock={'rice|g':generic,'white rice|g':exact},before=JSON.stringify(stock);
  const result=deduction.proposal({stock,ingredients,id,conversion}),usedBySource={};
  for(const allocation of result.used.flatMap(row=>row.allocations||[]))usedBySource[allocation.stockKey]=(usedBySource[allocation.stockKey]||0)+allocation.sourceQuantity;
  for(const [key,quantity]of Object.entries(stock)){
   almost(quantity,(result.remainingStock[key]||0)+(usedBySource[key]||0),'source conservation');
   assert.ok((usedBySource[key]||0)<=quantity+1e-9,'one source cannot satisfy more than its physical balance');
  }
  assert.ok(result.rows.every(row=>row.deduct<=row.required+1e-9),'a recipe cannot consume more than it requires');
  assert.equal(JSON.stringify(stock),before);
 }
});

test('dietary, processing and food identities cannot spend an incompatible physical source',()=>{
 for(const [owned,required]of [['Oat milk','Whole milk'],['Frozen spinach','Spinach'],['Cooked rice','Rice'],['Tomato puree','Tomatoes'],['Cod','Haddock'],['Chicken thigh','Chicken breast'],['Sweet potato','Potato']]){
  const stock={[id(owned,'g')]:500},result=deduction.proposal({stock,ingredients:[{key:required,unit:'g',required:300}],id,conversion});
  assert.equal(result.rows[0].deduct,0,owned+' must not silently satisfy '+required);assert.deepEqual(result.remainingStock,stock);
 }
});

test('portion changes scale compatible ingredient quantities before their combined requirement is reconciled',()=>{
 for(const factor of [.25,.75,1,1.5,1.75]){
  const [row]=canonical.aggregate([{name:'Rice',quantity:300,unit:'g'},{name:'rice',quantity:.4,unit:'kg'}].map(ingredient=>canonical.project(ingredient,{factor})));
  almost(row.required,700*factor,'scaled aggregate');
 }
});

test('the rice loop adds a real receipt and consumes one confirmed meal without replaying either transaction',async()=>{
 const STOCK='basketboss_321_v7_measured_pantry',INVENTORY='basketboss_makeameal_v1_inventory',SESSION='basketboss_cloud_session_v1';
 const ACTOR='11111111-1111-4111-8111-111111111111';
 const values=new Map([[STOCK,JSON.stringify({'rice|g':450})],[INVENTORY,'{}'],[SESSION,JSON.stringify({user:{id:ACTOR}})]]);
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const stock=()=>JSON.parse(storage.getItem(STOCK));
 const [requirement]=canonical.aggregate([300,400].map(quantity=>canonical.project({name:'Rice',unit:'g',quantity})));
 const initial=storage.getItem(STOCK);
 assert.deepEqual({needed:requirement.required,got:Math.min(requirement.required,stock()['rice|g']),toBuy:homeModule.difference(requirement.required,stock()['rice|g'])},{needed:700,got:450,toBuy:250});
 assert.equal(storage.getItem(STOCK),initial,'planning reserves food without deducting it');

 const root={console,localStorage:storage};
 vm.runInNewContext(fs.readFileSync(new URL('../bb-receipt-inventory.js',import.meta.url),'utf8'),root);
 const adapter=root.BBReceiptInventoryFactory({storage,core:receiptCore,canonicalize:name=>name.toLowerCase().trim(),
  getSession:()=>({user:{id:ACTOR},access_token:'synthetic-local-inventory-audit'}),
  getContext:()=>({market:'UK',retailer:'Tesco',shopSessionId:'audit-rice'}),
  getCatalog:()=>({ingredients:{'rice|g':{ingredient:'rice',unit:'g'}}})});
 const packet={receiptId:'audit-rice-500g',market:'UK',retailer:'Tesco',shopSessionId:'audit-rice',stockPantry:true,
  items:[{key:'rice',name:'Rice 500g',classification:'food',sourceKind:'purchase',quantity:500,unit:'g',lineTotal:1,reviewed:true}]};
 assert.equal((await adapter.commitLocalReceipt(packet)).ok,true);assert.equal(stock()['rice|g'],950);
 assert.equal((await adapter.commitLocalReceipt(packet)).duplicate,true);assert.equal(stock()['rice|g'],950);

 const win={localStorage:storage,document:{},location:{search:''},
  BBReceiptHost:{hasPendingConfirmation:()=>false,requiresPantryReview:()=>false,async confirmCookedPantry(){return {ok:true};}},
  BBHomeHost:{id:(name,unit)=>name.toLowerCase().trim()+'|'+unit,keys:()=>({stock:STOCK,inventory:INVENTORY}),stock,
   recipeIngredients:()=>[{key:'rice',unit:'g',required:300}],refresh(){},household:()=>[],requirements:()=>[]}};
 const home=homeModule.install(win);win.BBHome=home;
 const event={sessionId:'audit-meal-a',recipeId:'audit-meal-a',day:'Monday',factor:1,actorId:ACTOR};
 const beforePreview=[...values],preview=home.previewCook(event);
 assert.equal(preview.ok,true);assert.deepEqual([...values],beforePreview,'opening Cook confirmation does not consume food');
 assert.deepEqual([preview.rows[0].required,preview.rows[0].owned,preview.rows[0].deduct,preview.rows[0].remaining],[300,950,300,650]);
 assert.equal((await home.cooked({...event,expected:preview.fingerprint})).ok,true);assert.equal(stock()['rice|g'],650);
 const confirmed=[...values];assert.equal((await home.cooked(event)).already,true);assert.deepEqual([...values],confirmed);
 assert.equal(homeModule.difference(400,stock()['rice|g']),0,'the remaining stock covers unconfirmed Meal B');
});
