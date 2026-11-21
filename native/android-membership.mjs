import {androidMembershipURL,isAndroidBillingURL} from './android-routing.mjs';

// Both the account-only fallback and Play UI use server membership presentation.
// Neither writes an entitlement, session, or purchase proof to browser storage.
export function installAndroidMembership({window:win=globalThis.window,document:doc=globalThis.document,readSession,apiURL,fetch:perform=globalThis.fetch,purchases=null}={}){
 let sequence=0,card,status,login,message='',phase='signed_out',destroyed=false,unsubscribe,unsubscribePlans;
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
  paintDeletionManage();
 }
 async function refresh(){
  if(destroyed||deleting())return false;
  if(purchases){await purchases.refresh();return purchases.state.premiumAccess===true;}
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
  const note=doc.createElement('p');note.textContent=purchases?'Use the Free recipes, sign in to your existing membership, or choose an eligible Google Play plan.':'Use the Free recipes, or sign in to an existing Premium account. New purchases are not available in this Android test build.';
  status=doc.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  login=doc.createElement('button');login.type='button';login.textContent='Sign in';login.addEventListener('click',signIn);
  const retry=doc.createElement('button');retry.type='button';retry.textContent=purchases?'Refresh membership & prices':'Refresh membership';retry.addEventListener('click',()=>void refresh());
  const legal=doc.createElement('p');legal.className='bb-native-membership-legal';
  for(const [name,href]of [['Privacy','/privacy'],['Terms','/terms']]){const link=doc.createElement('a');link.textContent=name;link.href=href;legal.append(link);}
  card.append(title,note,status,login,retry,legal);if(purchases)mountPurchases(card,retry,legal);parent.append(card);paint();
 }
 function mountPurchases(parent,retry,legal){
  const heading=doc.createElement('h4');heading.textContent='BasketBoss Premium';
  const benefits=doc.createElement('p');benefits.textContent='Explore the full recipe collection, batch cooking and eligible AI meal tools.';
  const plans=doc.createElement('div');plans.className='bb-native-google-plans';plans.setAttribute('aria-label','Google Play subscription options');
  const catalogue=doc.createElement('p');catalogue.className='bb-native-membership-disclosure';
  const controls=doc.createElement('div');controls.className='bb-native-google-actions';
  const restore=doc.createElement('button');restore.type='button';restore.className='bb-native-google-secondary';restore.textContent='Restore purchases';restore.addEventListener('click',()=>{if(!identity()){signIn();return;}void purchases.restore();});
  const manage=doc.createElement('button');manage.type='button';manage.textContent='Manage Google Play subscription';manage.addEventListener('click',()=>void purchases.manage());
  controls.append(restore,manage);
  const terms=doc.createElement('p');terms.className='bb-native-membership-disclosure';
  parent.append(heading,benefits,plans,catalogue,controls,terms,legal);
  let previous='';
  unsubscribePlans=purchases.subscribeState(state=>{
   restore.disabled=state.busy;manage.disabled=state.busy;retry.disabled=state.busy;login.disabled=state.busy;
   manage.hidden=!state.authenticated;text(manage,state.provider==='google_play'?'Manage Google Play subscription':'Google Play subscription settings');
   text(catalogue,state.availabilityMessage||'');catalogue.hidden=!catalogue.textContent;catalogue.setAttribute('data-product-load-state',state.productLoadState);
   plans.hidden=state.premiumAccess;heading.hidden=state.premiumAccess;benefits.hidden=state.premiumAccess;
   terms.hidden=state.premiumAccess||!state.offers.length;
   text(terms,(state.offers.some(offer=>offer.hasTrial)?'Payment is charged to your Google Play account when you confirm, or when the eligible free trial shown for your selected offer ends. ':'Payment is charged to your Google Play account when you confirm. ')+'Subscriptions renew automatically at the renewal price shown above unless cancelled before renewal. Manage or cancel in Google Play before your trial or billing period ends. Google Play confirms your selected offer and price before purchase.');
   const next=JSON.stringify({offers:state.offers,busy:state.busy,available:state.available,premiumAccess:state.premiumAccess,authenticated:state.authenticated,membershipState:state.membershipState});
   if(next===previous)return;previous=next;plans.replaceChildren();
   for(const offer of state.offers){
    const button=doc.createElement('button');button.type='button';button.className='bb-native-google-plan';button.disabled=state.busy||!state.available||state.premiumAccess||state.authenticated&&state.membershipState!=='free';
    button.setAttribute('data-google-play-plan',offer.plan);
    const label=doc.createElement('strong');label.textContent=offer.title;
    const price=doc.createElement('span');price.textContent=offer.price;
    const action=doc.createElement('small');action.textContent=state.authenticated?'Continue with Google Play':'Sign in to continue';
    button.append(label,price,action);button.addEventListener('click',()=>{if(!identity()){signIn();return;}void purchases.subscribe(offer.key);});plans.append(button);
   }
  });
 }
 function paintDeletionManage(){
  const button=doc.getElementById('bbGooglePlayDeletionManage');
  if(button){const disabled=deleting()||purchases?.state?.busy===true;if(button.disabled!==disabled)button.disabled=disabled;}
 }
 function mountDeletionNotice(){
  const explanation=doc.getElementById('bbAccountDeletionExplanation');
  if(!purchases||!explanation||doc.getElementById('bbGooglePlayDeletionNotice'))return;
  const notice=doc.createElement('div');notice.id='bbGooglePlayDeletionNotice';notice.className='bb-native-membership';
  const note=doc.createElement('p');note.textContent='Deleting your BasketBoss account does not cancel Google Play billing. Manage or cancel your subscription in Google Play. You can still delete your account without cancelling first.';
  const manage=doc.createElement('button');manage.id='bbGooglePlayDeletionManage';manage.type='button';manage.className='bb-native-google-secondary';manage.textContent='Google Play subscription settings';
  manage.addEventListener('click',()=>{if(!deleting()&&!purchases.state.busy)void purchases.manage();});
  notice.append(note,manage);explanation.append(notice);paintDeletionManage();
 }
 function tidy(){
  if(destroyed)return;
  mountDeletionNotice();
  const intro=doc.getElementById('bbIntroTrialDialog');if(intro?.open)intro.close();hide(intro);
  hide(doc.getElementById('bbNativePlanComparison'));
  const lead=doc.getElementById('bbNativeMembershipHeading')?.nextElementSibling;
  if(lead?.tagName==='P'&&/choose Apple Premium/.test(lead.textContent))text(lead,purchases?'Use the Free recipes, or sign in to view your Premium options.':'Use the Free recipes, or sign in to your existing account. Purchases are not available in this Android test build.');
  doc.querySelectorAll('#bbMembershipSettings,.bbc-secondary,.bbc-note,.bb173-tier-plans,.bb173-tier-disclaimer,#bb175TierCompare,.bb175-tier-compare,.bbtrial-plans,.bbtrial-legal').forEach(node=>{if(node.tagName==='DIALOG'&&node.open)node.close();hide(node);});
  for(const node of doc.querySelectorAll('.bbob-plan-premium')){
   if(node.dataset.androidMembership==='true')continue;
   node.dataset.androidMembership='true';
   const title=doc.createElement('strong');title.textContent='Already have Premium?';const p=doc.createElement('p');p.textContent=purchases?'Sign in to use your existing membership, or view eligible Google Play plans in your account.':'Sign in to use your existing membership. Purchases are not available in this Android test build.';node.replaceChildren(title,p);
  }
  for(const node of doc.querySelectorAll('.bbob-footnote'))if(/Paddle|trial|checkout|renewal|Founder/i.test(node.textContent))text(node,purchases?'Use BasketBoss Free, or sign in to view your Premium options.':'Use BasketBoss Free, or sign in to an existing account. Purchases are not available in this Android test build.');
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
 if(purchases)unsubscribe=purchases.subscribeState(state=>{phase=state.membershipState;message=state.message;paint();});
 else{for(const name of refreshEvents)win.addEventListener(name,change);for(const name of ['basketboss:account-deletion-started','basketboss:account-deletion-deleted'])win.addEventListener(name,pause);void refresh();}
 return {refresh,destroy(){destroyed=true;sequence++;unsubscribe?.();unsubscribePlans?.();observer.disconnect();if(win.BasketBossNativeTrialOffer===offer)delete win.BasketBossNativeTrialOffer;for(const name of refreshEvents)win.removeEventListener(name,change);for(const name of ['basketboss:account-deletion-started','basketboss:account-deletion-deleted'])win.removeEventListener(name,pause);}};
}
