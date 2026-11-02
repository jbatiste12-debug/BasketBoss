import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const planning=html.slice(html.indexOf('function bb81Under30('),html.indexOf('function bb81ProEligible('));
const benefits=html.slice(html.indexOf('function bbDiscoverRecipeBenefits('),html.indexOf('/* BB-018: Premium tiles'));
const context=vm.createContext({collectionsFor(){throw Error('Editable collections cannot supply recipe claims');},esc:value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))});
vm.runInContext(planning+benefits,context);
const labels=(recipe,locked=false)=>Array.from(context.bbDiscoverRecipeBenefits(recipe,locked));
const record=overrides=>({id:'test-dinner',name:'Chicken dinner',mins:40,servings:4,category:'Family',tag:'DINNER',ingredients:[['Chicken breast','500g']],method:['Follow the declared recipe instructions.'],...overrides});

test('ordinary chicken and family dinners gain no inferred child or nutrition claims',()=>{
 assert.deepEqual(labels(record()),[]);
 assert.deepEqual(labels(record({name:'High protein chicken for kids'})),[],'recipe names and ingredients cannot invent classifications');
 assert.deepEqual(labels(record({category:'Family favourite'})),['Family favourite']);
});

test('explicit classifications produce benefits, and false flags override their declared category',()=>{
 assert.deepEqual(labels(record({kidFriendly:true,highProtein:true})),['Kid-friendly','High protein']);
 assert.deepEqual(labels(record({collections:['Kid Friendly','High Protein']})),['Kid-friendly','High protein']);
 assert.deepEqual(labels(record({expansionGroup:'kid-friendly'})),['Kid-friendly']);
 assert.deepEqual(labels(record({category:'Kid-friendly · High protein · Batch cook',kidFriendly:false,highProtein:false,batchCook:false})),[]);
 assert.deepEqual(labels(record({category:'Batch cook',batchFriendly:false})),[]);
});

test('the quick label includes exactly thirty minutes and respects explicit prep plus cook times',()=>{
 assert.deepEqual(labels(record({mins:30})),['30 mins or less']);
 assert.deepEqual(labels(record({mins:31})),[]);
 assert.deepEqual(labels(record({mins:0})),[]);
 assert.deepEqual(labels(record({mins:80,prep_mins:10,cook_mins:20})),['30 mins or less']);
 assert.deepEqual(labels(record({mins:20,prep_mins:15,cook_mins:20})),[]);
});

test('batch benefits require a loaded unlocked conservative match and suppress excluded dishes',()=>{
 const batch=record({name:'Vegetable stew',category:'Batch cook'});
 assert.deepEqual(labels(batch),['Batch-cook option']);
 for(const recipe of [{...batch,ingredients:[]},{...batch,method:[]},{...batch,privatePreview:true},{...batch,previewOnly:true},{...batch,placeholder:true}])assert.deepEqual(labels(recipe),[]);
 assert.deepEqual(labels(batch,true),[]);
 assert.deepEqual(labels({...batch,locked:true}),[]);
 assert.deepEqual(labels({...batch,name:'Fish stew'}),[]);
});

test('canonical cooking tags wrap into at most three escaped badges without copying user text',()=>{
 assert.deepEqual(labels(record({tag:'ONE-PAN',mins:25,category:'Family favourite'})),['30 mins or less','One-pan','Family favourite']);
 const all=record({kidFriendly:true,highProtein:true,category:'Batch cook · Family favourite',mins:20});
 assert.deepEqual(labels(all),['Kid-friendly','High protein','Batch-cook option']);
 const markup=context.bbDiscoverBenefitsHTML(record({category:'<img src=x onerror=alert(1)> One pot',mins:45}));
 assert.match(markup,/bb-discover-benefit/);assert.match(markup,/One-pot/);assert.doesNotMatch(markup,/<img|onerror|alert/);
 assert.equal(context.bbDiscoverBenefitsHTML(record()),'');
});

test('actual Free catalogue badges reflect its declared classifications without universal suitability claims',()=>{
 const recipes=JSON.parse(fs.readFileSync(new URL('../recipes.json',import.meta.url),'utf8'));
 const results=recipes.map(recipe=>labels(recipe));
 assert.equal(results.filter(values=>values.includes('Kid-friendly')).length,0);
 assert.equal(results.filter(values=>values.includes('High protein')).length,4);
 assert.ok(results.some(values=>values.includes('Batch-cook option')));
 assert.ok(results.every(values=>values.length<=3));
});
