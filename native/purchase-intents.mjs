// Purchase coordination carries no entitlement. Caller requests must authenticate
// and revalidate their pinned actor before and after every response.
export const PURCHASE_INTENT_PROTOCOL=1;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const PHASES=new Set(['prepared','started','pending','unknown','completed','canceled']);
const invalid=()=>Object.assign(Error('Purchase coordination could not be confirmed. Restore or manage the existing purchase before trying again.'),{code:'purchase_intent_unavailable'});
function valid(value,{capability=true}={}){
 return value?.protocol===PURCHASE_INTENT_PROTOCOL&&UUID.test(value.id||'')&&
  (!capability||CAPABILITY.test(value.capability||''))&&Number.isSafeInteger(value.version)&&value.version>0&&
  Number.isSafeInteger(value.generation)&&value.generation>0&&PHASES.has(value.phase)&&
  ['apple','google_play','paddle'].includes(value.provider)&&['test','live'].includes(value.mode)&&ID.test(value.productId||'')&&
  (value.basePlanId===null||ID.test(value.basePlanId||''))&&(value.offerId===null||ID.test(value.offerId||''))&&
  Number.isSafeInteger(value.preparedExpiresAt)&&value.preparedExpiresAt>0&&Number.isSafeInteger(value.billingRevision)&&value.billingRevision>=0;
}
const sameAttempt=(before,after)=>['id','capability','generation','provider','mode','productId','basePlanId','offerId','preparedExpiresAt','billingRevision'].every(key=>before[key]===after[key]);
function actorBinding(actor){
 const user=actor?.user??actor?.actor,token=actor?.token;
 if(typeof user!=='string'||!user||typeof token!=='string'||!token)return null;
 try{
  const parts=token.split('.');if(parts.length!==3||parts[1].length>16000||!/^[A-Za-z0-9_-]+$/.test(parts[1]))throw Error();
  const encoded=parts[1].replace(/-/g,'+').replace(/_/g,'/'),claims=JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length/4)*4,'=')));
  if(claims.sub!==user||!UUID.test(claims.session_id||'')||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/auth\/v1$/.test(claims.iss||''))throw Error();
  return {user,issuer:claims.iss,session:claims.session_id};
 }catch{return {user,token};} // Opaque legacy clients retain exact-token routing.
}
const sameBinding=(left,right)=>!!left&&!!right&&left.user===right.user&&
 (left.session&&right.session?left.issuer===right.issuer&&left.session===right.session:typeof left.token==='string'&&left.token===right.token);
// Decoded claims route a definite cancellation only. They never authenticate a
// caller, grant Premium, or relax the original paid-receipt identity checks.
export function cleanupActor(original,current){return sameBinding(actorBinding(original),actorBinding(current))?current:null;}
function reference(reservation){
 if(reservation===null||reservation===undefined)return null;
 if(!valid(reservation))throw invalid();
 return {id:reservation.id,capability:reservation.capability,version:reservation.version,generation:reservation.generation};
}
export function createPurchaseIntentClient({request}={}){
 if(typeof request!=='function')throw invalid();
 const canceledReports=new Map();
 async function mutate(reservation,actor,action,extra={}){
  if(reservation===null||reservation===undefined)return null; // Legacy/default-off backend.
  const input=reference(reservation);
  const result=await request('/api/subscription/purchase-intent',actor,{action,reservation:input,...extra});
  const updated=result?.reservation;
  if(result?.ok!==true||!valid(updated)||!sameAttempt(reservation,updated)||updated.version!==reservation.version+1)throw invalid();
  return {...updated};
 }
 async function start(reservation,actor){
  if(reservation===null||reservation===undefined)return null;
  if(!valid(reservation)||reservation.phase!=='prepared')throw invalid();
  // No store call has occurred at this point. A fresh status observation may
  // recover this exact in-memory capability after a lost start response.
  try{
   const updated=await mutate(reservation,actor,'start');
   if(updated.phase!=='started')throw invalid();
   return updated;
  }catch(error){
   try{
    const observed=await status({mode:reservation.mode,id:reservation.id},actor);
    const recoverable=observed&&{...observed,capability:reservation.capability};
    if(recoverable&&sameAttempt(reservation,recoverable)&&recoverable.version>=reservation.version&&['prepared','started'].includes(recoverable.phase))await report(recoverable,'not_launched',actor);
   }catch{/* A failed observation/report leaves the server reservation held. */}
   throw error; // Never retry the store automatically, even after recovery.
  }
 }
 async function report(reservation,outcome,actor,cause){
  if(reservation===null||reservation===undefined)return null;
  if(outcome==='cancelled'){outcome='canceled';cause='native_user_cancelled';}
  if(outcome==='not_launched'){outcome='canceled';cause='not_launched';}
  if(!['canceled','pending','unknown'].includes(outcome)||outcome==='canceled'&&!['native_user_cancelled','not_launched'].includes(cause))throw invalid();
  reference(reservation);
  try{
   const updated=await mutate(reservation,actor,'report',{outcome,...(outcome==='canceled'?{cause}:{})});
   if(updated.phase!==outcome)throw invalid();
   if(outcome==='canceled')canceledReports.delete(reservation.id);
   return updated;
  }catch(error){
   // Only a definite native cancellation/non-launch may be retried. Keep the
   // original version for server idempotency; no storage or token rebinding.
   if(outcome==='canceled')canceledReports.set(reservation.id,{reservation:{...reservation},binding:actorBinding(actor),cause});
   throw error;
  }
 }
 async function flush(actor){
  for(const [id,entry]of canceledReports){
   if(!sameBinding(entry.binding,actorBinding(actor))){canceledReports.delete(id);continue;}
   await report(entry.reservation,'canceled',actor,entry.cause);
  }
 }
 async function status({mode,id}={},actor){
  if(!['test','live'].includes(mode)||id!==undefined&&!UUID.test(id))throw invalid();
  const result=await request('/api/subscription/purchase-intent?mode='+encodeURIComponent(mode)+(id?'&id='+encodeURIComponent(id):''),actor);
  if(result?.ok!==true||result.reservation!==null&&(!valid(result.reservation,{capability:false})||result.reservation.mode!==mode||id!==undefined&&result.reservation.id!==id))throw invalid();
  if(result.reservation===null)return null;
  // Restart/status observations cannot reconstruct a capability or authorize
  // starting, canceling or releasing a pending/unknown reservation.
  const {capability:ignored,...projection}=result.reservation;
  return projection;
 }
 return Object.freeze({start,report,status,reference,flush,cleanupActor});
}
