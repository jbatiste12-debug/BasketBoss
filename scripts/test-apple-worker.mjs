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
const require=createRequire(import.meta.url);
const rootDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const toolsDir=process.env.BB_WORKER_TEST_TOOLS||path.join(rootDir,'node_modules');
const wrangler=path.join(toolsDir,'wrangler/bin/wrangler.js');
const {Miniflare,convertV4MiniflareOptions}=await import(path.join(toolsDir,'miniflare/dist/src/index.js'));
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'basketboss-apple-worker-'));
const entry=path.join(directory,'worker.mjs');
fs.writeFileSync(entry,`import {Buffer} from 'node:buffer';
import {getVerifiedAppleConfig,getAppleServices,verifyAppleTransaction,APPLE_BUNDLE_ID} from ${JSON.stringify(path.join(rootDir,'bb-server-lib/bb-apple-subscriptions.js'))};
export default {async fetch(request,env){try{
 if(new URL(request.url).pathname==='/disabled')return Response.json({available:getVerifiedAppleConfig({})!==null});
 const config=getVerifiedAppleConfig({...env,BILLING_DB:{prepare(){}}});
 const production=await getAppleServices(env,config);
 const {SignedDataVerifier,Environment}=await import(${JSON.stringify(require.resolve('@apple/app-store-server-library'))});
 const service={config,verifier:new SignedDataVerifier([Buffer.from(env.TEST_ROOT,'base64')],false,Environment.PRODUCTION,APPLE_BUNDLE_ID,config.appId)};
 const tx=await verifyAppleTransaction(service,env.TEST_TRANSACTION);
 let tamperRejected=false;
 try{await verifyAppleTransaction(service,env.TEST_TAMPERED);}catch(error){tamperRejected=error.code==='apple_transaction_unverified';}
 let productionRejectedTestRoot=false;
 try{await verifyAppleTransaction(production,env.TEST_TRANSACTION);}catch(error){productionRejectedTestRoot=error.code==='apple_transaction_unverified';}
 return Response.json({ok:tx.transactionId==='20000000000001',tamperRejected,productionRejectedTestRoot});
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
const intermediate=certificate(2,'/CN=Test Intermediate','/CN=Test Root',intermediateKeys.publicKey,rootKeys.privateKey,[{extname:'basicConstraints',cA:true,critical:true},{extname:'1.2.840.113635.100.6.2.1',extn:'0500'}]);
const leaf=certificate(3,'/CN=Test Leaf','/CN=Test Intermediate',leafKeys.publicKey,intermediateKeys.privateKey,[{extname:'basicConstraints',cA:false},{extname:'1.2.840.113635.100.6.11.1',extn:'0500'}]);
const header={alg:'ES256',x5c:[leaf,intermediate,root].map(cert=>cert.raw.toString('base64'))};
const transaction={transactionId:'20000000000001',originalTransactionId:'20000000000000',bundleId:'uk.co.basketboss.app',productId:'uk.co.basketboss.premium.monthly',subscriptionGroupIdentifier:'12345678',type:'Auto-Renewable Subscription',quantity:1,inAppOwnershipType:'PURCHASED',appAccountToken:'33333333-3333-4333-8333-333333333333',environment:'Production',purchaseDate:Date.now()-1000,signedDate:Date.now(),expiresDate:Date.now()+3600000};
const value=[header,transaction].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
const signed=value+'.'+sign('sha256',Buffer.from(value),{key:leafKeys.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
const parts=signed.split('.');parts[1]=Buffer.from(JSON.stringify({...transaction,productId:'uk.co.basketboss.premium.annual'})).toString('base64url');
const options={workers:[{modules:true,modulesRoot:directory,scriptPath:path.join(directory,'built/worker.js'),compatibilityDate:'2026-10-01',bindings:{APPLE_BILLING_ENABLED:'true',APPLE_ENVIRONMENT:'Production',APPLE_APP_ID:'1234567890',APPLE_ISSUER_ID:'55555555-5555-4555-8555-555555555555',APPLE_KEY_ID:'ABCDEFGHIJ',APPLE_PRIVATE_KEY:keys().privateKey,APPLE_SUBSCRIPTION_GROUP_ID:'12345678',TEST_ROOT:root.raw.toString('base64'),TEST_TRANSACTION:signed,TEST_TAMPERED:parts.join('.')}}]};
const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);
try{
 const cold=await mf.dispatchFetch('https://example.test/disabled');
 assert.equal(cold.status,200);assert.deepEqual(await cold.json(),{available:false});
 const response=await mf.dispatchFetch('https://example.test/verify');const result=await response.json();
 assert.equal(response.status,200);assert.deepEqual(result,{ok:true,tamperRejected:true,productionRejectedTestRoot:true});
 const pagesOptions={workers:[{modules:true,modulesRoot:directory,scriptPath:path.join(directory,'pages-built/index.js'),compatibilityDate:'2026-10-01',bindings:{APPLE_BILLING_ENABLED:'false'}}]};
 const pages=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(pagesOptions):pagesOptions);
 try{const disabled=await pages.dispatchFetch('https://basketboss.co.uk/api/apple/config');assert.equal(disabled.status,200);assert.deepEqual(await disabled.json(),{available:false,productIds:[],reason:'apple_not_enabled'});}finally{await pages.dispose();}
 console.log(JSON.stringify({runtime:'workerd',compatibilityDate:'2026-10-01',coldStart:true,pagesAppleDisabled:true,...result}));
}finally{await mf.dispose();fs.rmSync(directory,{recursive:true,force:true});}
