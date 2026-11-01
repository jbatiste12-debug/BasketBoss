import {isNativeBillingURL,nativeMembershipURL} from './routing.mjs';

// Keep web processors blocked. Native Apple purchases are provided separately
// and access is always confirmed by the server.
export function installNativeMembership({apiURL,readSession,fetch:perform=globalThis.fetch,document:doc=globalThis.document,window:win=globalThis.window,purchases=null}){
 const url=path=>typeof apiURL==='function'?apiURL(path):apiURL+path;
 let observer,card,status,login,revision=0,unsubscribe;
 const hide=node=>{if(node&&!node.classList.contains('bb-native-hidden'))node.classList.add('bb-native-hidden');};
 const text=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;};
 const token=()=>{const s=readSession();return s?.access_token&&Number(s.expires_at)*1000>Date.now()+5000?s.access_token:null;};
 function signIn(){const open=doc.getElementById('cloud-open');if(open)open.click();else win.location.assign('index.html#account');}
 async function refresh(){
  if(purchases)return purchases.refresh();
  if(!status)return;const bearer=token(),current=++revision;login.hidden=Boolean(bearer);
  if(!bearer){text(status,'Free recipes are ready to use. Sign in to access an existing BasketBoss account.');return;}
  text(status,'Checking your membership…');
  try{
   const result=await perform(url('/api/subscription/status'),{headers:{Authorization:'Bearer '+bearer,Accept:'application/json'},cache:'no-store',credentials:'omit'});
   if(token()!==bearer||current!==revision)return;
   if(!result.ok)throw Error('Membership could not be checked. Please sign in again or try later.');
   const data=await result.json();
   if(data.authenticated!==true)throw Error('Sign in again to check your membership.');
   text(status,data.premiumAccess===true?'Your existing Premium membership is available.':'Your account currently has Free access.');
  }catch(error){if(token()===bearer&&current===revision)text(status,error.message||'Membership is temporarily unavailable.');}
 }
 function mount(parent){
  if(card?.isConnected)return;
  card=doc.createElement('section');card.className='bb-native-membership';card.setAttribute('aria-label','BasketBoss membership');
  const title=doc.createElement('h3');title.textContent=purchases?'Your membership':'Your BasketBoss account';
  const note=doc.createElement('p');note.textContent=purchases?'Use 100 recipes free. Sign in or create an account to choose Apple Premium, or restore a subscription you already bought.':'Use 100 recipes free, or sign in to an existing account. Purchases and account creation are not available in this iOS build.';
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
  const heading=doc.createElement('h4');heading.textContent='BasketBoss Premium';
  const benefits=doc.createElement('p');benefits.textContent='Explore the full recipe collection, batch cooking and eligible AI meal tools.';
  const plans=doc.createElement('div');plans.className='bb-native-apple-plans';
  const controls=doc.createElement('div');controls.className='bb-native-apple-actions';
  const restore=doc.createElement('button');restore.type='button';restore.className='bb-native-apple-secondary';restore.textContent='Restore Purchases';
  restore.addEventListener('click',()=>{if(!token()){signIn();return;}void purchases.restore();});
  const manage=doc.createElement('button');manage.type='button';manage.textContent='Manage Apple subscription';manage.addEventListener('click',()=>{void purchases.manage();});
  const retry=doc.createElement('button');retry.type='button';retry.className='bb-native-apple-secondary';retry.textContent='Refresh membership';retry.addEventListener('click',()=>{void purchases.refresh();});
  controls.append(restore,manage,retry);
  const recurring=doc.createElement('p');recurring.className='bb-native-apple-disclosure';recurring.textContent='Payment is charged to your Apple Account when you confirm. Subscriptions renew automatically unless cancelled before renewal. You can manage or cancel in your Apple Account subscription settings. Apple shows your local price and billing period before you confirm.';
  parent.append(heading,benefits,plans,controls,recurring);
  // Keep the same privacy/terms links beside the Apple recurring-payment terms.
  parent.append(legal);
  let productKey='';
  unsubscribe=purchases.subscribeState(state=>{
   text(status,state.message);login.hidden=state.authenticated;login.disabled=state.busy;
   restore.disabled=state.busy;retry.disabled=state.busy;manage.disabled=state.busy;manage.hidden=state.provider!=='apple';
   plans.hidden=state.premiumAccess||!state.products.length||!state.available;
   recurring.hidden=state.premiumAccess||!state.available;
   heading.hidden=state.premiumAccess;benefits.hidden=state.premiumAccess;
   const key=JSON.stringify({products:state.products,authenticated:state.authenticated,busy:state.busy,premiumAccess:state.premiumAccess});
   if(key===productKey)return;productKey=key;
   plans.replaceChildren();
   for(const product of state.products){
    const annual=product.id.endsWith('.annual');
    const button=doc.createElement('button');button.type='button';button.className='bb-native-apple-plan';button.disabled=state.busy||state.premiumAccess;
    button.setAttribute('data-apple-product',product.id);
    const label=doc.createElement('strong');label.textContent=annual?'Annual Premium':'Monthly Premium';
    const price=doc.createElement('span');price.textContent=product.displayPrice+(annual?' per year':' per month');
    const action=doc.createElement('small');action.textContent=state.authenticated?'Subscribe with Apple':'Sign in to subscribe';
    button.append(label,price,action);
    button.addEventListener('click',()=>{if(!token()){signIn();return;}void purchases.subscribe(product.id);});
    plans.append(button);
   }
  });
 }
 function tidy(){
  const shortcut=doc.getElementById('bb16AccountShortcut');text(shortcut,'Account');if(shortcut&&shortcut.getAttribute('aria-label')!=='Open BasketBoss account')shortcut.setAttribute('aria-label','Open BasketBoss account');
  const intro=doc.getElementById('bbIntroTrialDialog');if(intro?.open)intro.close();hide(intro);
  doc.querySelectorAll((purchases?'':'#cloud-signup,')+'#bbMembershipSettings,.bbc-secondary,.bbc-note,.bb173-tier-plans,.bb173-tier-disclaimer,#bb175TierCompare,.bb175-tier-compare,.bbtrial-plans,.bbtrial-legal').forEach(node=>{if(node.tagName==='DIALOG'&&node.open)node.close();hide(node);});
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
   text(node,'Your account status');
  }
  for(const node of doc.querySelectorAll('.bb17513-meal-premium')){
   const target=nativeMembershipURL(win.location.href);
   if(node.getAttribute('href')!==target)node.setAttribute('href',target);
   // This is also a billing anchor handled above. Both passes must agree:
   // toggling two labels here creates an endless childList observer loop on
   // capacitor://localhost and prevents timers, app scripts and taps running.
   text(node,'Your account status');
   if(node.getAttribute('aria-label')!=='View your BasketBoss account status')node.setAttribute('aria-label','View your BasketBoss account status');
  }
  for(const node of doc.querySelectorAll('#bb175Compare,button[data-bbob="premium"]'))text(node,'Your account status');
  const parent=doc.getElementById('bbNativeMembershipMount')||doc.getElementById('bbuiLinksSection');if(parent)mount(parent);
  doc.querySelectorAll('[data-native-signin]').forEach(node=>{if(!node.dataset.nativeReady){node.dataset.nativeReady='true';node.addEventListener('click',()=>win.location.assign('index.html#account'));}});
 }
 tidy();observer=new MutationObserver(tidy);observer.observe(doc.body,{childList:true,subtree:true});
 win.addEventListener('basketboss:session-changed',refresh);win.addEventListener('focus',refresh);win.addEventListener('basketboss:apple-membership-updated',refresh);
 if(win.location.hash==='#account')doc.getElementById('cloud-open')?.click();
 return {refresh,destroy(){unsubscribe?.();observer.disconnect();win.removeEventListener('basketboss:session-changed',refresh);win.removeEventListener('focus',refresh);win.removeEventListener('basketboss:apple-membership-updated',refresh);}};
}
