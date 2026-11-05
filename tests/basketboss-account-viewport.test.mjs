import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../bb-account-polish.js',import.meta.url),'utf8');
function fixture({viewport=true,preInert=true,mobile=false}={}){
 const events=()=>{const map=new Map();return{addEventListener(type,fn){const list=map.get(type)||[];list.push(fn);map.set(type,list);},fire(type,event={}){for(const fn of map.get(type)||[])fn(event);}};};
 const style=()=>{const values=new Map();return{setProperty:(key,value)=>values.set(key,value),removeProperty:key=>values.delete(key),getPropertyValue:key=>values.get(key)||''};};
 const classes=()=>{const names=new Set();return{add:name=>names.add(name),remove:name=>names.delete(name),contains:name=>names.has(name)};};
 let doc,root;
 class Node{
  constructor(id,tag='DIV'){this.id=id;this.tagName=tag;this.dataset={};this.attrs=new Map();this.style=style();this.classList=classes();this.hidden=false;this.disabled=false;this.scrollTop=0;this.isConnected=true;this.value='';this.selectionStart=0;this.selectionEnd=0;this.base={top:0,bottom:40};Object.assign(this,events());}
  setAttribute(name,value){this.attrs.set(name,value);}
  hasAttribute(name){return this.attrs.has(name);}
  removeAttribute(name){this.attrs.delete(name);}
  querySelector(){return null;}
  querySelectorAll(){return this.id==='cloud-panel'?[nodes.close,nodes.email,nodes.password,nodes.login]:[];}
  contains(node){return this===node||['cloud-panel','cloud-card'].includes(this.id)&&[nodes.card,nodes.close,nodes.email,nodes.password,nodes.login].includes(node);}
  matches(selector){return selector.split(',').some(tag=>tag.trim().toUpperCase()===this.tagName);}
  getClientRects(){return this.hidden?[]:[this.getBoundingClientRect()];}
  getBoundingClientRect(){const delta=this!==nodes.card&&nodes.card.contains(this)?nodes.card.scrollTop:0;return{top:this.base.top-delta,bottom:this.base.bottom-delta};}
  focus(){doc.activeElement=this;nodes.panel.fire('focusin',{target:this});}
  blur(){this.blurred=true;if(doc.activeElement===this)doc.activeElement=nodes.body;}
  click(){if(this.id==='cloud-close'){nodes.panel.classList.remove('open');this.fire('click',{target:this});}}
 }
 const nodes={};for(const [key,id,tag]of[['panel','cloud-panel'],['card','cloud-card'],['email','cloud-email','INPUT'],['password','cloud-password','INPUT'],['login','cloud-login','BUTTON'],['close','cloud-close','BUTTON'],['signed','cloud-signed'],['status','cloud-status'],['message','cloud-message'],['shell','shell'],['settings','settings'],['onboarding','onboarding'],['body','body'],['opener','opener','BUTTON']])nodes[key]=new Node(id,tag);
 nodes.signed.hidden=true;if(preInert)nodes.settings.setAttribute('inert','');
 doc={readyState:'complete',documentElement:{style:style(),classList:classes()},activeElement:nodes.opener,body:nodes.body,getElementById:id=>Object.values(nodes).find(node=>node.id===id)||null,querySelector:()=>null,querySelectorAll:()=>[nodes.shell,nodes.settings,nodes.onboarding]};
 const frames=new Map(),scrolls=[];let nextFrame=0;
 root={document:doc,innerHeight:932,innerWidth:430,scrollX:3,scrollY:500,...events(),requestAnimationFrame(fn){const id=++nextFrame;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),scrollTo(x,y){scrolls.push([x,y]);this.scrollX=x;this.scrollY=y;},MutationObserver:class{constructor(callback){this.callback=callback;}observe(){}}};
 if(viewport)root.visualViewport={height:932,width:430,offsetTop:0,offsetLeft:0,...events()};
 root.matchMedia=()=>({matches:mobile});
 vm.runInNewContext(source,{window:root,Object,Number,Math});
 const flush=()=>{for(let round=0;frames.size&&round<20;round++){const active=[...frames.values()];frames.clear();for(const fn of active)fn();}assert.equal(frames.size,0,'viewport callbacks settle');};
 const open=()=>{nodes.panel.classList.add('open');root.BBAccountPolish.refresh();flush();};
 const close=()=>{nodes.panel.classList.remove('open');root.BBAccountPolish.refresh();flush();};
 return{root,doc,nodes,frames,scrolls,open,close,flush,resize(values){Object.assign(root.visualViewport,values);root.visualViewport.fire('resize');root.visualViewport.fire('scroll');flush();}};
}

test('opening account isolates the planner and closing restores page position and existing inert state',()=>{
 const h=fixture();h.open();assert.equal(h.doc.documentElement.classList.contains('bb-account-open'),true);assert.equal(h.doc.documentElement.style.getPropertyValue('--bbap-page-top'),'-500px');
 for(const node of[h.nodes.shell,h.nodes.settings,h.nodes.onboarding])assert.equal(node.hasAttribute('inert'),true);
 assert.equal(h.doc.activeElement,h.nodes.email);h.close();assert.equal(h.doc.documentElement.classList.contains('bb-account-open'),false);assert.equal(h.doc.documentElement.style.getPropertyValue('--bbap-page-top'),'');assert.deepEqual(h.scrolls,[[3,500]]);assert.equal(h.nodes.shell.hasAttribute('inert'),false);assert.equal(h.nodes.settings.hasAttribute('inert'),true);assert.equal(h.nodes.onboarding.hasAttribute('inert'),false);assert.equal(h.doc.activeElement,h.nodes.opener);
});

test('keyboard visual viewport events update account bounds without requiring a layout resize',()=>{
 const h=fixture();h.open();h.resize({height:520,width:393,offsetTop:180,offsetLeft:12});
 assert.equal(h.root.innerHeight,932);assert.equal(h.nodes.panel.style.getPropertyValue('--bbap-viewport-height'),'520px');assert.equal(h.nodes.panel.style.getPropertyValue('--bbap-viewport-width'),'393px');assert.equal(h.nodes.panel.style.getPropertyValue('--bbap-viewport-top'),'180px');assert.equal(h.nodes.panel.style.getPropertyValue('--bbap-viewport-left'),'12px');
 h.resize({height:300,offsetTop:300});assert.equal(h.nodes.panel.style.getPropertyValue('--bbap-viewport-height'),'300px');assert.equal(h.nodes.panel.style.getPropertyValue('--bbap-viewport-top'),'300px');
});

test('touch account opening keeps the form unfocused until the user chooses a field',()=>{
 const h=fixture({mobile:true});h.open();assert.equal(h.doc.activeElement,h.nodes.close);
 h.nodes.password.focus();h.flush();assert.equal(h.doc.activeElement,h.nodes.password);
 h.root.BBAccountPolish.refresh();h.flush();assert.equal(h.doc.activeElement,h.nodes.password);
});

test('a password tapped before deferred opening focus is never replaced by email',()=>{
 const h=fixture();h.nodes.panel.classList.add('open');h.root.BBAccountPolish.refresh();
 h.nodes.password.focus();h.flush();assert.equal(h.doc.activeElement,h.nodes.password);
});

test('keeping a focused password reachable preserves its value, selection and focus',()=>{
 const h=fixture();h.open();h.nodes.card.base={top:15,bottom:285};h.nodes.password.base={top:400,bottom:450};h.nodes.login.base={top:465,bottom:514};h.nodes.password.value='synthetic-local-input';h.nodes.password.selectionStart=2;h.nodes.password.selectionEnd=7;h.nodes.password.focus();h.resize({height:300});
 assert.ok(h.nodes.card.scrollTop>0);assert.equal(h.nodes.password.value,'synthetic-local-input');assert.equal(h.nodes.password.selectionStart,2);assert.equal(h.nodes.password.selectionEnd,7);assert.equal(h.doc.activeElement,h.nodes.password);
 h.root.BBAccountPolish.refresh();h.flush();assert.equal(h.doc.activeElement,h.nodes.password,'unrelated modal refresh cannot focus email during typing');
});

test('closing during a queued viewport update cancels adjustment and blurs the keyboard field',()=>{
 const h=fixture();h.open();h.nodes.password.value='synthetic-local-input';h.nodes.password.focus();assert.ok(h.frames.size>0);h.close();assert.equal(h.nodes.password.value,'synthetic-local-input');assert.equal(h.nodes.password.blurred,true);assert.equal(h.frames.size,0);const old=h.nodes.panel.style.getPropertyValue('--bbap-viewport-height');h.resize({height:300});assert.equal(h.nodes.panel.style.getPropertyValue('--bbap-viewport-height'),old,'closed account ignores keyboard changes');
});
test('the close tap restores fixed-body and inert state immediately and releases the stale keyboard dock lock',()=>{
 const h=fixture({mobile:true});let released=0;h.root.BBKeyboardLayout={releaseAfterDismissal(){released++;assert.equal(h.doc.activeElement,h.nodes.body,'blur happens before releasing keyboard protection');}};
 h.open();h.nodes.email.focus();h.resize({height:417,offsetTop:164});h.nodes.close.click();
 assert.equal(h.doc.documentElement.classList.contains('bb-account-open'),false);assert.equal(h.nodes.shell.hasAttribute('inert'),false);assert.equal(released,1);assert.equal(h.frames.size,0);assert.equal(h.doc.activeElement,h.nodes.opener);
});

test('reopening account uses the current full viewport rather than stale keyboard dimensions',()=>{
 const h=fixture();h.open();h.resize({height:300,offsetTop:180});h.close();Object.assign(h.root.visualViewport,{height:932,offsetTop:0});h.open();assert.equal(h.nodes.panel.style.getPropertyValue('--bbap-viewport-height'),'932px');assert.equal(h.nodes.panel.style.getPropertyValue('--bbap-viewport-top'),'0px');
});

test('browsers without visualViewport use window dimensions and retain normal close behavior',()=>{
 const h=fixture({viewport:false,preInert:false});h.open();assert.equal(h.nodes.panel.style.getPropertyValue('--bbap-viewport-height'),'932px');assert.equal(h.nodes.panel.style.getPropertyValue('--bbap-viewport-width'),'430px');h.root.innerHeight=480;h.root.fire('resize');h.flush();assert.equal(h.nodes.panel.style.getPropertyValue('--bbap-viewport-height'),'480px');h.close();assert.deepEqual(h.scrolls,[[3,500]]);
});
