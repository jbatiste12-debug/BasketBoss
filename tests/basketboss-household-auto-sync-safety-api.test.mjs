import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ACTOR='11111111-1111-4111-8111-111111111111',HOUSE='33333333-3333-4333-8333-333333333333',OTHER='44444444-4444-4444-8444-444444444444';
const OPERATION='55555555-5555-4555-8555-555555555555';
const ORIGIN='https://basketboss.co.uk',PREFIX='__bb_sync_v2:';
const clone=value=>JSON.parse(JSON.stringify(value));
globalThis.__bbAutoSyncSafetyFixture={
 livePaidBillingEnabled:()=>true,testFlightBetaEnabled:()=>false,readPersonalPaidAccess:async env=>({premiumAccess:env.fixturePremium!==false}),
 json:(body,status=200)=>Response.json(body,{status}),authenticatedUser:async(_request,env)=>env.fixtureActor===null?null:{id:ACTOR,email:'fixture@example.invalid'},
 isLive:()=>true,expectedPrice:()=>true,entitlementForStatus:()=>true,requireSameOrigin:request=>request.headers.get('Origin')===ORIGIN,
 isNewestVerifiedSession:async(_request,env)=>env.fixtureSession!==false
};
const original=fs.readFileSync(new URL('../functions/api/household/index.js',import.meta.url),'utf8');
const source=original
 .replace(/import \{([^\n]+)\} from '\.\.\/\.\.\/\.\.\/bb-server-lib\/(?:bb-paid-access|bb-billing|bb-premium-seat)\.js';/g,'const {$1}=globalThis.__bbAutoSyncSafetyFixture;')
 .replace("'../receipt-inventory.js'",JSON.stringify(new URL('../functions/api/receipt-inventory.js',import.meta.url).href))
 .replace(/(['"])\.\.\/\.\.\/\.\.\/bb-server-lib\/([^'"]+)\1/g,(_match,quote,file)=>quote+new URL('../bb-server-lib/'+file,import.meta.url).href+quote);
assert.ok(!source.includes(" from '../../../bb-server-lib/"));
const api=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const env=(extra={})=>({CF_PAGES_BRANCH:'main',BB_PARTNER_SHARING_ENABLED:'true',BB_PARTNER_PRODUCTION_READY:'true',BB_PREMIUM_SINGLE_SESSION_ENABLED:'true',BB_LIVE_WEBHOOK_ENABLED:'true',SUPABASE_URL:'https://kbhyosxuvlcazyzzinqv.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public_fixture_'+'p'.repeat(30),SUPABASE_SECRET_KEY:'sb_secret_fixture_'+'s'.repeat(40),BILLING_DB:{prepare(){}},fixturePremium:true,...extra});
const request=(body,mode='entries',origin=ORIGIN)=>new Request(ORIGIN+'/api/household'+(body?'':'?mode='+mode),{method:body?'POST':'GET',headers:{Authorization:'Bearer synthetic-token',...(body?{Origin:origin,'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});

// Interpret PostgREST's boolean filter syntax in a synthetic data service. This
// makes the limit test exercise filtering before limiting, as the real service
// does, instead of letting a fixture return already-filtered convenient rows.
function splitTerms(value){
 const terms=[];let depth=0,start=0;
 for(let i=0;i<value.length;i++){if(value[i]==='(')depth++;if(value[i]===')')depth--;if(value[i]===','&&depth===0){terms.push(value.slice(start,i));start=i+1;}}
 terms.push(value.slice(start));return terms;
}
function likePattern(value){
 let result='^';
 for(let i=0;i<value.length;i++){
  const char=value[i];
  if(char==='\\'&&i+1<value.length)result+=value[++i].replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  else if(char==='*'||char==='%')result+='.*';
  else if(char==='_')result+='.';
  else result+=char.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 }
 return new RegExp(result+'$');
}
function expression(row,term){
 const group=term.match(/^(and|or)\((.*)\)$/);if(group){const results=splitTerms(group[2]).map(part=>expression(row,part));return group[1]==='and'?results.every(Boolean):results.some(Boolean);}
 const match=term.match(/^([a-z_]+)\.(not\.)?(eq|neq|like)\.(.*)$/);assert.ok(match,'unsupported synthetic filter: '+term);
 const [,field,negated,operator,expected]=match,actual=String(row[field]);
 let result=operator==='eq'?actual===expected:operator==='neq'?actual!==expected:likePattern(expected).test(actual);
 return negated?!result:result;
}
function matchesQuery(row,query){
 for(const [field,value] of query){
  if(['select','order','limit'].includes(field))continue;
  if(field==='and'||field==='or'){if(!expression(row,field+value))return false;}
  else if(!expression(row,field+'.'+value))return false;
 }
 return true;
}
function fixture({rows=[],filterUpstream=true,household=true}={}){
 const saved=globalThis.fetch,calls=[];
 globalThis.fetch=async(address,init={})=>{
  const url=new URL(address),body=init.body?JSON.parse(init.body):null;calls.push({url,body,method:init.method||'GET'});
  if(url.pathname.endsWith('/bb_households'))return Response.json(household&&url.searchParams.has('owner_user_id')?[{id:HOUSE,owner_user_id:ACTOR,partner_user_id:null,invite_status:'pending'}]:[]);
  if(url.pathname.endsWith('/bb_household_invites'))return Response.json([]);
  if(url.pathname.endsWith('/bb_household_entries')){
   const filtered=filterUpstream?rows.filter(row=>matchesQuery(row,url.searchParams)):rows;
   return Response.json(clone(filtered.slice(0,Number(url.searchParams.get('limit')||1000))));
  }
  if(url.pathname.endsWith('/rpc/bb_hh_service_patch'))return Response.json({ok:true,revision:body.p_expected+1});
  throw Error('Unexpected synthetic safety request: '+url.pathname);
 };
 return {calls,restore:()=>{globalThis.fetch=saved;},writes:()=>calls.filter(call=>call.method!=='GET')};
}
const entry=(section,key,value={marker:'private'},revision=1)=>({household_id:HOUSE,section,entry_key:key,value,revision});

test('generic patches reject the private synchronization namespace before calling any write RPC',async()=>{
 for(const section of ['kitchen_item','pantry_item','planned_day','servings','shopping_checked','budget_target','household_servings'])for(const suffix of ['clock','op:11111111-1111-4111-8111-111111111111','target:dinner:Monday']){
  const f=fixture();try{
   const response=await api.onRequestPost({request:request({action:'patch',section,key:PREFIX+suffix,value:{deleted:true},expected:0}),env:env()});
   assert.equal(response.status,400,section+' '+suffix);assert.deepEqual(f.writes(),[]);
  }finally{f.restore();}
 }
});

test('legacy reads filter more than 1,000 synchronization metadata rows before their data limit',async()=>{
 const metadata=Array.from({length:1100},(_,i)=>entry('kitchen_item',PREFIX+'op:'+String(i).padStart(5,'0')));
 const ordinary=Array.from({length:999},(_,i)=>entry('kitchen_item','cupboard|food-'+i,{name:'food-'+i,qty:i,unit:'g'}));
 const f=fixture({rows:[...metadata,...ordinary]});try{
  const response=await api.onRequestGet({request:request(),env:env()});assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.household_id,HOUSE);assert.deepEqual(data.entries,ordinary);
  const query=f.calls.find(call=>call.url.pathname.endsWith('/bb_household_entries')).url.searchParams;
  assert.equal(query.get('limit'),'1000');assert.equal(metadata.filter(row=>matchesQuery(row,query)).length,0);
 }finally{f.restore();}
});

test('a household containing only private metadata returns an empty legacy snapshot',async()=>{
 const f=fixture({rows:Array.from({length:1100},(_,i)=>entry('kitchen_item',PREFIX+'op:'+i))});try{
  const response=await api.onRequestGet({request:request(),env:env()});assert.equal(response.status,200);assert.deepEqual((await response.json()).entries,[]);
 }finally{f.restore();}
});

test('metadata prefix filters preserve ordinary Kitchen keys that only resemble SQL LIKE wildcard matches',async()=>{
 const ordinary=entry('kitchen_item','aabbXsyncYv2:family-food',{name:'Family food',qty:2,unit:'each'});
 const f=fixture({rows:[entry('kitchen_item',PREFIX+'clock'),ordinary]});try{
  const response=await api.onRequestGet({request:request(),env:env()});assert.equal(response.status,200);assert.deepEqual((await response.json()).entries,[ordinary]);
 }finally{f.restore();}
});

test('legacy output also drops reserved metadata if an upstream service returns it despite the filter',async()=>{
 const ordinary=entry('kitchen_item','cupboard|rice',{name:'rice',qty:250,unit:'g'});
 const f=fixture({filterUpstream:false,rows:[entry('kitchen_item',PREFIX+'clock'),entry('kitchen_item','pantry-pack-v1:cupboard:metadata'),ordinary]});try{
  const response=await api.onRequestGet({request:request(),env:env()});assert.equal(response.status,200);assert.deepEqual((await response.json()).entries,[ordinary]);
 }finally{f.restore();}
});

test('ordinary data still fails closed at the legacy snapshot limit',async()=>{
 const f=fixture({rows:Array.from({length:1000},(_,i)=>entry('shopping_checked','food-'+i,true))});try{
  const response=await api.onRequestGet({request:request(),env:env()});assert.equal(response.status,409);assert.equal((await response.json()).entries,undefined);assert.deepEqual(f.writes(),[]);
 }finally{f.restore();}
});

test('ordinary kitchen patches retain their established contract outside the private namespace',async()=>{
 const f=fixture();try{
  const body={action:'patch',section:'kitchen_item',key:'cupboard|rice',value:{name:'rice',qty:250,unit:'g'},expected:2};
  const response=await api.onRequestPost({request:request(body),env:env()});assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,revision:3});
  assert.deepEqual(f.writes()[0].body,{p_actor:ACTOR,p_household:HOUSE,p_section:body.section,p_key:body.key,p_value:body.value,p_expected:2});
 }finally{f.restore();}
});

test('legacy reads keep verified actor, current-session and owner Premium gates',async()=>{
 for(const overrides of [{fixtureActor:null},{fixtureSession:false},{fixturePremium:false}]){
  const f=fixture();try{const response=await api.onRequestGet({request:request(),env:env(overrides)});assert.equal(response.status,overrides.fixtureActor===null?401:403);assert.equal(f.calls.some(call=>call.url.pathname.endsWith('/bb_household_entries')),false);assert.deepEqual(f.writes(),[]);}finally{f.restore();}
 }
});

test('new synchronization reads and writes retain verified account, current-session and owner Premium gates',async()=>{
 const body={action:'sync_reserve',expectedHouseholdId:HOUSE,operationId:OPERATION,baseClock:0,target:{kind:'dinner',key:'Monday'},value:{recipeId:'shared-dinner',servings:4}};
 for(const overrides of [{fixtureActor:null},{fixtureSession:false},{fixturePremium:false}])for(const method of ['GET','POST']){
  const f=fixture();try{
   const response=method==='GET'?await api.onRequestGet({request:request(null,'auto_sync'),env:env(overrides)}):await api.onRequestPost({request:request(body),env:env(overrides)});
   assert.equal(response.status,overrides.fixtureActor===null?401:403);assert.deepEqual(f.writes(),[]);
  }finally{f.restore();}
 }
});

test('new synchronization requests cannot reach a write RPC without the same-origin guard',async()=>{
 for(const body of [
  {action:'sync_reserve',expectedHouseholdId:HOUSE,operationId:OPERATION,baseClock:0,target:{kind:'dinner',key:'Monday'},value:{recipeId:'shared-dinner',servings:4}},
  {action:'sync_apply',expectedHouseholdId:HOUSE,operationId:OPERATION,order:1}
 ]){
  const f=fixture();try{const response=await api.onRequestPost({request:request(body,'entries','https://untrusted.example'),env:env()});assert.equal(response.status,403);assert.deepEqual(f.writes(),[]);}finally{f.restore();}
 }
});

test('new synchronization operations reject a changed household before any mutation',async()=>{
 for(const action of ['sync_reserve','sync_apply'])for(const expectedHouseholdId of [OTHER,undefined,'not-a-household']){
  const body=action==='sync_reserve'?{action,expectedHouseholdId,operationId:OPERATION,baseClock:0,target:{kind:'dinner',key:'Monday'},value:{recipeId:'shared-dinner',servings:4}}:{action,expectedHouseholdId,operationId:OPERATION,order:1};
  const f=fixture();try{const response=await api.onRequestPost({request:request(body),env:env()});assert.equal(response.status,expectedHouseholdId===OTHER?409:400);assert.deepEqual(f.writes(),[]);}finally{f.restore();}
 }
});

test('new synchronization operations cannot be used by an unlinked account',async()=>{
 const f=fixture({household:false});try{
  assert.equal((await api.onRequestGet({request:request(null,'auto_sync'),env:env()})).status,403);
  assert.equal((await api.onRequestPost({request:request({action:'sync_apply',expectedHouseholdId:HOUSE,operationId:OPERATION,order:1}),env:env()})).status,403);
  assert.deepEqual(f.writes(),[]);
 }finally{f.restore();}
});
