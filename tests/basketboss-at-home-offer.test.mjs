import test from 'node:test';
import assert from 'node:assert/strict';
import {installNativeMembership} from '../native/membership.mjs';

test('At home trial badge reads live StoreKit eligibility, stays read-only and cleans up',()=>{
 const previous=globalThis.MutationObserver;
 globalThis.MutationObserver=class{observe(){}disconnect(){}};
 const win=new EventTarget();win.Event=Event;win.location={hash:'',href:'capacitor://localhost/index.html'};
 const listeners=new Set(),offer={paymentMode:'freeTrial',price:'0',periodCount:1,period:{unit:'day',value:7},eligible:true};
 let state={available:false,premiumAccess:false,products:[]},events=0;
 win.addEventListener('basketboss:trial-offer-changed',()=>events++);
 const purchases={get state(){return state;},subscribeState(fn){listeners.add(fn);fn(state);return()=>listeners.delete(fn);},refresh(){throw Error('Presentation must not refresh or buy');}};
 const doc={getElementById(){return null;},querySelectorAll(){return[];},body:{}};
 let controller;
 try{
  controller=installNativeMembership({apiURL:'https://example.invalid',readSession:()=>null,document:doc,window:win,purchases});
  const gate=win.BasketBossNativeTrialOffer;assert.equal(gate.isEligible(),false);
  const emit=change=>{state={...state,...change};for(const fn of listeners)fn(state);};
  emit({available:true,products:[{displayPrice:'£3.99',introductoryOffer:offer}]});assert.equal(gate.isEligible(),true);
  const before=events;emit({});assert.equal(events,before,'unchanged eligibility never triggers a repaint loop');
  emit({premiumAccess:true});assert.equal(gate.isEligible(),false);
  emit({premiumAccess:false,products:[{displayPrice:'£3.99',introductoryOffer:{...offer,eligible:false}}]});assert.equal(gate.isEligible(),false);
  emit({products:[{displayPrice:'£3.99',introductoryOffer:{...offer,period:{unit:'day',value:3}}}]});assert.equal(gate.isEligible(),false);
  assert.deepEqual(Object.keys(gate),['isEligible'],'offer adapter exposes no account or purchase mutation');
  controller.destroy();controller=null;assert.equal(win.BasketBossNativeTrialOffer,undefined);assert.equal(listeners.size,0);
 }finally{controller?.destroy();if(previous===undefined)delete globalThis.MutationObserver;else globalThis.MutationObserver=previous;}
});
