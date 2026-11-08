import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {assembleCatalogue700,catalogue700Metadata,catalogue700UpsertSql,canonicalHash,private700OutputDirectory,TABLE700,RELEASE_TABLE700} from '../tools/catalogue700/release.mjs';

function recipe(id,number,accessTier){
 const value={id,name:"Chef's "+id,ingredients:[['Rice','100 g',1,'Grains']],servings:4,baseServings:4};
 if(!number)return value;
 Object.assign(value,{slug:id,catalogueNumber:number,accessTier,premium:accessTier==='premium',method:['Prepare and measure the ingredients.','Cook until properly done and tender.','Divide equally between four plates.'],image:`release-assets/basketboss-v17/images/new/${id}.webp`,cost:4,mins:30,ci_estimates:Object.fromEntries(['UK','Guernsey','Jersey','US'].map(key=>[key,{estimate:4,confidence:'INDICATIVE_UNVERIFIED'}]))});
 value.steps=[...value.method];return value;
}
function normalized(r){return {id:r.id,name:r.name,servings:r.servings,ingredients:r.ingredients.map((row,index)=>({name:row[0],recipe_id:r.id,ingredient_index:index,key:'rice',quantity:100,unit:'g'}))};}
function inputs(){
 const freeRecipes=Array.from({length:100},(_,i)=>recipe('free-'+i)),freeNormalized=freeRecipes.map(normalized);
 const privateRows=Array.from({length:400},(_,index)=>{const r=recipe('premium-'+index);return {recipe_id:r.id,sort_index:index,recipe_json:JSON.stringify(r),normalized_json:JSON.stringify(normalized(r))};});
 const additions=Array.from({length:200},(_,index)=>recipe('addition-'+(501+index),501+index,index%2?'premium':'free'));
 return {freeRecipes,freeNormalized,privateRows,additions,additionNormalized:additions.map(normalized),protectedHashes:{privateRows:canonicalHash(privateRows),freeRecipes:canonicalHash(freeRecipes),freeNormalized:canonicalHash(freeNormalized)}};
}
const releaseId='catalogue700-test-release';
function fileImport(db,sql){db.exec('BEGIN');try{db.exec(sql);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
function seed(db,data){
 db.exec('CREATE TABLE bb_private_premium_recipes_500_v1(recipe_id TEXT PRIMARY KEY,sort_index INTEGER UNIQUE,recipe_json TEXT,normalized_json TEXT); CREATE TABLE bb_private_premium_recipes(legacy TEXT); INSERT INTO bb_private_premium_recipes VALUES (\'unchanged\');');
 const statement=db.prepare('INSERT INTO bb_private_premium_recipes_500_v1 VALUES (?,?,?,?)');
 for(const row of data.privateRows)statement.run(row.recipe_id,row.sort_index,row.recipe_json,row.normalized_json);
}
function storedRows(db){return db.prepare(`SELECT recipe_id,sort_index,recipe_json,normalized_json FROM ${TABLE700} ORDER BY sort_index`).all().map(row=>({...row}));}

test('700 assembly preserves every old object and row string while appending exact new tiers',()=>{
 const data=inputs(),before=JSON.stringify(data),bundle=assembleCatalogue700(data);
 assert.equal(JSON.stringify(data),before);assert.equal(bundle.catalogue.length,700);assert.equal(bundle.normalized.length,700);
 assert.equal(bundle.free.length,200);assert.equal(bundle.premiumRows.length,500);assert.equal(bundle.activationEligible,false);
 assert.deepEqual(bundle.free.slice(0,100),data.freeRecipes);assert.deepEqual(bundle.freeNormalized.slice(0,100),data.freeNormalized);
 assert.deepEqual(bundle.premiumRows.slice(0,400),data.privateRows);assert.equal(new Set(bundle.catalogue.map(row=>row.id)).size,700);
 assert.deepEqual(bundle.premiumRows.slice(400).map(row=>JSON.parse(row.recipe_json).catalogueNumber),Array.from({length:100},(_,i)=>502+i*2));
});
test('700 assembly fails closed for changed baselines, missing rows, ID/number collisions and positional drift',()=>{
 const edits=[
  data=>{data.freeRecipes[0].name='changed';},data=>{data.privateRows[0].recipe_json+=' ';},
  data=>{data.additions.pop();},data=>{data.additionNormalized.pop();},
  data=>{data.additions[199].catalogueNumber=699;},data=>{data.additions[199].id=data.additions[0].id;},
  data=>{data.additions[0].id=data.freeRecipes[0].id;},data=>{data.additions[0].accessTier='premium';data.additions[0].premium=true;},
  data=>{data.additionNormalized[0].ingredients[0].ingredient_index=2;},data=>{data.additionNormalized[0].ingredients=[];},
  data=>{data.additions[0].method[0]='Incomplete';},data=>{data.additions[0].image='https://external.test/wrong.jpg';}
 ];
 for(const edit of edits){const data=inputs();edit(data);assert.throws(()=>assembleCatalogue700(data));}
});
test('700 UPSERT is exact, idempotent and never writes the legacy tables',()=>{
 const data=inputs(),bundle=assembleCatalogue700(data),sql=catalogue700UpsertSql(bundle,{releaseId}),db=new DatabaseSync(':memory:');
 try{
  seed(db,data);const legacyBefore=db.prepare('SELECT * FROM bb_private_premium_recipes_500_v1 ORDER BY sort_index').all();
  assert.doesNotMatch(sql,/^(?:DELETE|REPLACE|UPDATE bb_private_premium_recipes_500_v1|INSERT INTO bb_private_premium_recipes_500_v1)/m);
  assert.equal((sql.match(/ON CONFLICT\(recipe_id\) DO NOTHING/g)||[]).length,400);
  assert.equal((sql.match(/ON CONFLICT\(recipe_id\) DO UPDATE/g)||[]).length,100);
  fileImport(db,sql);fileImport(db,sql);assert.deepEqual(storedRows(db),bundle.premiumRows);
  assert.deepEqual(db.prepare('SELECT * FROM bb_private_premium_recipes_500_v1 ORDER BY sort_index').all(),legacyBefore);
  assert.equal(db.prepare('SELECT legacy FROM bb_private_premium_recipes').get().legacy,'unchanged');
  assert.deepEqual({...db.prepare(`SELECT * FROM ${RELEASE_TABLE700}`).get()},catalogue700Metadata(bundle,{releaseId}));
 }finally{db.close();}
});
test('700 UPSERT can update new records but refuses to alter protected old records',()=>{
 const data=inputs(),db=new DatabaseSync(':memory:');
 try{
  seed(db,data);const original=assembleCatalogue700(data);fileImport(db,catalogue700UpsertSql(original,{releaseId}));
  data.additions[1].name='Updated new recipe';data.additionNormalized[1].name='Updated new recipe';
  const next=assembleCatalogue700(data);fileImport(db,catalogue700UpsertSql(next,{releaseId:'next-release'}));
  assert.match(storedRows(db)[400].recipe_json,/Updated new recipe/);
  db.prepare(`UPDATE ${TABLE700} SET recipe_json=? WHERE sort_index=0`).run(JSON.stringify({id:'premium-0',name:'tampered'}));
  const tampered=storedRows(db);assert.throws(()=>fileImport(db,catalogue700UpsertSql(next,{releaseId})),/overflow/);
  assert.deepEqual(storedRows(db),tampered,'failure never overwrites a protected new-table copy');
  assert.equal(db.prepare(`SELECT release_id FROM ${RELEASE_TABLE700}`).get().release_id,'next-release');
 }finally{db.close();}
});
test('700 failed imports roll back all new rows and metadata on source mismatch or late insert failure',()=>{
 for(const failure of ['source-mismatch','last-insert']){
  const data=inputs(),db=new DatabaseSync(':memory:');
  try{
   seed(db,data);const bundle=assembleCatalogue700(data);
   if(failure==='source-mismatch')db.exec("UPDATE bb_private_premium_recipes_500_v1 SET recipe_json='changed' WHERE sort_index=0");
   else{
    fileImport(db,catalogue700UpsertSql(bundle,{releaseId}));
    db.exec(`CREATE TRIGGER reject_last BEFORE INSERT ON ${TABLE700} WHEN NEW.sort_index=499 BEGIN SELECT RAISE(ABORT,'late failure'); END;`);
   }
   const before=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
   const rows=failure==='last-insert'?storedRows(db):null;
   assert.throws(()=>fileImport(db,catalogue700UpsertSql(bundle,{releaseId:'rejected'})));
   assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),before);
   if(rows){assert.deepEqual(storedRows(db),rows);assert.equal(db.prepare(`SELECT release_id FROM ${RELEASE_TABLE700}`).get().release_id,releaseId);}
  }finally{db.close();}
 }
});
test('700 private output rejects paths and symlinks under the public checkout',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bb700-output-'));
 try{
  const root=path.join(temp,'public');fs.mkdirSync(root);assert.throws(()=>private700OutputDirectory(path.join(root,'new'),root));
  const alias=path.join(temp,'alias');fs.symlinkSync(root,alias,'dir');assert.throws(()=>private700OutputDirectory(path.join(alias,'nested'),root));
  const outside=path.join(temp,'private','nested');assert.equal(private700OutputDirectory(outside,root),fs.realpathSync(outside));
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

function apiHarness(){
 let authenticated={id:'owner'},premium=false,billing=false,configured=true;
 const data=inputs(),bundle=assembleCatalogue700(data),metadata=catalogue700Metadata(bundle,{releaseId});
 const state={rows:bundle.premiumRows,metadata,queries:[],error:null,raw:false};
 const helpers={json:(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Authorization'}}),authenticatedUser:async()=>authenticated,isConfigured:()=>configured,digestHex:async value=>createHash('sha256').update(value).digest('hex'),paidBillingEnabled:()=>billing,readMemberPaidAccess:async()=>({premiumAccess:premium})};
 // CI uses synthetic recipes rather than disclosing the protected catalogue.
 // Replace only the protected data hash in this in-memory route fixture.
 const source=fs.readFileSync(new URL('../functions/api/recipes/v700/premium.js',import.meta.url),'utf8').replace(/const PROTECTED_ROWS_SHA256='[a-f0-9]{64}';/,`const PROTECTED_ROWS_SHA256='${metadata.protected_rows_sha256}';`).replace(/^import \{([^}]+)\} from '[^']+';$/gm,(_,names)=>`const {${names}}=helpers;`).replace(/^export /gm,'');
 const api=new Function('helpers',source+'\nreturn {onRequestGet,onRequestPost};')(helpers);
 const env={BB_CATALOGUE700_ENABLED:'true',BB_CATALOGUE700_RELEASE_ID:releaseId,BB_CATALOGUE700_ROWS_SHA256:metadata.premium_rows_sha256,BB_CATALOGUE700_FREE_SHA256:metadata.free_recipes_sha256,BB_CATALOGUE700_NORMALIZED_SHA256:metadata.free_normalized_sha256,BB_OWNER_USER_ID:'owner',BILLING_DB:{prepare(sql){state.queries.push(sql);return {bind(version){assert.equal(version,700);return {first:async()=>{if(state.error)throw state.error;return state.metadata;}};},all:async()=>{if(state.error)throw state.error;return state.raw?{}:{results:state.rows};}};}}};
 return {state,env,api,request:query=>new Request('https://basketboss.example/api/recipes/v700/premium'+(query??'?catalogue=700')),user:value=>{authenticated=value;},premium:value=>{premium=value;},billing:value=>{billing=value;},configured:value=>{configured=value;}};
}
test('700 route is unavailable by default and requires explicit exact opt-in and release pins',async()=>{
 const h=apiHarness();
 for(const query of ['', '?catalogue=500','?catalogue=701','?catalogue=700&catalogue=700','?catalogue=700&other=true'])assert.equal((await h.api.onRequestGet({request:h.request(query),env:h.env})).status,400);
 for(const key of ['BB_CATALOGUE700_ENABLED','BB_CATALOGUE700_RELEASE_ID','BB_CATALOGUE700_ROWS_SHA256','BB_CATALOGUE700_FREE_SHA256','BB_CATALOGUE700_NORMALIZED_SHA256']){
  const env={...h.env};delete env[key];assert.equal((await h.api.onRequestGet({request:h.request(),env})).status,503);
 }
 assert.equal(h.state.queries.length,0);
});
test('700 route authenticates and checks server-owned Premium before querying any private row',async()=>{
 const h=apiHarness();h.user(null);assert.equal((await h.api.onRequestGet({request:h.request(),env:h.env})).status,401);
 h.user({id:'member'});assert.equal((await h.api.onRequestGet({request:h.request(),env:h.env})).status,503);
 h.billing(true);assert.equal((await h.api.onRequestGet({request:h.request(),env:h.env})).status,403);assert.equal(h.state.queries.length,0);
 h.premium(true);assert.equal((await h.api.onRequestGet({request:h.request(),env:h.env})).status,200);
});
test('700 route returns exact complete500Premium response with matching Free hashes and no legacy-table query',async()=>{
 const h=apiHarness(),response=await h.api.onRequestGet({request:h.request(),env:h.env}),body=await response.json();
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('vary'),'Authorization');
 assert.deepEqual([body.catalogueVersion,body.count,body.total,body.targetTotal],[700,500,700,700]);assert.equal(body.recipes.length,500);assert.equal(body.normalized.length,500);
 assert.equal(body.freeRecipesSha256,h.env.BB_CATALOGUE700_FREE_SHA256);assert.equal(body.freeNormalizedSha256,h.env.BB_CATALOGUE700_NORMALIZED_SHA256);
 assert.equal(h.state.queries.length,2);assert.match(h.state.queries[0],/bb_recipe_catalogue_releases_v1/);assert.match(h.state.queries[1],/bb_private_premium_recipes_700_v1/);
 assert.equal(h.state.queries.some(sql=>/\bbb_private_premium_recipes(?:_500_v1)?\b/.test(sql)),false);
});
test('700 route rejects missing, partial, duplicate, tampered, misordered and malformed releases without fallback',async()=>{
 const edits=[
  h=>{h.state.metadata=null;},h=>{h.state.metadata.free_count=100;},h=>{h.state.metadata.premium_count=400;},
  h=>{h.state.metadata.protected_rows_sha256='0'.repeat(64);},
  h=>{h.state.metadata.release_id='other-release';},h=>{h.state.metadata.premium_rows_sha256='0'.repeat(64);},h=>{h.state.metadata.free_normalized_sha256='0'.repeat(64);},
  h=>{h.state.rows=h.state.rows.slice(0,499);},h=>{h.state.rows.push(h.state.rows[0]);},h=>{h.state.rows[499]=h.state.rows[0];},
  h=>{h.state.rows[499].sort_index='499';},h=>{h.state.rows[499].recipe_id='wrong-id';},
  h=>{h.state.rows[0].recipe_json+=' ';},h=>{h.state.rows[499].recipe_json='bad json';},h=>{h.state.rows[499].normalized_json=JSON.stringify({id:'wrong'});},
  h=>{h.state.raw=true;},h=>{h.state.error=Error('no such table: bb_private_premium_recipes_700_v1');},h=>{h.state.error=Error('permission failure');}
 ];
 for(const edit of edits){const h=apiHarness();edit(h);assert.equal((await h.api.onRequestGet({request:h.request(),env:h.env})).status,503);assert.ok(h.state.queries.length<=2);assert.equal(h.state.queries.some(sql=>/\bbb_private_premium_recipes(?:_500_v1)?\b/.test(sql)),false);}
});
test('700 route does not accept mutated rows even if the unpinned database digest is changed with them',async()=>{
 const h=apiHarness();h.state.rows[0].recipe_json+=' ';h.state.metadata.premium_rows_sha256=canonicalHash(h.state.rows);
 assert.equal((await h.api.onRequestGet({request:h.request(),env:h.env})).status,503);
 assert.equal(h.state.queries.length,1,'release pin rejects tampered metadata before reading rows');
});
test('700 route rejects protected-prefix changes even with a matching full release digest',async()=>{
 const h=apiHarness();h.state.rows[0].recipe_json+=' ';h.state.metadata.premium_rows_sha256=canonicalHash(h.state.rows);h.env.BB_CATALOGUE700_ROWS_SHA256=h.state.metadata.premium_rows_sha256;
 assert.equal((await h.api.onRequestGet({request:h.request(),env:h.env})).status,503);
});
test('legacy route remains byte-for-byte separate and new route refuses writes',()=>{
 const source=fs.readFileSync(new URL('../functions/api/recipes/premium.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/catalogue700|recipes_700|v700/);assert.match(source,/searchParams\.get\('catalogue'\)==='500'/);assert.match(source,/const count=expanded\?recipes.length:221/);
 const h=apiHarness();assert.equal(h.api.onRequestPost().status,405);assert.equal(h.state.queries.length,0);
});

function sessionHarness(){
 const state={user:{id:'owner'},gate:true,newest:true,failure:false,live:true,deleting:false,nextCalls:0};
 const helpers={authenticatedUser:async()=>state.user,json:(body,status=200)=>new Response(JSON.stringify(body),{status}),isLive:()=>state.live,livePaidBillingEnabled:()=>state.live,testFlightBetaEnabled:()=>false,seatGateEnabled:()=>state.gate,isNewestVerifiedSession:async()=>{if(state.failure)throw Error('seat check unavailable');return state.newest;},nativeCorsResponse:(_request,response)=>response,nativePreflightResponse:request=>request.method==='OPTIONS'?new Response(null,{status:204}):null,ensureDeletionSchema:async()=>{},isAccountDeleting:async()=>state.deleting,logCookDiagnostic:()=>{}};
 const source=fs.readFileSync(new URL('../functions/api/_middleware.js',import.meta.url),'utf8').replace(/^import \{([^}]+)\} from '[^']+';$/gm,(_,names)=>`const {${names}}=helpers;`).replace(/^export /gm,'');
 const api=new Function('helpers',source+'\nreturn {onRequest};')(helpers);
 const env={BILLING_DB:{},SUPABASE_URL:'https://kbhyosxuvlcazyzzinqv.supabase.co',CF_PAGES_BRANCH:'main'};
 const context=(extra={})=>({request:new Request('https://basketboss.co.uk/api/recipes/v700/premium?catalogue=700',{headers:{Authorization:'Bearer verified-token'}}),env,next:async()=>{state.nextCalls++;return new Response('next');},...extra});
 return {state,api,env,context};
}
test('700 route inherits existing current-device, configuration and deletion boundaries',async()=>{
 const h=sessionHarness();h.state.newest=false;assert.equal((await h.api.onRequest(h.context())).status,403);assert.equal(h.state.nextCalls,0);
 h.state.newest=true;h.state.failure=true;assert.equal((await h.api.onRequest(h.context())).status,503);assert.equal(h.state.nextCalls,0);
 h.state.failure=false;h.env.SUPABASE_URL='https://wrong-tenant.supabase.co';assert.equal((await h.api.onRequest(h.context())).status,503);assert.equal(h.state.nextCalls,0);
 h.env.SUPABASE_URL='https://kbhyosxuvlcazyzzinqv.supabase.co';h.state.deleting=true;assert.equal((await h.api.onRequest(h.context())).status,409);assert.equal(h.state.nextCalls,0);
 h.state.deleting=false;assert.equal((await h.api.onRequest(h.context())).status,200);assert.equal(h.state.nextCalls,1);
});
test('700 native preflight exposes no account or private data',async()=>{
 const h=sessionHarness();h.state.failure=true;
 const response=await h.api.onRequest(h.context({request:new Request('https://basketboss.co.uk/api/recipes/v700/premium?catalogue=700',{method:'OPTIONS'})}));
 assert.equal(response.status,204);assert.equal(h.state.nextCalls,0);
});
