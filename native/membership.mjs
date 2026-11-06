import {isNativeBillingURL,nativeMembershipURL} from './routing.mjs';

const APPLE_PLANS=Object.freeze([{id:'uk.co.basketboss.premium.monthly',name:'Monthly Premium',period:'per month'},{id:'uk.co.basketboss.premium.annual',name:'Annual Premium',period:'per year'}]);
export function applePlanPresentation(state,plan){
 const product=(state.products||[]).find(value=>value.id===plan.id),test=state.authenticated&&state.premiumAccess&&state.sandboxPurchaseAllowed===true;
 return {price:product?.displayPrice?product.displayPrice+' '+plan.period:'Price shown by Apple',action:!state.authenticated?'Sign in to subscribe':test?'Test subscription with Apple':product?'Subscribe with Apple':'Try Apple subscription',disabled:state.busy===true};
}

// Keep web processors blocked. Native Apple purchases are provided separately
// and access is always confirmed by the server.
export function installNativeMembership({apiURL,readSession,fetch:perform=globalThis.fetch,document:doc=globalThis.document,window:win=globalThis.window,purchases=null}){
 const url=path=>typeof apiURL==='function'?apiURL(path):apiURL+path;
 let observer,card,status,login,revision=0,unsubscribe,headerUnsubscribe,viewState='checking';
 const hide=node=>{if(node&&!node.classList.contains('bb-native-hidden'))node.classList.add('bb-native-hidden');};
 const text=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;};
 const memberLabel=()=>win.BasketBossMembershipUI?.label?.()||({signed_out:'FREE · Upgrade to Premium',free:'FREE · Upgrade to Premium',premium:'PREMIUM',checking:'Checking membership…'}[purchases?.state?.membershipState||viewState]||'Check membership');
 function publishState(value){
  viewState=value;win.BasketBossNativeMembershipState=value;
  win.BasketBossMembershipUI?.setNativeState?.(value);
  const comparison=doc.getElementById('bbNativePlanComparison');if(comparison)comparison.hidden=value==='premium';
  text(doc.getElementById('bbNativeMembershipHeading'),value==='premium'?'Your Premium membership':'Free or Premium?');
 }
 const token=()=>{const s=readSession();return s?.access_token&&Number(s.expires_at)*1000>Date.now()+5000?s.access_token:null;};
 function signIn(){const open=doc.getElementById('cloud-open');if(open)open.click();else win.location.assign('index.html#account');}
 async function refresh(){
  if(purchases)return purchases.refresh();
  if(!status)return;const bearer=token(),current=++revision;login.hidden=Boolean(bearer);
  if(!bearer){publishState('signed_out');text(status,'Free recipes are ready to use. Sign in to access an existing BasketBoss account.');return;}
  publishState('checking');text(status,'Checking your membership…');
  try{
   const result=await perform(url('/api/subscription/status'),{headers:{Authorization:'Bearer '+bearer,Accept:'application/json'},cache:'no-store',credentials:'omit'});
   if(token()!==bearer||current!==revision)return;
   if(!result.ok)throw Error('Membership could not be checked. Please sign in again or try later.');
   const data=await result.json();
   if(token()!==bearer||current!==revision)return;
   if(data.authenticated!==true||typeof data.premiumAccess!=='boolean')throw Error('Sign in again to check your membership.');
   publishState(data.premiumAccess?'premium':'free');
   text(status,data.premiumAccess===true?'Your existing Premium membership is available.':'Your account currently has Free access.');
  }catch(error){if(token()===bearer&&current===revision){publishState('unavailable');text(status,error.message||'Membership is temporarily unavailable.');}}
 }
 function mount(parent){
  if(card?.isConnected)return;
  card=doc.createElement('section');card.className='bb-native-membership';card.setAttribute('aria-label','BasketBoss membership');
  const title=doc.createElement('h3');title.textContent=purchases?'Your membership':'Your BasketBoss account';
  const note=doc.createElement('p');note.textContent=purchases?'Choose an Apple plan, restore a purchase or sign in to your existing membership.':'Use 100 recipes free, or sign in to an existing account. Purchases and account creation are not available in this iOS build.';
  status=doc.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  login=doc.createElement('button');login.type='button';login.textContent='Sign in';login.addEventListener('click',signIn);
  const legal=doc.createElement('p');legal.className='bb-native-membership-legal';
  const privacy=doc.createElement('a');privacy.href='/privacy';privacy.textContent='Privacy';
  const terms=doc.createElement('a');terms.href='/terms';terms.textContent='Terms';
  legal.append(privacy,doc.createTextNode(' · '),terms);
  card.append(title,note,status,login,legal);parent.append(card);
  if(purchases)mountPurchases(card,legal);else void refresh();
 }
 function mountPurchases(parent,legal){
  const beta=doc.createElement('button');beta.type='button';beta.className='bb-native-apple-plan bb-native-apple-secondary bb-native-beta-unlock';beta.textContent='Unlock TestFlight Beta Premium';
  const betaNote=doc.createElement('p');betaNote.className='bb-native-apple-disclosure';
  beta.addEventListener('click',()=>{
   if(!token()){signIn();return;}
   if(typeof purchases.claimBeta!=='function'){text(status,'Update BasketBoss to the latest TestFlight build to unlock Beta Premium.');return;}
   void purchases.claimBeta();
  });
  const heading=doc.createElement('h4');heading.textContent='BasketBoss Premium';
  const benefits=doc.createElement('p');benefits.textContent='Explore the full recipe collection, batch cooking and eligible AI meal tools.';
  const plans=doc.createElement('div');plans.className='bb-native-apple-plans';plans.setAttribute('aria-label','Apple subscription purchase options');
  const catalogue=doc.createElement('p');catalogue.className='bb-native-apple-disclosure bb-native-apple-catalogue-state';catalogue.setAttribute('role','status');catalogue.setAttribute('aria-live','polite');
  const testing=doc.createElement('p');testing.className='bb-native-apple-disclosure bb-native-apple-testing';
  const controls=doc.createElement('div');controls.className='bb-native-apple-actions';
  const restore=doc.createElement('button');restore.type='button';restore.className='bb-native-apple-secondary';restore.textContent='Restore Purchases';
  restore.addEventListener('click',()=>{if(!token()){signIn();return;}void purchases.restore();});
  const manage=doc.createElement('button');manage.type='button';manage.textContent='Manage Apple subscription';manage.addEventListener('click',()=>{void purchases.manage();});
  const retry=doc.createElement('button');retry.type='button';retry.className='bb-native-apple-secondary';retry.textContent='Refresh membership & prices';retry.addEventListener('click',()=>{void purchases.refresh();});
  controls.append(restore,manage,retry);
  const recurring=doc.createElement('p');recurring.className='bb-native-apple-disclosure';recurring.textContent='Payment is charged to your Apple Account when you confirm. Subscriptions renew automatically unless cancelled before renewal. You can manage or cancel in your Apple Account subscription settings. Apple shows your local price and billing period before you confirm.';
  parent.append(heading,benefits,plans,catalogue,testing,controls,recurring,beta,betaNote);
  // Keep the same privacy/terms links beside the Apple recurring-payment terms.
  parent.append(legal);
  let productKey='';
  unsubscribe=purchases.subscribeState(state=>{
   const duplicateCatalogue=state.availabilityMessage&&state.message===state.availabilityMessage;
   text(status,duplicateCatalogue?(state.authenticated?'Your account currently has Free access.':'Sign in to subscribe. Your Free recipes remain available.'):state.message);login.hidden=state.authenticated;login.disabled=state.busy;
   const nativeIOS=win.BBNative?.isNative===true&&win.BBNative.platform==='ios';
   beta.hidden=!nativeIOS||!state.authenticated;beta.disabled=state.busy||state.premiumAccess;
   betaNote.hidden=beta.hidden;
   let betaExpiry=null;try{if(typeof state.beta?.expiresAt==='string'&&Number.isFinite(Date.parse(state.beta.expiresAt)))betaExpiry=new Date(state.beta.expiresAt).toLocaleDateString('en-GB');}catch{}
   text(betaNote,state.provider==='testflight_beta'&&state.premiumAccess?'TestFlight Beta Premium is active'+(betaExpiry?' until '+betaExpiry:'')+'. No subscription or renewal charge.':state.premiumAccess?'Your existing membership already provides Premium access.':'For eligible TestFlight builds. Unlock Premium for beta testing without starting a subscription. Your signed-in account and Apple-signed app are verified securely.');
   restore.disabled=state.busy;retry.disabled=state.busy;manage.disabled=state.busy;manage.hidden=state.provider!=='apple';
   plans.hidden=false;recurring.hidden=false;heading.hidden=false;benefits.hidden=false;
   text(catalogue,state.availabilityMessage||state.productLoadMessage||(!state.available?state.message:''));catalogue.hidden=!catalogue.textContent;catalogue.setAttribute('data-product-load-state',state.productLoadState||(!state.available?'unavailable':'ready'));
   testing.hidden=!state.premiumAccess;
   text(testing,state.premiumAccess?(state.sandboxPurchaseAllowed===true?'Sandbox purchase testing is available for this account. Apple test subscriptions do not charge real money.':'Your existing membership covers Premium. No additional Apple subscription is needed.'):'');
   const key=JSON.stringify({products:state.products,authenticated:state.authenticated,busy:state.busy,premiumAccess:state.premiumAccess,sandboxPurchaseAllowed:state.sandboxPurchaseAllowed});
   if(key===productKey)return;productKey=key;
   plans.replaceChildren();
   for(const plan of APPLE_PLANS){
    const presentation=applePlanPresentation(state,plan);
    const button=doc.createElement('button');button.type='button';button.className='bb-native-apple-plan';button.disabled=presentation.disabled;
    button.setAttribute('data-apple-product',plan.id);button.setAttribute('aria-label',plan.name+' · '+presentation.action);
    const label=doc.createElement('strong');label.textContent=plan.name;
    const price=doc.createElement('span');price.textContent=presentation.price;
    const action=doc.createElement('small');action.textContent=presentation.action;
    button.append(label,price,action);
    button.addEventListener('click',()=>{if(!token()){signIn();return;}void purchases.subscribe(plan.id);});
    plans.append(button);
   }
  });
 }
 function tidy(){
  const shortcut=doc.getElementById('bb16AccountShortcut');text(shortcut,'Account');if(shortcut&&shortcut.getAttribute('aria-label')!=='Open BasketBoss account')shortcut.setAttribute('aria-label','Open BasketBoss account');
  const intro=doc.getElementById('bbIntroTrialDialog');if(intro?.open)intro.close();hide(intro);
  doc.querySelectorAll('#bbMembershipSettings,.bbc-secondary,.bbc-note,.bb173-tier-plans,.bb173-tier-disclaimer,#bb175TierCompare,.bb175-tier-compare,.bbtrial-plans,.bbtrial-legal').forEach(node=>{if(node.tagName==='DIALOG'&&node.open)node.close();hide(node);});
  for(const node of doc.querySelectorAll('.bbob-plan-premium')){
   if(node.dataset.nativeMembership==='true')continue;
   node.dataset.nativeMembership='true';node.replaceChildren();
   const title=doc.createElement('strong');title.textContent='Already have Premium?';
   const p=doc.createElement('p');p.textContent=purchases?'Sign in to use your existing membership, or choose an Apple subscription in your account.':'Sign in to use your existing membership. Purchases are not offered here.';node.append(title,p);
  }
  for(const node of doc.querySelectorAll('.bbob-footnote'))if(/Paddle|trial|checkout|renewal|Founder/i.test(node.textContent))text(node,purchases?'Use BasketBoss Free, sign in to an existing membership, or choose an Apple subscription in your account.':'Use BasketBoss Free, or sign in to your existing account. Purchases are not available in this iOS build.');
  for(const node of doc.querySelectorAll('a[href]')){
   if(!isNativeBillingURL(node.getAttribute('href'),win.location.href))continue;
   const target=nativeMembershipURL(win.location.href);
   if(node.getAttribute('href')!==target)node.setAttribute('href',target);
   text(node,memberLabel());
  }
  for(const node of doc.querySelectorAll('.bb17513-meal-premium')){
   const target=nativeMembershipURL(win.location.href);
   if(node.getAttribute('href')!==target)node.setAttribute('href',target);
   // This is also a billing anchor handled above. Both passes must agree:
   // toggling two labels here creates an endless childList observer loop on
   // capacitor://localhost and prevents timers, app scripts and taps running.
   text(node,memberLabel());
   if(node.getAttribute('aria-label')!==memberLabel())node.setAttribute('aria-label',memberLabel());
  }
  for(const node of doc.querySelectorAll('#bb175Compare,#bbpolUpgradePill,button[data-bbob="premium"]'))text(node,memberLabel());
  const parent=doc.getElementById('bbNativeMembershipMount')||doc.getElementById('bbuiLinksSection');if(parent)mount(parent);
  doc.querySelectorAll('[data-native-signin]').forEach(node=>{if(!node.dataset.nativeReady){node.dataset.nativeReady='true';node.addEventListener('click',()=>win.location.assign('index.html#account'));}});
 }
 if(purchases)headerUnsubscribe=purchases.subscribeState(state=>publishState(state.membershipState||'checking'));
 else publishState(token()?'checking':'signed_out');
 tidy();observer=new MutationObserver(tidy);observer.observe(doc.body,{childList:true,subtree:true});
 win.addEventListener('basketboss:session-changed',refresh);win.addEventListener('focus',refresh);win.addEventListener('basketboss:apple-membership-updated',refresh);
 if(win.location.hash==='#account')doc.getElementById('cloud-open')?.click();
 return {refresh,destroy(){unsubscribe?.();headerUnsubscribe?.();observer.disconnect();win.removeEventListener('basketboss:session-changed',refresh);win.removeEventListener('focus',refresh);win.removeEventListener('basketboss:apple-membership-updated',refresh);}};
}
