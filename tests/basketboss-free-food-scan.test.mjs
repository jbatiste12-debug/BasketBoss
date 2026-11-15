import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {onRequest} from '../functions/api/bb173/[action].js';
import {digestDeletionActor} from '../bb-server-lib/bb-account-deletion.js';

const account='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const price='pri_'+'p'.repeat(26);
const photo={mimeType:'image/jpeg',imageBase64:Buffer.from([255,216,255,...Array(75).fill(4)]).toString('base64')};
const scanResult={items:[{name:'Carrot',estimatedQuantity:'unknown',confidence:'high',notes:'Visible food'}],caution:'Check the result.'};

function harness({paid=false,confirmed=true,challenge=true,globalCap=20,provider='ok',initialized=false}={}){
  const sqlite=new DatabaseSync(':memory:'),calls=[];
  sqlite.exec('CREATE TABLE bb_account_deletions(actor_hash TEXT PRIMARY KEY)');
  if(initialized)sqlite.exec('CREATE TABLE bb_ai_daily_usage(day_utc TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0 CHECK(used>=0),PRIMARY KEY(day_utc,actor,action))');
  const db={prepare(sql){
    calls.push({kind:'sql',sql});
    if(sql.includes('bb_paid_entitlements'))return {bind(){return {async first(){return paid?{status:'active',plan:'standard',price_id:price}:null;}};}};
    const prepared=sqlite.prepare(sql);
    return {bind(...args){return {async first(){return prepared.get(...args)||null;},async run(){return prepared.run(...args);}};},async run(){return prepared.run();}};
  }};
  const env={BB_BILLING_MODE:'live',BB_BILLING_ENABLED:'true',BB_PREMIUM_AI_ENABLED:'true',
    SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fixture-publishable',
    GEMINI_API_KEY:'fixture-provider',TURNSTILE_SITE_KEY:'fixture-site',TURNSTILE_SECRET_KEY:'fixture-challenge',
    PADDLE_LIVE_STANDARD_PRICE_ID:price,BB_AI_GLOBAL_DAILY_CAP:String(globalCap),BILLING_DB:db};
  const previous=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{
    const path=String(url);calls.push({kind:'fetch',path});
    if(path.endsWith('/auth/v1/user')){
      const token=options.headers?.Authorization;
      if(token==='Bearer invalid')return Response.json({error:'invalid'},{status:401});
      return Response.json({id:token==='Bearer second-account'?other:account,email:'synthetic@example.test',...(confirmed?{email_confirmed_at:'2026-11-15T00:00:00Z'}:{})});
    }
    if(path.includes('/siteverify'))return Response.json({success:challenge,action:'bb_ai',hostname:'basketboss.co.uk'});
    if(path.includes('generativelanguage.googleapis.com')){
      if(provider==='error')return Response.json({error:'private provider failure detail'},{status:503});
      if(provider==='network')throw Error('private network failure detail');
      return Response.json({candidates:[{content:{parts:[{text:provider==='invalid'?'invalid JSON':JSON.stringify(scanResult)}]}}]});
    }
    throw Error('Unexpected network destination');
  };
  async function request(action='scan',{body={},token='confirmed-account',origin='https://basketboss.co.uk'}={}){
    const method=action==='status'?'GET':'POST';
    const response=await onRequest({env,params:{action},request:new Request('https://basketboss.co.uk/api/bb173/'+action,{
      method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(method==='POST'?{Origin:origin,'Content-Type':'application/json'}:{})},
      ...(method==='POST'?{body:JSON.stringify({...photo,turnstileToken:'fixture-human-challenge',...body})}:{})
    })});
    return {status:response.status,body:await response.json()};
  }
  const count=(actor='user:'+account,action='food-scan-preview')=>{
    try{return sqlite.prepare('SELECT COALESCE(SUM(used),0) AS n FROM bb_ai_daily_usage WHERE actor=? AND action=?').get(actor,action).n;}catch{return 0;}
  };
  return {request,calls,env,sqlite,count,providerCalls:()=>calls.filter(row=>row.path?.includes('generativelanguage.googleapis.com')).length,
    close(){globalThis.fetch=previous;sqlite.close();}};
}
async function withHarness(options,run){const h=harness(options);try{await run(h);}finally{h.close();}}

test('confirmed free status offers two food scans without granting Premium or creating storage',async()=>withHarness({},async h=>{
  const state=await h.request('status');assert.equal(state.status,200);
  assert.equal(state.body.status,'available');assert.equal(state.body.premium_ai,false);
  assert.equal(state.body.food_scan_available,true);assert.equal(state.body.food_scan_preview,true);
  assert.equal(state.body.food_scan_remaining,2);assert.equal(state.body.food_scan_limit,2);assert.equal(state.body.turnstileRequired,true);
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='bb_ai_daily_usage'").get().n,0);
  assert.equal(h.providerCalls(),0);
}));

test('two free attempts survive new requests and exhaustion never becomes Premium',async()=>withHarness({},async h=>{
  for(const expected of [1,0]){
    const result=await h.request();assert.equal(result.status,200);assert.equal(result.body.reviewRequired,true);assert.deepEqual(result.body.scan,scanResult);
    const state=await h.request('status');assert.equal(state.body.food_scan_remaining,expected);assert.equal(state.body.premium_ai,false);
  }
  const exhausted=await h.request('status');assert.equal(exhausted.body.food_scan_available,false);assert.equal(exhausted.body.food_scan_preview,true);assert.equal(exhausted.body.status,'disabled');
  assert.equal((await h.request()).status,429);assert.equal(h.count(),2);assert.equal(h.providerCalls(),2);
  const stored=h.sqlite.prepare("SELECT day_utc FROM bb_ai_daily_usage WHERE actor=? AND action='food-scan-preview'").get('user:'+account);
  assert.equal(stored.day_utc,'lifetime');
}));

test('parallel third requests cannot exceed the lifetime allowance',async()=>withHarness({initialized:true},async h=>{
  const results=await Promise.all([h.request(),h.request(),h.request()]);
  assert.deepEqual(results.map(row=>row.status).sort(),[200,200,429]);assert.equal(h.count(),2);assert.equal(h.providerCalls(),2);
}));

test('the server owns account identity and allowances do not reset with a new browser request',async()=>withHarness({},async h=>{
  assert.equal((await h.request('scan',{body:{userId:other,premium:true,remaining:999}})).status,200);
  assert.equal(h.count(),1);assert.equal(h.count('user:'+other),0);
  assert.equal((await h.request('scan',{token:'second-account'})).status,200);
  assert.equal(h.count('user:'+other),1);
}));

test('invalid photos and failed human verification consume no free or global quota',async()=>{
  await withHarness({},async h=>{assert.equal((await h.request('scan',{body:{imageBase64:'bad'}})).status,400);assert.equal(h.count(),0);assert.equal(h.providerCalls(),0);});
  await withHarness({challenge:false},async h=>{assert.equal((await h.request()).status,403);assert.equal(h.count(),0);assert.equal(h.providerCalls(),0);});
});

test('free requests cannot use Live paid Turnstile fallback or cross-origin uploads',async()=>withHarness({},async h=>{
  assert.equal((await h.request('scan',{body:{turnstileToken:''}})).status,403);
  assert.equal((await h.request('scan',{origin:'https://unrelated.example'})).status,403);
  assert.equal(h.count(),0);assert.equal(h.providerCalls(),0);
}));

test('anonymous, invalid and unconfirmed accounts cannot use or discover an allowance',async()=>{
  for(const options of [{token:null},{token:'invalid'}])await withHarness({},async h=>{
    assert.equal((await h.request('scan',options)).status,403);
    const state=await h.request('status',options);assert.equal(state.body.food_scan_available,false);assert.equal(state.body.food_scan_preview,false);assert.equal(state.body.siteKey,null);
    assert.equal(h.count(),0);assert.equal(h.providerCalls(),0);
  });
  await withHarness({confirmed:false},async h=>{
    assert.equal((await h.request()).status,403);assert.equal((await h.request('status')).body.food_scan_available,false);assert.equal(h.count(),0);assert.equal(h.providerCalls(),0);
  });
});

test('receipt variants, AI generation and meal pictures remain Premium only',async()=>withHarness({},async h=>{
  for(const scanKind of ['receipt_inventory','receipt_prices','unknown']){
    const result=await h.request('scan',{body:{scanKind,expectedCurrency:'GBP',items:[{key:'carrot',name:'Carrot',packQuantity:100,unit:'g'}]}});
    assert.ok([400,403].includes(result.status));
  }
  assert.equal((await h.request('generate',{body:{ingredients:['Carrot'],mode:'only_have',servings:2}})).status,403);
  assert.equal((await h.request('meal-image',{body:{ticket:'x'.repeat(120)}})).status,403);
  assert.equal(h.count(),0);assert.equal(h.providerCalls(),0);
}));

test('daily global exhaustion does not spend the limited free attempt',async()=>withHarness({globalCap:1,initialized:true},async h=>{
  h.sqlite.prepare('INSERT INTO bb_ai_daily_usage VALUES (?,?,?,?)').run(new Date().toISOString().slice(0,10),'global','all',1);
  assert.equal((await h.request()).status,429);assert.equal(h.count(),0);assert.equal(h.providerCalls(),0);
  assert.equal((await h.request('status')).body.food_scan_remaining,2);
}));

test('deletion gate blocks lifetime usage writes and account deletion already owns the actor rows',async()=>withHarness({initialized:true},async h=>{
  h.sqlite.prepare('INSERT INTO bb_account_deletions VALUES (?)').run(await digestDeletionActor(account));
  const state=await h.request('status');assert.equal(state.body.food_scan_available,false);assert.equal(state.body.food_scan_remaining,0);
  assert.equal((await h.request()).status,429);assert.equal(h.count(),0);assert.equal(h.providerCalls(),0);
}));

test('deletion starting after global reservation cannot recreate lifetime account usage',async()=>withHarness({initialized:true},async h=>{
  const actorHash=await digestDeletionActor(account),base=h.env.BILLING_DB.prepare.bind(h.env.BILLING_DB);
  h.env.BILLING_DB.prepare=sql=>{
    const statement=base(sql);
    if(!sql.startsWith('INSERT INTO bb_ai_daily_usage'))return statement;
    return {...statement,bind(...args){
      const bound=statement.bind(...args);
      return {...bound,async first(){
        const row=await bound.first();
        if(args[1]==='global')h.sqlite.prepare('INSERT OR IGNORE INTO bb_account_deletions VALUES (?)').run(actorHash);
        return row;
      }};
    }};
  };
  assert.equal((await h.request()).status,429);assert.equal(h.count(),0);assert.equal(h.providerCalls(),0);
}));

test('missing configuration and unknown quota schemas fail closed before sending photos',async()=>{
  await withHarness({},async h=>{h.env.GEMINI_API_KEY='';assert.equal((await h.request()).status,503);assert.equal(h.count(),0);assert.equal(h.providerCalls(),0);});
  await withHarness({},async h=>{
    h.sqlite.exec('CREATE TABLE bb_ai_daily_usage(incompatible TEXT)');
    assert.equal((await h.request('status')).body.food_scan_available,false);
    assert.equal((await h.request()).status,503);assert.equal(h.providerCalls(),0);
    assert.deepEqual(h.sqlite.prepare('PRAGMA table_info(bb_ai_daily_usage)').all().map(row=>row.name),['incompatible']);
  });
});

test('Premium retains five daily scans and never consumes lifetime preview stock',async()=>withHarness({paid:true},async h=>{
  const state=await h.request('status');assert.equal(state.body.premium_ai,true);assert.equal(state.body.food_scan_preview,false);assert.equal(state.body.food_scan_remaining,null);assert.equal(state.body.turnstileRequired,false);
  for(let n=0;n<5;n++)assert.equal((await h.request('scan',{body:{turnstileToken:''}})).status,200);
  assert.equal((await h.request()).status,429);assert.equal(h.count(),0);assert.equal(h.count('user:'+account,'scan'),5);assert.equal(h.providerCalls(),5);
}));

test('provider failure is a bounded attempted scan and exposes no internal error detail',async()=>{
  for(const provider of ['error','network','invalid'])await withHarness({provider},async h=>{
    const result=await h.request();assert.equal(result.status,502);assert.doesNotMatch(JSON.stringify(result.body),/private|fixture-provider|network failure detail/);
    assert.equal(h.count(),1);assert.equal(h.providerCalls(),1);
  });
});
