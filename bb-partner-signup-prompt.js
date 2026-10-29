/* BasketBoss post-sign-in Partner Sharing prompt.
 * Presentation only: no entitlement writes, no partner emails, no meal-plan
 * uploads, and no client-provided tier claims. A missing/disabled backend
 * is always shown as 'not yet available', NEVER as an active invite.
 */
(()=>{'use strict';
 if(!['basketboss.co.uk','www.basketboss.co.uk','basketboss-site.pages.dev'].includes(location.hostname))return;
 const SESSION_KEY='basketboss_cloud_session_v1';
 const ONBOARD_KEY='bb_onboarding_fresh_once_20261028_v1';
 const ELEM_ID='bb-partner-signin-prompt';
 let requestCounter=0;
 const getSession=()=>{try{const s=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');return s?.access_token&&s?.user?.id?s:null}catch{return null}};
 const onboardIntent=()=>{try{
   const o=JSON.parse(localStorage.getItem(ONBOARD_KEY)||'null');
   return o?.wantsPartnerInvite===true?'invite':o?.partnerIntent==='join'?'join':'none';
  }catch{return 'none'}};
 const dismissalKey=id=>'bb_partner_signup_prompt_dismissed_main_v1_'+id;
 const dismissed=id=>{try{return sessionStorage.getItem(dismissalKey(id))==='yes'}catch{return false}};
 const el=(tag,cls,txt)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(txt)node.textContent=txt;return node};
 function dismiss(id){try{sessionStorage.setItem(dismissalKey(id),'yes')}catch{}document.getElementById(ELEM_ID)?.remove()}
 function openSharing(){
   const button=document.querySelector('#cloud-signed [data-bbhs-trigger]')||document.querySelector('[data-bbhs-trigger]');
   if(button){button.click();return}
   const m=document.getElementById('cloud-message');if(m)m.textContent='Sharing is not yet available here; your saved plan is unchanged.';
 }
 async function render(){
   const stamp=++requestCounter;
   const session=getSession();
   const parent=document.getElementById('cloud-signed');
   document.getElementById(ELEM_ID)?.remove();
   if(!session||!parent||parent.hidden||dismissed(session.user.id))return;
   let data={configured:false};
   try{
     const r=await fetch('/api/household?mode=status',{
       method:'GET',headers:{Authorization:'Bearer '+session.access_token,Accept:'application/json'},
       credentials:'same-origin',cache:'no-store'
     });
     if(r.ok){const response=await r.json();if(response&&typeof response==='object')data=response;}
   }catch{} // Never imply linking works if the endpoint is missing or unavailable.
   if(stamp!==requestCounter||getSession()?.user?.id!==session.user.id||!parent.isConnected||parent.hidden)return;
   if(data.configured===true&&data.role==='partner'&&data.household_id)return;
   if(data.configured===true&&data.role==='owner'&&data.invite_status==='accepted')return;
   const enabled=data.configured===true;
   const intent=onboardIntent();
   const box=el('section','bb-psu-prompt');box.id=ELEM_ID;
   const title=el('strong','bb-psu-title',enabled&&data.invite?'👥 Your partner has invited you':
     enabled&&data.premium?'👥 Would you like to link a partner?':
     intent==='invite'?'👥 Your Partner Sharing choice is saved':'👥 Plan together on Premium');
   const detail=el('p','bb-psu-desc',enabled&&data.invite?
     'Your verified email has a household invitation. Review it before any changes are shared.':
     enabled&&data.premium?
     'Premium households can invite one confirmed-email partner. Existing saved plans are reviewed before syncing.':
     intent==='join'?
     'You chose Join an invitation. Secure linking is not yet available on this site. Your own saved plan stays unchanged.':
     intent==='invite'?
     'You selected Invite one partner in onboarding. You can explore Premium now; invitations will be available after secure activation. No email has been sent.':
     'Premium household sharing is being prepared: one verified partner, one shared plan, across two phones. It is not active on this site yet.');
   const actions=el('div','bb-psu-actions');
   const primary=el('button','bb-psu-primary',enabled&&data.invite?'Review household invitation':
     enabled&&data.premium?'Invite one partner':'Explore Premium');
   primary.type='button';
   primary.onclick=()=>{if(enabled&&(data.invite||data.premium))openSharing();else location.assign('/pricing-sandbox.html')};
   const later=el('button','bb-psu-secondary','Not now');later.type='button';later.onclick=()=>dismiss(session.user.id);
   actions.append(primary,later);box.append(title,detail,actions);parent.append(box);
 }
 function start(){
   const refresh=()=>{void render()};
   refresh();
   window.addEventListener('basketboss:session-changed',refresh);
   window.addEventListener('focus',refresh);
   document.getElementById('cloud-open')?.addEventListener('click',()=>queueMicrotask(refresh));
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
