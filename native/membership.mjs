// iOS companion build: existing membership access, with no web purchase flow.
export function installNativeMembership({apiURL,openExternal,readSession,fetch:perform=globalThis.fetch,document:doc=globalThis.document,window:win=globalThis.window}){
 const url=path=>typeof apiURL==='function'?apiURL(path):apiURL+path;
 let observer,card,status,manage,busy=false;
 const hide=node=>{if(node&&!node.classList.contains('bb-native-hidden'))node.classList.add('bb-native-hidden');};
 const text=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;};
 const token=()=>{const s=readSession();return s?.access_token&&Number(s.expires_at)*1000>Date.now()+5000?s.access_token:null;};
 function signIn(){doc.getElementById('cloud-open')?.click();}
 async function refresh(){
  if(!status)return;const bearer=token();manage.hidden=true;
  if(!bearer){text(status,'Free recipes are ready to use. Sign in to access an existing BasketBoss account.');return;}
  text(status,'Checking your membership…');
  try{
   const result=await perform(url('/api/subscription/status'),{headers:{Authorization:'Bearer '+bearer,Accept:'application/json'},cache:'no-store',credentials:'omit'});
   if(token()!==bearer)return;
   if(!result.ok)throw Error('Membership could not be checked. Please sign in again or try later.');
   const data=await result.json();
   if(data.authenticated!==true)throw Error('Sign in again to check your membership.');
   text(status,data.premiumAccess===true?'Your existing Premium membership is available.':'Your account currently has Free access.');
   manage.hidden=!data.subscription?.id;
  }catch(error){text(status,error.message||'Membership is temporarily unavailable.');}
 }
 async function portal(){
  const bearer=token();if(!bearer||busy)return;busy=true;manage.disabled=true;
  try{
   const result=await perform(url('/api/subscription/portal'),{headers:{Authorization:'Bearer '+bearer,Accept:'application/json'},cache:'no-store',credentials:'omit'});
   if(!result.ok)throw Error('Subscription management is temporarily unavailable.');
   const data=await result.json();if(token()!==bearer)return;
   const target=new URL(data.url||data.portalUrl||'');
   if(target.protocol!=='https:'||!/(^|\.)paddle\.(com|net)$/i.test(target.hostname)||/^(?:checkout|buy|sandbox-checkout)\./i.test(target.hostname))throw Error('Subscription management link could not be verified.');
   await openExternal(target.href);
  }catch(error){text(status,error.message||'Subscription management is temporarily unavailable.');}
  finally{busy=false;manage.disabled=false;}
 }
 function mount(parent){
  if(card?.isConnected)return;
  card=doc.createElement('section');card.className='bb-native-membership';card.setAttribute('aria-label','BasketBoss membership');
  const title=doc.createElement('h3');title.textContent='Your BasketBoss account';
  const note=doc.createElement('p');note.textContent='Use 100 recipes free, or sign in to an existing account. Purchases and account creation are not available in this iOS build.';
  status=doc.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const login=doc.createElement('button');login.type='button';login.textContent='Sign in';login.addEventListener('click',signIn);
  manage=doc.createElement('button');manage.type='button';manage.textContent='Manage existing subscription / cancel';manage.hidden=true;manage.addEventListener('click',()=>void portal());
  card.append(title,note,status,login,manage);parent.append(card);void refresh();
 }
 function tidy(){
  const shortcut=doc.getElementById('bb16AccountShortcut');text(shortcut,'Sign in');if(shortcut&&shortcut.getAttribute('aria-label')!=='Open BasketBoss account sign-in')shortcut.setAttribute('aria-label','Open BasketBoss account sign-in');
  const intro=doc.getElementById('bbIntroTrialDialog');if(intro?.open)intro.close();hide(intro);
  doc.querySelectorAll('#cloud-signup,#bbMembershipSettings,.bbc-secondary,.bbc-note,.bb173-tier-plans,.bb173-tier-disclaimer,.bb175-tier-compare,.bbtrial-plans,.bbtrial-legal').forEach(hide);
  for(const node of doc.querySelectorAll('.bbob-plan-premium')){
   if(node.dataset.nativeMembership==='true')continue;
   node.dataset.nativeMembership='true';node.replaceChildren();
   const title=doc.createElement('strong');title.textContent='Already have Premium?';
   const p=doc.createElement('p');p.textContent='Sign in to use your existing membership. Purchases are not offered here.';node.append(title,p);
  }
  for(const node of doc.querySelectorAll('.bbob-footnote'))if(/Paddle|trial|checkout|renewal|Founder/i.test(node.textContent))text(node,'Use BasketBoss Free, or sign in to your existing account. Purchases are not available in this iOS build.');
  for(const node of doc.querySelectorAll('a[href*="pricing-sandbox"],a[href*="compare.html"],button[data-bbob="premium"]')){
   if(/trial|£|founder|upgrade|plans|subscribe/i.test(node.textContent))text(node,'Premium information');
  }
  const parent=doc.getElementById('bbNativeMembershipMount')||doc.getElementById('bbuiLinksSection');if(parent)mount(parent);
  doc.querySelectorAll('[data-native-signin]').forEach(node=>{if(!node.dataset.nativeReady){node.dataset.nativeReady='true';node.addEventListener('click',()=>win.location.assign('index.html#account'));}});
 }
 tidy();observer=new MutationObserver(tidy);observer.observe(doc.body,{childList:true,subtree:true});
 win.addEventListener('basketboss:session-changed',refresh);win.addEventListener('focus',refresh);
 if(win.location.hash==='#account')doc.getElementById('cloud-open')?.click();
 return {refresh,destroy(){observer.disconnect();win.removeEventListener('basketboss:session-changed',refresh);win.removeEventListener('focus',refresh);}};
}
