import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const read=p=>fs.readFile(new URL('../'+p,import.meta.url),'utf8');
const [html,privacy,script,css,handler,worker]=await Promise.all([
  'index.html','privacy.html','bb-funnel.js','bb-funnel.css','functions/api/funnel/[event].js','service-worker.js'
].map(read));

test('Only marketing assets added, existing checkout/auth/camera source still present',()=>{
  assert.match(html,/<script defer src="bb-funnel\.js\?v=20261028-v1"><\/script>/);
  assert.match(html,/<link rel="stylesheet" href="bb-funnel\.css\?v=20261028-v1">/);
  assert.match(html,/id="cloud-signup"/);
  assert.match(html,/id="cloud-open"/);
  assert.match(html,/id="bbColdVisitor"/);
  assert.match(html,/<meta property="og:image"/);
  assert.match(worker,/v13-free-signup-funnel/);
  assert.match(worker,/target\.pathname\.startsWith\(new URL\('api\/', APP_BASE\)\.pathname\)\) return/);
  assert.match(privacy,/Anonymous usage steps/);
});

test('No invasive data, account credentials or billing/quota calls in new tracking code',()=>{
  assert.doesNotMatch(script,/\b(?:BILLING_DB|GEMINI_API_KEY|service_role|access_token\s*:\s*|\/api\/paddle)\b/);
  assert.doesNotMatch(handler,/\.prepare\(|\bconsole\.log\(|read\(|\.json\(|get\('Cookie'\)/);
  assert.match(script,/credentials:'omit'/);
  assert.match(script,/referrerPolicy:'no-referrer'/);
  assert.match(script,/new Set\(\['landing'/);
  assert.match(script,/seenRecipes\.add\(key\)/);
  assert.match(script,/if\(prompted\|\|dismissed\|\|signedIn\(\)\|\|seenRecipes\.size<2\)return/);
  assert.match(script,/document\.getElementById\('cloud-open'\)\?\.click\(\)/);
  assert.match(css,/#bbFunnelNudge\[hidden\]/);
});

test('Anonymous endpoint allows only named POSTs and never returns visitor data',async()=>{
  const mod=await import('data:text/javascript;base64,'+Buffer.from(handler).toString('base64'));
  const yes=await mod.onRequestPost({params:{event:'signup_valid'}});
  assert.equal(yes.status,204);
  assert.equal(await yes.text(),'');
  assert.equal(yes.headers.get('Cache-Control'),'no-store');
  assert.equal((await mod.onRequestPost({params:{event:'secret_email'}})).status,404);
  const notGet=await mod.onRequestGet();
  assert.equal(notGet.status,405);
  assert.equal(notGet.headers.get('Allow'),'POST');
});

test('Visitor: one anonymous landing event, nudge only after two different free recipes; account button uses existing panel',()=>{
  const calls=[];
  const listeners={};
  const store=new Map();
  class El {
    constructor(id){this.id=id;this.hidden=false;this.children={};this.value='';this.textContent='';this.nodeName='BUTTON';}
    setAttribute(k,v){this[k]=v;}
    getAttribute(k){return k==='data-recipe'?this.recipe:null;}
    closest(selector){
      if(this.recipe&&selector==='[data-recipe]')return this;
      if(this.id==='cloud-signup'&&selector.includes('cloud-signup'))return this;
      if(this.id==='try-free'&&selector.includes('data-bbc-free'))return this;
      if(this.id==='cloud-open'&&selector.includes('cloud-open'))return this;
      return null;
    }
    querySelector(s){return this.children[s]||null;}
    addEventListener(n,fn){this[n]=fn;}
    click(){this.didClick=true;}
    checkValidity(){return true;}
  }
  const panel=new El('bbColdVisitor'),opener=new El('cloud-open'),email=new El('cloud-email'),password=new El('cloud-password');
  email.value='valid@example.com';password.value='correct-password';
  const nodes={'bbColdVisitor':panel,'cloud-open':opener,'cloud-email':email,'cloud-password':password,'cloud-message':new El('cloud-message')};
  const doc={readyState:'complete',body:{appendChild(el){nodes.bbFunnelNudge=el;}},getElementById(id){return nodes[id]||null;},createElement(){let b=new El('bbFunnelNudge');b.children['[data-bbf-signup]']=new El('nudge-account');b.children['[data-bbf-dismiss]']=new El('nudge-dismiss');return b;},addEventListener(n,fn){listeners[n]=fn;}};
  const win={addEventListener(n,fn){listeners[n]=fn;}};
  const context={document:doc,window:win,Element:El,MutationObserver:class{observe(){}},localStorage:{getItem(k){return store.get(k)||null;}},sessionStorage:{getItem(){return null;},setItem(){}},Date,fetch:(url,options)=>{calls.push({url,options});return Promise.resolve({ok:true});}};
  vm.runInNewContext(script,context,{filename:'bb-funnel.js'});
  assert.equal(calls.filter(c=>c.url.endsWith('/landing')).length,1);
  const emitClick=t=>listeners.click({target:t});
  const one=new El('recipe');one.recipe='123';emitClick(one);emitClick(one);
  assert.equal(nodes.bbFunnelNudge,undefined,'not shown after one unique recipe');
  const two=new El('recipe');two.recipe='456';emitClick(two);
  assert.equal(nodes.bbFunnelNudge.hidden,false);
  assert.equal(calls.filter(c=>c.url.endsWith('/nudge_shown')).length,1);
  const any=calls[0].options;
  assert.equal(any.credentials,'omit');assert.equal(any.body,undefined);assert.equal(any.method,'POST');
  nodes.bbFunnelNudge.children['[data-bbf-signup]'].click();
  assert.equal(opener.didClick,true,'uses pre-existing Supabase auth button');
  assert.equal(nodes.bbFunnelNudge.hidden,true);
  emitClick(new El('cloud-signup'));
  assert.equal(calls.filter(c=>c.url.endsWith('/signup_valid')).length,1);
  store.set('basketboss_cloud_session_v1',JSON.stringify({user:{id:'123'},access_token:'SECRET_NEVER_TRANSMIT',expires_at:Math.floor(Date.now()/1000)+7200}));
  listeners['basketboss:session-changed']();
  assert.equal(nodes.bbFunnelNudge.hidden,true,'signed-in visitor does not see promotion');
  assert.equal(calls.filter(c=>c.url.endsWith('/signed_in')).length,1);
  assert.ok(calls.every(x=>!JSON.stringify(x).includes('SECRET_NEVER_TRANSMIT')),'no token transmitted');
});
