import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
let authenticated={id:'owner'},billingEnabled=false;
let reads=0;
globalThis.__bbCatalogueTest={
 json:(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}}),
 authenticatedUser:async()=>authenticated,isBillingEnabled:()=>billingEnabled,isConfigured:()=>true,
 expectedPrice:()=>null,entitlementForStatus:()=>false,sharedHouseholdPremiumOwner:async()=>false
};
let source=fs.readFileSync('functions/api/recipes/premium.js','utf8');
source=source.replace(/^import \{([^}]+)\} from '[^']+';$/gm,(_,names)=>`const {${names}}=globalThis.__bbCatalogueTest;`);
const api=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const rows=count=>Array.from({length:count},(_,i)=>({recipe_json:JSON.stringify({id:'premium-'+i}),normalized_json:JSON.stringify({id:'premium-'+i})}));
const versionRows=count=>rows(count).map((row,i)=>({...row,recipe_id:'premium-'+i,sort_index:i}));
const context=(data,query='',optional='missing')=>{
 const queries=[];
 return {request:new Request('https://basketboss.example/api/recipes/premium'+query),queries,env:{BB_OWNER_USER_ID:'owner',BILLING_DB:{prepare:sql=>({
  bind:()=>({first:async()=>null}),all:async()=>{
   reads++;queries.push(sql);
   if(sql.includes('bb_private_premium_recipes_500_v1')){
    if(optional==='missing')throw Error('D1_ERROR: no such table: bb_private_premium_recipes_500_v1: SQLITE_ERROR');
    if(optional instanceof Error)throw optional;
    return optional?.rawResponse??{results:optional};
   }
   return {results:data};
  }
 })}}};
};
test('legacy and expanded clients negotiate complete authenticated releases',async()=>{
 for(const databaseCount of [221,400])for(const [query,requested]of [['',221],['?catalogue=500',400],['?catalogue=499',221]]){
  const count=Math.min(databaseCount,requested),response=await api.onRequestGet(context(rows(databaseCount),query));
  assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.count,count);assert.equal(body.total,100+count);assert.equal(body.targetTotal,500);
  assert.equal(new Set(body.recipes.map(r=>r.id)).size,count);
  assert.deepEqual(body.recipes.map(r=>r.id),Array.from({length:count},(_,i)=>'premium-'+i));
  assert.deepEqual(body.normalized.map(r=>r.id),body.recipes.map(r=>r.id));
 }
});
test('partial or arbitrary catalogue sizes fail closed during rollout',async()=>{
 for(const count of [0,220,222,224,399,401])assert.equal((await api.onRequestGet(context(rows(count)))).status,503);
});
test('expanded catalogue rejects duplicate IDs and mismatched normalized records',async()=>{
 let data=rows(400);data[399]=data[0];assert.equal((await api.onRequestGet(context(data))).status,503);
 data=rows(400);data[399].normalized_json=JSON.stringify({id:'wrong-slug'});assert.equal((await api.onRequestGet(context(data))).status,503);
 data=rows(400);data[399].recipe_json=JSON.stringify({id:400});assert.equal((await api.onRequestGet(context(data))).status,503);
});
test('unauthenticated requests never read private recipes',async()=>{
 const previous=reads;authenticated=null;
 try{for(const query of ['', '?catalogue=500'])assert.equal((await api.onRequestGet(context(rows(400),query,versionRows(400)))).status,401);assert.equal(reads,previous);}finally{authenticated={id:'owner'};}
});

test('both new recipe clients explicitly request the expanded catalogue',()=>{
 for(const file of ['index.html','app.html','make-a-meal.js'])assert.match(fs.readFileSync(file,'utf8'),/fetch\('\/api\/recipes\/premium\?catalogue=500'/,file);
});

test('the expanded opt-in never grants access to an unentitled signed-in user',async()=>{
 const before=reads;authenticated={id:'not-entitled'};
 try{
  for(const query of ['', '?catalogue=500']){
   billingEnabled=false;assert.equal((await api.onRequestGet(context(rows(400),query,versionRows(400)))).status,503);
   billingEnabled=true;assert.equal((await api.onRequestGet(context(rows(400),query,versionRows(400)))).status,403);
  }
  assert.equal(reads,before,'private catalogue is never queried for rejected users');
 }finally{authenticated={id:'owner'};billingEnabled=false;}
});

test('new clients prefer a complete versioned table without reading the legacy table',async()=>{
 const data=versionRows(400);data[0].recipe_json=JSON.stringify({id:'premium-0',name:'Versioned release'});
 const ctx=context(rows(221),'?catalogue=500',data),response=await api.onRequestGet(ctx);
 assert.equal(response.status,200);const body=await response.json();
 assert.equal(body.count,400);assert.equal(body.recipes[0].name,'Versioned release');
 assert.equal(ctx.queries.length,1);assert.match(ctx.queries[0],/bb_private_premium_recipes_500_v1/);
});
test('legacy clients never query the optional table, even when it is invalid',async()=>{
 for(const optional of [versionRows(400),versionRows(12),new Error('database permission failure')]){
  const ctx=context(rows(221),'',optional),response=await api.onRequestGet(ctx);
  assert.equal(response.status,200);assert.equal((await response.json()).count,221);
  assert.equal(ctx.queries.length,1);assert.doesNotMatch(ctx.queries[0],/_500_v1/);
 }
});
test('only absent or empty versioned tables permit a legacy-table fallback',async()=>{
 for(const optional of ['missing',[]])for(const legacyCount of [221,400]){
  const ctx=context(rows(legacyCount),'?catalogue=500',optional),response=await api.onRequestGet(ctx);
  assert.equal(response.status,200);assert.equal((await response.json()).count,legacyCount);assert.equal(ctx.queries.length,2);
 }
 for(const optional of [versionRows(1),versionRows(221),versionRows(399),versionRows(401),{rawResponse:{}},new Error('D1 unavailable'),new Error('no such table: unrelated'),new Error('no such table: bb_private_premium_recipes_500_v1_extra')]){
  const ctx=context(rows(221),'?catalogue=500',optional),response=await api.onRequestGet(ctx);
  assert.equal(response.status,503);assert.equal(ctx.queries.length,1,'partial/invalid/query errors cannot fall back to older data');
 }
});
test('versioned rows validate identity, indexes, JSON and normalized alignment before delivery',async()=>{
 const invalid=[];
 for(const edit of [
  data=>{data[399]=data[0];},data=>{data[399].recipe_id='wrong-id';},
  data=>{data[399].sort_index=500;},data=>{data[399].sort_index='399';},
  data=>{data[399].normalized_json=JSON.stringify({id:'other'});},data=>{data[399].recipe_json='not-json';}
 ]){const data=versionRows(400);edit(data);invalid.push(data);}
 for(const data of invalid){const ctx=context(rows(221),'?catalogue=500',data);assert.equal((await api.onRequestGet(ctx)).status,503);assert.equal(ctx.queries.length,1);}
});
