import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {auditRegions} from '../scripts/audit-pantry-regions.mjs';
import {normalizePantryState} from '../bb-receipt-inventory-core.mjs';
const require=createRequire(import.meta.url),policy=require('../bb-pantry-policy.js'),deduction=require('../bb-pantry-deduction.js'),display=require('../bb-pantry-display.js');
test('all 100 recipes aggregate once per ingredient in UK and US, preserving every uncertain source',()=>{
 const report=auditRegions();assert.equal(report.rows.length,730);assert.equal(report.modes.UK.recipes,100);
 for(const mode of Object.values(report.modes)){assert.deepEqual(mode.duplicateRows,[]);assert.deepEqual(mode.nonCanonicalRows,[]);assert.deepEqual(mode.conversionFailures,[]);}
 assert.deepEqual(report.modes.UK.canonicalTotals,report.modes.US.canonicalTotals,'region changes presentation and new purchase defaults, never saved recipe quantities');
 assert.ok(report.recipeReview.some(row=>/block/.test(row.source)));assert.ok(report.recipeReview.some(row=>/carton/.test(row.source)));assert.ok(report.recipeReview.every(row=>row.reason&&row.recipeId&&row.source));
});
test('US kitchen factors and ingredient cup weights are explicit and do not give unknown solids a liquid density',()=>{
 for(const [name,unit,qty,expected,base]of [['Milk','cup',1,240,'ml'],['Milk','fl oz',1,30,'ml'],['Rice','oz',1,28.35,'g'],['Rice','lb',1,453.6,'g'],['Plain flour','cup',1,120,'g'],['Rice','cup',1,185,'g'],['Rolled oats','cup',1,90,'g'],['Grated cheddar','cup',1,113,'g'],['Spinach','cup',1,30,'g']]){const amount=policy.normalize(name,qty,unit,{market:'US'});assert.equal(amount.quantity,expected);assert.equal(amount.unit,base);}
 assert.equal(policy.normalize('Mystery solid',1,'cup',{market:'US'}),null);
 assert.match(policy.normalize('Plain flour',1,'cup',{market:'US'}).assumption,/Approximate/);
});
test('US cups, ounces and pounds merge to one physical flour balance and Cook deducts canonical grams',()=>{
 const stock={'plain flour|cup':1,'plain flour|oz':16},inventory={cup:{name:'Plain flour',loc:'cupboard',selected:true,qty:1,unit:'cup',bb173StockKey:'plain flour|cup',bb173StockValue:1},oz:{name:'Plain flour',loc:'cupboard',selected:true,qty:16,unit:'oz',bb173StockKey:'plain flour|oz',bb173StockValue:16}};
 const result=normalizePantryState(stock,inventory,{market:'US'});assert.deepEqual(result.stock,{'plain flour|g':573.6});assert.equal(Object.values(result.inventory).filter(row=>row.selected).length,1);
 const cooked=deduction.proposal({stock:result.stock,ingredients:[{name:'Plain flour',unit:'cup',required:1}],conversion:{pantryMode:true,market:'US'}});
 assert.equal(cooked.remainingStock['plain flour|g'],453.6);assert.equal(cooked.rows[0].deduct,120);assert.equal(cooked.issues.length,0);
 assert.deepEqual(normalizePantryState(result.stock,result.inventory,{market:'UK'}).stock,result.stock,'switching region never rescales an existing gram balance');
});
test('regional can, mince pack and pint defaults differ only for new informal entries',()=>{
 for(const [market,tin,mince,pint]of [['UK',400,500,568],['US',411,454,473]]){assert.equal(policy.normalize('Chopped tomatoes',1,'can',{market}).quantity,tin);assert.equal(policy.normalize('Ground beef',1,'pack',{market}).quantity,mince);assert.equal(policy.normalize('Milk',1,'pint',{market}).quantity,pint);}
 const checked=policy.normalize('Ground beef',1,'pack',{market:'US',packReviewed:true,packQuantity:750,packUnit:'g'});assert.equal(checked.quantity,750);assert.equal(checked.estimated,false);
});
test('regional display is read-only and unknown units remain reviewable without zeroing stock',()=>{
 assert.equal(display.format('Rice',453.6,'g','US'),'1 lb');assert.equal(display.format('Milk',240,'ml','US'),'1 US cups');assert.equal(display.format('Milk',240,'ml','UK'),'240 ml');
 assert.match(display.format('Plain flour',120,'g','US',{preferredUnit:'cup'}),/≈ 1 US cups/);
 const source={'mystery solid|cup':2},result=normalizePantryState(source,{}, {market:'US'});assert.deepEqual(result.stock,source);assert.equal(result.issues.length,1);
 const cooked=deduction.proposal({stock:source,ingredients:[{name:'Mystery solid',unit:'g',required:100}],conversion:{pantryMode:true,market:'US'}});assert.deepEqual(cooked.remainingStock,source);assert.ok(cooked.issues.length);
});
