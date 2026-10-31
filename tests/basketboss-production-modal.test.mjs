import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const read=p=>fs.readFile(new URL('../'+p,import.meta.url),'utf8');
test('production modal is customer-facing, scroll safe, and checkout gated',async()=>{
  const [modal,css,terms,pricing,checkout,index]=await Promise.all([
    read('bb-premium-features.js'),read('bb-premium-features.css'),read('bb174-trial-ux.js'),
    read('pricing-sandbox.html'),read('paddle-sandbox.js'),read('index.html')]);
  for(const s of ['More magic, less waste.','Includes 500 recipes, Smart Auto-Fill, 1-Tap Batch Cooking',
    '7-day free trial · First 25 confirmed members only','3-day free trial · Cancel anytime',
    'Cancel anytime before your trial ends']) assert.ok(modal.includes(s),s);
  for(const s of ['SANDBOX PREVIEW','Preview only:','must be verified before launch',
    'once configured']) assert.ok(!modal.includes(s),s);
  assert.match(css,/#bb173TierDialog\[open\].*display:flex/);
  assert.match(css,/#bb173TierDialog \.bb173-tier-body.*overflow-y:auto/);
  assert.ok(modal.includes("config.mode==='live'"));
  assert.ok(pricing.includes('Cancellations &amp; refunds'));
  assert.ok(pricing.includes('privacy.html'));
  assert.ok(pricing.includes('terms.html'));
  assert.ok(terms.includes('first 25 confirmed eligible members'));
  assert.ok(index.includes('bb-myweek-etched-watermark-20261027'));
  assert.ok(index.includes("bind('bbFeaturedAddWeek',()=>{if(r)bb80PromptAddRecipe(r.id);});"));
});


// Exercise the shipped browser module with local DOM/network doubles. In particular,
// the live-host rule is a behavior, not a dependency on a local variable's spelling.
const checkoutSource=await read('paddle-sandbox.js');
const settle=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};
function element(tag='div'){
  const node={tagName:tag.toUpperCase(),className:'',dataset:{},children:[],textContent:'',disabled:false,
    setAttribute(){},scrollIntoView(){},
    append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}},
    replaceChildren(...children){this.children=[];this.append(...children);},
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(x=>x!==this);},
    querySelector(selector){
      const [wantedTag,wantedClass]=selector.split('.');
      const matches=child=>(!wantedTag||child.tagName===wantedTag.toUpperCase())&&(!wantedClass||child.className.split(' ').includes(wantedClass));
      for(const child of this.children){if(matches(child))return child;const nested=child.querySelector?.(selector);if(nested)return nested;}
      return null;
    }
  };
  return node;
}
async function checkoutPage({hostname='basketboss.co.uk',signedIn=true,
    config={enabled:true,mode:'live'},transaction={mode:'live',transactionId:'txn_'+'a'.repeat(26)},
    afterTransaction}={}){
  let token=signedIn?'test-session-token':null;
  const calls=[],initialized=[],opened=[],environments=[],listeners=new Map();
  const buttons=['founder','monthly'].map(plan=>{
    const button=element('button');button.dataset.plan=plan;
    const parent=element();parent.append(button);
    button.addEventListener=(name,fn)=>listeners.set(plan+':'+name,fn);
    button.insertAdjacentElement=(_where,target)=>parent.append(target);
    return button;
  });
  const message=element(),ribbon=element(),pending=element();
  const document={
    querySelectorAll:selector=>selector==='button[data-plan]'?buttons:[],
    getElementById:id=>id==='checkoutMessage'?message:null,
    querySelector:selector=>selector==='.test-ribbon'?ribbon:selector==='.test-info'?pending:null,
    createElement:tag=>element(tag),createTextNode:text=>({...element('#text'),textContent:text})
  };
  const env={document,location:{hostname,href:'https://'+hostname+'/pricing-sandbox.html'},URL,Date,
    console:{warn(){},error(){}},
    localStorage:{getItem:()=>token?JSON.stringify({access_token:token,expires_at:Math.floor(Date.now()/1000)+3600}):null},
    fetch:async(url,options)=>{
      calls.push({url,options});
      if(url.endsWith('/checkout-config'))return {ok:true,status:200,json:async()=>config};
      if(url.endsWith('/checkout')){
        if(afterTransaction)token=afterTransaction;
        return {ok:true,status:200,json:async()=>transaction};
      }
      throw Error('Unexpected request '+url);
    },
    Paddle:{Initialize:options=>initialized.push(options),Environment:{set:mode=>environments.push(mode)},Checkout:{open:value=>opened.push(value)}}
  };
  env.window=env;
  vm.runInNewContext(checkoutSource,env,{filename:'paddle-sandbox.js'});
  await settle();
  return {calls,initialized,opened,environments,message,buttons,
    feedback:plan=>buttons.find(x=>x.dataset.plan===plan).parentElement.querySelector('.bb-checkout-feedback'),
    async click(plan='monthly'){listeners.get(plan+':click')();await settle();}
  };
}

test('production checkout rejects disabled, unknown or sandbox server configuration before Paddle opens',async()=>{
  for(const hostname of ['basketboss.co.uk','www.basketboss.co.uk']){
    for(const config of [{enabled:false,mode:'live'},{enabled:true,mode:'unexpected'},{enabled:true,mode:'sandbox'}]){
      const page=await checkoutPage({hostname,config});await page.click();
      assert.equal(page.initialized.length,0);
      assert.equal(page.opened.length,0);
      assert.equal(page.calls.filter(x=>x.options?.method==='POST').length,0);
      assert.match(page.message.textContent,/not enabled|not active/);
    }
  }
});

test('anonymous checkout never creates a transaction or a fallback payment link',async()=>{
  const page=await checkoutPage({signedIn:false});await page.click();
  assert.equal(page.calls.filter(x=>x.options?.method==='POST').length,0);
  assert.equal(page.opened.length,0);
  assert.match(page.message.textContent,/sign in/i);
  assert.equal(page.feedback('monthly').querySelector('a.bb-checkout-fallback'),null);
});

test('signed-in checkout sends the bearer to the server and opens only its validated transaction',async()=>{
  const page=await checkoutPage();await page.click();
  const post=page.calls.find(x=>x.options?.method==='POST');
  assert.equal(post.url,'/api/subscription/checkout');
  assert.equal(post.options.headers.Authorization,'Bearer test-session-token');
  assert.deepEqual(JSON.parse(post.options.body),{plan:'standard'});
  assert.equal(post.options.credentials,'same-origin');assert.equal(post.options.redirect,'manual');
  assert.equal(page.initialized.length,1);
  assert.equal(page.opened.length,1);
  assert.equal(page.opened[0].transactionId,'txn_'+'a'.repeat(26));
  const link=page.feedback('monthly').querySelector('a.bb-checkout-fallback');
  assert.equal(new URL(link.href).searchParams.get('_ptxn'),page.opened[0].transactionId);
});

test('wrong-mode or malformed server transactions and account changes never open Paddle',async()=>{
  for(const options of [
    {transaction:{mode:'sandbox',transactionId:'txn_'+'a'.repeat(26)}},
    {transaction:{mode:'live',transactionId:'not-a-transaction'}},
    {afterTransaction:'different-account-token'}
  ]){
    const page=await checkoutPage(options);await page.click();
    assert.equal(page.opened.length,0);
    assert.equal(page.feedback('monthly').querySelector('a.bb-checkout-fallback'),null);
    assert.equal(page.buttons.find(x=>x.dataset.plan==='monthly').disabled,false);
  }
});
