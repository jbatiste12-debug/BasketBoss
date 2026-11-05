import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),policy=require('../bb-pantry-policy.js'),deduction=require('../bb-pantry-deduction.js');
const html=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const section=(from,to)=>html.slice(html.indexOf('function '+from+'('),html.indexOf('function '+to+'('));
function fixture(){
 const context={window:{BBPantryPolicy:policy,BBPantryDeduction:deduction,BBKitchenChoiceRules:{isHousehold:name=>/soap|detergent/i.test(name)}},BB307Pantry:{pantryName:name=>String(name).trim().toLowerCase()},BBPriceV19:{catalog:{}},BB307_NORMALIZED:[],bb307ReadStock:()=>({})};
 vm.createContext(context);vm.runInContext(section('bbHomeExcludedStockKeys','bbHomeConversionContext')+section('bbHomeShoppingKind','bbHomePurchaseContext'),context);return context;
}
test('generic Sugar is a food top-up without falsely aliasing it to a specific baking sugar',()=>{
 const h=fixture();assert.equal(h.bbHomeShoppingKind('Sugar'),'food');assert.equal(h.bbHomeShoppingKind('Laundry detergent'),'household');assert.equal(h.BB307Pantry.pantryName('Sugar'),'sugar');
});
test('mixed or unowned legacy pepper count aliases remain unavailable to whole-food calculations',()=>{
 const h=fixture(),stock={'pepper|items':3},rows={produce:{name:'Peppers',unit:'items',staple:false,selected:true,bb173StockKey:'pepper|items'},spice:{name:'Pepper',unit:'items',staple:true,selected:true,bb173StockKey:'pepper|items'}};
 assert.deepEqual(Array.from(h.bbHomeExcludedStockKeys(stock,rows)),['pepper|items']);
 assert.deepEqual(Array.from(h.bbHomeExcludedStockKeys(stock,{})),['pepper|items']);assert.equal(stock['pepper|items'],3);
});
test('unambiguous whole-food grams and count records remain usable alongside a spice container',()=>{
 const h=fixture(),stock={'pepper|each':1,'pepper|g':400},rows={spice:{name:'Pepper',unit:'each',staple:true,selected:true,bb173StockKey:'pepper|each'},produce:{name:'Peppers',unit:'g',staple:false,selected:true,bb173StockKey:'pepper|g'}};
 assert.deepEqual(Array.from(h.bbHomeExcludedStockKeys(stock,rows)),['pepper|each']);
 const whole={produce:{name:'Peppers',unit:'each',staple:false,selected:true,bb173StockKey:'pepper|each'}};assert.deepEqual(Array.from(h.bbHomeExcludedStockKeys({'pepper|each':2},whole)),[]);
});
