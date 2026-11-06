import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),home=require('../bb-home.js'),display=require('../bb-pantry-display.js');
const source=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
function actual(name){const start=source.indexOf('function '+name+'('),end=source.indexOf('\n}',start);assert.ok(start>=0&&end>start);return source.slice(start,end+2);}
function fixture(){
 const ctx=vm.createContext({window:{BBHome:home,BBPantryDisplay:display},bb307Market:'UK',BBPriceV19:{formatQuantity:(q,u)=>q+' '+u},bb321TinSpec:()=>({size:400}),bb321TinShoppingQuantity:()=> '2 tins (800 g)',bbWholeProduceCount:()=>null});
 vm.runInContext(actual('bb80ShoppingQuantity')+'\n'+actual('bb84DisplayedPurchase'),ctx);return ctx;
}
test('chosen measured pack displays its real size instead of the generic tin or produce lookup',()=>{
 const ctx=fixture(),pack={buyMultiple:500,buyMultipleUnit:'g'};
 assert.equal(ctx.bb80ShoppingQuantity('Chopped tomatoes',500,'g','UK',pack),'500 g');
 assert.equal(ctx.bb80ShoppingQuantity('Milk',1000,'ml','UK',{buyMultiple:1000,buyMultipleUnit:'ml'}),'1 L');
 assert.equal(ctx.bb80ShoppingQuantity('Pasta',1500,'g','UK',pack),'1.5 kg');
 assert.equal(ctx.bb80ShoppingQuantity('Pasta',453.6,'g','US',{buyMultiple:453.6,buyMultipleUnit:'g'}),'1 lb');
});
test('one tap buys the chosen pack and rounds only the remaining amount after a partial purchase',()=>{
 const ctx=fixture(),item={key:'Chopped tomatoes',unit:'g',buyMultiple:500,buyMultipleUnit:'g'};
 assert.equal(ctx.bb84DisplayedPurchase(item,500),500,'a 500g chosen pack must not become 800g of generic tins');
 assert.equal(ctx.bb84DisplayedPurchase(item,1000,250),1250,'750g still needed is two 500g packs, plus 250g already bought');
 assert.equal(ctx.bb84DisplayedPurchase({...item,buyMultiple:0},500),800,'existing generic tin behavior remains when the option is off');
 assert.equal(ctx.bb84DisplayedPurchase({key:'Eggs',unit:'each',buyMultiple:6,buyMultipleUnit:'each'},7),12);
});
