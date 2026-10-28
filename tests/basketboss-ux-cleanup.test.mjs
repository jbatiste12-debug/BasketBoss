import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const index=fs.readFileSync('index.html','utf8');
const meal=fs.readFileSync('make-a-meal.html','utf8');
const compare=fs.readFileSync('compare.html','utf8');
const css=fs.readFileSync('bb-ux-cleanup.css','utf8');
const js=fs.readFileSync('bb-ux-cleanup.js','utf8');

test('founder story moved off main app, preserved intact on comparison page',()=>{
  assert.doesNotMatch(index,/<section id="bb2026Trust"/);
  assert.match(compare,/Made by a dad of four/i);
  assert.match(index,/<a href="compare.html">Why BasketBoss\?<\/a>/);
});
test('unconnected OAuth marketing and preview copy removed, original email form unchanged',()=>{
  assert.doesNotMatch(index,/Apple · not connected|Google · not connected|Unavailable in this development preview/);
  for(const required of ['id="cloud-email"','id="cloud-password"','id="cloud-login"','id="cloud-signup"',"'/auth/v1/signup'", "'/auth/v1/token?grant_type=password'"]){
    assert.ok(index.includes(required),`Missing untouched Supabase account element ${required}`);
  }
});
test('Make a Meal visible wording uses production labels with original pricing destinations',()=>{
  assert.match(meal,/>⭐ Premium plans<\/a>/);
  assert.doesNotMatch(meal,/Premium plans \(test\)|Explore test plans/);
  assert.match(meal,/Explore plans →/);
  assert.match(meal,/href="pricing-sandbox.html#founder"/);
  assert.match(meal,/id="ai-photo-input"/);
});
test('install prompts hidden only in approved banners; original native and Samsung safeguards remain intact',()=>{
  assert.match(css,/\[data-bb173-install-banner\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(index,/data-bb173-install-banner/);
  assert.match(meal,/data-bb173-install-banner/);
  assert.match(js,/\[data-bb173-install-banner\] \[data-bb173-install-open\]/);
  assert.ok(fs.readFileSync('bb-install.js','utf8').includes('Play Protect'));
});
test('one visible replay option remains in Settings; binding ID is preserved',()=>{
  assert.match(index,/id="bb82StartLiveTour"[^>]*>↻ Replay tutorial<\/button>/);
  assert.doesNotMatch(index,/Read the complete BasketBoss guide ↗|Original illustrated tutorial ↗/);
  assert.match(css,/#bb173WelcomeReplay.*#bbBetaWelcomeReplay.*#bb172ViewWelcome/s);
});
test('region editor ID and change event code preserved, pricing disclaimer accessible',()=>{
  assert.match(index,/id="bb307Island"/);
  assert.match(index,/id="bb307SaveMarket"/);
  assert.match(index,/bb17513-region-summary/);
  assert.match(index,/How prices are estimated and allergen guidance/);
  assert.match(index,/window\.bb307SwitchIsland\(select\.value\)/);
});
test('only one footer Privacy link; all terms and support links retained',()=>{
  assert.doesNotMatch(index,/<nav class="bb172-privacy-footer"/);
  assert.match(index,/<nav aria-label="Legal information and support">[^\n]*<a href="privacy.html">Privacy<\/a>/);
  assert.match(index,/<a href="terms.html">Terms<\/a>/);
  assert.match(index,/<a href="subscriptions.html">Subscriptions &amp; refunds<\/a>/);
});
function harness({authenticated=false,meals='0/7',spend='£0.00',pantry='0'}={}){
  let installClicks=0;
  const stats={hidden:false};
  const nodes={statMeals:{textContent:meals},statSpend:{textContent:spend},statPantry:{textContent:pantry}};
  const original={click(){installClicks++;}};
  const section={appendChild(node){nodes[node.id]=node;}};
  const listeners={};
  const doc={readyState:'complete',body:{},getElementById(id){return nodes[id]??(id==='bbuiLinksSection'?section:null);},
    createElement(){return {addEventListener(kind,fn){this[kind]=fn;}};},
    querySelector(sel){if(sel==='.shell > .stats')return stats;
      if(sel==='[data-bb173-install-banner] [data-bb173-install-open]')return original;
      return null;}};
  const session=authenticated?JSON.stringify({user:{id:'x'},access_token:'x',expires_at:Math.floor(Date.now()/1000)+1800}):'null';
  const env={document:doc,localStorage:{getItem(){return session;}},window:{addEventListener(n,fn){listeners[n]=fn;},alert(){}},Date,JSON,Number,String};
  vm.runInNewContext(js,env);
  return {stats,nodes,listeners,install(){nodes.bbuxInstallFromSettings.click();return installClicks;}};
}
test('stats are hidden for guests and empty signed-in accounts, but visible with meaningful signed-in data',()=>{
  assert.equal(harness({authenticated:false,meals:'4/7'}).stats.hidden,true);
  assert.equal(harness({authenticated:true}).stats.hidden,true);
  assert.equal(harness({authenticated:true,meals:'1/7'}).stats.hidden,false);
  assert.equal(harness({authenticated:true,spend:'£12.49'}).stats.hidden,false);
  assert.equal(harness({authenticated:true,pantry:'3'}).stats.hidden,false);
});
test('Settings install button delegates to the original install trigger',()=>{
  const h=harness();assert.equal(h.install(),1);
});
