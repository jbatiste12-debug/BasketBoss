import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../bb-onboarding-v2.js',import.meta.url),'utf8');
const KEY='bb_onboarding_fresh_once_20261028_v1';
const PLAN='basketboss_321_unified_state_v1',SESSION='basketboss_cloud_session_v1';
const completed={step:10,started:false,complete:true,house:'2 people',region:'UK',goals:['Plan dinners faster'],diets:['Vegetarian'],partnerStepV2:true,wantsPartnerInvite:false,partnerIntent:'none'};
function harness({saved,store,deleted=false,startup=false,native=true,dialog=false,remembered,withAuth=false}={}){
 const storage=store||new Map([[PLAN,'saved meal plan must survive'],[SESSION,JSON.stringify({user:{id:'existing-user-id'},access_token:'synthetic-token',expires_at:9999999999})]]);
 if(saved)storage.set(KEY,JSON.stringify(saved));
 const windowEvents=new Map(),documentEvents=new Map(),viewportEvents=new Map(),writes=[],preferences=[],nodes=[];
 let deleting=deleted,starting=startup,dialogOpen=dialog,observer,closed=0,mealSave=true;
 const saveStatus={textContent:''};
 const on=(map,name,fn)=>{const callbacks=map.get(name)||[];callbacks.push(fn);map.set(name,callbacks);};
 const replayButton={id:'bbOnboardingReplay',textContent:'Replay welcome animation',isConnected:true,focus(){this.focused=true;}};
 const uiNodes=new Map([[replayButton.id,replayButton]]);
 const parent={appendChild(node){node.parentNode=this;uiNodes.set(node.id,node);},insertBefore(node){node.parentNode=this;}};replayButton.parentNode=parent;replayButton.setAttribute=()=>{};
 if(withAuth){for(const name of ['cloud-auth','cloud-message','bbobAuthSlot','bbobMessageSlot'])uiNodes.set(name,{id:name,hidden:true,parentNode:parent,appendChild(node){node.parentNode=this;}});}
 const rootClasses=new Set(),rootStyle=new Map(),scrolls=[];
 const background=[false,true].map(inert=>({inert,contains:()=>false,hasAttribute(){return this.inert;},setAttribute(){this.inert=true;},removeAttribute(){this.inert=false;}}));
 const body={style:{overflow:''},appendChild(node){nodes.push(node);}};
 const document={body,createComment:()=>({}),readyState:'complete',activeElement:replayButton,documentElement:{style:{setProperty:(k,v)=>rootStyle.set(k,v),removeProperty:k=>rootStyle.delete(k)},classList:{contains:name=>rootClasses.has(name)||name==='bb-native-starting'&&starting,add:name=>rootClasses.add(name),remove:name=>rootClasses.delete(name)}},querySelectorAll:()=>background,
  getElementById(id){if(uiNodes.has(id))return uiNodes.get(id);if(id==='bbAccountDeletionDialog')return {open:dialogOpen};return null;},
  createElement(){const classes=new Set(),values=new Map();return {innerHTML:'',events:new Map(),style:{setProperty:(k,v)=>values.set(k,v),getPropertyValue:k=>values.get(k)},classList:{contains:name=>classes.has(name),toggle(name,enabled){enabled?classes.add(name):classes.delete(name);}},contains:node=>node?.inside===true,setAttribute(){},addEventListener(name,fn){on(this.events,name,fn);},querySelector(selector){return selector==='#bbobSaveError'?saveStatus:null;},remove(){this.removed=true;}};},
  querySelector:selector=>selector.includes('bbui-settings-close')?{click(){closed++;}}:null,addEventListener(name,fn){on(documentEvents,name,fn);}};
 const window={innerHeight:932,innerWidth:430,scrollX:3,scrollY:500,scrollTo(x,y){scrolls.push([x,y]);this.scrollX=x;this.scrollY=y;},visualViewport:{height:932,width:430,offsetTop:0,offsetLeft:0,addEventListener(name,fn){on(viewportEvents,name,fn);}},BBNative:native?{isNative:true}:undefined,BBAccountDeletion:{isDeleting:()=>deleting},matchMedia:()=>({matches:false}),addEventListener(name,fn){on(windowEvents,name,fn);},BasketBossSetOnboardingServings(count){preferences.push({house:count});return true;},bb307SwitchIsland(region){preferences.push({region});return true;},BasketBossSetOnboardingMealPreferences(meals){preferences.push({meals:JSON.parse(JSON.stringify(meals))});return mealSave;}};
 if(remembered!==undefined)window.BasketBossSession={state:()=>({remembered})};
 const context=vm.createContext({window,document,localStorage:{getItem:key=>storage.get(key)??null,setItem(key,value){writes.push([key,value]);storage.set(key,value);}},sessionStorage:{setItem(){}},location:{hostname:native?'localhost':'basketboss.co.uk',protocol:native?'capacitor:':'https:',search:''},navigator:{standalone:false},URLSearchParams,queueMicrotask,MutationObserver:class{constructor(fn){observer=fn;}observe(){}},console});
 vm.runInContext(source,context,{timeout:1000});
 const active=()=>nodes.findLast(node=>!node.removed);
 const dispatch=(name,event={})=>{for(const fn of windowEvents.get(name)||[])fn(event);};
 const tap=(action,option)=>{const node=active();assert.ok(node,'expected active onboarding');for(const fn of node.events.get('click')||[])fn({target:{closest(selector){if(selector==='[data-bbob-opt]'&&option!==undefined)return {dataset:{bbobOpt:String(option)}};if(selector==='[data-bbob]'&&action)return {dataset:{bbob:action}};return null;}}});};
 const through=step=>{for(let i=0;i<step;i++)tap('next');};
 return {window,document,storage,node:id=>uiNodes.get(id),setRemembered:value=>{remembered=value;},writes,preferences,saveStatus,setMealSave:value=>{mealSave=value;},replayButton,rootClasses,rootStyle,background,scrolls,settingsClosed:()=>closed,active,tap,through,dispatch,read:()=>JSON.parse(storage.get(KEY)||'null'),setDeleting:value=>{deleting=value;},setStartup:value=>{starting=value;},setDialog:value=>{dialogOpen=value;},
  escape(){for(const fn of active()?.events.get('keydown')||[])fn({key:'Escape',preventDefault(){}});},
  resize(height){window.visualViewport.height=height;for(const fn of viewportEvents.get('resize')||[])fn();},
  region(value){for(const fn of active()?.events.get('change')||[])fn({target:{value,matches:()=>true}});},
  clickReplay(){let prevented=false,stopped=false;for(const fn of documentEvents.get('click')||[])fn({target:{closest:selector=>selector==='#bbOnboardingReplay,#bbBetaWelcomeReplay'?replayButton:null},preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});return {prevented,stopped};},
  closeDeletionDialog(){dialogOpen=false;for(const fn of documentEvents.get('close')||[])fn({target:{id:'bbAccountDeletionDialog'}});},
  remountReplay(){replayButton.textContent='Replay welcome animation';observer?.();}
 };
}

test('fresh native install opens onboarding once and can finish without prices, purchases or data resets',()=>{
 const h=harness();assert.match(h.active().innerHTML,/Thanks for downloading BasketBoss/);assert.equal(h.read().complete,false);
 h.through(10);assert.match(h.active().innerHTML,/Start using BasketBoss/);assert.doesNotMatch(h.active().innerHTML,/Explore Premium plans|Paddle|Founder|£\d/);
 h.tap('free-complete');assert.equal(h.active(),undefined);assert.equal(h.read().complete,true);assert.equal(h.storage.get(PLAN),'saved meal plan must survive');assert.equal(h.preferences.length,0);
 const again=harness({store:h.storage});assert.equal(again.active(),undefined);assert.equal(again.window.BBOnboard2026.willShow(),false);
});

test('only optional tour screens can skip to the existing final choice without completing setup or applying preferences',()=>{
 for(const step of [6,7,8,9]){
  const saved={...completed,step,started:true,complete:false},h=harness({saved});
  const session=h.storage.get(SESSION),plan=h.storage.get(PLAN);
  assert.match(h.active().innerHTML,/data-bbob="skip-tour"/);
  assert.match(h.active().innerHTML,/Optional tour/);
  h.tap('skip-tour');
  assert.deepEqual(h.read(),{...saved,step:10});
  assert.match(h.active().innerHTML,/Start using BasketBoss/);
  assert.doesNotMatch(h.active().innerHTML,/data-bbob="skip-tour"/);
  assert.deepEqual(h.preferences,[],'skipping presentation must not commit setup');
  assert.equal(h.storage.get(SESSION),session);assert.equal(h.storage.get(PLAN),plan);
  const resumed=harness({store:h.storage});
  assert.equal(resumed.read().step,10);assert.match(resumed.active().innerHTML,/Start using BasketBoss/);
  h.tap('free-complete');
  assert.equal(h.read().complete,true);
  assert.deepEqual(h.preferences,[{house:2},{region:'UK'},{meals:{diets:['Vegetarian'],goals:['Plan dinners faster']}}]);
 }
 for(const step of [0,1,2,3,4,5,10]){
  const h=harness({saved:{...completed,step,started:true,complete:false}}),before=h.storage.get(KEY);
  assert.doesNotMatch(h.active().innerHTML,/data-bbob="skip-tour"/);
  h.tap('skip-tour');assert.equal(h.storage.get(KEY),before);assert.deepEqual(h.preferences,[]);
 }
});

test('skipping an optional replay tour and cancelling preserves the previously committed setup',()=>{
 const h=harness({saved:completed}),before=h.storage.get(KEY);
 h.window.BBOnboard2026.open();h.through(3);h.tap(null,3);h.region('Guernsey');h.through(3);
 h.tap('skip-tour');assert.match(h.active().innerHTML,/Start using BasketBoss/);
 assert.equal(h.storage.get(KEY),before);assert.deepEqual(h.preferences,[]);
 h.tap('replay-cancel');assert.equal(h.active(),undefined);assert.equal(h.storage.get(KEY),before);assert.deepEqual(h.preferences,[]);
});

test('returning users keep completion, while Settings replay opens the complete setup and preserves data',()=>{
 const h=harness({saved:completed}),before=h.storage.get(KEY),session=h.storage.get(SESSION);
 assert.equal(h.active(),undefined);assert.equal(h.replayButton.textContent,'Replay welcome & setup');
 assert.deepEqual(h.clickReplay(),{prevented:true,stopped:true});assert.match(h.active().innerHTML,/Cancel setup/);
 h.through(10);assert.equal(h.storage.get(KEY),before,'navigating replay does not clear the completed marker');
 h.tap('free-complete');assert.equal(h.active(),undefined);assert.equal(h.read().complete,true);assert.equal(h.preferences.length,0,'unchanged old household choices cannot overwrite current app settings');assert.equal(h.settingsClosed(),1,'Finish returns to the actual app');
 assert.equal(h.storage.get(PLAN),'saved meal plan must survive');assert.equal(h.storage.get(SESSION),session);
 h.remountReplay();assert.equal(h.replayButton.textContent,'Replay welcome & setup');
});

test('cancel or reload during replay leaves the completed marker and existing choices intact',()=>{
 const h=harness({saved:completed}),before=h.storage.get(KEY);
 assert.equal(h.window.BBOnboard2026.open(),true);h.through(3);h.tap(null,3);h.region('Guernsey');
 assert.equal(h.preferences.length,0);assert.equal(h.storage.get(KEY),before);
 h.escape();assert.equal(h.active(),undefined);assert.equal(h.settingsClosed(),0,'Cancel returns to Settings');assert.equal(h.storage.get(KEY),before);assert.equal(h.window.BBOnboard2026.willShow(),false);assert.equal(h.replayButton.focused,true);
 const again=harness({store:h.storage});assert.equal(again.active(),undefined);
 assert.equal(again.window.BBOnboard2026.open(),true);again.tap('replay-cancel');assert.equal(again.active(),undefined);assert.equal(again.storage.get(KEY),before);
});

test('replay applies only explicitly changed household and region choices after Finish',()=>{
 const h=harness({saved:completed});h.window.BBOnboard2026.open();h.through(3);h.tap(null,3);h.region('Guernsey');
 assert.equal(h.preferences.length,0);h.through(7);h.tap('free-complete');
 assert.deepEqual(h.preferences,[{house:5},{region:'Guernsey'}]);assert.equal(h.read().house,'5+ people');assert.equal(h.read().region,'Guernsey');assert.equal(h.read().complete,true);
 assert.equal(h.window.BBOnboard2026.getPreferences().house,'5+ people');assert.equal(h.storage.get(PLAN),'saved meal plan must survive');
});

test('native startup defers first onboarding until ready and starts it only once',()=>{
 const h=harness({startup:true});assert.equal(h.active(),undefined);assert.equal(h.storage.has(KEY),false);assert.equal(h.window.BBOnboard2026.open(),false);
 h.setStartup(false);h.dispatch('basketboss:native-startup-ready');assert.match(h.active().innerHTML,/Thanks for downloading/);const first=h.active();h.dispatch('basketboss:native-startup-ready');assert.equal(h.active(),first);
 const returning=harness({saved:completed,startup:true});returning.setStartup(false);returning.dispatch('basketboss:native-startup-ready');assert.equal(returning.active(),undefined);
});

test('pending deletion blocks onboarding and replay without writes, then cancellation resumes only an incomplete tour',async()=>{
 const h=harness({deleted:true}),before=h.writes.length;assert.equal(h.active(),undefined);assert.equal(h.replayButton.disabled,true);assert.match(h.replayButton.title,/Finish account deletion/);assert.match(h.document.getElementById('bbOnboardingReplayStatus').textContent,/Finish account deletion/);assert.equal(h.window.BBOnboard2026.open(),false);h.clickReplay();assert.equal(h.writes.length,before);
 h.setDeleting(false);h.dispatch('basketboss:account-deletion-cancelled');await Promise.resolve();assert.ok(h.active());assert.equal(h.replayButton.disabled,false);
 h.setDeleting(true);const saved=h.storage.get(KEY),writes=h.writes.length;h.dispatch('basketboss:account-deletion-started');assert.equal(h.active(),undefined);assert.equal(h.window.BBOnboard2026.open(),false);assert.equal(h.storage.get(KEY),saved);assert.equal(h.writes.length,writes);
 const returning=harness({saved:completed,deleted:true});returning.setDeleting(false);returning.dispatch('basketboss:account-deletion-cancelled');await Promise.resolve();assert.equal(returning.active(),undefined);
});

test('an open deletion confirmation is never covered by onboarding, including retry after a failed deletion',async()=>{
 const h=harness({dialog:true});assert.equal(h.active(),undefined);assert.equal(h.storage.has(KEY),false);assert.equal(h.window.BBOnboard2026.open(),false);
 h.dispatch('basketboss:account-deletion-cancelled');await Promise.resolve();assert.equal(h.active(),undefined);
 h.closeDeletionDialog();assert.ok(h.active());
});

test('replay interrupted by deletion does not overwrite completion or reappear for returning users',async()=>{
 const h=harness({saved:completed}),saved=h.storage.get(KEY);h.window.BBOnboard2026.open();h.through(3);h.tap(null,0);h.setDeleting(true);h.dispatch('basketboss:account-deletion-started');
 assert.equal(h.active(),undefined);assert.equal(h.storage.get(KEY),saved);assert.equal(h.preferences.length,0);
 h.setDeleting(false);h.dispatch('basketboss:account-deletion-cancelled');await Promise.resolve();assert.equal(h.active(),undefined);assert.equal(h.storage.get(KEY),saved);
});

test('web onboarding keeps its existing Premium handoff and does not acquire native-only copy',()=>{
 const h=harness({native:false});assert.match(h.active().innerHTML,/Welcome to BasketBoss\./);h.through(10);assert.match(h.active().innerHTML,/Explore Premium plans/);assert.match(h.active().innerHTML,/Founder/);assert.doesNotMatch(h.active().innerHTML,/Start using BasketBoss/);
});

test('direct account sign-in suspends unfinished setup without changing preferences or completion',()=>{
 const h=harness();h.through(1);const saved=h.storage.get(KEY),session=h.storage.get(SESSION),count=h.writes.length;
 h.window.BBOnboard2026.pauseForAccount();assert.equal(h.active(),undefined);assert.equal(h.window.BBOnboard2026.willShow(),false);
 h.dispatch('basketboss:native-startup-ready');assert.equal(h.active(),undefined);
 assert.equal(h.storage.get(KEY),saved);assert.equal(h.storage.get(SESSION),session);assert.equal(h.writes.length,count);assert.equal(h.preferences.length,0);
 assert.equal(h.window.BBOnboard2026.open(),true,'explicit Settings replay remains available');
});

test('an unsigned account step labels its skip action without implying authentication',()=>{
 const h=harness({store:new Map([[PLAN,'saved meal plan']])});h.through(1);
 assert.match(h.active().innerHTML,/Continue without signing in/);assert.doesNotMatch(h.active().innerHTML,/Continue setup/);
 h.tap('next');assert.match(h.active().innerHTML,/Would you like to share with a partner/);assert.equal(h.storage.has(SESSION),false);
});

test('keyboard layout stays steady when a sign-in field blurs onto its button',()=>{
 const h=harness({store:new Map([[PLAN,'saved meal plan']])});h.through(1);
 h.resize(500);assert.equal(h.active().classList.contains('bbob-keyboard'),false,'rotation without editing must keep setup actions');
 h.document.activeElement={id:'cloud-email',matches:()=>true,inside:true};h.resize(500);assert.equal(h.active().classList.contains('bbob-keyboard'),true);
 h.document.activeElement={id:'cloud-login'};h.resize(500);assert.equal(h.active().classList.contains('bbob-keyboard'),true,'Sign in must not move while its tap completes');
 h.resize(932);assert.equal(h.active().classList.contains('bbob-keyboard'),false);
 h.resize(500);h.tap('next');assert.equal(h.active().classList.contains('bbob-keyboard'),false,'later setup screens keep their navigation');
});

test('signed-out session notifications preserve the mounted onboarding form while either credential field is focused',()=>{
 for(const field of ['cloud-email','cloud-password']){
  const h=harness({store:new Map([[PLAN,'saved meal plan']]),withAuth:true});h.tap('next');
  const host=h.active(),form=h.node('cloud-auth'),parent=form.parentNode;
  let html=host.innerHTML,renders=0;
  Object.defineProperty(host,'innerHTML',{get:()=>html,set(value){renders++;html=value;}});
  const input={id:field,inside:true,matches:selector=>selector.split(',').includes('#'+field)};
  h.document.activeElement=input;
  const saved=h.storage.get(KEY),writes=h.writes.length;
  h.dispatch('basketboss:session-changed');h.dispatch('basketboss:session-changed');
  assert.equal(renders,0,field+' must not be removed and remounted by unchanged signed-out state');
  assert.equal(form.parentNode,parent);assert.equal(h.document.activeElement,input);
  assert.equal(h.storage.get(KEY),saved);assert.equal(h.writes.length,writes);
  assert.equal(h.storage.has(SESSION),false);assert.equal(h.storage.get(PLAN),'saved meal plan');

  h.storage.set(SESSION,JSON.stringify({user:{id:'newly-authenticated'},access_token:'fresh',expires_at:9999999999}));
  h.dispatch('basketboss:session-changed');
  assert.equal(h.read().step,2,'a valid sign-in must still advance immediately while an input is focused');
  assert.equal(renders,1);assert.match(host.innerHTML,/Would you like to share with a partner/);
 }
});

test('fresh onboarding isolates the planner, follows keyboard panning and restores the page on exit',()=>{
 const h=harness({store:new Map([[PLAN,'saved meal plan']])});
 assert.equal(h.rootClasses.has('bb-onboarding-open'),true);
 assert.equal(h.rootStyle.get('--bbob-page-top'),'-500px');
 assert.deepEqual(h.background.map(node=>node.inert),[true,true]);
 h.tap('next');
 h.document.activeElement={id:'cloud-password',inside:true,matches:()=>true,blur(){this.blurred=true;}};
 Object.assign(h.window.visualViewport,{height:300,width:393,offsetTop:180,offsetLeft:12});h.resize(300);
 for(const [name,value] of Object.entries({height:'300px',width:'393px',top:'180px',left:'12px'})){
  assert.equal(h.active().style.getPropertyValue('--bbob-viewport-'+name),value);
 }
 assert.equal(h.rootClasses.has('bb-onboarding-open'),true,'focusing an onboarding field keeps the page locked');
 const input=h.document.activeElement;h.window.BBOnboard2026.pauseForAccount();
 assert.equal(input.blurred,true);assert.equal(h.rootClasses.has('bb-onboarding-open'),false);
 assert.equal(h.rootStyle.has('--bbob-page-top'),false);assert.deepEqual(h.background.map(node=>node.inert),[false,true]);
 assert.deepEqual(h.scrolls,[[3,500]]);assert.equal(h.document.body.style.overflow,'');
 assert.equal(h.storage.get(PLAN),'saved meal plan');assert.equal(h.read().complete,false);
});

test('leaving onboarding restores the shared form before requesting native dismissal, without waiting for the bridge',async()=>{
 for(const outcome of ['resolved','pending','rejected','throws','unavailable','web']){
  const session=JSON.stringify({user:{id:'remembered-user'},access_token:'expired-preserved-token',expires_at:1});
  const h=harness({store:new Map([[PLAN,'saved meal plan'],[SESSION,session]]),withAuth:true,native:outcome!=='web'});
  h.tap('next');
  const host=h.active(),form=h.node('cloud-auth'),slot=form.parentNode,originalParent=h.replayButton.parentNode;
  const input={id:'cloud-email',matches:()=>true,inside:true,blur(){this.blurred=true;h.document.activeElement=h.replayButton;}};
  host.contains=node=>node===input||node===form&&form.parentNode===slot;
  h.document.activeElement=input;
  let calls=0;const requests=[];
  if(h.window.BBNative&&outcome!=='unavailable')h.window.BBNative.dismissKeyboard=()=>{
   calls++;requests.push({blurred:input.blurred,parent:form.parentNode});
   if(outcome==='throws')throw Error('Native bridge unavailable');
   if(outcome==='rejected')return Promise.reject(Error('Native bridge unavailable'));
   if(outcome==='pending')return new Promise(()=>{});
   return Promise.resolve({ok:true});
  };
  assert.doesNotThrow(()=>h.tap('free'));
  assert.equal(calls,0,'native editing ends after the DOM close has settled');
  assert.equal(h.active(),undefined,'a pending or unavailable native bridge never delays closing');
  assert.equal(form.parentNode,originalParent);assert.equal(h.replayButton.focused,true);
  assert.equal(h.rootClasses.has('bb-onboarding-open'),false);assert.equal(h.read().complete,true);
  assert.equal(h.storage.get(PLAN),'saved meal plan');assert.equal(h.storage.get(SESSION),session);assert.equal(h.preferences.length,0);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,['web','unavailable'].includes(outcome)?0:1);
  for(const request of requests){assert.equal(request.blurred,true,'DOM input blurs before the native request');assert.equal(request.parent,originalParent,'UIKit sees the form in its restored, hidden account panel');}
 }
});

test('native close waits one layout frame and cannot dismiss a newly opened credential field',()=>{
 for(const next of ['none','field','onboarding']){
  const h=harness({store:new Map([[PLAN,'saved meal plan']]),withAuth:true});h.tap('next');
  const host=h.active(),form=h.node('cloud-auth'),slot=form.parentNode,frames=[];
  const input={id:'cloud-email',matches:()=>true,inside:true,blur(){this.blurred=true;h.document.activeElement=h.replayButton;}};
  host.contains=node=>node===input||node===form&&form.parentNode===slot;
  h.document.activeElement=input;h.window.requestAnimationFrame=fn=>{frames.push(fn);return frames.length;};
  let calls=0;h.window.BBNative.dismissKeyboard=()=>{calls++;assert.notEqual(form.parentNode,slot);assert.equal(host.removed,true);assert.equal(input.blurred,true);return Promise.resolve({ok:true});};
  h.tap('free');assert.equal(calls,0);assert.equal(h.active(),undefined);assert.equal(frames.length,1);
  let fresh;
  if(next==='field'){fresh={matches:()=>true,getClientRects:()=>[{}],blur(){this.blurred=true;}};h.document.activeElement=fresh;}
  if(next==='onboarding')h.window.BBOnboard2026.open();
  for(const frame of frames.splice(0))frame();
  assert.equal(calls,next==='none'?1:0,'an old close never cancels new editing');
  if(fresh)assert.notEqual(fresh.blurred,true);
 }
});

test('native close still dismisses the original credential input when WebKit retains visible focus',()=>{
 for(const field of ['cloud-email','cloud-password']){
  const h=harness({store:new Map([[PLAN,'saved meal plan']]),withAuth:true});h.tap('next');
  const host=h.active(),form=h.node('cloud-auth'),slot=form.parentNode,frames=[];
  // Secure input can keep its WKWebView responder even after DOM blur and
  // portal restoration. A retained original field is not a new user action.
  let blurs=0,keyboardVisible=true,calls=0;
  const input={id:field,matches:()=>true,inside:true,getClientRects:()=>[{}],blur(){blurs++;}};
  host.contains=node=>node===input||node===form&&form.parentNode===slot;
  h.document.activeElement=input;h.window.requestAnimationFrame=fn=>{frames.push(fn);return frames.length;};
  h.window.BBNative.dismissKeyboard=()=>{
   calls++;assert.notEqual(form.parentNode,slot);assert.equal(host.removed,true);
   keyboardVisible=false;h.document.activeElement=h.replayButton;return Promise.resolve({ok:true});
  };
  h.tap('free');assert.equal(h.active(),undefined);assert.ok(blurs>0);assert.equal(keyboardVisible,true);
  assert.equal(h.document.activeElement,input,'the original field can retain focus until UIKit resigns it');
  for(const frame of frames.splice(0))frame();
  assert.equal(calls,1,field+' must still reach native dismissal when the original focus survives');
  assert.equal(keyboardVisible,false);assert.equal(h.document.activeElement,h.replayButton);
 }
});

test('closing onboarding never restores focus to an editable opener',async()=>{
 const h=harness({saved:completed,store:new Map([[PLAN,'saved meal plan']]),withAuth:true});
 const opener={isConnected:true,matches:()=>true,focus(){this.focused=true;}};h.document.activeElement=opener;
 assert.equal(h.window.BBOnboard2026.open(),true);h.tap('next');
 const host=h.active(),form=h.node('cloud-auth'),slot=form.parentNode;
 const input={inside:true,matches:()=>true,blur(){h.document.activeElement=h.replayButton;}};
 host.contains=node=>node===input||node===form&&form.parentNode===slot;h.document.activeElement=input;
 let calls=0;h.window.BBNative.dismissKeyboard=()=>{calls++;return Promise.resolve({ok:true});};
 h.tap('replay-cancel');assert.notEqual(opener.focused,true,'restoring an input would reopen the software keyboard');
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
});

test('leaving Welcome without mounting credentials does not request native keyboard dismissal',()=>{
 const h=harness({store:new Map([[PLAN,'saved meal plan']]),withAuth:true});let calls=0;
 h.window.BBNative.dismissKeyboard=()=>{calls++;return Promise.resolve({ok:true});};
 h.tap('free');assert.equal(calls,0);assert.equal(h.active(),undefined);assert.equal(h.read().complete,true);
 assert.equal(h.storage.get(PLAN),'saved meal plan');
});

test('a remembered expired session keeps onboarding credentials hidden, then shows them after definitive rejection',()=>{
 const storage=new Map([[PLAN,'saved meal plan'],[SESSION,JSON.stringify({user:{id:'returning-person'},access_token:'expired',refresh_token:'renewable',expires_at:1})]]);
 const h=harness({store:storage,remembered:true,withAuth:true});h.through(1);
 assert.match(h.active().innerHTML,/You’re already signed in/);assert.equal(h.node('cloud-auth').hidden,true,'render must not unhide the original form behind onboarding');
 assert.notEqual(h.node('cloud-auth').parentNode.id,'bbobAuthSlot');
 h.setRemembered(false);h.storage.delete(SESSION);h.dispatch('basketboss:session-changed');
 assert.match(h.active().innerHTML,/Create a free account or sign in/);assert.doesNotMatch(h.active().innerHTML,/You’re already signed in/);
 assert.equal(h.node('cloud-auth').hidden,false);assert.equal(h.node('cloud-auth').parentNode.id,'bbobAuthSlot');
 assert.equal(h.storage.get(PLAN),'saved meal plan');
});

test('remembered identity cannot finish a partner join until a fresh authenticated session arrives',()=>{
 const storage=new Map([[PLAN,'saved meal plan'],[SESSION,JSON.stringify({user:{id:'returning-person'},access_token:'expired',refresh_token:'renewable',expires_at:1})]]);
 const h=harness({store:storage,remembered:true,withAuth:true});h.through(2);h.tap('partner-join');
 assert.equal(h.read().complete,false);assert.equal(h.read().step,1);assert.ok(h.active());assert.equal(h.node('cloud-auth').hidden,true);
 h.dispatch('basketboss:session-changed');assert.equal(h.read().complete,false,'an unchanged remembered-session notification is not authentication');
 h.storage.set(SESSION,JSON.stringify({user:{id:'returning-person'},access_token:'fresh',expires_at:9999999999}));h.dispatch('basketboss:session-changed');
 assert.equal(h.read().complete,true);assert.equal(h.active(),undefined);assert.equal(h.storage.get(PLAN),'saved meal plan');
});

test('first setup applies selected goals and diet through the planner only after Finish',()=>{
 const h=harness();h.through(4);h.tap(null,1);h.tap('next');h.tap(null,1);
 assert.equal(h.preferences.length,0,'answering a question must not alter the active planner');
 h.through(5);h.tap('free-complete');
 assert.deepEqual(h.preferences,[{meals:{diets:['Vegetarian'],goals:['Plan dinners faster']}}]);
 assert.equal(h.read().complete,true);assert.equal(h.active(),undefined);
});

test('replay changes only its edited diet and preserves unrelated planner goals',()=>{
 const h=harness({saved:completed});h.window.BBOnboard2026.open();h.through(5);
 h.tap(null,1);h.tap(null,2);h.through(5);h.tap('free-complete');
 assert.deepEqual(h.preferences,[{meals:{diets:['Vegan']}}]);
 assert.deepEqual(h.read().goals,['Plan dinners faster']);
});

test('explicitly clearing a replay field clears only that planner field',()=>{
 for(const [field,step,index] of [['goals',4,1],['diets',5,1]]){
  const h=harness({saved:completed});h.window.BBOnboard2026.open();h.through(step);
  h.tap(null,index);h.through(10-step);h.tap('free-complete');
  assert.deepEqual(h.preferences,[{meals:{[field]:[]}}]);
 }
});

test('skipping edited replay questions restores their original answers without applying a patch',()=>{
 const h=harness({saved:completed});h.window.BBOnboard2026.open();h.through(4);
 h.tap(null,0);h.tap('skip');h.tap(null,2);h.tap('skip');h.through(4);h.tap('free-complete');
 assert.deepEqual(h.preferences,[]);
 assert.deepEqual(h.read().diets,['Vegetarian']);assert.deepEqual(h.read().goals,['Plan dinners faster']);
});

test('skipping a first-setup question does not clear an existing planner preference',()=>{
 const h=harness();h.through(5);h.tap(null,1);h.tap('skip');h.through(4);h.tap('free-complete');
 assert.deepEqual(h.preferences,[]);assert.equal(h.read().complete,true);
});

test('authentication applies previously selected first-setup choices before completing',()=>{
 const h=harness({saved:{...completed,complete:false,started:true},withAuth:true});
 h.window.BBOnboard2026.pauseForAccount();
 assert.equal(h.window.BBOnboard2026.authenticated(),true);
 assert.deepEqual(h.preferences,[{house:2},{region:'UK'},{meals:{diets:['Vegetarian'],goals:['Plan dinners faster']}}]);
 assert.equal(h.read().complete,true);assert.equal(h.active(),undefined);
});

test('later sign-in never reapplies a completed survey over newer planner edits',()=>{
 const h=harness({saved:completed}),before=h.storage.get(KEY),writes=h.writes.length;
 assert.equal(h.window.BBOnboard2026.authenticated(),true);
 assert.equal(h.preferences.length,0);assert.equal(h.storage.get(KEY),before);assert.equal(h.writes.length,writes);
});

test('authentication cancels replay drafts without changing the committed survey or planner',()=>{
 const h=harness({saved:completed}),before=h.storage.get(KEY);
 h.window.BBOnboard2026.open();h.through(5);h.tap(null,2);
 assert.equal(h.window.BBOnboard2026.authenticated(),true);
 assert.equal(h.preferences.length,0);assert.equal(h.storage.get(KEY),before);assert.equal(h.active(),undefined);
});

test('meal preference failures keep setup retryable during Finish and after authentication',()=>{
 for(const auth of [false,true]){
  const h=harness({saved:{...completed,house:'',region:'',goals:[],complete:false,started:true},withAuth:true});
  h.setMealSave(false);
  if(auth){h.window.BBOnboard2026.pauseForAccount();assert.equal(h.window.BBOnboard2026.authenticated(),false);assert.match(h.node('cloud-message').textContent,/Could not save your meal preferences/);}
  else{h.tap('free-complete');assert.match(h.saveStatus.textContent,/Could not save your meal preferences/);assert.ok(h.active());}
  assert.equal(h.read().complete,false);
  h.setMealSave(true);
  if(auth)assert.equal(h.window.BBOnboard2026.authenticated(),true);else h.tap('free-complete');
  assert.equal(h.read().complete,true);assert.equal(h.active(),undefined);
 }
});
