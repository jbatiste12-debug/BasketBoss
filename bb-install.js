/* BasketBoss v17.3 | On-demand, accessible PWA installation help.
 * Installs only if the browser offers a prompt. Otherwise uses honest OS instructions.
 * No tracking, network requests, storage, subscriptions or account requirements.
 */
(()=>{
  'use strict';
  let deferredPrompt=null;
  // Samsung Internet may generate WebAPKs that Play Protect rejects on recent Android.
  // This guard applies only to Samsung Internet on Android.
  const isSamsungInternet=/\bAndroid\b/i.test(navigator.userAgent||'') && /\bSamsungBrowser\//i.test(navigator.userAgent||'');
  let lastOpener=null;
  let dialog=null;
  const installed=()=>{
    try { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone===true; }
    catch { return navigator.standalone===true; }
  };
  const $=id=>document.getElementById(id);
  const installedFlag='bb173_install_completed_v1';
  function rememberedInstalled(){
    try { return window.localStorage.getItem(installedFlag)==='1'; }
    catch { return false; }
  }
  function rememberInstalled(){
    try { window.localStorage.setItem(installedFlag,'1'); } catch {}
  }
  function finishedInstalling(){
    if(installed()) { rememberInstalled(); return true; }
    return rememberedInstalled();
  }
  // Inline important display is deliberate: v17.4.4's display:flex!important
  // rule is more specific than the browser's [hidden] default.
  function setHidden(el,hide){
    if(!el)return;
    el.hidden=hide;
    if(hide)el.style.setProperty('display','none','important');
    else el.style.removeProperty('display');
  }
  function setStatus(msg) { const el=$('bb173InstallStatus');if(el)el.textContent=msg; }
  function refresh(){
    const done=finishedInstalling();
    document.querySelectorAll('[data-bb173-install-banner]').forEach(el=>setHidden(el,done));
    setHidden($('bb172InstallButton'),done); // independent older footer install link
    if (done && dialog?.open) dialog.close();
    setHidden($('bb173SamsungInstallNote'),!isSamsungInternet);
    const go=$('bb173NativeInstall');
    if (go) go.textContent=isSamsungInternet?'View safe Android advice':(deferredPrompt?'Install now':'Show installation steps');
  }
  function close(){if(!dialog)return;dialog.close?.();lastOpener?.focus?.();}
  function buildDialog(){
    if(dialog)return dialog;
    dialog=document.createElement('dialog');
    dialog.id='bb173InstallDialog';
    dialog.className='bb173-install-dialog';
    dialog.setAttribute('aria-labelledby','bb173InstallDialogTitle');
    dialog.innerHTML=`
      <div class="bb173-install-dialog-head">
        <div><span class="bb173-install-kicker">ON YOUR HOME SCREEN</span>
          <h2 id="bb173InstallDialogTitle">Install BasketBoss</h2></div>
        <button type="button" class="bb173-install-close" aria-label="Close install instructions" id="bb173InstallClose">✕</button>
      </div>
      <p>Open your meal plans and recipes in an app-style window. No app-store download is needed.</p>
      <div class="bb173-install-steps">
        <section><strong>iPhone / iPad</strong><p>Open BasketBoss in Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>. If offered, select <b>Open as Web App</b>, then tap <b>Add</b>.</p></section>
        <section><strong>Android / Chrome or Edge</strong><p>Tap <b>Install now</b> if available. Otherwise open the browser's <b>⋮ menu</b> and choose <b>Install app</b> or <b>Add to Home screen</b>.</p></section>
        <section id="bb173SamsungInstallNote" hidden role="note"><strong>Samsung Internet: safer installation advice</strong><p>Some Samsung Internet installs are blocked by Google Play Protect. BasketBoss still works in this browser. To try adding it to your home screen, open <b>Google Chrome</b>, type <b>basketboss.co.uk</b>, then use Chrome's <b>⋮ menu</b> to choose <b>Install app</b> or <b>Add to Home screen</b> if available. If Play Protect warns again, do not bypass it; continue using BasketBoss in the browser.</p></section>
        <section><strong>Desktop</strong><p>Use <b>Install now</b> when offered, or look for the install icon in the browser address bar or browser menu.</p></section>
      </div>
      <p class="bb173-install-note">Offline access is limited to content previously saved by this device. Live AI tools still require an internet connection.</p>
      <p role="status" aria-live="polite" id="bb173InstallStatus" class="bb173-install-status"></p>
      <div class="bb173-install-actions">
        <button id="bb173NativeInstall" type="button" class="bb173-install-primary">Show installation steps</button>
        <button id="bb173DismissInstall" type="button" class="bb173-install-secondary">Maybe later</button>
        <button id="bb173ConfirmInstalled" type="button" class="bb173-install-secondary">I've installed it — hide install prompts</button>
      </div>`;
    document.body.appendChild(dialog);
    $('bb173InstallClose').addEventListener('click',close);
    $('bb173DismissInstall').addEventListener('click',close);
    $('bb173ConfirmInstalled').addEventListener('click',()=>{
      rememberInstalled();
      refresh();
      close();
    });
    dialog.addEventListener('click',e=>{if(e.target===dialog)close();});
    $('bb173NativeInstall').addEventListener('click',async()=>{
      if(finishedInstalling()){setStatus('BasketBoss is already installed on this device.');refresh();return;}
      if(isSamsungInternet){setStatus('Use BasketBoss in this browser, or open basketboss.co.uk in Chrome. Never bypass Play Protect.');return;}
      if(!deferredPrompt){setStatus('Use the instructions above for your device. The browser has not offered a one-click install.');return;}
      const event=deferredPrompt; deferredPrompt=null;
      try {
        await event.prompt();
        const result=await event.userChoice;
        setStatus(result?.outcome==='accepted'?'Install requested — look for BasketBoss on your home screen.':'Installation dismissed. You can also use your browser menu to install.');
      }catch{
        setStatus('One-click installation is unavailable here. Please use the device instructions above.');
      }
      refresh();
    });
    return dialog;
  }
  function open(opener){
    if(finishedInstalling())return;
    lastOpener=opener;
    const el=buildDialog();
    refresh();
    if(typeof el.showModal==='function')el.showModal();
    else el.setAttribute('open','');
    setStatus(isSamsungInternet?'Samsung Internet installation may trigger Play Protect. Use BasketBoss in the browser or try Chrome; never bypass Play Protect.':(deferredPrompt?'Your browser can install BasketBoss. Tap Install now.':'Follow the steps for your device; one-click installation might not be available.'));
    $('bb173InstallClose').focus();
  }
  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();
    if(isSamsungInternet){deferredPrompt=null;refresh();return;}
    deferredPrompt=event;
    refresh();
  });
  window.addEventListener('appinstalled',()=>{deferredPrompt=null;rememberInstalled();refresh();});
  window.addEventListener('pageshow',refresh);
  const wire=()=>{
    document.querySelectorAll('[data-bb173-install-open]').forEach(btn=>{
      if(btn.dataset.bb173Bound)return;
      btn.dataset.bb173Bound='1';
      btn.addEventListener('click',()=>open(btn));
    });
    refresh();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire,{once:true});
  else wire();
})();
