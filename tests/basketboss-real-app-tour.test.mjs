import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../bb-real-app-tour-v82.js',import.meta.url),'utf8');
function fixture({search='?bb_tour=1&bb_step=8',account=false,dialog=false,onboarding=false,pending=false,settings=false}={}){
 const flags={account,dialog,onboarding,pending,settings};const nodes=new Map(),observers=[],historyCalls=[],tabs=[];let restoredFocus=0;
 class Node{
  constructor(name){this.name=name;this.isConnected=true;this.parts=new Map();this.textContent='';this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),contains:x=>this.classes.has(x)};}
  set id(value){this._id=value;nodes.set(value,this);}get id(){return this._id;}
  setAttribute(){}append(){}remove(){this.isConnected=false;nodes.delete(this.id);}
  querySelector(selector){if(!this.parts.has(selector))this.parts.set(selector,new Node(selector));return this.parts.get(selector);}
  closest(selector){return selector==='.bbui-settings-overlay'&&this.name==='settings'?this:null;}
  getClientRects(){return [1];}scrollIntoView(){}focus(){restoredFocus++;}click(){tabs.push(this.name);}
 }
 const accountNode=new Node('account'),modal=new Node('modal'),settingsNode=new Node('settings'),nav=new Node('navigation');
 const document={readyState:'complete',head:new Node('head'),body:new Node('body'),activeElement:new Node('previous-focus'),documentElement:{classList:{contains:()=>false}},createElement:name=>new Node(name),addEventListener(){},
  getElementById(id){if(id==='app')return {firstElementChild:{}};if(id==='bbNewOnboarding')return flags.onboarding?new Node('onboarding'):null;if(id==='cloud-panel')return accountNode;return nodes.get(id)||null;},
  querySelector(selector){if(selector==='#cloud-panel.open')return flags.account?accountNode:null;if(selector==='.shell .tabs')return nav;if(selector.startsWith('.shell .tab[data-tab='))return new Node(selector);return null;},
  querySelectorAll(){return [...(flags.dialog?[modal]:[]),...(flags.settings?[settingsNode]:[])];}
 };
 const window={BBAccountDeletion:{isDeleting:()=>flags.pending},addEventListener(){}};
 vm.runInNewContext(source,{window,document,URL,URLSearchParams,location:{href:'https://basketboss.example/index.html'+search,search},history:{state:null,replaceState(...args){historyCalls.push(args);}},getComputedStyle:()=>({display:'block',visibility:'visible'}),requestAnimationFrame:fn=>fn(),MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}},console});
 return {flags,window,nodes,tabs,historyCalls,get restoredFocus(){return restoredFocus;},mutate(){for(const fn of observers)fn();},title(){return nodes.get('bb82TourCard')?.parts.get('#bb82TourTitle')?.textContent;}};
}

test('direct receipt walkthrough opens step nine using the real Shop route',()=>{
 const h=fixture();assert.equal(h.title(),'Scan a receipt after shopping');assert.equal(h.window.BBRealAppTour.steps,10);assert.ok(h.tabs[0].includes('shop-list'));
 h.window.BBRealAppTour.close();assert.ok(!h.nodes.has('bb82TourCard'));assert.equal(h.historyCalls.at(-1)[2],'/index.html');
});

test('an automatic walkthrough waits for account, sensitive dialog, setup and deletion flows',()=>{
 for(const kind of ['account','dialog','onboarding','pending','settings']){
  const h=fixture({[kind]:true});assert.ok(!h.nodes.has('bb82TourCard'),kind);
  h.flags[kind]=false;h.mutate();assert.equal(h.title(),'Scan a receipt after shopping',kind);
 }
});

test('manual walkthrough cannot cover account or deletion flows',()=>{
 for(const kind of ['account','dialog','onboarding','pending']){
  const h=fixture({search:'',[kind]:true});assert.equal(h.window.BBRealAppTour.open(),false);assert.ok(!h.nodes.has('bb82TourCard'));
 }
});

test('opening an account dialog dismisses the current walkthrough without moving focus behind it',()=>{
 const h=fixture();const previous=h.restoredFocus;h.flags.account=true;h.mutate();
 assert.ok(!h.nodes.has('bb82TourCard'));assert.equal(h.restoredFocus,previous);
});
