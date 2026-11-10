import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../bb-membership-settings.js',import.meta.url),'utf8');
const tick=()=>new Promise(setImmediate);
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.textContent='';this.hidden=false;this.disabled=false;this.isConnected=true;}
 append(...nodes){this.children.push(...nodes);} setAttribute(key,value){this[key]=value;}
 addEventListener(name,fn){this.listeners[name]=fn;}
}
function fixture(){
 const parent=new Element('section');parent.id='bbuiLinksSection';
 const find=(el,id)=>el.id===id?el:el.children.map(x=>find(x,id)).find(Boolean);
 const events={},requests=[],destinations=[];let bearer='first';
 const document={readyState:'complete',hidden:false,body:parent,getElementById:id=>find(parent,id),createElement:tag=>new Element(tag),addEventListener(){}};
 const window={addEventListener:(type,fn)=>events[type]=fn,location:{assign:href=>destinations.push(href)}};
 const fetch=()=>new Promise((resolve,reject)=>requests.push({resolve,reject}));
 vm.runInNewContext(source,{document,window,URL,localStorage:{getItem:()=>JSON.stringify({access_token:bearer,expires_at:9999999999})},fetch});
 const reply=(i,raw,status=200)=>requests[i].resolve({ok:status===200,status,json:async()=>raw});
 return {requests,reply,events,destinations,get:id=>find(parent,id),change:token=>{bearer=token;events['basketboss:session-changed']();}};
}
const active={authenticated:true,premiumAccess:true,provider:'apple',subscription:{provider:'apple',plan:'annual',status:'active',environment:'Production'}};
test('an older same-account Free response cannot replace a newer verified Apple membership',async()=>{
 const h=fixture();h.events.focus();assert.equal(h.requests.length,2);
 h.reply(1,active);await tick();assert.match(h.get('bbMembershipState').textContent,/Annual.*Active/);
 h.reply(0,{authenticated:true,premiumAccess:false,subscription:null});await tick();
 assert.match(h.get('bbMembershipState').textContent,/Annual.*Active/);assert.equal(h.get('bbMembershipManage').disabled,false);assert.equal(h.get('bbMembershipUpgrade').hidden,true);
});
for(const failure of ['http','network','json'])test('an old account '+failure+' failure cannot overwrite the new account membership',async()=>{
 const h=fixture();h.change('second');h.reply(1,active);await tick();
 if(failure==='network')h.requests[0].reject(Error('offline'));
 else if(failure==='json')h.requests[0].resolve({ok:true,json:async()=>{throw Error('invalid JSON');}});
 else h.reply(0,null,401);
 await tick();assert.match(h.get('bbMembershipState').textContent,/Annual.*Active/);assert.equal(h.get('bbMembershipManage').disabled,false);
});
test('a membership response after the Settings card is removed has no UI or navigation effect',async()=>{
 const h=fixture();h.get('bbMembershipSettings').isConnected=false;h.reply(0,active);await tick();
 assert.equal(h.get('bbMembershipManage').disabled,true);assert.deepEqual(h.destinations,[]);
});
