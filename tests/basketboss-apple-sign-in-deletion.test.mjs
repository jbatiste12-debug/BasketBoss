import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign,verify} from 'node:crypto';
import {appleSignInConfig,appleSignInConfigured,authenticatedDeletionUser,reauthenticateAppleDeletion} from '../bb-server-lib/bb-apple-sign-in.js';
import {onRequestGet} from '../functions/api/auth/apple-config.js';

const appleKeys=generateKeyPairSync('rsa',{modulusLength:2048}),clientKeys=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const current=1800000000000,seconds=current/1000,nonce='a'.repeat(64),subject='synthetic.apple.subject';
const publicKey={...appleKeys.publicKey.export({format:'jwk'}),kid:'synthetic-apple-key',alg:'RS256',use:'sig'};
const env={APPLE_SIGN_IN_ENABLED:'true',APPLE_SIGN_IN_TEAM_ID:'TEAM123456',APPLE_SIGN_IN_KEY_ID:'SIGN123456',APPLE_SIGN_IN_CLIENT_ID:'uk.co.basketboss.app',APPLE_SIGN_IN_PRIVATE_KEY:clientKeys.privateKey.export({type:'pkcs8',format:'pem'})};
const user={id:'11111111-1111-4111-8111-111111111111',email:'synthetic@example.invalid',appleIdentity:true,appleSubjects:[subject]};
const encoded=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function token(claims={}){
 const payload={iss:'https://appleid.apple.com',aud:'uk.co.basketboss.app',sub:subject,iat:seconds,exp:seconds+300,nonce:createHash('sha256').update(nonce).digest('hex'),...claims};
 const unsigned=encoded({alg:'RS256',kid:publicKey.kid})+'.'+encoded(payload);
 return unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),appleKeys.privateKey).toString('base64url');
}
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function fixture({claims,exchangedClaims,revokeStatus=200,exchangeStatus=200}={}){
 const calls=[],identityToken=token(claims),credential={identityToken,nonce,authorizationCode:'synthetic-authorization-code'};
 const fetcher=async(address,options={})=>{
  const url=new URL(address);calls.push({path:url.pathname,body:options.body,options});
  assert.equal(url.origin,'https://appleid.apple.com');assert.equal(options.redirect,'error');
  if(url.pathname==='/auth/keys')return response({keys:[publicKey]});
  if(url.pathname==='/auth/token')return response({id_token:token(exchangedClaims),refresh_token:'synthetic-apple-refresh'},exchangeStatus);
  if(url.pathname==='/auth/revoke')return response({},revokeStatus);
  throw Error('unexpected fixture path');
 };
 return {calls,credential,fetcher,run:()=>reauthenticateAppleDeletion(env,user,credential,{fetcher,now:()=>current})};
}

test('Apple deletion config is disabled by default and never reuses purchase signing keys',()=>{
 assert.equal(appleSignInConfigured({}),false);assert.equal(appleSignInConfig({APPLE_BILLING_ENABLED:'true',APPLE_PRIVATE_KEY:env.APPLE_SIGN_IN_PRIVATE_KEY}),null);
 assert.equal(appleSignInConfigured(env),true);
 for(const change of [{APPLE_SIGN_IN_TEAM_ID:'bad'},{APPLE_SIGN_IN_KEY_ID:'bad'},{APPLE_SIGN_IN_CLIENT_ID:'another.bundle'},{APPLE_SIGN_IN_PRIVATE_KEY:'invalid'}])assert.equal(appleSignInConfigured({...env,...change}),false);
});

test('fresh Apple proof is verified, exchanged and revoked before a deletion may begin',async()=>{
 const h=fixture();assert.equal(await h.run(),true);
 assert.deepEqual(h.calls.map(value=>value.path),['/auth/keys','/auth/token','/auth/revoke']);
 const form=h.calls[1].body;assert.equal(form.get('client_id'),'uk.co.basketboss.app');assert.equal(form.get('code'),'synthetic-authorization-code');
 const [header,payload,signature]=form.get('client_secret').split('.');
 assert.equal(JSON.parse(Buffer.from(payload,'base64url')).exp,seconds+300);
 assert.equal(verify('sha256',Buffer.from(header+'.'+payload),{key:clientKeys.publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')),true);
 assert.equal(h.calls[2].body.get('token_type_hint'),'refresh_token');assert.equal(h.calls[2].body.get('token'),'synthetic-apple-refresh');
});

for(const [name,claims] of Object.entries({other_account:{sub:'different.apple.subject'},wrong_bundle:{aud:'another.bundle'},wrong_issuer:{iss:'https://example.invalid'},expired:{exp:seconds-1},old:{iat:seconds-301},future:{iat:seconds+61},wrong_nonce:{nonce:'other'}})){
 test('Apple deletion rejects '+name+' before any token exchange',async()=>{
  const h=fixture({claims});await assert.rejects(h.run(),error=>error.code==='deletion_apple_required'&&error.status===403);assert.equal(h.calls.length,0);
 });
}

test('a different exchanged Apple subject cannot be paired with valid initial proof',async()=>{
 const h=fixture({exchangedClaims:{sub:'someone.else'}});await assert.rejects(h.run(),error=>error.code==='deletion_apple_required');assert.equal(h.calls.some(value=>value.path==='/auth/revoke'),false);
});

test('untrusted signatures and unavailable revocation fail closed with fixed safe errors',async()=>{
 const h=fixture();const parts=h.credential.identityToken.split('.');parts[2]='A'.repeat(parts[2].length);h.credential.identityToken=parts.join('.');
 await assert.rejects(h.run(),error=>error.code==='deletion_apple_required');assert.deepEqual(h.calls.map(value=>value.path),['/auth/keys']);
 const unavailable=fixture({revokeStatus:503});await assert.rejects(unavailable.run(),error=>error.code==='deletion_apple_unavailable'&&error.message==='deletion_apple_unavailable');
});

test('deletion identity derives Apple subjects from the fresh authenticated Supabase user only',async()=>{
 const request=new Request('https://basketboss.co.uk/api/account/delete',{headers:{Authorization:'Bearer synthetic-account-session'}});
 const config={SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public'};
 const found=await authenticatedDeletionUser(request,config,{fetcher:async(address,options)=>{
  assert.equal(address,config.SUPABASE_URL+'/auth/v1/user');assert.equal(options.headers.Authorization,'Bearer synthetic-account-session');
  return response({id:user.id,email:user.email,email_confirmed_at:'2026-11-14T12:00:00Z',identities:[{provider:'apple',identity_data:{sub:subject}}]});
 }});
 assert.deepEqual(found,user);
 assert.equal(await authenticatedDeletionUser(request,config,{fetcher:async()=>response({},401)}),null);
});

test('verification observers cannot change authenticated identity or failed verification',async()=>{
 const request=new Request('https://basketboss.co.uk/api/account/delete',{headers:{Authorization:'Bearer synthetic-account-session'}});
 const config={SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public'};
 let observed=0;
 const onFailure=reason=>{observed++;assert.equal(reason,'auth_session_rejected');throw Error('observer must not authorize deletion');};
 assert.equal(await authenticatedDeletionUser(request,config,{onFailure,fetcher:async()=>response({},401)}),null);
 assert.equal(observed,1);
 const found=await authenticatedDeletionUser(request,config,{onFailure:()=>assert.fail('success has no failure category'),fetcher:async()=>response({id:user.id,email:user.email,email_confirmed_at:'2026-11-14T12:00:00Z',identities:[{provider:'apple',identity_data:{sub:subject}}]})});
 assert.deepEqual(found,user);
});

test('public Apple readiness never leaks credentials and stays disabled before configuration',async()=>{
 const result=await onRequestGet({env:{}}),data=await result.json();
 assert.deepEqual(data,{available:false,nativeOnly:true,deletionReady:false,checks:{appleConfiguration:false,accountDeletionConfiguration:false,accountDeletionChecked:false,accountDeletionReady:false}});
 assert.equal(result.headers.get('Cache-Control'),'no-store');assert.doesNotMatch(JSON.stringify(data),/PRIVATE KEY|TEAM123456|SIGN123456/);
});

test('public Apple diagnostics distinguish configured credentials from an unavailable deletion backend',async()=>{
 const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error('Readiness must not be requested.');};
 try{
  const data=await (await onRequestGet({env})).json();
  assert.deepEqual(data,{available:false,nativeOnly:true,deletionReady:false,checks:{appleConfiguration:true,accountDeletionConfiguration:false,accountDeletionChecked:false,accountDeletionReady:false}});
  assert.equal(calls,0);assert.doesNotMatch(JSON.stringify(data),/PRIVATE KEY|TEAM123456|SIGN123456/);
 }finally{globalThis.fetch=previous;}
});

const deletionBackend={SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public-key',SUPABASE_SECRET_KEY:'synthetic-service-key-for-local-readiness-tests-only',BILLING_DB:{prepare(){throw Error('Readiness must not execute a local SQL query.');}}};

test('invalid Apple configuration does not probe an otherwise configured deletion backend',async()=>{
 const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error('Readiness must not be requested.');};
 try{
  const data=await (await onRequestGet({env:{...env,...deletionBackend,APPLE_SIGN_IN_KEY_ID:'invalid'}})).json();
  assert.deepEqual(data,{available:false,nativeOnly:true,deletionReady:false,checks:{appleConfiguration:false,accountDeletionConfiguration:true,accountDeletionChecked:false,accountDeletionReady:false}});
  assert.equal(calls,0);
 }finally{globalThis.fetch=previous;}
});

test('public Apple readiness is enabled only after the configured deletion readiness RPC succeeds',async()=>{
 const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async(address,options)=>{
  calls++;assert.equal(address,deletionBackend.SUPABASE_URL+'/rest/v1/rpc/bb_account_deletion_ready');assert.equal(options.method,'POST');
  return response({ready:true,version:1});
 };
 try{
  const result=await onRequestGet({env:{...env,...deletionBackend}}),data=await result.json();
  assert.deepEqual(data,{available:true,nativeOnly:true,deletionReady:true,checks:{appleConfiguration:true,accountDeletionConfiguration:true,accountDeletionChecked:true,accountDeletionReady:true}});
  assert.equal(calls,1);assert.equal(result.headers.get('Cache-Control'),'no-store');
  assert.doesNotMatch(JSON.stringify(data),/PRIVATE KEY|TEAM123456|SIGN123456|supabase|synthetic|service-key/);
 }finally{globalThis.fetch=previous;}
});

test('a failed Apple deletion readiness check reports only checked and ready booleans',async()=>{
 const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error('private endpoint diagnostic with credentials must never be returned');};
 try{
  const data=await (await onRequestGet({env:{...env,...deletionBackend}})).json();
  assert.deepEqual(data,{available:false,nativeOnly:true,deletionReady:false,checks:{appleConfiguration:true,accountDeletionConfiguration:true,accountDeletionChecked:true,accountDeletionReady:false}});
  assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(data),/private|endpoint|credentials|PRIVATE KEY|TEAM123456|SIGN123456|synthetic/);
 }finally{globalThis.fetch=previous;}
});
