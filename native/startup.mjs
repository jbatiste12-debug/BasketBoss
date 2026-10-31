// Paint the local brand before the application scripts run. The iOS controller
// animates the same brand independently of WKWebView's JavaScript process.
export function installNativeStartup({window:win=globalThis.window,document:doc=globalThis.document,finishNative=async()=>{}}={}){
 const root=doc.documentElement;
 root.classList.add('bb-native-starting');
 let phase='starting',finished=false,timer,observer,settling=false;
 const entry=/(?:^|\/)(?:index|app)\.html$|\/$/.test(win.location.pathname);
 let shown=false;
 try{shown=win.sessionStorage.getItem('basketboss_native_startup_seen_v1')==='1';}catch{}
 // Suppress the old delayed welcome screen, while retaining its explicit API.
 try{win.sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');}catch{}
 let overlay=null;
 if(entry){
  const style=doc.createElement('style');style.id='bbNativeStartupCritical';
  style.textContent=`#bbNativeStartup{position:fixed;inset:0;z-index:2147483640;display:grid;place-items:center;background:#fffdf7;color:#173b32;font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:24px;box-sizing:border-box}#bbNativeStartup .bbns-brand{position:relative;display:flex;flex-direction:column;align-items:center;gap:16px;width:min(100%,380px)}#bbNativeStartup .bbns-logo{width:128px;height:128px;border-radius:30px;background:linear-gradient(145deg,#f7f8f9,#e4e6e8);box-shadow:0 15px 35px #173b3215;display:grid;place-items:center;animation:bbns-pop .65s cubic-bezier(.2,.85,.3,1.22) both}#bbNativeStartup svg{width:100px;height:100px;overflow:visible}#bbNativeStartup .bbns-crown{transform-origin:32px 16px;animation:bbns-crown .55s cubic-bezier(.2,.8,.3,1.15) both}#bbNativeStartup .bbns-name{margin:0;font-size:clamp(35px,10vw,42px);font-weight:850;letter-spacing:-1.6px;line-height:1.15;animation:bbns-name .45s ease-out both}#bbNativeStartup .bbns-name span{color:#2c8855}#bbNativeStartup .bbns-tagline{margin:0;font-size:15px;line-height:1.5;color:#496957}#bbNativeStartup .bbns-spark{position:absolute;top:12px;left:calc(50% - 108px);font-size:25px;color:#c29429;animation:bbns-spark .8s ease-out both}#bbNativeStartup .bbns-spark-b{left:auto;right:calc(50% - 108px);top:86px;color:#2c8855;animation-delay:.08s}#bbNativeStartup .bbns-retry{min-height:44px;padding:10px 20px;border:0;border-radius:12px;background:#195f3c;color:white;font:inherit;font-weight:700}#bbNativeStartup[hidden],#bbNativeStartup [hidden]{display:none!important}#bbNativeStartup .bbns-status{font-size:13px;color:#496957;margin:8px 0 0}#bbNativeStartup .bbns-retry:focus-visible{outline:3px solid #d7ad45;outline-offset:3px}@keyframes bbns-pop{0%{transform:scale(.88) rotate(-5deg)}65%{transform:scale(1.05) rotate(2deg)}100%{transform:none}}@keyframes bbns-crown{0%{transform:translateY(-8px) rotate(-7deg)}70%{transform:translateY(2px) rotate(3deg)}100%{transform:none}}@keyframes bbns-name{0%{transform:translateY(6px) scale(.98)}100%{transform:none}}@keyframes bbns-spark{0%{opacity:0;transform:scale(.4) rotate(-20deg)}35%{opacity:.85;transform:scale(1.1)}100%{opacity:0;transform:scale(.8) rotate(15deg)}}@media(prefers-reduced-motion:reduce){#bbNativeStartup *{animation:none!important}#bbNativeStartup .bbns-spark{display:none}}`;
  (doc.head||root).append(style);
  overlay=doc.createElement('div');overlay.id='bbNativeStartup';overlay.setAttribute('role','status');overlay.setAttribute('aria-label','Opening BasketBoss');
  overlay.innerHTML='<div class="bbns-brand"><span class="bbns-spark" aria-hidden="true">&#10022;</span><span class="bbns-spark bbns-spark-b" aria-hidden="true">&#10023;</span><div class="bbns-logo" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none"><g><path d="M18 30 25 23M46 30 39 23" stroke="#44484B" stroke-width="4" stroke-linecap="round"/><path d="M11 31h42l-5 24H16l-5-24Z" fill="#44484B" stroke="#44484B" stroke-width="2" stroke-linejoin="round"/><path d="M22 38v10M32 38v10M42 38v10" stroke="#F8F8F8" stroke-width="4" stroke-linecap="round"/></g><g class="bbns-crown"><path d="M22 18 18 10 27 14 32 6 37 14 46 10 42 18Z" fill="#44484B" stroke="#44484B" stroke-width="2" stroke-linejoin="round"/><path d="M21 21h22" stroke="#44484B" stroke-width="3" stroke-linecap="round"/></g></svg></div><h1 class="bbns-name">Basket<span>Boss</span></h1><p class="bbns-tagline">Plan smarter. Eat better. Less waste.</p><p class="bbns-status" hidden>BasketBoss is taking longer to open.</p><button class="bbns-retry" type="button" hidden>Try again</button></div>';
  overlay.hidden=shown;
  root.append(overlay);
  overlay.querySelector('button').addEventListener('click',()=>win.location.reload());
 }
 function interactive(){const app=doc.getElementById('app');return !entry||!!app?.firstElementChild;}
 async function finish(){
  if(finished||settling||!interactive())return false;
  settling=true;phase='handoff';win.clearTimeout(timer);observer?.disconnect();
  // Prepare the app's next screen while the native brand still covers it. In
  // particular, a fresh onboarding screen must exist before UIKit starts fading.
  overlay?.remove();doc.getElementById('bbNativeStartupCritical')?.remove();
  root.classList.remove('bb-native-starting');
  win.dispatchEvent(new win.Event('basketboss:native-startup-ready'));
  try{await finishNative();}catch{
   // A missing native method must not trap an otherwise usable application.
   // The native controller also has an independent timed recovery button.
  }
  finished=true;phase='ready';win.clearTimeout(timer);observer?.disconnect();
  overlay?.remove();doc.getElementById('bbNativeStartupCritical')?.remove();
  try{win.sessionStorage.setItem('basketboss_native_startup_seen_v1','1');}catch{}
  return true;
 }
 function ready(){
  if(interactive()){void finish();return;}
  observer=new win.MutationObserver(()=>{if(interactive())void finish();});
  observer.observe(doc.body||root,{childList:true,subtree:true});
 }
 timer=win.setTimeout(()=>{
  if(finished)return;
  phase='delayed';
  if(overlay)overlay.hidden=false;
  overlay?.querySelectorAll('.bbns-status,.bbns-retry').forEach(node=>node.hidden=false);
 },12000);
 const api={ready,finish,get phase(){return phase;}};
 win.BBNativeStartup=api;
 return api;
}
