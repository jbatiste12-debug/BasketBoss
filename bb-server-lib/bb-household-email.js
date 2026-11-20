/* Optional transactional invitation delivery. This module never creates users,
   grants membership, changes invites or treats a link as authorisation. */
export const HOUSEHOLD_INVITE_ENTRY_URL='https://www.basketboss.co.uk/app#partner-sharing';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL=/^[^\s@<>\u0000-\u001f\u007f]+@[^\s@<>\u0000-\u001f\u007f]+\.[^\s@<>\u0000-\u001f\u007f]+$/;
const HOUR=3600000;
function configuration(env){
 const key=typeof env.RESEND_API_KEY==='string'?env.RESEND_API_KEY.trim():'';
 const from=typeof env.BB_HOUSEHOLD_INVITE_EMAIL_FROM==='string'?env.BB_HOUSEHOLD_INVITE_EMAIL_FROM.trim():'';
 const address=from.match(/^(?:[^<>\r\n]+ <([^<>]+)>|([^<>]+))$/);
 if(env.BB_HOUSEHOLD_INVITE_EMAIL_ENABLED!=='true'||key.length<20||/\s/.test(key)||!address||!EMAIL.test(address[1]||address[2])||from.length>254||/[\u0000-\u001f\u007f]/.test(from))return null;
 return {key,from};
}
function result(available,status,message,extra={}){
 return {email_available:available,email_sent:status==='accepted',email_status:status,message,...extra};
}
function validPending(record,ownerId,recipient,householdId,now){
 const {household,invite}=record||{};
 return household?.id===householdId&&household.owner_user_id===ownerId&&
  household.partner_email===recipient&&household.invite_status==='pending'&&household.partner_user_id===null&&
  UUID.test(invite?.id||'')&&invite.household_id===householdId&&invite.partner_email===recipient&&
  invite.status==='pending'&&invite.accepted_by===null&&typeof invite.expires_at==='string'&&
  Number.isFinite(Date.parse(invite.expires_at))&&Date.parse(invite.expires_at)>now;
}
async function ownerHourKey(ownerId,now){
 // Provider-wide idempotency, not an in-memory counter. A changed recipient in
 // the same owner's hour reuses this key and Resend refuses the changed body.
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ownerId+':'+Math.floor(now/HOUR)));
 return 'bb-household-invite/'+Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
}
export async function sendHouseholdInviteEmail(env,{ownerId,recipient,householdId,readPending},{fetcher=fetch,now=Date.now}={}){
 const config=configuration(env);
 if(!config)return result(false,'not_configured','Invite saved. Email invitations are not configured. Ask your partner to sign in using their confirmed email.');
 if(!UUID.test(ownerId||'')||!UUID.test(householdId||'')||typeof recipient!=='string'||recipient!==recipient.trim().toLowerCase()||recipient.length>254||!EMAIL.test(recipient)||typeof readPending!=='function')
  return result(true,'not_sent','Invite saved, but email sending could not be confirmed. Refresh Partner Sharing before trying again.');
 try{
  const record=await readPending(),timestamp=now();
  if(!Number.isFinite(timestamp)||!validPending(record,ownerId,recipient,householdId,timestamp))
   return result(true,'not_sent','The invitation has changed or expired. Refresh Partner Sharing before trying again.');
  const details={invite_url:HOUSEHOLD_INVITE_ENTRY_URL,invite_expires_at:record.invite.expires_at};
  // Keep the payload identical within the owner/hour. Expiry, names, invite IDs
  // and user text must not be inserted: retries must retain provider deduplication.
  const payload={from:config.from,to:[recipient],subject:'Your BasketBoss household invitation',text:[
   'You have been invited to share a household in BasketBoss.',
   '',
   'Open BasketBoss and sign in using the confirmed email address that received this invitation:',
   HOUSEHOLD_INVITE_ENTRY_URL,
   '',
   'Go to Settings > Household Partner Sharing to review and accept your invitation.',
   'Invitations expire after 7 days and can be revoked by the household owner. BasketBoss will check that your invitation is still valid before you can accept.',
   '',
   'This link does not sign you in or give anyone access to your household.',
   'If you were not expecting this invitation, you can ignore this email.',
   '',
   'BasketBoss — Shop your kitchen first.'
  ].join('\n')};
  const response=await fetcher('https://api.resend.com/emails',{
   method:'POST',headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json','Idempotency-Key':await ownerHourKey(ownerId,timestamp)},
   body:JSON.stringify(payload),signal:AbortSignal.timeout(8000),redirect:'manual'
  });
  const body=await response.json().catch(()=>null);
  if(response.ok&&UUID.test(body?.id||''))
   return result(true,'accepted','Invite saved. The invitation email has been accepted for sending. Delivery is not yet confirmed.',details);
  if(response.status===409&&['invalid_idempotent_request','concurrent_idempotent_requests'].includes(body?.name))
   return result(true,'rate_limited','Invite saved. An invitation email has already been requested recently. Share the link or try email again later.',{...details,retry_after_seconds:Math.max(1,Math.ceil((HOUR-timestamp%HOUR)/1000))});
  return result(true,'unavailable','Invite saved, but the invitation email could not be confirmed. Share the link or try again later.',details);
 }catch{
  // The invitation RPC has already succeeded. Provider/database readback errors
  // must never turn that success into a misleading request to recreate the invite.
  return result(true,'unavailable','Invite saved, but the invitation email could not be confirmed. Ask your partner to sign in using their confirmed email.');
 }
}
