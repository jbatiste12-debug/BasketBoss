/* BasketBoss guarded membership Settings card. Display only; never grants entitlements.
   Must run inside the existing Settings section, with server-verifiable auth. */
(()=>{
  'use strict';
  const API='/api/subscription/status';
  const PORTAL='/api/subscription/portal';
  const SETTINGS_ID='bbuiLinksSection';
  const $=(id)=>document.getElementById(id);
  function safeText(tag,value,cls){
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    el.textContent=value;
    return el;
  }
  function link(label,href){const a=safeText('a',label);a.href=href;return a;}
  function token(){
    try{
      const session=JSON.parse(localStorage.getItem('basketboss_cloud_session_v1')||'null');
      return typeof session?.access_token==='string' &&
        Number(session.expires_at)*1000>Date.now()+5000 ? session.access_token : null;
    }catch{return null;}
  }
  function dateText(value){
    if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return null;
    return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'}).format(new Date(value));
  }
  function destinationOK(value){
    try{
      const url=new URL(value);
      return url.protocol==='https:' && /(^|\.)paddle\.(com|net)$/i.test(url.hostname) ? url.href : null;
    }catch{return null;}
  }
  function mount(){
    const parent=$(SETTINGS_ID);
    if(!parent||$('bbMembershipSettings'))return false;
    const root=document.createElement('section');root.id='bbMembershipSettings';
    root.className='bb-membership-settings';
    root.setAttribute('aria-label','Premium membership and billing');
    root.append(safeText('h3','💳 Premium membership'));
    root.append(safeText('p','View your plan and manage cancellation securely.','bb-membership-intro'));
    const status=safeText('p','Checking your membership…','bb-membership-status');
    status.id='bbMembershipState';status.setAttribute('aria-live','polite');
    root.append(status);
    const details=safeText('p','','bb-membership-details');details.id='bbMembershipDetails';root.append(details);
    const manage=safeText('button','Manage subscription / cancel','bb-membership-button');
    manage.type='button';manage.disabled=true;manage.id='bbMembershipManage';
    root.append(manage);
    const upgrade=link('⭐ Upgrade to Premium — view plans & trials','pricing-sandbox.html#founder');
    upgrade.id='bbMembershipUpgrade';upgrade.className='bb-membership-upgrade';upgrade.hidden=true;
    root.append(upgrade);
    const links=document.createElement('div');links.className='bb-membership-policies';
    links.append(link('Subscription, cancellation & refunds','subscriptions.html'));
    links.append(link('Terms of service','terms.html'));
    links.append(link('Privacy notice','privacy.html'));
    root.append(links);
    parent.append(root);
    let busy=false;
    manage.addEventListener('click',async()=>{
      if(busy || manage.disabled)return;
      const bearer=token();
      if(!bearer){status.textContent='Sign in again to manage your subscription.';manage.disabled=true;return;}
      busy=true;manage.disabled=true;manage.textContent='Opening Paddle securely…';
      try{
        const res=await fetch(PORTAL,{
          headers:{'Authorization':'Bearer '+bearer,'Accept':'application/json'},
          cache:'no-store',credentials:'same-origin'
        });
        const data=await res.json().catch(()=>null);
        const dest=res.ok&&data ? destinationOK(data.url):null;
        if(!dest)throw Error('Secure billing link unavailable. Use your Paddle receipt or paddle.net.');
        window.location.assign(dest);
      }catch(err){status.textContent=err.message;}
      finally{busy=false;manage.textContent='Manage subscription / cancel';manage.disabled=false;}
    });
    async function refresh(){
      const bearer=token();
      details.textContent='';manage.disabled=true;upgrade.hidden=true;
      if(!bearer){status.textContent='BasketBoss Free — sign in or create an account to start a Premium trial.';upgrade.hidden=false;return;}
      try{
        const response=await fetch(API,{
          headers:{'Authorization':'Bearer '+bearer,'Accept':'application/json'},
          cache:'no-store',credentials:'same-origin'
        });
        if(!response.ok){status.textContent=response.status===401?'Session expired — sign in again.':'Membership status temporarily unavailable. Please try again.';return;}
        const raw=await response.json();
        if(token()!==bearer)return;
        if(raw?.authenticated!==true){status.textContent='Unable to verify your account.';return;}
        if(raw.tier==='owner' && raw.premiumAccess===true){
          status.textContent='Owner Premium — complimentary access';
          details.textContent='No Paddle subscription or charge applies to this account.';
          return;
        }
        const sub=raw.subscription;
        if(!sub){status.textContent='BasketBoss Free — no active paid subscription';upgrade.hidden=false;return;}
        if(typeof sub.id!=='string' || !/^sub_[a-z0-9]{26}$/.test(sub.id)){
          status.textContent='Membership details temporarily unavailable.';return;
        }
        const name=sub.plan==='founder'?'Founding Member (£1.99/month)':sub.plan==='standard'?'Standard Premium (£4.99/month)':'Premium subscription';
        const names={trialing:'Free trial',active:'Active',past_due:'Payment overdue',paused:'Paused',canceled:'Canceled'};
        if(!Object.prototype.hasOwnProperty.call(names,sub.status)){
          status.textContent='Membership status temporarily unavailable.';return;
        }
        status.textContent=`${name} — ${names[sub.status]}`;
        const parts=[];
        const trial=dateText(sub.trialEndsAt),renewal=dateText(sub.currentPeriodEndsAt),cancel=dateText(sub.cancellationEffectiveAt);
        if(sub.status==='trialing'&&trial)parts.push(`Trial ends ${trial}. Cancel before this date to avoid the first subscription charge.`);
        else if(sub.status==='active'&&renewal)parts.push(`Current billing period ends ${renewal}.`);
        if(sub.cancelAtPeriodEnd===true)parts.push(`Cancellation scheduled${cancel?` for ${cancel}`:''}.`);
        if(!raw.premiumAccess){parts.push('Premium access is currently unavailable.');upgrade.hidden=false;}
        details.textContent=parts.join(' ');
        manage.disabled=false;
      }catch{status.textContent='Membership status temporarily unavailable. Please retry later.';}
    }
    refresh();
    window.addEventListener('focus',refresh);
    window.addEventListener('basketboss:session-changed',refresh);
    window.addEventListener('storage',event=>{if(event.key==='basketboss_cloud_session_v1')refresh();});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
    return true;
  }
  function start(){
    if(mount())return;
    const observer=new MutationObserver(()=>{if(mount())observer.disconnect();});
    observer.observe(document.body,{childList:true,subtree:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
