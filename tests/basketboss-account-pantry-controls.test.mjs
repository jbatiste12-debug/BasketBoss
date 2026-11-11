import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../bb-account-polish.js',import.meta.url),'utf8');
function fixture({status='pending',sync}={}){
 const nodes=new Map(),storage=new Map([['basketboss_cloud_session_v1','actor-one']]),calls=[];
 class Node{
  constructor(tag='DIV'){this.tagName=tag;this.children=[];this.dataset={};this.events=new Map();this.attrs={};this.textContent='';this.hidden=false;this.classList={contains:()=>false};}
  set id(value){this._id=value;nodes.set(value,this);}get id(){return this._id;}
  setAttribute(name,value){this.attrs[name]=value;}
  addEventListener(name,fn){this.events.set(name,fn);}
  append(...children){for(const child of children){child.parentNode=this;this.children.push(child);}}
  insertBefore(child,before){child.parentNode=this;this.children.splice(this.children.indexOf(before),0,child);}
  querySelector(selector){return selector==='h2'?nodes.get('heading'):null;}
  remove(){nodes.delete(this.id);}
  async click(){return this.events.get('click')?.({stopPropagation(){}});}
 }
 const make=(id,tag)=>{const n=new Node(tag);n.id=id;return n;};
 const panel=make('cloud-panel'),card=make('cloud-card'),signed=make('cloud-signed'),logout=make('cloud-logout','BUTTON');card.dataset.bbAccountPolish='account';signed.append(logout);make('heading','H2');make('bbapAccountIntro');make('cloud-close','BUTTON');
 const value={enabled:true,status,canSync:true,requiresReview:status==='conflict',queued:true,message:'Your At home amounts are kept.'};
 let schedules=0;
 const root={document:{readyState:'loading',body:new Node(),getElementById:id=>nodes.get(id)||null,querySelector:()=>null,createElement:tag=>new Node(tag),addEventListener(){}},localStorage:{getItem:key=>storage.get(key)||null},requestAnimationFrame(){},BBReceiptHost:{getAccountPantryStatus:()=>({...value}),async syncAccountPantry(options){calls.push(options);return sync?sync(options):{ok:true};}},BasketBossCloud:{scheduleSave(){schedules++;}}};
 vm.runInNewContext(source,{window:root,Object,Number,Math,JSON});root.BBAccountPolish.refresh();
 return{root,nodes,storage,calls,value,refresh:()=>root.BBAccountPolish.refresh(),button:nodes.get('bbAccountPantrySyncButton'),schedules:()=>schedules};
}

test('account has one current-pantry sync action and no per-food source picker',()=>{
 const h=fixture();assert.equal(h.button.textContent,'Sync At home pantry');assert.equal(h.nodes.get('bbAccountPantrySync').children.filter(n=>n.tagName==='input').length,0);
 assert.match(h.nodes.get('bbAccountPantrySync').children[1].textContent,/Foods you remove stay removed/);
 assert.ok(![...h.nodes.values()].some(n=>/Confirm Your Pantry|Use saved online|Use this device/.test(n.textContent)));
});
test('ordinary account sync preserves the guarded non-conflict path',async()=>{
 const h=fixture();await h.button.click();assert.equal(h.calls.length,1);assert.equal(h.calls[0].resolveConflict,false);assert.equal(h.schedules(),1);
});
test('only an explicit account action requests replacement with current At home on conflict',async()=>{
 const h=fixture({status:'conflict'});assert.equal(h.calls.length,0);await h.button.click();assert.equal(h.calls.length,1);assert.equal(h.calls[0].resolveConflict,true);
});
test('rapid repeated account taps run one sync and release the button after settlement',async()=>{
 let finish;const h=fixture({sync:()=>new Promise(resolve=>finish=resolve)}),first=h.button.click();await h.button.click();assert.equal(h.calls.length,1);assert.equal(h.button.disabled,true);finish({ok:true});await first;assert.equal(h.button.disabled,false);
});
test('failed sync retains At home and an account switch ignores an earlier account result',async()=>{
 const h=fixture({sync:async()=>({ok:false,needsReview:true})});await h.button.click();assert.match(h.nodes.get('bbAccountPantrySyncStatus').textContent,/At home pantry has been kept/);assert.equal(h.schedules(),0);
 let finish;const switched=fixture({sync:()=>new Promise(resolve=>finish=resolve)}),pending=switched.button.click();switched.storage.set('basketboss_cloud_session_v1','actor-two');finish({ok:true});await pending;assert.equal(switched.schedules(),0);assert.equal(switched.button.disabled,false);
});
