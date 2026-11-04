import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const helperSource=source.slice(source.indexOf('function bbMyWeekPantrySavings('),source.indexOf('function bbNextComposePlan('));
const ctx=vm.createContext({window:{}});vm.runInContext(fs.readFileSync(new URL('../basketboss-pricing-v19.js',import.meta.url),'utf8'),ctx);vm.runInContext(helperSource,ctx);
const money=n=>'£'+n.toFixed(2),copy=patch=>ctx.bbMyWeekBudgetCopy({spend:144.9,target:150,dinners:7,money,...patch});
const quote=item=>ctx.window.BBPriceV19.price({name:item.key||item.name,quantity:item.toBuy,unit:item.unit,market:'UK'});

test('saved target copy states the exact under, over and matched budget with the dinner count',()=>{
 assert.equal(copy({}).summary,'£5.10 under your £150 budget · 7/7 dinners planned');
 assert.equal(copy({spend:155.25,dinners:3}).summary,'£5.25 over your £150 budget · 3/7 dinners planned');
 assert.equal(copy({spend:150}).summary,'At your £150 budget · 7/7 dinners planned');
 assert.equal(copy({target:150.5}).summary,'£5.60 under your £150.50 budget · 7/7 dinners planned');
});
test('unset budget and incomplete quotes never claim the household is under a made-up target',()=>{
 assert.equal(copy({target:null}).summary,'7/7 dinners planned · Set a weekly budget');
 assert.equal(copy({pending:2}).summary,'£144.90 priced so far · £150 budget · 7/7 dinners planned');
 assert.equal(copy({pending:2}).priceNote,'2 items still need a price.');
 assert.equal(copy({review:true,target:null}).summary,'£144.90 priced so far · 7/7 dinners planned');
 assert.match(copy({review:true}).priceNote,/amounts need checking/);
});
test('dinner count merges valid source, custom and leftover nights without counting a day twice',()=>{
 const plan=[{day:'Monday'},{day:'Monday'},{day:'Wednesday'},{day:'bad'}],notes={Friday:'Eat out',bad:'ignore'},pairs=[{leftoverDay:'Tuesday'},{leftoverDay:'Friday'}];
 assert.equal(ctx.bbMyWeekDinnerCount(plan,notes,pairs),4);
});
test('At home saving uses actual whole-pack reduction and leaves same-pack partial ownership at zero',()=>{
 const one=quote({key:'rice',unit:'g',toBuy:1000}).amount;
 assert.ok(one>0);
 assert.equal(ctx.bbMyWeekPantrySavings({items:[{key:'rice',unit:'g',toBuy:1000,pantryUsed:1000}]},{quote}),one);
 assert.equal(ctx.bbMyWeekPantrySavings({items:[{key:'rice',unit:'g',toBuy:125,pantryUsed:125}]},{quote}),0);
 assert.equal(ctx.bbMyWeekPantrySavings({items:[{key:'rice',unit:'g',toBuy:0,pantryUsed:1000}]},{quote}),one);
});
test('manual top-ups stay in both sides of the pantry price comparison; unknown and reminder lines invent no savings',()=>{
 assert.equal(ctx.bbMyWeekPantrySavings({items:[{key:'rice',unit:'g',toBuy:1500,pantryUsed:500,manualBuyQty:500}]},{quote}),0);
 const blocked=[{key:'honey',staple:true,toBuy:0,pantryUsed:1},{key:'oil',cupboardCheck:true,toBuy:0,pantryUsed:1},{key:'rice',bb172Assumed:true,toBuy:0,pantryUsed:1},{key:'unknown',toBuy:0,pantryUsed:3}];
 assert.equal(ctx.bbMyWeekPantrySavings({items:blocked},{quote:item=>item.key==='unknown'?{amount:null}:quote(item)}),0);
 assert.equal(ctx.bbMyWeekPantrySavings({items:[{key:'rice',toBuy:1,pantryUsed:2}]},{quote:()=>({amount:null})}),0);
});
test('household ownership includes manual additions before whole-pack rounding and ignores completed targets',()=>{
 const household=[{id:'cleaner',name:'Cleaner',selected:true,unit:'each',targetQty:1,ownedQty:1}],quote=(item,essential)=>({amount:Math.ceil(item.qty/3)*6});
 assert.equal(ctx.bbMyWeekPantrySavings({essentials:[{id:'cleaner',unit:'each',qty:1,manualBuyQty:1}]},{household,quote}),0);
 assert.equal(ctx.bbMyWeekPantrySavings({essentials:[]},{household,quote}),6);
 assert.equal(ctx.bbMyWeekPantrySavings({essentials:[]},{household:[{...household[0],manualPending:false}],quote}),0);
});
test('savings copy appears only for a priced reduction and labels the result as an estimate',()=>{
 assert.equal(copy({savings:0}).savings,'');assert.equal(copy({savings:3.5}).savings,'At home stock saves an estimated £3.50.');
});

test('recipe spoonful review on cupboard staples does not make the shopping budget incomplete, but unknown measured foods do',()=>{
 const unknown={needsRecipeReview:true,pendingSources:[{source:'1 block',required:null}]};
 assert.equal(ctx.bbMyWeekAmountReview([{...unknown,staple:true,cupboardCheck:true,toBuy:0}]),false);
 assert.equal(ctx.bbMyWeekAmountReview([{...unknown,staple:true,toBuy:1,unit:'each'}]),false,'an active Low/Out container has its own known purchase quantity');
 assert.equal(ctx.bbMyWeekAmountReview([{...unknown,cupboardCheck:true}]),false);
 assert.equal(ctx.bbMyWeekAmountReview([{...unknown,key:'parmesan',unit:'g',required:0,toBuy:0}]),true,'unknown measured Parmesan cannot disappear from the incomplete-cost check');
 assert.equal(ctx.bbMyWeekAmountReview([],true),true,'deferred recipe access still leaves the cost incomplete');
 assert.equal(ctx.bbMyWeekAmountReview([{key:'rice',required:250,toBuy:250,unit:'g'}]),false);
});
