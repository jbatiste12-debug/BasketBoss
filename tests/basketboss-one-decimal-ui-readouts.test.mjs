import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),ui=require('../bb-shop-purchase-ui.js'),pantry=require('../bb-pantry-inline.js'),policy=require('../bb-pantry-policy.js'),legacyDisplay=require('../bb-pantry-display.js');
const source=fs.readFileSync(new URL('../bb-pantry-inline.js',import.meta.url),'utf8');

test('US and kitchen display units use one decimal without converting their supplied quantity',()=>{
 const cases=Object.freeze([
  [13.333333,'oz','13.3 oz'],[1.102292,'lb','1.1 lb'],[3.333333,'US fl oz','3.3 US fl oz'],
  [2.366667,'US cups','2.4 US cups'],[1.200846,'pint','1.2 US pints'],[1.333333,'tsp','1.3 tsp'],
  [.666667,'tbsp','0.7 tbsp'],[1.333333,'bunch','1.3 bunches'],[.066667,'fl oz','<0.1 fl oz'],
  [.000001,'each','<0.1 each'],[.000001,'g','<1 g']
 ]),before=JSON.stringify(cases);
 for(const [amount,unit,expected]of cases)assert.equal(ui.formatDisplayQty(amount,unit,{market:'US',countMode:'balance'}),expected);
 assert.equal(JSON.stringify(cases),before);
});

test('quantity narratives handle US units, ranges and tiny markers while leaving money unchanged',()=>{
 const original='≈ 8.47 oz (240 g); ≈ 3.33 US fl oz (100 ml); 1.04–2.66 US cups; <0.01 oz. £3.99 pack, $ 4.99 each, €2.49 tin, £3.99 per pack.';
 const display=ui.formatDisplayQuantityText(original);
 assert.equal(display,'≈ 8.5 oz (240 g); ≈ 3.3 US fl oz (100 ml); 1–2.7 US cups; <0.1 oz. £3.99 pack, $ 4.99 each, €2.49 tin, £3.99 per pack.');
 assert.equal(original.includes('8.47'),true);
 assert.equal(ui.formatDisplayQuantityText('£ 3.99 pack · Have 1.333333 packs'),'£ 3.99 pack · Have 1.3 packs');
});

test('narrative formatting preserves original item, piece and count nouns without changing money or direct each labels',()=>{
 const original='1 item · 2 items · 1 piece · 2 pieces · 1 count · 2 counts · 1.333333 items · 2.666667 pieces · 1.333333 counts · 2.333333 units · £3.99 item · $ 4.99 pieces · €2.49 counts';
 assert.equal(ui.formatDisplayQuantityText(original),'1 item · 2 items · 1 piece · 2 pieces · 1 count · 2 counts · 1.3 items · 2.7 pieces · 1.3 counts · 2.3 units · £3.99 item · $ 4.99 pieces · €2.49 counts');
 assert.equal(ui.formatDisplayQty(1,'item'),'1 each','direct canonical count displays retain their existing contract');
 assert.equal(ui.formatDisplayQty(2,'piece'),'2 each');
 assert.equal(original.includes('1.333333 items'),true);
});

test('active At home US summaries use the shared one-decimal renderer and keep legacy helpers exact',()=>{
 const rows=Object.freeze([Object.freeze({name:'Rice',qty:240,unit:'g'}),Object.freeze({name:'Rice',qty:500,unit:'g'}),Object.freeze({name:'Milk',qty:568,unit:'ml'}),Object.freeze({name:'Milk',qty:.000001,unit:'ml'}),Object.freeze({name:'Egg',qty:3.333333,unit:'each'})]),before=JSON.stringify(rows);
 assert.deepEqual(rows.map(row=>pantry.visibleSummaryAmount(row,'US',policy,ui,legacyDisplay)),['8.5 oz','1.1 lb','2.4 US cups','<0.1 fl oz','3.3 each']);
 assert.deepEqual(rows.map(row=>pantry.visibleSummaryAmount(row,'US',policy,null,legacyDisplay)),['8.5 oz','1.1 lb','2.4 US cups','<0.1 fl oz','3.3 each']);
 assert.equal(pantry.summaryAmount(rows[2],'US',policy,legacyDisplay),'2.37 US cups');
 assert.equal(pantry.converted(rows[2],'pint',policy,'US'),1.200846);
 assert.equal(JSON.stringify(rows),before);
});

function modalFixture({unit='g',market='UK',rowQty=50,other=11.111111,meal=333.333333,manual=0,buy=0,purchase=272.222222,rounded=false}={}){
 const name=unit==='g'?'Rice':'Milk',basis=policy.normalize(name,1,unit,{market});
 const row=Object.freeze({key:'pantry-modal',name,qty:rowQty,unit,otherOwned:other,extraBuffer:0,extraBufferQuantity:0,canonicalUnit:basis.unit,buyMultiple:0});
 const target=Object.freeze({totalNeeded:meal,totalQuantity:meal*basis.quantity,quantityPerUnit:basis.quantity,mealQuantity:meal*basis.quantity,mealNeeded:meal,manualQuantity:manual*basis.quantity,manualNeeded:manual,quantityTolerance:.000001});
 const calculation=Object.freeze({shortfall:purchase*basis.quantity,purchaseQuantity:purchase*basis.quantity,rounded,packCount:2}),calls=[];
 const node=value=>({value:String(value),textContent:'',hidden:false});
 const view={key:row.key,row,api:{list:()=>[row]},quantity:node(rowQty),needed:node(''),buffer:node(0),units:node(unit),touched:new Set(),neededHelp:node(''),readout:node(''),roundingNote:node(''),bufferHelp:node(''),otherOwned:node(''),done:node('')};
 const context={win:{BBPantryPolicy:policy,BBShopPurchaseUI:ui,BBHome:{foodTarget:()=>target,purchaseAmounts:request=>{calls.push(request);return calculation;}}},market:()=>market,amountText:String,amountValue:node=>node.value,text:(node,value)=>node.textContent=value,ROUND:value=>Math.round(value*1000000)/1000000,converted:pantry.converted,draftRow:()=>({...row,qty:view.quantity.value}),multipleDraft:()=>({quantity:buy,unit}),unitLabel:(_row,selected)=>selected,visibleAmount:(value,selected)=>pantry.visibleQuantity(value,selected,market,ui),visibleNote:value=>ui.formatDisplayQuantityText(value,{market})};
 const start=source.indexOf('  function automaticNeeded('),end=source.indexOf('  function localStep(',start);
 assert.ok(start>=0&&end>start);vm.runInNewContext(source.slice(start,end)+'\nthis.refreshActual=refreshPreview;',context);
 return {view,row,target,calls,render:()=>context.refreshActual(view),calculation};
}

test('actual pantry modal helper, purchase preview and other-storage text format only the visible amounts',()=>{
 const h=modalFixture(),before=JSON.stringify(h.row),inputBefore=[h.view.quantity.value,h.view.buffer.value];h.render();
 assert.match(h.view.neededHelp.textContent,/From your planned meals: 333 g\./);
 assert.equal(h.view.readout.textContent,'Add to Shop: 272 g');
 assert.equal(h.view.otherOwned.textContent,'Also at home in another storage area: 11 g.');
 assert.deepEqual([h.view.quantity.value,h.view.buffer.value],inputBefore);
 assert.equal(h.calls[0].needed,272.222222);assert.equal(h.calculation.purchaseQuantity,272.222222);
 assert.equal(JSON.stringify(h.row),before);assert.equal(h.target.mealNeeded,333.333333);
});

test('actual pantry modal static pack and shortfall hints use one decimal for US units',()=>{
 const h=modalFixture({unit:'cup',market:'US',rowQty:1,other:.333333,meal:4.333333,manual:.666667,buy:1.333333,purchase:2.666667,rounded:true}),before=JSON.stringify(h.row);h.render();
 assert.match(h.view.neededHelp.textContent,/4.3 US cups/);assert.match(h.view.neededHelp.textContent,/0.7 US cup/);
 assert.equal(h.view.readout.textContent,'Add to Shop: 2 × 1.3 US cups');
 assert.equal(h.view.roundingNote.textContent,'Shortfall 2.7 US cups · rounded to full packs.');
 assert.equal(h.view.otherOwned.textContent,'Also at home in another storage area: 0.3 US cup.');
 assert.equal(h.view.quantity.value,'1');assert.equal(JSON.stringify(h.row),before);
 assert.equal(h.calculation.shortfall,2.666667*240);
});

test('narrative thousands are parsed as one quantity and cannot lose zero groups',()=>{
 assert.equal(ui.formatDisplayQuantityText('Have 1,000 g and 2,001 pieces'),'Have 1 kg and 2001 pieces');
 assert.equal(ui.formatDisplayQuantityText('1,000–2,000 g needed'),'1000–2000 g needed');
 assert.equal(ui.formatDisplayQuantityText('£1,000.99 per pack'),'£1,000.99 per pack');
});

test('narrative formatting never rewrites a fraction denominator as a new measure',()=>{
 assert.equal(ui.formatDisplayQuantityText('Use 1/2000 g and 1/3 cup'),'Use 1/2000 g and 1/3 cup');
});
