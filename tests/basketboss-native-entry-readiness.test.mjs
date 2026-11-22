import test from 'node:test';
import assert from 'node:assert/strict';
import {watchNativeEntryReadiness,nativeEntryPresentationReady} from '../native/entry-readiness.mjs';
import {transformNativeHtml} from '../scripts/build-native-web.mjs';

function fixture({saved='{"complete":true}',pathname='/index.html',storageError=false,loading=false,presentation=true}={}){
 const events=[];let callback,controls=false,disconnected=false,presented=presentation;
 const win={location:{pathname},localStorage:{getItem(){if(storageError)throw Error('unavailable');return saved;}},MutationObserver:class{constructor(fn){callback=fn;}observe(){}disconnect(){disconnected=true;}}};
 const doc={body:{},readyState:loading?'loading':'interactive',documentElement:{},getElementById:id=>id==='app'?{get firstElementChild(){return controls?{}:null;}}:null};
 const watcher=watchNativeEntryReadiness({window:win,document:doc,startup:{ready(){events.push('ready');}},prepareMembership(){events.push('membership');},presentationReady:()=>presented});
 return {events,watcher,win,get disconnected(){return disconnected;},render(){controls=true;callback?.();},present(){presented=true;callback?.();},parsed(){doc.readyState='interactive';callback?.();},initDeletion(){win.BBAccountDeletion={start(){events.push('deletion');}};callback?.();},initOnboarding(){win.BBOnboard2026={willShow:()=>true};callback?.();},mutate(){callback?.();}};
}

test('returning native entry waits for real controls and restores deletion guards before revealing the app',()=>{
 const h=fixture();h.render();assert.deepEqual(h.events,[]);
 h.initDeletion();assert.deepEqual(h.events,['deletion','membership','ready']);assert.equal(h.disconnected,true);
 h.mutate();assert.equal(h.events.length,3);
});

test('fresh, incomplete, malformed and unavailable setup state waits for the real modern onboarding module',()=>{
 for(const options of [{saved:null},{saved:'{"complete":false}'},{saved:'{"complete":"true"}'},{saved:'broken'},{storageError:true}]){
  const h=fixture(options);h.initDeletion();h.render();assert.deepEqual(h.events,[]);
  h.initOnboarding();assert.deepEqual(h.events,['deletion','membership','ready']);
 }
});

test('secondary native documents and a stopped watcher never dismiss an unfinished page early',()=>{
 const secondary=fixture({pathname:'/make-a-meal.html'});secondary.initDeletion();secondary.render();assert.deepEqual(secondary.events,[]);
 const stopped=fixture();stopped.watcher.stop();stopped.initDeletion();stopped.render();assert.deepEqual(stopped.events,[]);
});

test('even a returning install waits for parsing to finish before exposing controls',()=>{
 const h=fixture({loading:true});h.initDeletion();h.render();assert.deepEqual(h.events,[]);
 h.parsed();assert.deepEqual(h.events,['deletion','membership','ready']);
});

test('DOMContentLoaded cannot release a returning raw Plan before its local presentation settles',()=>{
 const h=fixture({presentation:false});h.initDeletion();h.render();
 assert.deepEqual(h.events,['deletion']);h.watcher.ready();h.mutate();
 assert.deepEqual(h.events,['deletion'],'restored locks stay active without restarting their owner');
 assert.equal(h.disconnected,false);h.present();
 assert.deepEqual(h.events,['deletion','membership','ready']);
 assert.equal(h.disconnected,true);h.watcher.ready();assert.equal(h.events.length,3);
});

test('fresh onboarding retains its own handoff instead of waiting for the background Plan decorator',()=>{
 const h=fixture({saved:null,presentation:false});h.initDeletion();h.render();h.watcher.ready();
 assert.deepEqual(h.events,[]);h.initOnboarding();
 assert.deepEqual(h.events,['deletion','membership','ready']);
});

test('secondary document readiness is explicit and never waits for a Plan header',()=>{
 const h=fixture({pathname:'/make-a-meal.html',presentation:false});h.watcher.ready();
 assert.deepEqual(h.events,['ready']);h.watcher.ready();assert.equal(h.events.length,1);
});

test('the real local predicate rejects missing headers, raw Plan and double navigation selection',()=>{
 const parts=new Set(),selected=[{dataset:{bbNavItem:'plan'}}];
 const app={firstElementChild:{},dataset:{},querySelector:selector=>parts.has(selector)?{}:null};
 const nav={dataset:{bbNavigation:'polished'},querySelectorAll:()=>selected};
 const doc={body:{dataset:{bbnextView:'week'}},getElementById:id=>id==='app'?app:id==='bbPrimaryNavigation'?nav:null,querySelector:selector=>parts.has(selector)?{}:null};
 assert.equal(nativeEntryPresentationReady(doc),false);
 Object.assign(app.dataset,{bbCompactPlan:'true',bbCompactHeader:'true'});
 for(const part of ['.bbpc-week-header','.bbpc-week-price','.bbnext-plan-budget[data-bb-simple-budget]','#bbPlanHomeSnapshot'])parts.add(part);
 assert.equal(nativeEntryPresentationReady(doc),false,'old header cannot be exposed');
 parts.add('.shell>header.top[data-bb-account-polish="banner"]');assert.equal(nativeEntryPresentationReady(doc),true);
 selected.push({dataset:{bbNavItem:'discover'}});assert.equal(nativeEntryPresentationReady(doc),false);
 selected.pop();parts.delete('.bbpc-week-price');assert.equal(nativeEntryPresentationReady(doc),false);
});

test('native HTML removes only inline favicon bytes while keeping local icons and embedded content',()=>{
 const html=transformNativeHtml('<html><head><link rel="icon" href="data:image/png;base64,AAAA"><link href="data:image/png;base64,BBBB" rel="shortcut icon"><link rel="icon" href="icons/app.png"></head><body><img src="data:image/png;base64,CCCC"></body></html>');
 assert.ok(!html.includes('AAAA'));assert.ok(!html.includes('BBBB'));
 assert.ok(html.includes('href="icons/app.png"'));assert.ok(html.includes('data:image/png;base64,CCCC'));
});
