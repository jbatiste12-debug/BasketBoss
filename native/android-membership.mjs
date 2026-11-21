import {androidMembershipURL,isAndroidBillingURL} from './android-routing.mjs';

// Android closed testing has account access, not a Google Play purchase flow.
// A server response changes presentation only; no local entitlement is minted.
export function installAndroidMembership({window:win=globalThis.window,document:doc=globalThis.document,readSession,apiURL,fetch:perform=globalThis.fetch}={}){
 let sequence=0,card,status,login,message='',phase='signed_out',destroyed=false;
 const deleting=()=>win.BBAccountDeletion?.isDeleting?.()===true;
 const identity=()=>{
  try{const session=readSession();
   return typeof session?.access_token==='string'&&session.access_token&&typeof session.user?.id==='string'&&session.user.id&&Number.isFinite(Number(session.expires_at))&&Number(session.expires_at)*1000>Date.now()+5000?{actor:session.user.id,token:session.access_token}:null;
  }catch{return null;}
 };
 const matches=pin=>{const now=identity();return !destroyed&&!deleting()&&pin?.actor===now?.actor&&pin?.token===now?.token;};
 const text=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;};
 const hide=node=>{if(node&&!node.classList.contains('bb-native-hidden'))node.classList.add('bb-native-hidden');};
 const label=()=>({premium:'PREMIUM',free:'FREE · Account',signed_out:'Sign in',checking:'Checking membership…',unavailable:'Check membership'}[phase]);
 function paint(){
  win.BasketBossNativeMembershipState=phase;
  win.BasketBossMembershipUI?.setNativeState?.(phase);
  text(status,message);if(login)login.hidden=!!identity()&&phase!=='signed_out';
  text(doc.getElementById('bbNativeMembershipHeading'),phase==='premium'?'Your Premium membership':'Your BasketBoss account');
 }
 async function refresh(){
  if(destroyed||deleting())return false;
  const pin=identity(),stamp=++sequence;
  if(!pin){phase='signed_out';message='Sign in to use your existing BasketBoss account. Free recipes remain available.';paint();return false;}
  phase='checking';message='Checking your membership…';paint();
  try{
   const response=await perform(apiURL('/api/subscription/status'),{headers:{Authorization:'Bearer '+pin.token,Accept:'application/json'},credentials:'omit',mode:'cors',redirect:'error',cache:'no-store'});
   if(stamp!==sequence||!matches(pin))return false;
   if(response.status===401){phase='signed_out';message='Sign in again to check your membership.';paint();return false;}
   if(!response.ok)throw Error('membership_unavailable');
   const data=await response.json();
   if(stamp!==sequence||!matches(pin))return false;
   if(data?.authenticated!==true||typeof data.premiumAccess!=='boolean'||data.premiumAccess===true&&(!['owner','premium'].includes(data.tier)||!['live','sandbox'].includes(data.mode)))throw Error('membership_unavailable');
   phase=data.premiumAccess?'premium':'free';message=data.premiumAccess?'Your existing Premium membership is available. You do not need another subscription.':'Your account currently has Free access. Purchases are not available in this Android test build.';paint();return data.premiumAccess;
  }catch{if(stamp===sequence&&matches(pin)){phase='unavailable';message='Membership could not be checked. Try again when you are connected.';paint();}return false;}
 }
 function signIn(){const button=doc.getElementById('cloud-open');if(button)button.click();else win.location.assign('index.html#account');}
 function mount(parent){
  if(card?.isConnected)return;
  card=doc.createElement('section');card.className='bb-native-membership';card.setAttribute('aria-label','BasketBoss membership');
  const title=doc.createElement('h3');title.textContent='Your BasketBoss account';
  const note=doc.createElement('p');note.textContent='Use the Free recipes, or sign in to an existing Premium account. New purchases are not available in this Android test build.';
  status=doc.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  login=doc.createElement('button');login.type='button';login.textContent='Sign in';login.addEventListener('click',signIn);
  const retry=doc.createElement('button');retry.type='button';retry.textContent='Refresh membership';retry.addEventListener('click',()=>void refresh());
  const legal=doc.createElement('p');legal.className='bb-native-membership-legal';
  for(const [name,href]of [['Privacy','/privacy'],['Terms','/terms']]){const link=doc.createElement('a');link.textContent=name;link.href=href;legal.append(link);}
  card.append(title,note,status,login,retry,legal);parent.append(card);paint();
 }
 function tidy(){
  if(destroyed)return;
  const intro=doc.getElementById('bbIntroTrialDialog');if(intro?.open)intro.close();hide(intro);
  hide(doc.getElementById('bbNativePlanComparison'));
  const lead=doc.getElementById('bbNativeMembershipHeading')?.nextElementSibling;
  if(lead?.tagName==='P'&&/choose Apple Premium/.test(lead.textContent))text(lead,'Use the Free recipes, or sign in to your existing account. Purchases are not available in this Android test build.');
  doc.querySelectorAll('#bbMembershipSettings,.bbc-secondary,.bbc-note,.bb173-tier-plans,.bb173-tier-disclaimer,#bb175TierCompare,.bb175-tier-compare,.bbtrial-plans,.bbtrial-legal').forEach(node=>{if(node.tagName==='DIALOG'&&node.open)node.close();hide(node);});
  for(const node of doc.querySelectorAll('.bbob-plan-premium')){
   if(node.dataset.androidMembership==='true')continue;
   node.dataset.androidMembership='true';
   const title=doc.createElement('strong');title.textContent='Already have Premium?';const p=doc.createElement('p');p.textContent='Sign in to use your existing membership. Purchases are not available in this Android test build.';node.replaceChildren(title,p);
  }
  for(const node of doc.querySelectorAll('.bbob-footnote'))if(/Paddle|trial|checkout|renewal|Founder/i.test(node.textContent))text(node,'Use BasketBoss Free, or sign in to an existing account. Purchases are not available in this Android test build.');
  for(const node of doc.querySelectorAll('a[href]')){
   if(!isAndroidBillingURL(node.getAttribute('href'),win.location.href))continue;
   const target=androidMembershipURL(win.location.href);if(node.getAttribute('href')!==target)node.setAttribute('href',target);text(node,label());
  }
  for(const node of doc.querySelectorAll('#bb175Compare,#bbpolUpgradePill,button[data-bbob="premium"],.bb17513-meal-premium')){text(node,label());if(node.getAttribute('aria-label')!==label())node.setAttribute('aria-label',label());}
  const parent=doc.getElementById('bbNativeMembershipMount')||doc.getElementById('bbuiLinksSection');if(parent)mount(parent);
 }
 const change=()=>{sequence++;void refresh();};
 const pause=()=>{sequence++;phase='unavailable';message='Account changes are paused during deletion.';paint();};
 const offer=Object.freeze({isEligible:()=>false});win.BasketBossNativeTrialOffer=offer;
 const Observer=win.MutationObserver||globalThis.MutationObserver,observer=new Observer(tidy);
 tidy();observer.observe(doc.body,{childList:true,subtree:true});
 const refreshEvents=['basketboss:session-changed','focus','basketboss:native-resumed','basketboss:household-changed','basketboss:account-deletion-cancelled'];
 for(const name of refreshEvents)win.addEventListener(name,change);
 for(const name of ['basketboss:account-deletion-started','basketboss:account-deletion-deleted'])win.addEventListener(name,pause);
 void refresh();
 return {refresh,destroy(){destroyed=true;sequence++;observer.disconnect();if(win.BasketBossNativeTrialOffer===offer)delete win.BasketBossNativeTrialOffer;for(const name of refreshEvents)win.removeEventListener(name,change);for(const name of ['basketboss:account-deletion-started','basketboss:account-deletion-deleted'])win.removeEventListener(name,pause);}};
}
