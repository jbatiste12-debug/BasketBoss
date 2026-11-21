/* Google credentials, purchase tokens and unverified provider responses never
 * enter diagnostics. Every request uses a fixed Google host and bounded body.
 * Entitlement, test-purchase and account ownership checks belong to the caller.
 */
const OAUTH_URL='https://oauth2.googleapis.com/token';
const PUBLISHER_URL='https://androidpublisher.googleapis.com/androidpublisher/v3/applications/';
const JWKS_URL='https://www.googleapis.com/oauth2/v3/certs';
const SCOPE='https://www.googleapis.com/auth/androidpublisher';
const TIMEOUT_MS=10000,JWT_LIMIT=8192;
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const oauthCaches=new WeakMap();
let jwksCache=null,jwksPending=null,lastUnknownRefresh=0;

export class GooglePlayBillingError extends Error {
 constructor(code,message,status=503){super(message);this.name='GooglePlayBillingError';this.code=code;this.status=status;}
}
const unavailable=()=>new GooglePlayBillingError('google_play_unavailable','Google Play verification is temporarily unavailable.');
const unverified=()=>new GooglePlayBillingError('google_play_notification_unverified','Google Play notification could not be verified.',401);
const notConfigured=()=>new GooglePlayBillingError('google_play_not_configured','Google Play subscriptions are not configured.');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function encodeBase64url(bytes){
 let binary='';for(const value of bytes)binary+=String.fromCharCode(value);
 return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function decodeBase64url(value){
 if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value)||value.length%4===1)throw Error('invalid_encoding');
 const bytes=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));
 if(encodeBase64url(bytes)!==value)throw Error('invalid_encoding');
 return bytes;
}
const encodeJSON=value=>encodeBase64url(encoder.encode(JSON.stringify(value)));

async function readBody(response,maxBytes){
 const length=response.headers?.get?.('content-length');
 if(length!==null&&length!==undefined&&(!/^\d+$/.test(length)||Number(length)>maxBytes))throw unavailable();
 if(!response.body)return '';
 const reader=response.body.getReader();let size=0;const chunks=[];
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw unavailable();chunks.push(value);}
 }catch(error){try{await reader.cancel();}catch{}throw error;}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return decoder.decode(bytes);
}
async function googleRequest(url,init,maxBytes,{empty=false}={}){
 const controller=new AbortController();let timer;
 const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(unavailable());},TIMEOUT_MS);});
 try{
  return await Promise.race([(async()=>{
   const response=await globalThis.fetch(url,{...init,redirect:'manual',signal:controller.signal});
   if(response.redirected||response.status>=300&&response.status<400)throw unavailable();
   if(!response.ok){try{await response.body?.cancel();}catch{}return {status:response.status,ok:false};}
   const body=await readBody(response,maxBytes);
   if(empty&&body==='')return {status:response.status,ok:true,data:null};
   let data;try{data=JSON.parse(body);}catch{throw unavailable();}
   if(!object(data))throw unavailable();
   return {status:response.status,ok:true,data,cacheControl:response.headers?.get?.('cache-control')};
  })(),expired]);
 }catch{throw unavailable();}
 finally{clearTimeout(timer);}
}
function credentials(config){
 if(config?.packageName!=='uk.co.basketboss.app'||typeof config.serviceAccountEmail!=='string'||config.serviceAccountEmail.length>254||
    !/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.gserviceaccount\.com$/.test(config.serviceAccountEmail)||typeof config.privateKey!=='string'||config.privateKey.length>20000)throw notConfigured();
 const privateKey=config.privateKey.replace(/\\n/g,'\n').trim();
 if(!/^-----BEGIN PRIVATE KEY-----\s+[A-Za-z0-9+/=\s]+\s+-----END PRIVATE KEY-----$/.test(privateKey))throw notConfigured();
 return {email:config.serviceAccountEmail,privateKey};
}
async function importPrivateKey(pem){
 try{
  const contents=pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
  const bytes=Uint8Array.from(atob(contents),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey('pkcs8',bytes,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  if(key.algorithm.modulusLength<2048||key.algorithm.modulusLength>8192)throw Error('invalid_key');
  return key;
 }catch{throw notConfigured();}
}
async function accessToken(cache){
 if(cache.token&&cache.expiresAt>Date.now()+60000)return cache.token;
 if(cache.pending)return cache.pending;
 cache.pending=(async()=>{
  cache.key??=await importPrivateKey(cache.privateKey);
  const now=Math.floor(Date.now()/1000),unsigned=encodeJSON({alg:'RS256',typ:'JWT'})+'.'+encodeJSON({iss:cache.email,scope:SCOPE,aud:OAUTH_URL,iat:now,exp:now+3600});
  let signature;try{signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',cache.key,encoder.encode(unsigned));}catch{throw notConfigured();}
  const assertion=unsigned+'.'+encodeBase64url(new Uint8Array(signature));
  const response=await googleRequest(OAUTH_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}).toString()},16384);
  const data=response.data;
  if(!response.ok||typeof data?.access_token!=='string'||data.access_token.length<16||data.access_token.length>8192||!/^[A-Za-z0-9._~+\/-]+=*$/.test(data.access_token)||
     data.token_type!=='Bearer'||!Number.isSafeInteger(data.expires_in)||data.expires_in<1||data.expires_in>3600)throw unavailable();
  cache.token=data.access_token;cache.expiresAt=Date.now()+data.expires_in*1000;
  return cache.token;
 })();
 try{return await cache.pending;}finally{cache.pending=null;}
}
function validToken(token){
 if(typeof token!=='string'||token.length<1||token.length>4096||/[\x00-\x20\x7f]/.test(token))throw new GooglePlayBillingError('invalid_google_play_token','Invalid Google Play purchase token.',400);
 return token;
}
export function createGooglePlayAPI(env,config){
 if(!object(env))throw notConfigured();
 const {email,privateKey}=credentials(config),fingerprint=email+'\n'+privateKey;
 let cache=oauthCaches.get(env);
 if(!cache||cache.fingerprint!==fingerprint){cache={fingerprint,email,privateKey,token:null,expiresAt:0,pending:null,key:null};oauthCaches.set(env,cache);}
 const base=PUBLISHER_URL+encodeURIComponent(config.packageName)+'/purchases/';
 async function request(path,method='GET'){
  const bearer=await accessToken(cache);
  const response=await googleRequest(base+path,{method,headers:{'Authorization':'Bearer '+bearer,'Accept':'application/json',...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:'{}'}:{})},262144,{empty:method==='POST'});
  if(!response.ok){
   if(response.status===401)cache.token=null;
   if([400,404,410].includes(response.status))throw new GooglePlayBillingError('google_play_purchase_unverified','Google Play could not verify this purchase.',400);
   throw unavailable();
  }
  return response.data;
 }
 return Object.freeze({
  get:purchaseToken=>request('subscriptionsv2/tokens/'+encodeURIComponent(validToken(purchaseToken))),
  acknowledge:(purchaseToken,productId)=>{
   validToken(purchaseToken);
   if(typeof productId!=='string'||!/^[A-Za-z0-9._-]{1,200}$/.test(productId))throw new GooglePlayBillingError('invalid_google_play_token','Invalid Google Play subscription product.',400);
   return request('subscriptions/'+encodeURIComponent(productId)+'/tokens/'+encodeURIComponent(purchaseToken)+':acknowledge','POST');
  }
 });
}

async function fetchGoogleKeys(){
 if(jwksPending)return jwksPending;
 jwksPending=(async()=>{
  const response=await googleRequest(JWKS_URL,{method:'GET',headers:{'Accept':'application/json'}},131072);
  if(!response.ok||!Array.isArray(response.data?.keys)||response.data.keys.length<1||response.data.keys.length>32)throw unavailable();
  const keys=new Map();
  for(const jwk of response.data.keys){
   if(!object(jwk)||jwk.kty!=='RSA'||jwk.alg&&jwk.alg!=='RS256'||jwk.use&&jwk.use!=='sig'||
      typeof jwk.kid!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(jwk.kid)||keys.has(jwk.kid)||
      typeof jwk.n!=='string'||jwk.n.length>1400||typeof jwk.e!=='string'||jwk.e.length>12)throw unavailable();
   let key;try{
    if(decodeBase64url(jwk.n).length<256||decodeBase64url(jwk.e).length>8)throw Error('invalid_key');
    key=await crypto.subtle.importKey('jwk',{kty:'RSA',n:jwk.n,e:jwk.e,alg:'RS256',ext:true,key_ops:['verify']},{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
   }catch{throw unavailable();}
   keys.set(jwk.kid,key);
  }
  const age=/\bmax-age=(\d+)\b/i.exec(response.cacheControl||'');
  const ttl=age?Math.min(Number(age[1]),3600)*1000:300000;
  jwksCache={keys,expiresAt:Date.now()+ttl};return jwksCache;
 })();
 try{return await jwksPending;}finally{jwksPending=null;}
}
async function googleVerificationKey(kid){
 const fresh=jwksCache?.expiresAt>Date.now();
 let cache=fresh?jwksCache:await fetchGoogleKeys();
 if(cache.keys.has(kid))return cache.keys.get(kid);
 // A cached certificate set may predate Google's key rotation. Refresh once,
 // while bounding repeated random kid requests from unauthenticated callers.
 if(fresh&&Date.now()-lastUnknownRefresh>=30000){lastUnknownRefresh=Date.now();cache=await fetchGoogleKeys();}
 if(!cache.keys.has(kid))throw unverified();
 return cache.keys.get(kid);
}
export async function verifyGooglePlayPubSub(request,config){
 const expected=config?.pubsub;
 if(typeof expected?.email!=='string'||!expected.email||typeof expected.audience!=='string'||!expected.audience)throw notConfigured();
 const authorization=request?.headers?.get?.('authorization');
 if(typeof authorization!=='string'||authorization.length>JWT_LIMIT+7)throw unverified();
 const match=/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization);
 if(!match||match[1].length>JWT_LIMIT)throw unverified();
 const [headerPart,payloadPart,signaturePart]=match[1].split('.');let header,claims,signature;
 try{
  header=JSON.parse(decoder.decode(decodeBase64url(headerPart)));claims=JSON.parse(decoder.decode(decodeBase64url(payloadPart)));signature=decodeBase64url(signaturePart);
  if(!object(header)||!object(claims)||header.alg!=='RS256'||typeof header.kid!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(header.kid)||header.crit!==undefined||
     header.typ!==undefined&&header.typ!=='JWT'||signature.length<256||signature.length>1024)throw Error('invalid_jwt');
  const now=Math.floor(Date.now()/1000);
  if(!['accounts.google.com','https://accounts.google.com'].includes(claims.iss)||claims.aud!==expected.audience||claims.email!==expected.email||claims.email_verified!==true||
     !Number.isSafeInteger(claims.exp)||!Number.isSafeInteger(claims.iat)||claims.exp<=now||claims.iat>now+60||claims.iat<now-3900||claims.exp<=claims.iat||claims.exp-claims.iat>3900||
     claims.nbf!==undefined&&(!Number.isSafeInteger(claims.nbf)||claims.nbf>now+60))throw Error('invalid_claims');
 }catch{throw unverified();}
 const key=await googleVerificationKey(header.kid);
 let verified=false;try{verified=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,signature,encoder.encode(headerPart+'.'+payloadPart));}catch{}
 if(!verified)throw unverified();
 return claims;
}
