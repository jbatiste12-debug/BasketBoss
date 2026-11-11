import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {PRODUCTION_ORIGIN,productionApiURL,nativePageURL,nativeMembershipURL,isNativeBillingURL} from '../native/routing.mjs';

const source=fs.readFileSync(new URL('../native/runtime.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
function fixture({native=true,platform='ios',href='capacitor://localhost/index.html'}={}){
 const calls={navigation:[],network:[],plugins:[],storage:[],purchaseControllers:0,membershipControllers:0};
 const flags={deleting:false,dialog:false,startup:false},classes=new Set(),events=new Map();
 const location={href,hash:'',assign:value=>calls.navigation.push(value)};
 const document={readyState:'loading',documentElement:{classList:{add:value=>classes.add(value),contains:value=>value==='bb-native-starting'?flags.startup:classes.has(value)}},getElementById:id=>id==='bbAccountDeletionDialog'?{open:flags.dialog}:null,addEventListener(name,listener){events.set(name,listener);}};
 const window={location,BBAccountDeletion:{isDeleting:()=>flags.deleting},addEventListener(){},dispatchEvent(){}};
 const context={window,document,location,URL,Event,console,PRODUCTION_ORIGIN,productionApiURL,nativePageURL,nativeMembershipURL,isNativeBillingURL,
  Capacitor:{isNativePlatform:()=>native,getPlatform:()=>platform},registerPlugin(name){calls.plugins.push(name);return {};},
  installNativeFetch:()=>async(...args)=>{calls.network.push(args);throw Error('Navigation must not send a request.');},installNativeXHR(){},installNativeWindowOpen(){},
  installNativeStartup:()=>({ready(){}}),watchNativeEntryReadiness:()=>({stop(){}}),installNativeCookVoice:()=>({stop(){}}),
  installNativeApplePurchases(){calls.purchaseControllers++;throw Error('Navigation must not create a purchase controller.');},installNativeMembership(){calls.membershipControllers++;throw Error('Navigation must not mount a membership screen.');},
  App:{addListener:async()=>({remove(){}}),getLaunchUrl:async()=>null},Browser:{open(){throw Error('Navigation must stay in the app.');}},
  localStorage:{getItem:()=>null,setItem:(...args)=>calls.storage.push(args)},sessionStorage:{getItem:()=>null,setItem:(...args)=>calls.storage.push(args)}
 };
 vm.runInNewContext(source,context,{timeout:1000});
 return {window,flags,calls,events};
}

test('the onboarding membership hook exists only on native iOS and exposes navigation only',()=>{
 const h=fixture(),hook=h.window.BBNativeMembership;
 assert.equal(Object.isFrozen(hook),true);assert.deepEqual(Object.keys(hook),['open']);
 for(const options of [{native:false},{platform:'android'}])assert.equal(fixture(options).window.BBNativeMembership,undefined);
 assert.throws(()=>{hook.subscribe=()=>{};},TypeError);
});

test('onboarding membership navigation uses the canonical bundled Apple page without starting billing or changing access',()=>{
 for(const href of ['capacitor://localhost/index.html?offer=founder#account','capacitor://localhost/make-a-meal.html?plan=annual']){
  const h=fixture({href});
  assert.equal(h.window.BBNativeMembership.open('https://checkout.paddle.com/pay'),true);
  assert.deepEqual(h.calls.navigation,['capacitor://localhost/pricing-sandbox.html']);
  assert.deepEqual(h.calls.network,[]);assert.deepEqual(h.calls.storage,[]);
  assert.equal(h.calls.purchaseControllers,0);assert.equal(h.calls.membershipControllers,0);
  assert.equal(h.calls.plugins.includes('BasketBossPurchases'),false);
  assert.equal(h.window.BasketBossVerifiedPremium,undefined);assert.equal(h.window.BasketBossNativeMembershipState,undefined);
 }
});

test('deletion locks, open confirmation and startup block the handoff until the guard clears',()=>{
 for(const flag of ['deleting','dialog','startup']){
  const h=fixture();h.flags[flag]=true;
  assert.equal(h.window.BBNativeMembership.open(),false,flag);assert.deepEqual(h.calls.navigation,[]);
  assert.deepEqual(h.calls.network,[]);assert.deepEqual(h.calls.storage,[]);
  h.flags[flag]=false;assert.equal(h.window.BBNativeMembership.open(),true,flag);
  assert.deepEqual(h.calls.navigation,['capacitor://localhost/pricing-sandbox.html']);
 }
});
