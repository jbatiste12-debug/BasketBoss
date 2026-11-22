import test from 'node:test';
import assert from 'node:assert/strict';
import {reauthenticateDeletion} from '../bb-server-lib/bb-account-deletion.js';

// The current deletion endpoint still requires its original independent password
// grant for non-Apple accounts. Google-only users first set a BasketBoss password
// through the existing verified email recovery flow; Google credentials are not
// collected or used here. Every network call in this file is intercepted.
const USER='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const EMAIL='google-family@example.invalid';
const PASSWORD='synthetic independent BasketBoss password';
const env={SUPABASE_URL:'https://synthetic-project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-publishable-key'};
const googleUser={id:USER,email:EMAIL,email_confirmed_at:'2026-11-22T12:00:00Z',
 app_metadata:{provider:'google',providers:['google']},identities:[{provider:'google',identity_data:{sub:'synthetic-google-subject'}}]};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function mockGrant(t,response){
 const calls=[];
 t.mock.method(globalThis,'fetch',async(input,init)=>{calls.push({input,init,body:JSON.parse(init.body)});return response;});
 return calls;
}
function assertPasswordGrant(calls,password){
 assert.equal(calls.length,1,'only the original Supabase password grant is used');
 const call=calls[0];
 assert.equal(call.input,env.SUPABASE_URL+'/auth/v1/token?grant_type=password');
 assert.equal(call.init.method,'POST');assert.equal(call.init.redirect,'manual');
 assert.deepEqual(call.init.headers,{apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'});
 assert.deepEqual(call.body,password===undefined?{email:EMAIL}:{email:EMAIL,password});
 assert.ok(call.init.signal instanceof AbortSignal,'the original bounded verification request remains in use');
}

test('a Google-linked user with a configured BasketBoss password must verify the same confirmed UID through the existing password grant',async t=>{
 const calls=mockGrant(t,json({user:googleUser,access_token:'synthetic-password-grant-access'}));
 assert.equal(await reauthenticateDeletion(env,googleUser,PASSWORD),true);
 assertPasswordGrant(calls,PASSWORD);
});

test('wrong or missing BasketBoss passwords remain rejected for a Google-linked account',async t=>{
 for(const password of ['incorrect BasketBoss password','',undefined]){
  const calls=mockGrant(t,json({error:'invalid_grant',error_description:'Invalid login credentials'},400));
  assert.equal(await reauthenticateDeletion(env,googleUser,password),false);
  assertPasswordGrant(calls,password);t.mock.restoreAll();
 }
});

test('a password-grant response for another confirmed UID never authorizes deletion of the Google-linked user',async t=>{
 const calls=mockGrant(t,json({user:{...googleUser,id:OTHER}}));
 assert.equal(await reauthenticateDeletion(env,googleUser,PASSWORD),false);
 assertPasswordGrant(calls,PASSWORD);
});

test('an unconfirmed or absent password-grant user never authorizes deletion even when Google identity metadata is present',async t=>{
 for(const response of [{user:{...googleUser,email_confirmed_at:null}},{}]){
  const calls=mockGrant(t,json(response));assert.equal(await reauthenticateDeletion(env,googleUser,PASSWORD),false);
  assertPasswordGrant(calls,PASSWORD);t.mock.restoreAll();
 }
});

test('a Google-labelled session and provider metadata cannot substitute for the unchanged password reauthentication',async t=>{
 const sessionProof={...googleUser,access_token:'synthetic-fresh-google-session',googleIdentity:true,
  provider_token:'synthetic-google-provider-token',user_metadata:{google_verified:true,premiumAccess:true}};
 const calls=mockGrant(t,json({error:'invalid_grant'},400));
 assert.equal(await reauthenticateDeletion(env,sessionProof,undefined),false);
 assertPasswordGrant(calls,undefined);
 assert.doesNotMatch(calls[0].init.body,/google_verified|premiumAccess|provider_token|synthetic-fresh-google-session|synthetic-google-provider-token/);
 assert.equal(Object.hasOwn(calls[0].init.headers,'Authorization'),false,'a Google-labelled bearer is never used as password proof');
});
