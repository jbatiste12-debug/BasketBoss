import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {onRequest} from '../functions/api/bb173/[action].js';

const price='pri_'+'p'.repeat(26);
const jpeg=Buffer.from([0xff,0xd8,0xff,...Array(70).fill(4)]).toString('base64');
const scanBody={mimeType:'image/jpeg',imageBase64:jpeg};

function harness({schemaPresent=false,invalidSchema=false,mode='live',paid=true,cap=20}={}){
  const seen=[],counts=new Map();
  let tableExists=schemaPresent;
  const env={
    BB_BILLING_MODE:mode,BB_BILLING_ENABLED:'true',BB_PREMIUM_AI_ENABLED:'true',
    BB_OWNER_USER_ID:'owner_id',BB_LIVE_CHECKOUT_ENABLED:'true',BB_LIVE_WEBHOOK_ENABLED:'true',
    PADDLE_LIVE_STANDARD_PRICE_ID:price,PADDLE_SANDBOX_STANDARD_PRICE_ID:price,
    SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'mock_publishable',
    GEMINI_API_KEY:'mock_gemini',TURNSTILE_SITE_KEY:'0x4AAAA_test',TURNSTILE_SECRET_KEY:'mock_secret',
    BB_AI_GLOBAL_DAILY_CAP:String(cap),BILLING_DB:{
      prepare(sql){
        seen.push({kind:'sql',sql});
        return {
          async run(){
            if(!sql.startsWith('CREATE TABLE IF NOT EXISTS bb_ai_daily_usage'))throw Error('Unexpected D1 .run: '+sql);
            if(tableExists)throw Error('Unexpected CREATE for existing quota table');
            tableExists=true;
            return {success:true};
          },
          bind(...args){
            return {async first(){
              if(sql.includes('FROM bb_paid_entitlements'))
                return paid?{status:'trialing',plan:'standard',price_id:price}:null;
              if(sql.includes('bb_ai_daily_usage')){
                if(!tableExists)throw Error('D1_ERROR: no such table: bb_ai_daily_usage: SQLITE_ERROR');
                if(invalidSchema)throw Error('D1_ERROR: ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint');
                const [day,actor,action,limit]=args;
                const key=day+'/'+actor+'/'+action;
                const next=(counts.get(key)||0)+1;
                if(next>limit)return null;
                counts.set(key,next);
                return {used:next};
              }
              throw Error('Unexpected D1 .first: '+sql);
            }};
          }
        };
      }
    }
  };
  const prior=globalThis.fetch;
  globalThis.fetch=async(url)=>{
    const u=String(url);seen.push({kind:'fetch',url:u});
    if(u.endsWith('/auth/v1/user'))return Response.json({id:'paid_user',email:'verified@example.com',email_confirmed_at:'2026-10-27T00:00:00Z'});
    if(u.includes('siteverify'))return Response.json({success:true,action:'bb_ai',hostname:'basketboss.co.uk'});
    if(u.includes('generativelanguage.googleapis.com'))return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({items:[{name:'apple',estimatedQuantity:'one',confidence:'high',notes:'visible'}],caution:''})}]}}]});
    throw Error('Unexpected network '+u);
  };
  async function request(action='scan',body={}){
    const method=action==='status'?'GET':'POST';
    const req=new Request('https://basketboss.co.uk/api/bb173/'+action,{
      method,headers:{Authorization:'Bearer demo_test_token',...(method==='POST'?{'Content-Type':'application/json',Origin:'https://basketboss.co.uk'}:{})},
      ...(method==='POST'?{body:JSON.stringify({...scanBody,...body})}:{})
    });
    const res=await onRequest({request:req,env,params:{action}});
    return {status:res.status,body:await res.json()};
  }
  return {request,seen,counts,restore:()=>{globalThis.fetch=prior;}};
}

async function withHarness(options,fn){const h=harness(options);try{await fn(h)}finally{h.restore()}}

test('Live newly trialing subscriber: missing D1 quota table auto-creates once, and Gemini runs',async()=>withHarness({},async h=>{
  const a=await h.request();assert.equal(a.status,200,JSON.stringify(a.body));
  assert.equal(a.body.reviewRequired,true);
  assert.equal(h.seen.filter(x=>x.sql?.startsWith('CREATE TABLE IF NOT EXISTS bb_ai_daily_usage')).length,1);
  assert.equal(h.seen.filter(x=>x.url?.includes('generativelanguage.googleapis.com')).length,1);
  assert.equal(h.counts.size,2,'per-account and global usage both recorded');
  const b=await h.request();assert.equal(b.status,200,JSON.stringify(b.body));
  assert.equal(h.seen.filter(x=>x.sql?.startsWith('CREATE TABLE IF NOT EXISTS bb_ai_daily_usage')).length,1);
}));

test('Per-user quota still stops a 6th AI photo request at 5 per day',async()=>withHarness({},async h=>{
  for(let i=0;i<5;i++)assert.equal((await h.request()).status,200,`scan ${i+1}`);
  const sixth=await h.request();assert.equal(sixth.status,429,JSON.stringify(sixth.body));
  assert.equal(h.seen.filter(x=>x.url?.includes('generativelanguage.googleapis.com')).length,5);
}));

test('Existing initialized table is reused without attempting CREATE TABLE',async()=>withHarness({schemaPresent:true},async h=>{
  const response=await h.request();assert.equal(response.status,200);
  assert.ok(!h.seen.some(x=>x.sql?.startsWith('CREATE TABLE')));
}));

test('Incompatible quota schema never bypasses daily limits or triggers destructive migration',async()=>withHarness({schemaPresent:true,invalidSchema:true},async h=>{
  const response=await h.request();assert.equal(response.status,503);
  assert.match(response.body.error,/quota protection unavailable/);
  assert.ok(!h.seen.some(x=>x.sql?.startsWith('CREATE TABLE')));
  assert.ok(!h.seen.some(x=>x.url?.includes('generativelanguage.googleapis.com')));
}));

test('Free authenticated account is denied before D1 quota writes or initialization',async()=>withHarness({paid:false},async h=>{
  const response=await h.request();assert.equal(response.status,403);
  assert.ok(!h.seen.some(x=>x.sql?.includes('bb_ai_daily_usage')));
}));

test('Status marks Turnstile optional only for verified Live subscriber, required in sandbox',async()=>{
  await withHarness({mode:'live'},async h=>{
    const response=await h.request('status');assert.equal(response.status,200);
    assert.equal(response.body.premium_ai,true);
    assert.equal(response.body.turnstileRequired,false);
  });
  await withHarness({mode:'sandbox'},async h=>{
    const response=await h.request('status');assert.equal(response.status,200);
    assert.equal(response.body.turnstileRequired,true);
  });
});

test('Safari scanner modal hides Turnstile for verified Live accounts, preserves camera label/input',async()=>{
  const script=await fs.readFile(new URL('../make-a-meal.js',import.meta.url),'utf8');
  const html=await fs.readFile(new URL('../make-a-meal.html',import.meta.url),'utf8');
  assert.match(script,/bbTurnstileRequired=\!\(aiEnabled&&data.turnstileRequired===false\)/);
  assert.match(script,/verifyPanel.hidden=!bbTurnstileRequired/);
  assert.match(script,/if\(!bbTurnstileRequired\)return;/);
  assert.match(html,/#aiSecurityBox:not\(\[hidden\]\)/);
  assert.match(html,/<label class="scan-upload-label" for="ai-photo-input">/);
  assert.match(html,/<input accept="image\/\*"[^>]+id="ai-photo-input" type="file"/);
  assert.match(html,/make-a-meal\.js\?v=bb-ai-quota-turnstile-live-20261027-v1/);
});
