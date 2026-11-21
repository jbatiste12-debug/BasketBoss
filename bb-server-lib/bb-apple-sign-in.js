/* Sign in with Apple account deletion. All credentials are ephemeral and every
 * identity is checked against Supabase's authenticated user, never client data.
 * This uses separate Sign-In credentials, not the StoreKit billing signing key.
 */
import {Buffer} from 'node:buffer';
import {createHash,createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';

const APPLE='https://appleid.apple.com',BUNDLE='uk.co.basketboss.app';
const codeError=(code='deletion_apple_unavailable',status=503)=>Object.assign(Error(code),{code,status});
const fail=(code,status)=>{throw codeError(code,status);};
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max;
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
export function appleSignInConfig(env){
 if(env.APPLE_SIGN_IN_ENABLED!=='true')return null;
 const teamId=env.APPLE_SIGN_IN_TEAM_ID,keyId=env.APPLE_SIGN_IN_KEY_ID,clientId=env.APPLE_SIGN_IN_CLIENT_ID||BUNDLE;
 const privateKey=typeof env.APPLE_SIGN_IN_PRIVATE_KEY==='string'?env.APPLE_SIGN_IN_PRIVATE_KEY.replace(/\\n/g,'\n'):'';
 if(!/^[A-Z0-9]{10}$/.test(teamId||'')||!/^[A-Z0-9]{10}$/.test(keyId||'')||clientId!==BUNDLE)fail();
 let key;
 try{key=createPrivateKey(privateKey);if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')throw Error();}catch{fail();}
 return {teamId,keyId,clientId,key};
}
export function appleSignInConfigured(env){try{return !!appleSignInConfig(env);}catch{return false;}}

async function readJson(response,max=32768){
 if(Number(response.headers.get('content-length')||0)>max)fail();
 const reader=response.body?.getReader();if(!reader)fail();
 const parts=[];let size=0;
 for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>max){await reader.cancel();fail();}parts.push(part.value);}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail();}
}

// This is a fresh server /user response, with the same bearer whose deletion
// will be authorized. Locally stored provider metadata never grants access.
export async function authenticatedDeletionUser(request,env,{fetcher=fetch,onFailure}={}){
 const bearer=request.headers.get('Authorization')||'',url=String(env.SUPABASE_URL||'');
 // Only fixed failure categories leave this helper. Observers cannot change
 // authentication, and never receive a bearer, account or upstream response.
 const reject=reason=>{try{onFailure?.(reason);}catch{}return null;};
 if(!/^Bearer [^\s]+$/.test(bearer))return reject('bearer_invalid');
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)||!env.SUPABASE_PUBLISHABLE_KEY)return reject('auth_configuration');
 let response;
 try{
  response=await fetcher(url+'/auth/v1/user',{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:bearer},redirect:'error',signal:AbortSignal.timeout(6500)});
 }catch(error){return reject(['TimeoutError','AbortError'].includes(error?.name)?'auth_timeout':'auth_fetch_failed');}
 try{if(!response.ok)return reject(response.status===401||response.status===403?'auth_session_rejected':'auth_http_unavailable');}
 catch{return reject('auth_response_invalid');}
 let user;
 try{user=await readJson(response);}catch(error){return reject(['TimeoutError','AbortError'].includes(error?.name)?'auth_timeout':'auth_response_invalid');}
 try{
  if(typeof user?.id!=='string'||typeof user.email!=='string')return reject('auth_user_invalid');
  if(!user.email_confirmed_at)return reject('auth_user_unconfirmed');
  const identities=Array.isArray(user.identities)?user.identities.filter(value=>value?.provider==='apple'):[];
  const appleIdentity=identities.length>0||user.app_metadata?.providers?.includes?.('apple')===true;
  const appleSubjects=identities.map(value=>value.identity_data?.sub||value.provider_id).filter(value=>text(value,255));
  return {id:user.id,email:user.email,appleIdentity,appleSubjects};
 }catch{return reject('auth_user_invalid');}
}

function decodeJWT(value){
 if(!text(value,16384)||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value))fail('deletion_apple_required',403);
 const parts=value.split('.');let header,claims;
 try{header=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));}catch{fail('deletion_apple_required',403);}
 if(header?.alg!=='RS256'||!text(header.kid,128)||!claims||typeof claims!=='object')fail('deletion_apple_required',403);
 return {header,claims,signed:parts[0]+'.'+parts[1],signature:Buffer.from(parts[2],'base64url')};
}

export async function reauthenticateAppleDeletion(env,user,credential,{fetcher=fetch,now=Date.now}={}){
 const config=appleSignInConfig(env);if(!config)fail();
 if(!user?.appleIdentity||!Array.isArray(user.appleSubjects)||!user.appleSubjects.length||
    !credential||Object.keys(credential).some(key=>!['identityToken','nonce','authorizationCode'].includes(key))||
    typeof credential.nonce!=='string'||!/^[a-f0-9]{64}$/.test(credential.nonce)||!text(credential.authorizationCode,4096)||
    !/^[\x21-\x7e]+$/.test(credential.authorizationCode))fail('deletion_apple_required',403);
 const seconds=Math.floor(now()/1000),expectedNonce=createHash('sha256').update(credential.nonce).digest('hex');
 let keys;
 async function validate(token){
  const value=decodeJWT(token),claims=value.claims;
  if(claims.iss!==APPLE||claims.aud!==config.clientId||!text(claims.sub,255)||!user.appleSubjects.includes(claims.sub)||
     !Number.isFinite(claims.exp)||claims.exp<=seconds||!Number.isFinite(claims.iat)||claims.iat>seconds+60||claims.iat<seconds-300||
     claims.nonce!==expectedNonce)fail('deletion_apple_required',403);
  if(!keys){
   const response=await fetcher(APPLE+'/auth/keys',{redirect:'error',signal:AbortSignal.timeout(6500)});
   if(!response.ok)fail();
   const result=await readJson(response);keys=Array.isArray(result?.keys)?result.keys:[];
  }
  const jwk=keys.find(key=>key?.kid===value.header.kid&&key.kty==='RSA'&&key.alg==='RS256'&&key.use==='sig');
  if(!jwk)fail('deletion_apple_required',403);
  let valid=false;
  try{valid=verify('RSA-SHA256',Buffer.from(value.signed),createPublicKey({key:jwk,format:'jwk'}),value.signature);}catch{}
  if(!valid)fail('deletion_apple_required',403);
  return claims;
 }
 await validate(credential.identityToken);
 const header=encode({alg:'ES256',kid:config.keyId,typ:'JWT'}),payload=encode({iss:config.teamId,iat:seconds,exp:seconds+300,aud:APPLE,sub:config.clientId});
 const unsigned=header+'.'+payload,secret=unsigned+'.'+sign('sha256',Buffer.from(unsigned),{key:config.key,dsaEncoding:'ieee-p1363'}).toString('base64url');
 const parameters={client_id:config.clientId,client_secret:secret};
 const exchanged=await fetcher(APPLE+'/auth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...parameters,code:credential.authorizationCode,grant_type:'authorization_code'}),redirect:'error',signal:AbortSignal.timeout(6500)});
 if(!exchanged.ok)fail('deletion_apple_required',403);
 const tokens=await readJson(exchanged);
 // Prove that the exchanged code belongs to the same Apple subject/nonce too;
 // a valid token cannot be paired with a different person's authorization code.
 await validate(tokens?.id_token);
 if(!text(tokens?.refresh_token,8192))fail();
 const revoked=await fetcher(APPLE+'/auth/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...parameters,token:tokens.refresh_token,token_type_hint:'refresh_token'}),redirect:'error',signal:AbortSignal.timeout(6500)});
 if(!revoked.ok)fail();
 return true;
}
