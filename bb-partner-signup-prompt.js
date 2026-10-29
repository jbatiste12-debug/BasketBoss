/* QA-only post-sign-in household prompt; no entitlement grants or state writes. */
(()=>{'use strict';
 if(location.hostname!=='basketboss-partner-qa.pages.dev')return;
 const KEY='basketboss_cloud_session_v1';
 let counter=0;
 const getSession=()=>{try{const s=JSON.parse(localStorage.getItem(KEY)||'null');return s?.access_token&&s?.user?.id?s:null}catch{return null}};
 const shown=id=>'bb_partner_signup_prompt_dismissed_v2_'+id;
 const preference=()=>{try{
   const x=JSON.parse(localStorage.getItem('bb_onboarding_fresh_once_20261028_v1')||'null');
   return x?.wantsPartnerInvite===true?'invite':x?.partnerIntent==='join'?'join':'none';
  }catch{return 'none'}};
 const dismissed=id=>{try{return sessionStorage.getItem(shown(id))==='yes'}catch{return false}};
 function dismiss(id){try{sessionStorage.setItem(shown(id),'yes')}catch{}const c=document.getElementById('bb-partner-signin-prompt');if(c)c.remove()}
 function openSharing(){const btn=document.querySelector('#cloud-signed [data-bbhs-trigger]')||document.querySelector('[data-bbhs-trigger]');
  if(btn){btn.click();return}const msg=document.getElementById('cloud-message');if(msg)msg.textContent='Open Settings and choose Share with Partner.';
 }
 const el=(tag,cls,text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text)x.textContent=text;return x};
 async function render(){
  const stamp=++counter,session=getSession();
  const parent=document.getElementById('cloud-signed');
  const old=document.getElementById('bb-partner-signin-prompt');if(old)old.remove();
  if(!session||!parent||parent.hidden||dismissed(session.user.id))return;
  let response,data;
  try{response=await fetch('/api/household?mode=status',{
   method:'GET',cache:'no-store',credentials:'same-origin',
   headers:{Authorization:'Bearer '+session.access_token,Accept:'application/json'}
  });data=response.ok?await response.json():null;}catch{return}
  if(stamp!==counter||getSession()?.user?.id!==session.user.id||!data?.configured||!parent.isConnected)return;
  if(data.role==='partner' && data.household_id)return; // Already connected.
  if(data.role==='owner' && data.invite_status==='accepted')return; // Already connected.
  const wanted=preference();
  const box=el('section','bb-psu-prompt');box.id='bb-partner-signin-prompt';
  const title=el('strong','bb-psu-title',data.invite?'👥 Your partner has invited you':
    data.premium?(data.invite_status==='pending'?'👥 Your partner invitation is pending':wanted==='invite'?'👥 Ready to invite your partner?':'👥 Would you like to link a partner?'):
    wanted==='invite'?'👥 Your partner-sharing choice is saved':'👥 Plan together with Premium');
  const detail=el('p','bb-psu-desc',data.invite?'Accept the invitation to share one meal plan, pantry and shopping list.':
    data.premium?(data.invite_status==='pending'?'Your invited partner can join by signing into the QA app with their confirmed email.':wanted==='invite'?'You chose Partner Sharing during onboarding. Enter one partner email to invite them securely.':'Share one household plan with one additional verified-email partner.'):
    wanted==='invite'?'You chose Partner Sharing during onboarding. Activate Premium first, then invite one verified partner email. No invitation has been sent yet.':'Premium lets you invite one partner to sync your household across two phones.');
  const actions=el('div','bb-psu-actions');
  const primary=el('button','bb-psu-primary',data.invite?'Review household invitation':data.premium?(data.invite_status==='pending'?'Manage partner invite':'Invite my partner'):'Explore Premium');
  primary.type='button';primary.onclick=()=>{if(data.invite||data.premium)openSharing();else location.href='/pricing-sandbox.html'};
  const later=el('button','bb-psu-secondary','Not now');later.type='button';later.onclick=()=>dismiss(session.user.id);
  actions.append(primary,later);box.append(title,detail,actions);parent.append(box);
 }
 const refresh=()=>{void render()};
 const start=()=>{refresh();window.addEventListener('basketboss:session-changed',refresh);window.addEventListener('focus',refresh);
  // UI may open after the event: this event hooks the existing Account button without changing its handler.
  document.getElementById('cloud-open')?.addEventListener('click',()=>{queueMicrotask(refresh)});
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
