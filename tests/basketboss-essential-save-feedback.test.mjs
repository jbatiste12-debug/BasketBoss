import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync('app.html','utf8'),FEATURE='basketboss_321_features_v1';
const coreStart=source.indexOf('const BB307Features=(()=>{'),coreEnd=source.indexOf('/* BasketBoss 321: optional family features',coreStart);
const storeStart=source.indexOf('function bb307StoreFeatures(){'),storeEnd=source.indexOf('\nfunction bb307FeaturesRefresh()',storeStart);
const handlerStart=source.indexOf("region.querySelector('#bb307EssentialsForm').onsubmit="),handlerEnd=source.indexOf('\n  const update=',handlerStart);
assert.ok(coreStart>=0&&coreEnd>coreStart&&handlerStart>=0&&handlerEnd>handlerStart);
function fixture(mode='ok'){
 let failure=mode;const values=new Map([[FEATURE,JSON.stringify({version:1,essentials:[]})]]),notices=[];
 const fields={bb307EssName:'Toothpaste',bb307EssQty:'2',bb307EssUnit:'each',bb307EssPrice:'',bb307EssPackQty:'',bb307EssPackUnit:'',bb307EssProduct:'',bb307EssBrand:''};
 const form={},region={querySelector(selector){return selector==='#bb307EssentialsForm'?form:{value:fields[selector.slice(1)]};}};
 const ctx=vm.createContext({window:{},console:{warn(){}},RECIPES:[],BB307_FEATURE_KEY:FEATURE,bb307FeatureState:{version:1,essentials:[]},bb307Market:'UK',bb307ActiveRetailer:()=>null,region,
 localStorage:{getItem:key=>values.get(key)??null,setItem(key,value){if(failure==='quota')throw Error('quota');if(failure!=='noop')values.set(key,String(value));}},notify:message=>notices.push(message),bb307FeaturesRefresh(){ctx.refreshed=(ctx.refreshed||0)+1;}});
 vm.runInContext(source.slice(coreStart,coreEnd),ctx);vm.runInContext(source.slice(storeStart,storeEnd),ctx);vm.runInContext(source.slice(handlerStart,handlerEnd),ctx);
 return{ctx,values,notices,fields,submit:()=>form.onsubmit({preventDefault(){}}),repair(){failure='ok';}};
}
for(const mode of ['quota','noop'])test(`legacy essential Add keeps inputs and refuses saved feedback on ${mode} storage failure`,()=>{
 const h=fixture(mode);h.submit();assert.equal(h.ctx.refreshed,undefined);assert.equal(h.ctx.bb307FeatureState.essentials.length,0);assert.equal(JSON.parse(h.values.get(FEATURE)).essentials.length,0);assert.equal(h.fields.bb307EssName,'Toothpaste');assert.ok(h.notices.includes('Could not save changes to this device.'));assert.ok(!h.notices.some(message=>message.includes('Essential added')));
 h.repair();h.submit();const saved=JSON.parse(h.values.get(FEATURE));assert.equal(saved.essentials.length,1);assert.equal(saved.essentials[0].name,'Toothpaste');assert.equal(saved.essentials[0].qty,2);assert.equal(h.ctx.refreshed,1);assert.equal(h.notices.filter(message=>message==='Essential added ✓').length,1);
});
