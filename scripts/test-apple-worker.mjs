// Exercise real Cloudflare workerd: cold startup plus Node crypto/X.509/JWS.
// Fixture credentials are generated in memory; no real Apple requests or billing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,sign,X509Certificate} from 'node:crypto';
import jsrsasign from 'jsrsasign';
import {build} from 'esbuild';
import {appleBuiltinFacades} from './build-apple-sdk.mjs';
const require=createRequire(import.meta.url);
const rootDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const toolsDir=process.env.BB_WORKER_TEST_TOOLS||path.join(rootDir,'node_modules');
const wrangler=path.join(toolsDir,'wrangler/bin/wrangler.js');
const {Miniflare,convertV4MiniflareOptions}=await import(path.join(toolsDir,'miniflare/dist/src/index.js'));
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'basketboss-apple-worker-'));
const entry=path.join(directory,'worker.mjs');
// Same deferred/static-builtin packaging, retaining the old Node HTTP transport
// only in this isolated regression fixture. Never deployed or used for billing.
const legacyTransport=path.join(directory,'legacy-online-sdk.mjs');
await build({absWorkingDir:rootDir,stdin:{contents:'export function loadAppleServerSDK(){return require("@apple/app-store-server-library");}',resolveDir:rootDir},bundle:true,format:'esm',platform:'node',plugins:[appleBuiltinFacades()],outfile:legacyTransport,logLevel:'silent'});
fs.writeFileSync(entry,`import {Buffer} from 'node:buffer';
import {getVerifiedAppleConfig,getAppleServices,verifyAppleTransaction,APPLE_BUNDLE_ID} from ${JSON.stringify(path.join(rootDir,'bb-server-lib/bb-apple-subscriptions.js'))};
import {verifyTestFlightAppTransaction,testFlightBetaFailureReference} from ${JSON.stringify(path.join(rootDir,'bb-server-lib/bb-testflight-beta.js'))};
import {withAppleOCSPDateCompatibility} from ${JSON.stringify(path.join(rootDir,'bb-server-lib/bb-apple-ocsp.js'))};
export default {async fetch(request,env){try{
 const pathname=new URL(request.url).pathname;
 if(pathname==='/disabled')return Response.json({available:getVerifiedAppleConfig({})!==null});
 if(pathname==='/online'||pathname==='/online-legacy'){
  const sdk=pathname==='/online-legacy'?(await import(${JSON.stringify(legacyTransport)})).loadAppleServerSDK():(await import(${JSON.stringify(path.join(rootDir,'bb-server-lib/vendor/apple-server-sdk.mjs'))})).loadAppleServerSDK();
  const verifier=withAppleOCSPDateCompatibility(new sdk.SignedDataVerifier([Buffer.from(env.TEST_ROOT,'base64')],true,sdk.Environment.SANDBOX,APPLE_BUNDLE_ID),sdk);
  try{const claims=await verifyTestFlightAppTransaction(env,env.TEST_APP_TRANSACTION,{verifier});return Response.json({verified:claims.appTransactionId==='30000000000001'});}
  catch(error){return Response.json({verified:false,code:error.code,reference:testFlightBetaFailureReference(error)},{status:error.status||500});}
 }
 const config=getVerifiedAppleConfig({...env,BILLING_DB:{prepare(){}}});
 const production=await getAppleServices(env,config);
 const {SignedDataVerifier,Environment,VerificationException,VerificationStatus}=(await import(${JSON.stringify(path.join(rootDir,'bb-server-lib/vendor/apple-server-sdk.mjs'))})).loadAppleServerSDK();
 const service={config,verifier:new SignedDataVerifier([Buffer.from(env.TEST_ROOT,'base64')],false,Environment.PRODUCTION,APPLE_BUNDLE_ID,config.appId)};
 const tx=await verifyAppleTransaction(service,env.TEST_TRANSACTION);
 let tamperRejected=false;
 try{await verifyAppleTransaction(service,env.TEST_TAMPERED);}catch(error){tamperRejected=error.code==='apple_transaction_unverified';}
 let productionRejectedTestRoot=false;
 try{await verifyAppleTransaction(production,env.TEST_TRANSACTION);}catch(error){productionRejectedTestRoot=error.code==='apple_transaction_unverified';}
 // The only injected boundary is the root-pinned official Apple verifier. These
 // cases still perform real ES256/X.509 verification inside workerd.
 const betaVerifier=new SignedDataVerifier([Buffer.from(env.TEST_ROOT,'base64')],false,Environment.SANDBOX,APPLE_BUNDLE_ID);
 const app=await verifyTestFlightAppTransaction(env,env.TEST_APP_TRANSACTION,{verifier:betaVerifier});
 const rejected=async(signed,verifier)=>{try{await verifyTestFlightAppTransaction(env,signed,verifier?{verifier}:{});return null;}catch(error){return {code:error.code,reference:testFlightBetaFailureReference(error)};}};
 const betaTamper=await rejected(env.TEST_APP_TAMPERED,betaVerifier);
 const betaProduction=await rejected(env.TEST_APP_PRODUCTION,betaVerifier);
 const betaWrongBundle=await rejected(env.TEST_APP_WRONG_BUNDLE,betaVerifier);
 const betaPinnedRoot=await rejected(env.TEST_APP_TRANSACTION);
 const betaMissingAppId=await rejected(env.TEST_APP_MISSING_ID,betaVerifier);
 const onlineVerifier={verifyAndDecodeAppTransaction:async()=>{throw new VerificationException(VerificationStatus.RETRYABLE_VERIFICATION_FAILURE);}};
 const betaOnline=await rejected(env.TEST_APP_TRANSACTION,onlineVerifier);
 return Response.json({ok:tx.transactionId==='20000000000001',tamperRejected,productionRejectedTestRoot,
  betaAppTransactionVerified:app.appTransactionId==='30000000000001'&&app.receiptType==='Sandbox'&&app.bundleId===APPLE_BUNDLE_ID,
  betaTamperRejected:betaTamper?.code==='testflight_beta_unverified',betaProductionRejected:betaProduction?.code==='testflight_beta_unverified',betaWrongBundleRejected:betaWrongBundle?.code==='testflight_beta_unverified',betaPinnedRootRejected:betaPinnedRoot?.code==='testflight_beta_unverified',
  betaFailureReferences:{tamper:betaTamper?.reference,production:betaProduction?.reference,wrongBundle:betaWrongBundle?.reference,pinnedRoot:betaPinnedRoot?.reference,missingAppId:betaMissingAppId?.reference,online:betaOnline?.reference},
  betaOnlineRetryable:betaOnline?.code==='testflight_beta_unavailable'});
}catch(error){return Response.json({ok:false,code:error.code||error.name,message:error.message},{status:500});}}};
`);
execFileSync(process.execPath,[wrangler,'deploy',entry,'--dry-run','--outdir',path.join(directory,'built'),'--compatibility-date','2026-10-01','--name','basketboss-apple-local-smoke'],{cwd:directory,env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:'pipe'});
execFileSync(process.execPath,[wrangler,'pages','functions','build',path.join(rootDir,'functions'),'--outdir',path.join(directory,'pages-built'),'--compatibility-date','2026-10-01','--project-directory',rootDir],{cwd:directory,env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:'pipe'});
const keys=()=>generateKeyPairSync('ec',{namedCurve:'prime256v1',privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}});
function certificate(serial,subject,issuer,pub,issuerPrivate,ext){
 const time=n=>new Date(n).toISOString().replace(/[-:T]/g,'').replace(/\.\d{3}/,'');
 return new X509Certificate(new jsrsasign.KJUR.asn1.x509.Certificate({version:3,serial:{int:serial},issuer:{str:issuer},subject:{str:subject},notbefore:{type:'gen',str:time(Date.now()-86400000)},notafter:{type:'gen',str:time(Date.now()+86400000)},sbjpubkey:pub,ext,sigalg:'SHA256withECDSA',cakey:issuerPrivate}).getPEM());
}
const rootKeys=keys(),intermediateKeys=keys(),leafKeys=keys();
const root=certificate(1,'/CN=Test Root','/CN=Test Root',rootKeys.publicKey,rootKeys.privateKey,[{extname:'basicConstraints',cA:true,critical:true}]);
const intermediate=certificate(2,'/CN=Test Intermediate','/CN=Test Root',intermediateKeys.publicKey,rootKeys.privateKey,[{extname:'basicConstraints',cA:true,critical:true},{extname:'1.2.840.113635.100.6.2.1',extn:'0500'},{extname:'authorityInfoAccess',array:[{ocsp:'http://ocsp.fixture.test/status'}]}]);
const leaf=certificate(3,'/CN=Test Leaf','/CN=Test Intermediate',leafKeys.publicKey,intermediateKeys.privateKey,[{extname:'basicConstraints',cA:false},{extname:'1.2.840.113635.100.6.11.1',extn:'0500'},{extname:'authorityInfoAccess',array:[{ocsp:'http://ocsp.fixture.test/status'}]}]);
const header={alg:'ES256',x5c:[leaf,intermediate,root].map(cert=>cert.raw.toString('base64'))};
function signedFixture(payload){
 const value=[header,payload].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
 return value+'.'+sign('sha256',Buffer.from(value),{key:leafKeys.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
}
function tamperedFixture(signed,payload){
 const parts=signed.split('.');parts[1]=Buffer.from(JSON.stringify(payload)).toString('base64url');return parts.join('.');
}
const transaction={transactionId:'20000000000001',originalTransactionId:'20000000000000',bundleId:'uk.co.basketboss.app',productId:'uk.co.basketboss.premium.monthly',subscriptionGroupIdentifier:'12345678',type:'Auto-Renewable Subscription',quantity:1,inAppOwnershipType:'PURCHASED',appAccountToken:'33333333-3333-4333-8333-333333333333',environment:'Production',purchaseDate:Date.now()-1000,signedDate:Date.now(),expiresDate:Date.now()+3600000};
const signed=signedFixture(transaction);
const tampered=tamperedFixture(signed,{...transaction,productId:'uk.co.basketboss.premium.annual'});
const appTransaction={receiptType:'Sandbox',appAppleId:1234567890,bundleId:'uk.co.basketboss.app',appTransactionId:'30000000000001',applicationVersion:'8',receiptCreationDate:Date.now(),originalPurchaseDate:Date.now()-86400000};
const signedApp=signedFixture(appTransaction);
const ocspTime=n=>new Date(n).toISOString().replace(/[-:T]/g,'').replace(/\.\d{3}/,'');
const responderKeys=keys(),rootResponderKeys=keys();
const responder=certificate(4,'/CN=Test OCSP Responder','/CN=Test Intermediate',responderKeys.publicKey,intermediateKeys.privateKey,[{extname:'basicConstraints',cA:false},{extname:'extKeyUsage',array:[{name:'ocspSigning'}]}]);
const rootResponder=certificate(5,'/CN=Test Root OCSP Responder','/CN=Test Root',rootResponderKeys.publicKey,rootKeys.privateKey,[{extname:'basicConstraints',cA:false},{extname:'extKeyUsage',array:[{name:'ocspSigning'}]}]);
let ocspRequests=0,ocspMode='good';
async function ocspFixture(request){
 assert.equal(request.url,'http://ocsp.fixture.test/status');assert.equal(request.method,'POST');assert.equal(request.headers.get('content-type'),'application/ocsp-request');
 const bytes=Buffer.from(await request.arrayBuffer());assert.ok(bytes.length>0);ocspRequests++;
 if(ocspMode==='network')throw Error('fixture OCSP network unavailable');
 if(ocspMode==='non2xx')return new Response('fixture OCSP unavailable',{status:503});
 if(ocspMode==='malformed')return new Response(Buffer.from([0,255,128]));
 const parsed=new jsrsasign.KJUR.asn1.ocsp.OCSPParser().getOCSPRequest(bytes.toString('hex')),certid=parsed.array[0];
 const delegated=certid.sbjsn==='03'?{cert:responder,key:responderKeys.privateKey}:{cert:rootResponder,key:rootResponderKeys.privateKey};
 const status=ocspMode==='revoked'?{status:'revoked',time:ocspTime(Date.now()-60000),reason:0}:{status:'good'};
 const delta=ocspMode==='stale'?-86400000:ocspMode==='future'?2*86400000:3600000;
 const thisupdate=ocspMode==='malformed-date'?'20261301000000Z':ocspTime(Date.now()+(ocspMode==='future'?86400000:-2*86400000));
 let hex=new jsrsasign.KJUR.asn1.ocsp.OCSPResponse({resstatus:'successful',restype:'ocspBasic',respid:{name:delegated.cert.toString()},prodat:ocspTime(Date.now()),array:[{certid,status,thisupdate,nextupdate:ocspTime(Date.now()+delta)}],sigalg:'SHA256withECDSA',reskey:delegated.key,certs:[delegated.cert.toString()]}).getEncodedHex();
 if(ocspMode==='tampered'){
  const at=jsrsasign.ASN1HEX.getIdxbyList(hex,0,[1,0,1,0,2]),value=jsrsasign.ASN1HEX.getVidx(hex,at)+12;
  hex=hex.slice(0,value)+(parseInt(hex.slice(value,value+2),16)^1).toString(16).padStart(2,'0')+hex.slice(value+2);
 }
 return new Response(Buffer.from(hex,'hex'),{headers:{'Content-Type':'application/ocsp-response'}});
}
const options={workers:[{outboundService:ocspFixture,modules:true,modulesRoot:directory,scriptPath:path.join(directory,'built/worker.js'),compatibilityDate:'2026-10-01',bindings:{APPLE_BILLING_ENABLED:'true',APPLE_ENVIRONMENT:'Production',APPLE_APP_ID:'1234567890',APPLE_ISSUER_ID:'55555555-5555-4555-8555-555555555555',APPLE_KEY_ID:'ABCDEFGHIJ',APPLE_PRIVATE_KEY:keys().privateKey,APPLE_SUBSCRIPTION_GROUP_ID:'12345678',TEST_ROOT:root.raw.toString('base64'),TEST_TRANSACTION:signed,TEST_TAMPERED:tampered,
 TEST_APP_TRANSACTION:signedApp,TEST_APP_TAMPERED:tamperedFixture(signedApp,{...appTransaction,appTransactionId:'30000000000002'}),TEST_APP_PRODUCTION:signedFixture({...appTransaction,receiptType:'Production'}),TEST_APP_WRONG_BUNDLE:signedFixture({...appTransaction,bundleId:'example.other.app'}),TEST_APP_MISSING_ID:signedFixture({...appTransaction,appTransactionId:undefined})}}]};
const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);
try{
 const cold=await mf.dispatchFetch('https://example.test/disabled');
 assert.equal(cold.status,200);assert.deepEqual(await cold.json(),{available:false});
 const response=await mf.dispatchFetch('https://example.test/verify');const result=await response.json();
 assert.equal(response.status,200);assert.deepEqual(result,{ok:true,tamperRejected:true,productionRejectedTestRoot:true,
  betaAppTransactionVerified:true,betaTamperRejected:true,betaProductionRejected:true,betaWrongBundleRejected:true,betaPinnedRootRejected:true,
  betaFailureReferences:{tamper:'BB_BETA_APPLE_VERIFY_VERIFICATION_FAILURE',production:'BB_BETA_APPLE_VERIFY_INVALID_ENVIRONMENT',wrongBundle:'BB_BETA_APPLE_VERIFY_INVALID_APP_IDENTIFIER',pinnedRoot:'BB_BETA_APPLE_VERIFY_VERIFICATION_FAILURE',missingAppId:'BB_BETA_APPLE_CLAIM_APP_TRANSACTION_ID',online:'BB_BETA_APPLE_VERIFY_RETRYABLE_VERIFICATION_FAILURE'},betaOnlineRetryable:true});
 const legacyOnline=await mf.dispatchFetch('https://example.test/online-legacy');assert.equal(legacyOnline.status,503);assert.deepEqual(await legacyOnline.json(),{verified:false,code:'testflight_beta_unavailable',reference:'BB_BETA_APPLE_VERIFY_RETRYABLE_VERIFICATION_FAILURE'});assert.equal(ocspRequests,0,'legacy Node HTTP transport fails before reaching OCSP');
 const onlineChecks={legacyNodeTransportRejected:true};
 for(const mode of ['good','revoked','stale','future','malformed-date','tampered','malformed','network','non2xx']){
  ocspMode=mode;const before=ocspRequests,response=await mf.dispatchFetch('https://example.test/online'),result=await response.json();
  assert.equal(ocspRequests-before,2,'both certificate OCSP POSTs use native transport: '+mode);
  if(mode==='good'){assert.equal(response.status,200,JSON.stringify(result));assert.deepEqual(result,{verified:true});}
  else{assert.equal(response.status,['network','non2xx'].includes(mode)?503:403,mode+': '+JSON.stringify(result));assert.equal(result.verified,false);assert.equal(result.code,['network','non2xx'].includes(mode)?'testflight_beta_unavailable':'testflight_beta_unverified');assert.match(result.reference,/^BB_BETA_APPLE_VERIFY_(?:FAILURE|VERIFICATION_FAILURE|RETRYABLE_VERIFICATION_FAILURE)$/);}
  onlineChecks[mode]=mode==='good'?'verified':'rejected';
 }
 const pagesOptions={workers:[{modules:true,modulesRoot:directory,scriptPath:path.join(directory,'pages-built/index.js'),compatibilityDate:'2026-10-01',bindings:{APPLE_BILLING_ENABLED:'false'}}]};
 const pages=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(pagesOptions):pagesOptions);
 try{const disabled=await pages.dispatchFetch('https://basketboss.co.uk/api/apple/config');assert.equal(disabled.status,200);assert.deepEqual(await disabled.json(),{available:false,productIds:[],reason:'apple_not_enabled'});}finally{await pages.dispose();}
 console.log(JSON.stringify({runtime:'workerd',compatibilityDate:'2026-10-01',coldStart:true,pagesAppleDisabled:true,...result,onlineChecks}));
}finally{await mf.dispose();fs.rmSync(directory,{recursive:true,force:true});}
