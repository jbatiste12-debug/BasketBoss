import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('bb-onboarding-v2.js','utf8');
const css=fs.readFileSync('bb-onboarding-v2.css','utf8');
const intent=fs.readFileSync('bb-partner-signup-prompt.js','utf8');
const KEY='bb_onboarding_fresh_once_20261028_v1';
function harness(saved){
 const storage=new Map(saved?[[KEY,JSON.stringify(saved)]]:[]);
 const events={};const body={style:{overflow:''},appendChild(node){this.node=node}};
 const document={readyState:'complete',body,querySelector:()=>null,getElementById:()=>null,
  createElement:()=>({innerHTML:'',setAttribute(){},addEventListener(type,fn){this.events??={};this.events[type]=fn},querySelector(){return null},remove(){this.removed=true}}),
  addEventListener(type,fn){events[type]=fn}};
 const sandbox={window:{matchMedia:()=>({matches:false}),addEventListener(type,fn){events[type]=fn}},document,
  localStorage:{getItem:k=>storage.get(k)??null,setItem(k,v){storage.set(k,v)},removeItem:k=>storage.delete(k)},
  sessionStorage:{setItem(){}},navigator:{standalone:false},location:{hostname:'basketboss-partner-qa.pages.dev',search:''},URLSearchParams,queueMicrotask,console};
 vm.runInNewContext(source,sandbox,{timeout:500});
 const read=()=>JSON.parse(storage.get(KEY));
 const tap=act=>{const click=body.node?.events?.click;assert.ok(click);click({target:{closest(sel){return sel==='[data-bbob]'?{dataset:{bbob:act}}:null}}})};
 return {body,read,tap};
}
test('new unsigned users see partner card even when they skip account',()=>{
 const a=harness();assert.match(a.body.node.innerHTML,/Welcome to BasketBoss/);
 a.tap('next');assert.match(a.body.node.innerHTML,/One account/);
 a.tap('next');assert.match(a.body.node.innerHTML,/Would you like to share with a partner\?/);
 for(const k of ['Invite one partner (Premium)','Join an invitation','Not now'])assert.ok(a.body.node.innerHTML.includes(k),k);
 assert.equal(a.read().step,2);
});
test('Invite one partner is local preference only, not entitlement or email send',()=>{
 const a=harness();a.tap('next');a.tap('next');a.tap('partner-invite');
 assert.equal(a.read().wantsPartnerInvite,true);
 assert.match(a.body.node.innerHTML,/No email has been sent yet/);
 a.tap('next');assert.equal(a.read().step,3);assert.match(a.body.node.innerHTML,/How many people/);
});
test('Join invitation goes straight back to sign-in, without solo meal setup',()=>{
 const a=harness();a.tap('next');a.tap('next');a.tap('partner-join');
 assert.equal(a.read().step,1);assert.equal(a.read().partnerIntent,'join');
 assert.match(a.body.node.innerHTML,/Sign in to join your partner/);
 assert.doesNotMatch(a.body.node.innerHTML,/How many people are you usually cooking for/);
});
test('Not now immediately advances to household, no sign-in requirement',()=>{
 const a=harness();a.tap('next');a.tap('next');a.tap('partner-later');
 assert.equal(a.read().step,3);assert.equal(a.read().wantsPartnerInvite,false);
 assert.match(a.body.node.innerHTML,/How many people/);
});
test('resuming old incomplete onboarding preserves the matching original step',()=>{
 const a=harness({step:2,house:'2 people',goals:[],diets:[],region:'UK',started:true,complete:false});
 assert.equal(a.read().step,3);assert.match(a.body.node.innerHTML,/How many people/);
 assert.equal(a.read().house,'2 people');
});
test('already completed users are not re-onboarded or reset',()=>{
 const a=harness({step:9,house:'2 people',goals:[],diets:[],region:'UK',started:false,complete:true});
 assert.equal(a.body.node,undefined);assert.equal(a.read().complete,true);
});
test('post-sign-in link prompt still uses verified server data, never client tier',()=>{
 assert.match(intent,/\/api\/household\?mode=status/);assert.match(intent,/data\.invite/);
 assert.match(intent,/data\.premium/);assert.match(intent,/wantsPartnerInvite/);
 assert.doesNotMatch(intent,/\b(?:service_role|SUPABASE_SECRET_KEY)\b/);
 assert.match(css,/bbob-partner-choice/);
});
