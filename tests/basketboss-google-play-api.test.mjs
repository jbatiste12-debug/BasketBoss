import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,verify} from 'node:crypto';

const first=generateKeyPairSync('rsa',{modulusLength:2048}),second=generateKeyPairSync('rsa',{modulusLength:2048});
const pem=pair=>pair.privateKey.export({type:'pkcs8',format:'pem'});
const jwk=(pair,kid)=>({...pair.publicKey.export({format:'jwk'}),kid,alg:'RS256',use:'sig'});
const email='billing@fixture-project.iam.gserviceaccount.com';
const pubsub={email:'play-push@fixture-project.iam.gserviceaccount.com',audience:'https://example.invalid/api/google-play/notifications',subscription:'projects/fixture/subscriptions/play'};
const config=(extra={})=>({packageName:'uk.co.basketboss.app',serviceAccountEmail:email,privateKey:pem(first),pubsub,...extra});
const json=(value,options={})=>Response.json(value,options);
let moduleId=0;
const fresh=()=>import('../bb-server-lib/bb-google-play-api.js?transport-test='+(moduleId++));
function token(pair=first,kid='first',overrides={},headerOverrides={}){
 const now=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid,...headerOverrides})).toString('base64url');
 const body=Buffer.from(JSON.stringify({iss:'https://accounts.google.com',aud:pubsub.audience,email:pubsub.email,email_verified:true,sub:'123456789',iat:now,exp:now+3600,...overrides})).toString('base64url');
 const unsigned=header+'.'+body;return unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),pair.privateKey).toString('base64url');
}
const request=value=>new Request(pubsub.audience,{method:'POST',headers:{Authorization:'Bearer '+value},body:'{}'});
const errorCode=(code,status)=>error=>error?.name==='GooglePlayBillingError'&&error.code===code&&(status===undefined||error.status===status);

test('service-account OAuth signs a scoped RS256 assertion and caches access by environment and credentials',async t=>{
 const {createGooglePlayAPI}=await fresh();let oauth=0,gets=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  assert.equal(init.redirect,'manual');assert.ok(init.signal instanceof AbortSignal);
  if(url==='https://oauth2.googleapis.com/token'){
   oauth++;assert.equal(init.method,'POST');assert.equal(init.headers['Content-Type'],'application/x-www-form-urlencoded');
   const form=new URLSearchParams(init.body);assert.equal(form.get('grant_type'),'urn:ietf:params:oauth:grant-type:jwt-bearer');
   const parts=form.get('assertion').split('.'),header=JSON.parse(Buffer.from(parts[0],'base64url')),claims=JSON.parse(Buffer.from(parts[1],'base64url'));
   assert.deepEqual(header,{alg:'RS256',typ:'JWT'});assert.equal(claims.iss,email);assert.equal(claims.scope,'https://www.googleapis.com/auth/androidpublisher');assert.equal(claims.aud,url);assert.equal(claims.exp-claims.iat,3600);assert.ok(Math.abs(claims.iat-Math.floor(Date.now()/1000))<2);
   assert.equal(verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),oauth===3?second.publicKey:first.publicKey,Buffer.from(parts[2],'base64url')),true);
   return json({access_token:'fixture-access-token-'+oauth,token_type:'Bearer',expires_in:3600});
  }
  gets++;assert.match(url,/^https:\/\/androidpublisher\.googleapis\.com\//);assert.match(init.headers.Authorization,/^Bearer fixture-access-token-\d+$/);return json({subscriptionState:'SUBSCRIPTION_STATE_ACTIVE'});
 });
 const env={},api=createGooglePlayAPI(env,config());
 await Promise.all([api.get('one'),api.get('two')]);await createGooglePlayAPI(env,config()).get('three');assert.equal(oauth,1);assert.equal(gets,3);
 await createGooglePlayAPI({},config()).get('four');assert.equal(oauth,2);
 await createGooglePlayAPI(env,config({privateKey:pem(second)})).get('five');assert.equal(oauth,3);
});

test('OAuth token expiry and a publisher authentication rejection force fresh credentials',async t=>{
 const {createGooglePlayAPI}=await fresh();let oauth=0,now=Date.now(),publisher=0;
 t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'fetch',async url=>{
  if(url==='https://oauth2.googleapis.com/token'){oauth++;return json({access_token:'fixture-access-token-'+oauth,token_type:'Bearer',expires_in:120});}
  publisher++;return publisher===3?json({error:'must never be exposed'},{status:401}):json({ok:true});
 });
 const api=createGooglePlayAPI({},config());await api.get('one');await api.get('two');assert.equal(oauth,1);
 now+=61000;await assert.rejects(api.get('three'),errorCode('google_play_unavailable',503));assert.equal(oauth,2);
 await api.get('four');assert.equal(oauth,3);
});

test('purchase get and acknowledge use fixed hosts, encoded tokens and an empty acknowledgment body',async t=>{
 const {createGooglePlayAPI}=await fresh(),seen=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(url==='https://oauth2.googleapis.com/token')return json({access_token:'fixture-access-token',token_type:'Bearer',expires_in:3600});
  seen.push({url,init});return init.method==='POST'?new Response(null,{status:204}):json({lineItems:[{productId:'premium.monthly'}]});
 });
 const api=createGooglePlayAPI({},config());assert.deepEqual(await api.get('fixture/token?with#chars%'),{lineItems:[{productId:'premium.monthly'}]});await api.acknowledge('fixture/token?with#chars%','premium.monthly');
 assert.equal(seen[0].url,'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/uk.co.basketboss.app/purchases/subscriptionsv2/tokens/fixture%2Ftoken%3Fwith%23chars%25');
 assert.equal(seen[1].url,'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/uk.co.basketboss.app/purchases/subscriptions/premium.monthly/tokens/fixture%2Ftoken%3Fwith%23chars%25:acknowledge');
 assert.equal(seen[1].init.method,'POST');assert.equal(seen[1].init.body,'{}');assert.equal(seen[1].init.headers['Content-Type'],'application/json');
 assert.throws(()=>api.get('bad token'),errorCode('invalid_google_play_token',400));assert.throws(()=>api.acknowledge('token','../other'),errorCode('invalid_google_play_token',400));assert.equal(seen.length,2);
});

test('OAuth failures and malformed keys produce fixed errors without exposing upstream text',async t=>{
 const {createGooglePlayAPI}=await fresh();let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return json({error_description:'fixture-provider-secret'},{status:400});});
 await assert.rejects(createGooglePlayAPI({},config()).get('fixture-private-token'),error=>errorCode('google_play_unavailable',503)(error)&&!String(error).includes('fixture-provider-secret')&&!String(error).includes('fixture-private-token'));
 await assert.rejects(createGooglePlayAPI({},config({privateKey:'-----BEGIN PRIVATE KEY-----\nYWJj\n-----END PRIVATE KEY-----'})).get('token'),errorCode('google_play_not_configured',503));
 assert.throws(()=>createGooglePlayAPI({},config({packageName:'other.package'})),errorCode('google_play_not_configured',503));assert.equal(calls,1);
});

test('transport rejects redirects, oversized bodies, malformed JSON and upstream purchase rejection',async t=>{
 const {createGooglePlayAPI}=await fresh();let response;
 t.mock.method(globalThis,'fetch',async url=>url==='https://oauth2.googleapis.com/token'?json({access_token:'fixture-access-token',token_type:'Bearer',expires_in:3600}):response);
 const api=createGooglePlayAPI({},config());
 for(response of [new Response(null,{status:302,headers:{Location:'https://attacker.invalid'}}),new Response('x'.repeat(262145)),new Response('{')])await assert.rejects(api.get('token'),errorCode('google_play_unavailable',503));
 response=json({error:'fixture-purchase-secret'},{status:404});await assert.rejects(api.get('token'),error=>errorCode('google_play_purchase_unverified',400)(error)&&!String(error).includes('fixture-purchase-secret'));
});

test('network timeout bounds a stalled response body and aborts its request',async t=>{
 const {createGooglePlayAPI}=await fresh();let signal,started;
 const waiting=new Promise(resolve=>{started=resolve;});
 t.mock.timers.enable({apis:['setTimeout']});
 t.mock.method(globalThis,'fetch',async(_url,init)=>{signal=init.signal;started();return new Response(new ReadableStream({start(){}}));});
 const pending=createGooglePlayAPI({},config()).get('token');const rejected=assert.rejects(pending,errorCode('google_play_unavailable',503));
 await waiting;t.mock.timers.tick(10000);await rejected;assert.equal(signal.aborted,true);
});

test('Pub/Sub verifies Google RS256 signatures, fixed audience and service-account identity, caching keys',async t=>{
 const {verifyGooglePlayPubSub}=await fresh();let fetches=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{fetches++;assert.equal(url,'https://www.googleapis.com/oauth2/v3/certs');assert.equal(init.redirect,'manual');return json({keys:[jwk(first,'first')]},{headers:{'Cache-Control':'public, max-age=3600'}});});
 const claims=await verifyGooglePlayPubSub(request(token()),config());assert.equal(claims.email,pubsub.email);
 await verifyGooglePlayPubSub(request(token(first,'first',{iss:'accounts.google.com'})),config());assert.equal(fetches,1);
});

test('Pub/Sub rejects forged signatures and unsafe claim values',async t=>{
 const {verifyGooglePlayPubSub}=await fresh();let fetches=0;
 t.mock.method(globalThis,'fetch',async()=>{fetches++;return json({keys:[jwk(first,'first')]});});
 await assert.rejects(verifyGooglePlayPubSub(request(token(second)),config()),errorCode('google_play_notification_unverified',401));
 const now=Math.floor(Date.now()/1000);
 for(const changes of [{aud:'https://attacker.invalid'},{aud:[pubsub.audience]},{iss:'https://attacker.invalid'},{email:'other@fixture-project.iam.gserviceaccount.com'},{email_verified:false},{email_verified:'true'},{exp:now-1},{iat:now+61},{iat:now-4000},{exp:now+7200},{iat:String(now)},{nbf:now+61}]){
  await assert.rejects(verifyGooglePlayPubSub(request(token(first,'first',changes)),config()),errorCode('google_play_notification_unverified',401));
 }
 assert.equal(fetches,1,'invalid claims do not trigger extra network requests');
});

test('Pub/Sub rejects malformed, oversized and unsupported JWTs before network access',async t=>{
 const {verifyGooglePlayPubSub}=await fresh();let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('network must remain unused');});
 for(const value of ['bad.jwt.parts',token(first,'first',{}, {alg:'HS256'}),token(first,'first',{}, {crit:['custom']}),token(first,'first',{extra:'x'.repeat(9000)})])await assert.rejects(verifyGooglePlayPubSub(request(value),config()),errorCode('google_play_notification_unverified',401));
 await assert.rejects(verifyGooglePlayPubSub(new Request(pubsub.audience),config()),errorCode('google_play_notification_unverified',401));assert.equal(calls,0);
});

test('Pub/Sub refreshes cached Google certificates for an unknown rotated kid',async t=>{
 const {verifyGooglePlayPubSub}=await fresh();let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return json({keys:calls===1?[jwk(first,'first')]:[jwk(first,'first'),jwk(second,'second')]},{headers:{'Cache-Control':'max-age=3600'}});});
 await verifyGooglePlayPubSub(request(token()),config());await verifyGooglePlayPubSub(request(token(second,'second')),config());assert.equal(calls,2);
 await assert.rejects(verifyGooglePlayPubSub(request(token(first,'unknown')),config()),errorCode('google_play_notification_unverified',401));assert.equal(calls,2,'random unknown kids cannot force repeated refreshes');
});

test('Pub/Sub key loading rejects duplicate keys and never follows provider redirects',async t=>{
 const {verifyGooglePlayPubSub}=await fresh();let response=json({keys:[jwk(first,'first'),jwk(first,'first')]});
 t.mock.method(globalThis,'fetch',async()=>response);
 await assert.rejects(verifyGooglePlayPubSub(request(token()),config()),errorCode('google_play_unavailable',503));
 response=new Response(null,{status:302,headers:{Location:'https://attacker.invalid/keys'}});await assert.rejects(verifyGooglePlayPubSub(request(token()),config()),errorCode('google_play_unavailable',503));
});
