import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {installNativeStartup} from '../native/startup.mjs';

function fixture({saved=false,pathname='/index.html',nativeFinish=async()=>{}}={}){
 const nodes=new Map(),values=new Map(),listeners=[],events=[],timers=new Map();let callback,reloads=0,hasControls=false,finishCalls=0;
 if(saved)values.set('basketboss_native_startup_seen_v1','1');
 class Node{
  constructor(tag){this.tag=tag;this.removed=false;this.hidden=true;this.children=[];this.handlers=new Map();}
  set id(value){this._id=value;nodes.set(value,this);}get id(){return this._id;}
  append(node){this.children.push(node);}setAttribute(){}
  addEventListener(name,fn){this.handlers.set(name,fn);}
  querySelector(name){return this.parts?.[name]||(this.parts??={},this.parts[name]=new Node(name));}
  querySelectorAll(){return [this.querySelector('.bbns-status'),this.querySelector('button')];}
  remove(){this.removed=true;nodes.delete(this.id);}
 }
 const classes=new Set(),root=new Node('html');root.classList={add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)};
 const app={get firstElementChild(){return hasControls?{}:null;}};
 const doc={documentElement:root,head:new Node('head'),body:new Node('body'),createElement:tag=>new Node(tag),getElementById:id=>id==='app'&&pathname==='/index.html'?app:nodes.get(id)||null};
 const win={location:{pathname,reload(){reloads++;}},sessionStorage:{getItem:key=>values.get(key)||null,setItem:(key,val)=>values.set(key,val)},setTimeout(fn,ms){timers.set(ms,fn);return ms;},clearTimeout:id=>timers.delete(id),Event,dispatchEvent:event=>events.push(event.type),MutationObserver:class{constructor(fn){callback=fn;}observe(){}disconnect(){callback=null;}}};
 const api=installNativeStartup({window:win,document:doc,finishNative:async()=>{finishCalls++;await nativeFinish();}});
 return {api,classes,nodes,values,events,timers,get finishCalls(){return finishCalls;},get reloads(){return reloads;},render(){hasControls=true;callback?.();}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('native crown and wordmark exist before app startup, without hiding the name behind an animation delay',()=>{
 const h=fixture(),overlay=h.nodes.get('bbNativeStartup'),style=h.nodes.get('bbNativeStartupCritical').textContent;
 assert.ok(h.classes.has('bb-native-starting'));
 assert.match(overlay.innerHTML,/<h1 class="bbns-name">Basket<span>Boss<\/span>/);
 assert.doesNotMatch(style,/\.bbns-name\{[^}]*opacity:\s*0/);
 assert.equal(h.values.get('basketboss_welcome_splash_seen_v1'),'1');
 assert.equal(h.finishCalls,0);
});

test('native overlay hands off only after controls render and the native dismissal has completed',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;}),h=fixture({nativeFinish:()=>pending});
 h.api.ready();assert.equal(h.finishCalls,0);assert.equal(h.api.phase,'starting');
 h.render();await tick();assert.equal(h.finishCalls,1);assert.ok(!h.nodes.has('bbNativeStartup'),'native dismissal must reveal the app rather than a second HTML logo');assert.ok(!h.classes.has('bb-native-starting'));assert.deepEqual(h.events,['basketboss:native-startup-ready']);assert.equal(h.api.phase,'handoff');
 release();await tick();assert.equal(h.api.phase,'ready');assert.ok(!h.classes.has('bb-native-starting'));
 assert.ok(!h.nodes.has('bbNativeStartup'));assert.deepEqual(h.events,['basketboss:native-startup-ready']);
 assert.equal(h.values.get('basketboss_native_startup_seen_v1'),'1');assert.equal(h.timers.size,0);
 await h.api.finish();assert.equal(h.finishCalls,1);
});

test('a delayed launch offers a safe reload instead of removing the screen onto an empty app',()=>{
 const h=fixture();h.api.ready();h.timers.get(12000)();
 const overlay=h.nodes.get('bbNativeStartup');assert.equal(h.api.phase,'delayed');
 assert.ok(overlay.querySelectorAll().every(node=>node.hidden===false));assert.equal(h.finishCalls,0);
 overlay.querySelector('button').handlers.get('click')();assert.equal(h.reloads,1);assert.ok(h.classes.has('bb-native-starting'));
});

test('a returning document skips a second web animation while the native readiness handoff still runs',async()=>{
 const h=fixture({saved:true});assert.equal(h.nodes.get('bbNativeStartup').hidden,true);
 h.render();h.api.ready();await tick();assert.equal(h.finishCalls,1);assert.equal(h.api.phase,'ready');
});

test('legal documents release startup without waiting for planner controls',async()=>{
 const h=fixture({pathname:'/privacy.html'});h.api.ready();await tick();assert.equal(h.api.phase,'ready');assert.equal(h.finishCalls,1);
});

test('a missing bridge method does not leave the web startup blocker over a usable page',async()=>{
 const h=fixture({nativeFinish:async()=>{throw Error('missing bridge');}});h.render();h.api.ready();await tick();
 assert.equal(h.api.phase,'ready');assert.ok(!h.classes.has('bb-native-starting'));
});

test('iOS starts native motion independently of web content and keeps a name on the OS launch screen',()=>{
 const swift=fs.readFileSync(new URL('../ios/App/App/AppDelegate.swift',import.meta.url),'utf8');
 const config=JSON.parse(fs.readFileSync(new URL('../capacitor.config.json',import.meta.url),'utf8'));
 const launch=fs.readFileSync(new URL('../ios/App/App/Base.lproj/LaunchScreen.storyboard',import.meta.url),'utf8');
 assert.equal(config.plugins.SplashScreen.launchShowDuration,0);
 assert.match(swift,/override func viewDidLoad\(\)[\s\S]*showStartup\(\)/);
 assert.match(swift,/override func viewDidAppear[\s\S]*startupView\?\.startMotion\(\)/);
 assert.match(swift,/name\.attributedText = NSAttributedString\(string: "BasketBoss"/);
 assert.match(swift,/guard !UIAccessibility\.isReduceMotionEnabled else \{ return \}/);
 assert.match(swift,/CAPPluginMethod\(name: "finishStartup", returnType: CAPPluginReturnPromise\)/);
 assert.match(swift,/asyncAfter\(deadline: \.now\(\) \+ 12/);
 assert.match(launch,/text="BasketBoss"/);
 assert.doesNotMatch(swift,/startup[^\n]*Thread\.sleep|startup[^\n]*usleep/);
});


test('native cream screens use dark status-bar text according to the installed Capacitor style semantics',()=>{
 const sdk=fs.readFileSync(new URL('../node_modules/@capacitor/status-bar/ios/Sources/StatusBarPlugin/StatusBarPlugin.swift',import.meta.url),'utf8');
 const runtime=fs.readFileSync(new URL('../native/runtime.mjs',import.meta.url),'utf8');
 const config=JSON.parse(fs.readFileSync(new URL('../capacitor.config.json',import.meta.url),'utf8'));
 assert.match(sdk,/case "light", "darkcontent":[\s\S]*?return \.darkContent/);
 assert.equal(config.plugins.StatusBar.style,'LIGHT');assert.match(runtime,/StatusBar\.setStyle\(\{style:Style\.Light\}/);
});


test('a failed returning-page load still reveals a recovery action after the bounded wait',()=>{
 const h=fixture({saved:true});h.api.ready();assert.equal(h.nodes.get('bbNativeStartup').hidden,true);
 h.timers.get(12000)();assert.equal(h.nodes.get('bbNativeStartup').hidden,false);
 h.nodes.get('bbNativeStartup').querySelector('button').handlers.get('click')();assert.equal(h.reloads,1);
});


test('the next screen receives its ready event before the native cover begins to fade',async()=>{
 let eventBeforeFade=false;let h;
 h=fixture({nativeFinish:async()=>{eventBeforeFade=h.events.includes('basketboss:native-startup-ready')&&!h.classes.has('bb-native-starting');}});
 h.render();h.api.ready();await tick();assert.equal(eventBeforeFade,true);assert.equal(h.events.length,1);
});
