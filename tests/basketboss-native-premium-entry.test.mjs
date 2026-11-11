import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../bb-premium-features.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');

function fixture({native=true,membership=true,nativeMembership=true}={}){
 const calls={membership:0,nativeMembership:0,purchase:0,restore:0,fetch:0,dialogs:0},navigation=[],nodes=new Map();
 class Node{
  constructor(id=''){this.id=id;this.open=false;this.textContent='';this.hidden=false;this.handlers=new Map();this.attributes=new Map();this.children=new Map();}
  addEventListener(name,handler){const handlers=this.handlers.get(name)||[];handlers.push(handler);this.handlers.set(name,handlers);}
  querySelector(selector){return this.children.get(selector)||null;}
  querySelectorAll(){return [];}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  removeAttribute(name){this.attributes.delete(name);}
  showModal(){this.open=true;}
  close(){this.open=false;}
  focus(){this.focused=true;}
 }
 const doc={activeElement:new Node('feature-opener'),addEventListener(){},querySelector:selector=>nodes.get(selector)||null,querySelectorAll:()=>[],body:{insertAdjacentHTML(position,html){
  calls.dialogs++;assert.equal(position,'beforeend');assert.match(html,/id="bb173TierDialog"/);assert.match(html,/id="bb173TierHeading"/);assert.match(html,/data-bb173-close/);
  const dialog=new Node('bb173TierDialog'),close=new Node('close');dialog.children.set('[data-bb173-close]',close);
  for(const id of ['bb173TierDialog','bb173TierDesc','bb173CheckoutStatus'])nodes.set('#'+id,id==='bb173TierDialog'?dialog:new Node(id));
 }}};
 const location={href:native?'capacitor://localhost/index.html':'https://basketboss.co.uk/app',hostname:native?'localhost':'basketboss.co.uk',assign:value=>navigation.push(value)};
 const win={location,BBNative:{isNative:native,platform:native?'ios':undefined},addEventListener(){},BasketBossPurchases:{purchase(){calls.purchase++;throw Error('Feature navigation must not start a purchase');},restorePurchases(){calls.restore++;throw Error('Feature navigation must not restore');}}};
 if(membership)win.BasketBossMembershipUI={open(){calls.membership++;}};
 if(nativeMembership)win.BBNativeMembership={open(){calls.nativeMembership++;return false;}};
 const context=vm.createContext({window:win,document:doc,location,URL,AbortController,fetch(){calls.fetch++;throw Error('Opening Premium must not submit checkout');},queueMicrotask,setTimeout,clearTimeout});
 vm.runInContext(source,context);
 return {win,doc,context,calls,navigation,nodes,open:()=>win.BasketBossPremiumPreview.show(doc.activeElement,'Camera scan')};
}

function noBilling(h){assert.equal(h.calls.purchase,0);assert.equal(h.calls.restore,0);assert.equal(h.calls.fetch,0);}

test('the real legacy Premium entry sends native feature gates through the existing Apple membership router',()=>{
 const h=fixture();h.open();assert.equal(h.calls.membership,1);assert.equal(h.calls.nativeMembership,0);assert.equal(h.calls.dialogs,0);assert.deepEqual(h.navigation,[]);noBilling(h);
});

test('the early native membership navigation hook retains its refusal guards without opening a legacy dialog',()=>{
 const h=fixture({membership:false});h.open();assert.equal(h.calls.nativeMembership,1);assert.equal(h.calls.dialogs,0);assert.deepEqual(h.navigation,[],'a guarded native hook returning false must not be bypassed');noBilling(h);
});

test('native loading fallback navigates only to the bundled Apple membership screen',()=>{
 const h=fixture({membership:false,nativeMembership:false});h.open();assert.deepEqual(h.navigation,['capacitor://localhost/pricing-sandbox.html']);assert.equal(h.calls.dialogs,0);noBilling(h);
});

test('web Premium keeps the existing modal IDs, close handler, focus and checkout-free entry',()=>{
 const h=fixture({native:false});h.open();
 const dialog=h.nodes.get('#bb173TierDialog');assert.equal(dialog.open,true);assert.equal(dialog.querySelector('[data-bb173-close]').focused,true);assert.equal(dialog.handlers.get('click').length,2);assert.equal(dialog.handlers.get('cancel').length,1);
 assert.equal(h.calls.membership,0);assert.equal(h.calls.nativeMembership,0);assert.equal(h.calls.dialogs,1);assert.deepEqual(h.navigation,[]);noBilling(h);
 h.open();assert.equal(h.calls.dialogs,1,'reopening reuses the original modal');assert.equal(h.nodes.get('#bb173TierDesc').textContent,'Includes 500 recipes, Smart Auto-Fill, 1-Tap Batch Cooking, 5 AI photo scans & 10 AI meal ideas per day.');
});

function installLegacyFeatureWrapper(h){
 const start=app.indexOf('function bb176OpenPremiumUpgrade(){'),end=app.indexOf('\n/*',start);assert.ok(start>=0&&end>start);
 vm.runInContext(app.slice(start,end),h.context);
}

test('the existing At home camera upgrade host reaches the corrected central entry without scans or billing',()=>{
 const h=fixture();installLegacyFeatureWrapper(h);h.context.bbVerifiedPremiumFeature=()=>false;h.context.tab='shop';
 const host=app.match(/window\.BBPantryCameraHost=Object\.freeze\([^\n]+/);assert.ok(host);vm.runInContext(host[0],h.context);
 assert.equal(h.win.BBPantryCameraHost.isPremium(),false);h.win.BBPantryCameraHost.upgrade();assert.equal(h.calls.membership,1);assert.equal(h.calls.dialogs,0);noBilling(h);
});

test('locked recipe Cook uses the same corrected route and does not start cooking or payment',()=>{
 const h=fixture();installLegacyFeatureWrapper(h);h.context.getRecipe=id=>({id,name:'Locked recipe'});h.context.bb176AllowedRecipe=()=>false;
 const start=app.indexOf('function openCook(id,day,kind){'),end=app.indexOf('\nfunction ',start+1);assert.ok(start>=0&&end>start);
 vm.runInContext(app.slice(start,end),h.context);h.context.openCook('locked-recipe','Monday','dinner');
 assert.equal(h.calls.membership,1);assert.equal(h.calls.dialogs,0);assert.deepEqual(h.navigation,[]);noBilling(h);
});
