/* Apple subscriptions are separate from Paddle rows and never trust a client tier.
 * Production accepts only Apple-pinned, OCSP-checked ES256 JWS and fresh server
 * status. Sandbox is a separate namespace and requires an explicit user allowlist.
 */
import {Buffer} from 'node:buffer';
import {createPrivateKey} from 'node:crypto';
import {appleRootCertificates} from './bb-apple-roots.js';
import {withAppleOCSPDateCompatibility} from './bb-apple-ocsp.js';
import {expectedPrice,entitlementForStatus} from './bb-billing.js';
import {ensureDeletionSchema,isAccountDeleting,digestDeletionActor} from './bb-account-deletion.js';
export const APPLE_BUNDLE_ID='uk.co.basketboss.app';
export const APPLE_DEFAULT_PRODUCTS=Object.freeze({monthly:'uk.co.basketboss.premium.monthly',annual:'uk.co.basketboss.premium.annual'});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TX=/^[0-9]{1,40}$/;
const REFRESH_MS=60000;
const services=new WeakMap();
const Environment=Object.freeze({PRODUCTION:'Production',SANDBOX:'Sandbox'});
let appleLibraryPromise;
// jsrsasign, a dependency of Apple's official verifier, seeds its RNG when its
// module initializes. Workers disallow that during global-scope evaluation.
// Keep initialization inside the first request that actually needs Apple;
// disabled billing and existing web access must not load it at Worker startup.
// The generated ESM bridge makes native imports static for Pages bundlers; its
// factory delays SDK evaluation even when ESM module initialisation is global.
function loadAppleLibrary(){
 return appleLibraryPromise??=import('./vendor/apple-server-sdk.mjs').then(module=>module.loadAppleServerSDK()).catch(error=>{appleLibraryPromise=undefined;throw error;});
}
// App acquisition proof does not require subscription products, an API signing
// key, a paid purchase, or the separate subscription sandbox account allowlist.
// Classify locally into fixed labels only. Raw exception text/stack can contain
// account or infrastructure details and must never enter responses or logs.
export function classifyAppleVerifierInitFailure(error){
 let message='',stack='',name='';try{if(typeof error?.message==='string')message=error.message.slice(0,2000);if(typeof error?.stack==='string')stack=error.stack.slice(0,6000);if(typeof error?.name==='string')name=error.name;}catch{}
 if(/global[- ]scope|outside.{0,50}(?:request|handler)|(?:I\/O|random).{0,80}(?:global|request context)/i.test(message))return 'GLOBAL_CONTEXT';
 if(/SlowBuffer|buffer-equal-constant-time/i.test(message+' '+stack))return 'BUFFER_COMPAT';
 if(/(?:undefined|null).{0,80}(?:reading|accessing).{0,20}prototype|prototype.{0,50}(?:undefined|null)/i.test(message))return 'UNDEFINED_PROTOTYPE';
 if(/\bJSON\b.{0,100}(?:import|attribute|assert)|import.{0,120}(?:assertion|attribute)/i.test(message))return 'JSON_IMPORT';
 if(name==='ReferenceError'&&/\b(?:Buffer|process|navigator|window|self)\b/.test(message))return 'MISSING_GLOBAL';
 if(/dynamic import|dynamic require|require is not defined|cannot find (?:module|package)|no such module|cannot resolve module|unsupported.{0,60}(?:require|import)|(?:require|import).{0,80}not supported/i.test(message))return 'DYNAMIC_IMPORT';
 if(/SignedDataVerifier.{0,60}(?:not a constructor|not a function|undefined|missing)|does not provide an export/i.test(message))return 'MISSING_EXPORT';
 if(/(?:crypto|X509|createHash|node:buffer)/i.test(message)&&/(?:not implemented|not supported|unsupported|not a constructor|not a function|undefined|unrecognized)/i.test(message))return 'NODE_CRYPTO';
 if(/Apple trust anchor integrity check failed/i.test(message))return 'ROOT_INTEGRITY';
 if(name==='TypeError')return 'TYPE_ERROR';
 return 'UNKNOWN';
}
function verifierInitFailure(stage,error,cause){
 const reference='BB_BETA_APPLE_'+stage+'_'+(cause||classifyAppleVerifierInitFailure(error));
 return new AppleBillingError('testflight_beta_unavailable','Apple app verification could not start. Please try again. Reference: '+reference+'.');
}
function isConstructor(value){if(typeof value!=='function')return false;try{Reflect.construct(Object,[],value);return true;}catch{return false;}}
export async function createAppleAppTransactionVerifier({loadLibrary=loadAppleLibrary,rootCertificates=appleRootCertificates}={}){
 let sdk,Constructor,roots;
 try{const library=await loadLibrary();sdk=isConstructor(library?.SignedDataVerifier)?library:isConstructor(library?.default?.SignedDataVerifier)?library.default:null;Constructor=sdk?.SignedDataVerifier;}
 catch(error){throw verifierInitFailure('MODULE',error);}
 if(!Constructor)throw verifierInitFailure('MODULE',null,'MISSING_EXPORT');
 try{roots=rootCertificates();}catch(error){throw verifierInitFailure('ROOTS',error);}
 try{return withAppleOCSPDateCompatibility(new Constructor(roots,true,Environment.SANDBOX,APPLE_BUNDLE_ID),sdk);}
 catch(error){throw verifierInitFailure('CONSTRUCTOR',error);}
}
export async function getAppleAppTransactionVerifier(){return createAppleAppTransactionVerifier();}
export async function isAppleRetryableVerificationFailure(error){
 const {VerificationStatus}=await loadAppleLibrary();
 return error?.status===VerificationStatus.RETRYABLE_VERIFICATION_FAILURE;
}
// Fixed SDK status names are safe diagnostics. Neither exception text nor its
// cause is returned: those may contain certificate, request or account data.
export async function classifyAppleVerificationFailure(error,{loadLibrary=loadAppleLibrary}={}){
 const {VerificationStatus}=await loadLibrary();
 let status;try{status=error?.status;}catch{return 'UNEXPECTED';}
 const labels=['VERIFICATION_FAILURE','RETRYABLE_VERIFICATION_FAILURE','INVALID_APP_IDENTIFIER','INVALID_ENVIRONMENT','INVALID_CHAIN_LENGTH','INVALID_CERTIFICATE','FAILURE'];
 return labels.find(label=>Number.isInteger(VerificationStatus?.[label])&&status===VerificationStatus[label])||'UNEXPECTED';
}
export class AppleBillingError extends Error {
 constructor(code,message,status=503){super(message);this.name='AppleBillingError';this.code=code;this.status=status;}
}
const fail=(code,message,status=503)=>{throw new AppleBillingError(code,message,status);};
const millis=value=>Number.isSafeInteger(value)&&value>0;
const iso=value=>millis(value)?new Date(value).toISOString():null;
export function getVerifiedAppleConfig(env){
 if(env.APPLE_BILLING_ENABLED!=='true')return null;
 const environment=env.APPLE_ENVIRONMENT;
 const appId=Number(env.APPLE_APP_ID),issuerId=env.APPLE_ISSUER_ID,keyId=env.APPLE_KEY_ID;
 const privateKey=typeof env.APPLE_PRIVATE_KEY==='string'?env.APPLE_PRIVATE_KEY.replace(/\\n/g,'\n'):'';
 const products={monthly:env.APPLE_MONTHLY_PRODUCT_ID||APPLE_DEFAULT_PRODUCTS.monthly,annual:env.APPLE_ANNUAL_PRODUCT_ID||APPLE_DEFAULT_PRODUCTS.annual};
 const groupId=String(env.APPLE_SUBSCRIPTION_GROUP_ID||'');
 if(![Environment.PRODUCTION,Environment.SANDBOX].includes(environment)||!Number.isSafeInteger(appId)||appId<=0||
    !UUID.test(issuerId||'')||!/[A-Z0-9]{10}/.test(keyId||'')||keyId.length!==10||
    (env.APPLE_BUNDLE_ID&&env.APPLE_BUNDLE_ID!==APPLE_BUNDLE_ID)||!/^\d{1,30}$/.test(groupId)||
    !Object.values(products).every(id=>typeof id==='string'&&id.startsWith('uk.co.basketboss.premium.')&&/^[A-Za-z0-9._-]{1,200}$/.test(id))||new Set(Object.values(products)).size!==2||!env.BILLING_DB?.prepare)
  fail('apple_not_configured','Apple subscriptions are not configured.');
 try{const key=createPrivateKey(privateKey);if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')throw Error('invalid_key');}
 catch{fail('apple_not_configured','Apple subscriptions are not configured.');}
 const sandboxUsers=String(env.APPLE_SANDBOX_USER_IDS||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
 const allowSandbox=environment===Environment.SANDBOX||env.APPLE_ALLOW_SANDBOX==='true';
 if(allowSandbox&&(!sandboxUsers.length||sandboxUsers.some(id=>!UUID.test(id))))fail('apple_sandbox_not_configured','Apple sandbox accounts are not configured.');
 return {environment,appId,issuerId,keyId,privateKey,products,groupId,bundleId:APPLE_BUNDLE_ID,sandboxUsers,allowSandbox};
}
export function appleUserAllowed(config,userId){return UUID.test(userId||'')&&(config.environment===Environment.PRODUCTION||config.sandboxUsers.includes(userId.toLowerCase()));}
// Apple's verifier deliberately does not require appAppleId in Sandbox. Keep
// Production exact, and still reject a conflicting identifier if Sandbox sends it.
export function appleAppIdentifierMatches(config,value){return value===config.appId||(config.environment===Environment.SANDBOX&&value===undefined);}
export function appleConfigForUser(config,userId){
 const testAccount=config.allowSandbox&&config.sandboxUsers.includes(String(userId).toLowerCase());
 const selected={...config,environment:testAccount?Environment.SANDBOX:config.environment};
 if(!appleUserAllowed(selected,userId))fail('apple_account_unavailable','Apple subscriptions are not available for this account.',403);
 return selected;
}
// This decode ONLY routes to a verifier. Every field remains untrusted until
// that verifier validates Apple's pinned chain, signature, bundle and environment.
export function appleConfigForSignedData(config,signed,userId){
 validateAppleJWS(signed);let hint;
 try{const payload=JSON.parse(Buffer.from(signed.split('.')[1],'base64url').toString('utf8'));hint=payload.environment||payload.data?.environment||payload.summary?.environment;}
 catch{fail('invalid_apple_transaction','Invalid Apple signed data.',400);}
 if(hint===Environment.PRODUCTION&&config.environment===Environment.PRODUCTION)return {...config,environment:hint};
 if(hint===Environment.SANDBOX&&config.allowSandbox&&(!userId||config.sandboxUsers.includes(String(userId).toLowerCase())))return {...config,environment:hint};
 fail('apple_environment_mismatch','This Apple purchase environment is not available for this account.',403);
}
function bounded(promise){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new AppleBillingError('apple_unavailable','Apple verification is temporarily unavailable.')),22000);})]).finally(()=>clearTimeout(timer));}
export async function getAppleServices(env,config=getVerifiedAppleConfig(env)){
 if(!config)fail('apple_disabled','Apple subscriptions are not available.');
 const cache=services.get(env)||new Map();
 const cached=cache.get(config.environment);
 const fingerprint=[config.environment,config.appId,config.groupId,config.issuerId,config.keyId,config.privateKey,JSON.stringify(config.products),config.sandboxUsers.join(',')].join('|');
 if(cached?.fingerprint===fingerprint)return cached;
 const sdk=await loadAppleLibrary(),{AppStoreServerAPIClient,SignedDataVerifier}=sdk;
 const result={fingerprint,config,verifier:withAppleOCSPDateCompatibility(new SignedDataVerifier(appleRootCertificates(),true,config.environment,config.bundleId,config.environment===Environment.PRODUCTION?config.appId:undefined),sdk),client:new AppStoreServerAPIClient(config.privateKey,config.keyId,config.issuerId,config.bundleId,config.environment)};
 cache.set(config.environment,result);services.set(env,cache);return result;
}
export function validateAppleJWS(value){
 if(typeof value!=='string'||value.length<50||value.length>65536||!value.split('.').every(part=>/^[A-Za-z0-9_-]+$/.test(part))||value.split('.').length!==3)fail('invalid_apple_transaction','Invalid Apple signed data.',400);
 try{const h=JSON.parse(Buffer.from(value.split('.')[0],'base64url').toString('utf8'));if(h.alg!=='ES256'||!Array.isArray(h.x5c)||h.x5c.length!==3||h.x5c.some(cert=>typeof cert!=='string'||cert.length>12000))throw Error('invalid_header');}
 catch{fail('invalid_apple_transaction','Invalid Apple signed data.',400);}
 return value;
}
export async function ensureAppleSchema(env){
 try{
  const schema=await env.BILLING_DB.prepare('SELECT version FROM bb_apple_schema WHERE id=1').first();
  if(schema?.version!==1)throw Error('wrong_schema');
  await env.BILLING_DB.prepare('SELECT user_id,app_account_token FROM bb_apple_account_tokens LIMIT 0').all();
  await env.BILLING_DB.prepare('SELECT original_transaction_id,last_verified_at_ms FROM bb_apple_subscriptions LIMIT 0').all();
  await env.BILLING_DB.prepare('SELECT notification_uuid FROM bb_apple_notifications LIMIT 0').all();
 }catch{fail('apple_schema_unavailable','Apple subscriptions are temporarily unavailable.');}
}
export async function assertAppleAccountReady(env,config,userId){
 if(!appleUserAllowed(config,userId))fail('apple_account_unavailable','Apple subscriptions are not available for this account.',403);
 await ensureDeletionSchema(env);
 if(await isAccountDeleting(env,userId))fail('account_deletion_pending','Account deletion is in progress.',409);
 await ensureAppleSchema(env);
}
export async function appleAccountToken(env,userId,{create=false}={}){
 let row=await env.BILLING_DB.prepare('SELECT app_account_token FROM bb_apple_account_tokens WHERE user_id=?').bind(userId).first();
 if(!row&&create){
  const token=crypto.randomUUID();
  await env.BILLING_DB.prepare(`INSERT OR IGNORE INTO bb_apple_account_tokens(user_id,app_account_token,created_at_ms)
   SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM bb_account_deletions WHERE actor_hash=?)`)
   .bind(userId,token,Date.now(),await digestDeletionActor(userId)).run();
  row=await env.BILLING_DB.prepare('SELECT app_account_token FROM bb_apple_account_tokens WHERE user_id=?').bind(userId).first();
 }
 if(!UUID.test(row?.app_account_token||''))fail('apple_account_token_unavailable','Prepare the Apple purchase again.',409);
 return row.app_account_token.toLowerCase();
}
export async function verifyAppleTransaction(services,signed){
 validateAppleJWS(signed);
 let transaction;
 try{transaction=await bounded(services.verifier.verifyAndDecodeTransaction(signed));}
 catch(error){if(error instanceof AppleBillingError)throw error;if(await isAppleRetryableVerificationFailure(error))fail('apple_unavailable','Apple verification is temporarily unavailable.');fail('apple_transaction_unverified','Apple could not verify this transaction.',400);}
 validateTransactionClaims(services.config,transaction);
 return transaction;
}
export function validateTransactionClaims(config,transaction,now=Date.now()){
 const plan=Object.entries(config.products).find(([,id])=>id===transaction?.productId)?.[0];
 if(!plan||transaction.bundleId!==config.bundleId||transaction.environment!==config.environment||transaction.type!=='Auto-Renewable Subscription'||
    transaction.subscriptionGroupIdentifier!==config.groupId||!TX.test(transaction.transactionId||'')||!TX.test(transaction.originalTransactionId||'')||
    !UUID.test(transaction.appAccountToken||'')||transaction.inAppOwnershipType!=='PURCHASED'||!millis(transaction.expiresDate)||
    !millis(transaction.purchaseDate)||!millis(transaction.signedDate)||transaction.signedDate>now+300000||transaction.purchaseDate>now+300000||transaction.quantity!==1)
  fail('apple_transaction_mismatch','The Apple transaction does not match this app and account.',400);
 if(transaction.revocationDate!==undefined&&!millis(transaction.revocationDate))fail('apple_transaction_mismatch','Invalid Apple revocation information.',400);
 return plan;
}
export function evaluateAppleSubscription(config,transaction,renewal,status,now=Date.now()){
 const plan=validateTransactionClaims(config,transaction,now);
 if(!renewal||renewal.environment!==config.environment||renewal.originalTransactionId!==transaction.originalTransactionId||
    renewal.productId!==transaction.productId||!millis(renewal.signedDate)||renewal.signedDate>now+300000||
    ![0,1].includes(renewal.autoRenewStatus)||(renewal.appAccountToken&&renewal.appAccountToken.toLowerCase()!==transaction.appAccountToken.toLowerCase())||
    (renewal.autoRenewProductId&&!Object.values(config.products).includes(renewal.autoRenewProductId))||![1,2,3,4,5].includes(status))
  fail('apple_status_mismatch','Apple subscription status could not be verified.');
 let state=({1:'active',2:'expired',3:'billing_retry',4:'grace_period',5:'revoked'})[status];
 if(transaction.revocationDate||status===5)state='revoked';
 const grace=millis(renewal.gracePeriodExpiresDate)?renewal.gracePeriodExpiresDate:null;
 if(state==='active'&&(transaction.expiresDate<=now||transaction.isUpgraded===true))state='expired';
 if(state==='grace_period'&&(!grace||grace<=now))state='expired';
 return {environment:config.environment,originalTransactionId:transaction.originalTransactionId,transactionId:transaction.transactionId,
  appAccountToken:transaction.appAccountToken.toLowerCase(),productId:transaction.productId,plan,status:state,
  expiresAtMs:transaction.expiresDate,graceExpiresAtMs:grace,revokedAtMs:transaction.revocationDate||null,
  cancelAtPeriodEnd:renewal.autoRenewStatus===0,appleSignedAtMs:Math.max(transaction.signedDate,renewal.signedDate),lastVerifiedAtMs:now};
}
export async function fetchAppleCurrentSubscription(service,originalId,accountToken){
 const {config,client,verifier}=service;
 if(!TX.test(originalId||'')||!UUID.test(accountToken||''))fail('apple_transaction_mismatch','Invalid Apple subscription identifier.',400);
 let response;
 try{response=await bounded(client.getAllSubscriptionStatuses(originalId));}
 catch{fail('apple_unavailable','Apple subscription status is temporarily unavailable.');}
 if(response?.bundleId!==config.bundleId||response.environment!==config.environment||!appleAppIdentifierMatches(config,response.appAppleId)||!Array.isArray(response.data)||response.data.length>100)
  fail('apple_status_mismatch','Apple subscription status could not be verified.');
 const entries=response.data.filter(group=>group.subscriptionGroupIdentifier===config.groupId).flatMap(group=>group.lastTransactions||[]).filter(item=>item.originalTransactionId===originalId);
 if(entries.length!==1)fail('apple_status_mismatch','Apple subscription status could not be verified.');
 const item=entries[0],transaction=await verifyAppleTransaction(service,item.signedTransactionInfo);
 let renewal;
 try{validateAppleJWS(item.signedRenewalInfo);renewal=await bounded(verifier.verifyAndDecodeRenewalInfo(item.signedRenewalInfo));}
 catch(error){if(error instanceof AppleBillingError)throw error;fail('apple_status_mismatch','Apple renewal information could not be verified.');}
 if(transaction.originalTransactionId!==originalId||transaction.appAccountToken.toLowerCase()!==accountToken.toLowerCase())fail('apple_account_mismatch','This Apple subscription belongs to another BasketBoss account.',409);
 return evaluateAppleSubscription(config,transaction,renewal,item.status);
}
export async function persistAppleSubscription(env,userId,state){
 const actorHash=await digestDeletionActor(userId);
 // Every write checks the durable account deletion barrier in the same statement.
 // The immutable account-token row also prevents a late request recreating a
 // subscription after the parent's deletion cleanup removed that mapping.
 await env.BILLING_DB.prepare(`INSERT INTO bb_apple_subscriptions(environment,original_transaction_id,user_id,app_account_token,
  latest_transaction_id,product_id,plan,status,expires_at_ms,grace_expires_at_ms,revoked_at_ms,cancel_at_period_end,apple_signed_at_ms,last_verified_at_ms)
  SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM bb_apple_account_tokens WHERE user_id=? AND app_account_token=?)
  AND NOT EXISTS(SELECT 1 FROM bb_account_deletions WHERE actor_hash=?)
  ON CONFLICT(environment,original_transaction_id) DO UPDATE SET latest_transaction_id=excluded.latest_transaction_id,
  product_id=excluded.product_id,plan=excluded.plan,status=excluded.status,expires_at_ms=excluded.expires_at_ms,
  grace_expires_at_ms=excluded.grace_expires_at_ms,revoked_at_ms=excluded.revoked_at_ms,cancel_at_period_end=excluded.cancel_at_period_end,
  apple_signed_at_ms=excluded.apple_signed_at_ms,last_verified_at_ms=excluded.last_verified_at_ms
  WHERE bb_apple_subscriptions.user_id=excluded.user_id AND bb_apple_subscriptions.app_account_token=excluded.app_account_token
  AND (excluded.apple_signed_at_ms>bb_apple_subscriptions.apple_signed_at_ms OR
   (excluded.apple_signed_at_ms=bb_apple_subscriptions.apple_signed_at_ms AND excluded.last_verified_at_ms>=bb_apple_subscriptions.last_verified_at_ms))`)
 .bind(state.environment,state.originalTransactionId,userId,state.appAccountToken,state.transactionId,state.productId,state.plan,state.status,
  state.expiresAtMs,state.graceExpiresAtMs,state.revokedAtMs,Number(state.cancelAtPeriodEnd),state.appleSignedAtMs,state.lastVerifiedAtMs,userId,state.appAccountToken,actorHash).run();
 const saved=await env.BILLING_DB.prepare('SELECT * FROM bb_apple_subscriptions WHERE environment=? AND original_transaction_id=?').bind(state.environment,state.originalTransactionId).first();
 if(!saved||saved.user_id!==userId||saved.app_account_token!==state.appAccountToken)fail('apple_account_mismatch','This Apple subscription is unavailable for this BasketBoss account.',409);
 return saved;
}
export function appleEntitlementFromRow(config,row,now=Date.now()){
 if(!row||row.environment!==config.environment||!Object.values(config.products).includes(row.product_id)||!['monthly','annual'].includes(row.plan)||config.products[row.plan]!==row.product_id)return null;
 const premiumAccess=!row.revoked_at_ms&&((row.status==='active'&&row.expires_at_ms>now)||(row.status==='grace_period'&&row.grace_expires_at_ms>now));
 return {provider:'apple',premiumAccess,plan:row.plan,status:premiumAccess?row.status:(row.status==='active'||row.status==='grace_period'?'expired':row.status),
  originalTransactionId:row.original_transaction_id,productId:row.product_id,expiresAt:iso(row.expires_at_ms),currentPeriodEndsAt:iso(row.expires_at_ms),
  cancelAtPeriodEnd:row.cancel_at_period_end===1,environment:row.environment,lastVerifiedAt:iso(row.last_verified_at_ms)};
}
export async function readAppleEntitlement(env,userId){
 const baseConfig=getVerifiedAppleConfig(env);if(!baseConfig||!appleUserAllowed(baseConfig,userId))return null;
 const config=appleConfigForUser(baseConfig,userId);
 await assertAppleAccountReady(env,config,userId);
 const rows=(await env.BILLING_DB.prepare('SELECT * FROM bb_apple_subscriptions WHERE user_id=? AND environment=? ORDER BY last_verified_at_ms DESC LIMIT 21').bind(userId,config.environment).all()).results||[];
 if(rows.length>20)fail('apple_account_unavailable','Apple subscription records require support review.');
 const result=[];
 for(let row of rows){
  if(Date.now()-row.last_verified_at_ms>=REFRESH_MS){
   const state=await fetchAppleCurrentSubscription(await getAppleServices(env,config),row.original_transaction_id,row.app_account_token);
   row=await persistAppleSubscription(env,userId,state);
  }
  const entitlement=appleEntitlementFromRow(config,row);if(entitlement)result.push(entitlement);
 }
 return result.find(item=>item.premiumAccess)||result[0]||null;
}
export async function hasExistingWebPremium(env,user){
 if(user.id&&user.id===env.BB_OWNER_USER_ID)return 'owner';
 const rows=(await env.BILLING_DB.prepare("SELECT status,price_id,plan FROM bb_paid_entitlements WHERE user_id=? AND status IN ('active','trialing') LIMIT 100").bind(user.id).all()).results||[];
 if(rows.length===100)fail('billing_unavailable','Existing subscription status requires support review.');
 if(rows.some(row=>entitlementForStatus(row.status)&&expectedPrice(env,row.plan)&&expectedPrice(env,row.plan)===row.price_id))return 'paddle';
 const {sharedHouseholdPremiumOwner}=await import('./bb-household-premium.js');
 if(await sharedHouseholdPremiumOwner(new Request('https://basketboss.co.uk/api/apple/purchase-context'),env,user))return 'household';
 return null;
}
export async function assertNoPendingWebCheckout(env,userId){
 // An unpaid web checkout may still complete in another tab. Do not open a
 // second payment sheet merely because its entitlement webhook has not arrived.
 // Legacy/Apple-only installations need not have the Paddle claims table.
 const table=await env.BILLING_DB.prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='bb_billing_claims'").first();
 if(!table)return;
 const pending=await env.BILLING_DB.prepare("SELECT 1 AS found FROM bb_billing_claims WHERE user_id=? AND claim_state IN ('pending','checkout_created') LIMIT 1").bind(userId).first();
 if(pending)fail('web_checkout_pending','Your web checkout is still awaiting confirmation. Complete or safely cancel it before subscribing through Apple.',409);
}
