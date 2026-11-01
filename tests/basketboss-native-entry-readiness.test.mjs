import test from 'node:test';
import assert from 'node:assert/strict';
import {watchNativeEntryReadiness} from '../native/entry-readiness.mjs';
import {transformNativeHtml} from '../scripts/build-native-web.mjs';

function fixture({saved='{"complete":true}',pathname='/index.html',storageError=false,loading=false}={}){
 const events=[];let callback,controls=false,disconnected=false;
 const win={location:{pathname},localStorage:{getItem(){if(storageError)throw Error('unavailable');return saved;}},MutationObserver:class{constructor(fn){callback=fn;}observe(){}disconnect(){disconnected=true;}}};
 const doc={body:{},readyState:loading?'loading':'interactive',documentElement:{},getElementById:id=>id==='app'?{get firstElementChild(){return controls?{}:null;}}:null};
 const watcher=watchNativeEntryReadiness({window:win,document:doc,startup:{ready(){events.push('ready');}},prepareMembership(){events.push('membership');}});
 return {events,watcher,win,get disconnected(){return disconnected;},render(){controls=true;callback?.();},parsed(){doc.readyState='interactive';callback?.();},initDeletion(){win.BBAccountDeletion={start(){events.push('deletion');}};callback?.();},initOnboarding(){win.BBOnboard2026={willShow:()=>true};callback?.();},mutate(){callback?.();}};
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

test('native HTML removes only inline favicon bytes while keeping local icons and embedded content',()=>{
 const html=transformNativeHtml('<html><head><link rel="icon" href="data:image/png;base64,AAAA"><link href="data:image/png;base64,BBBB" rel="shortcut icon"><link rel="icon" href="icons/app.png"></head><body><img src="data:image/png;base64,CCCC"></body></html>');
 assert.ok(!html.includes('AAAA'));assert.ok(!html.includes('BBBB'));
 assert.ok(html.includes('href="icons/app.png"'));assert.ok(html.includes('data:image/png;base64,CCCC'));
});
