import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const swift=fs.readFileSync('ios/App/App/AppDelegate.swift','utf8');
const script=swift.slice(swift.indexOf('private enum BasketBossAccountKeyboardSetup')).match(/#"""\n([\s\S]*?)\n\s*"""#/)[1];
function harness(){
 let callback,probe;
 const viewport={height:932,width:402,offsetTop:0,offsetLeft:0,pageTop:0,pageLeft:0,scale:1};
 const rect={top:0,left:0,bottom:932,right:402,height:932,width:402};
 const host={contains:()=>true,getClientRects:()=>[rect],getBoundingClientRect:()=>rect,appendChild:n=>{probe=n;}};
 const shell={closest:()=>({})};
 const document={readyState:'complete',body:{scrollTop:0},documentElement:{scrollTop:0},querySelector:()=>shell,getElementById:id=>id==='bbAccountKeyboardProbe'?probe:id==='bbNewOnboarding'?host:id==='cloud-auth'?{}:null,createElement:()=>({style:{}})};
 const win={bbKeyboardSmokeOnboarding:true,visualViewport:viewport,scrollY:0,scrollX:0};
 vm.runInNewContext(script,{window:win,document,localStorage:{setItem(){}},sessionStorage:{setItem(){}},setInterval:fn=>{callback=fn;},clearInterval(){},getComputedStyle:n=>({position:'fixed',visibility:'hidden',top:'0px',height:'932px'}),innerHeight:932,innerWidth:402});
 const sample=()=>{callback();return probe.textContent;};sample();
 return {win,viewport,rect,sample};
}
test('WKWebView keyboard pan uses document coordinates without counting it as page scroll',()=>{
 const h=harness();Object.assign(h.viewport,{height:417,offsetTop:152.7,pageTop:152.7});h.win.scrollY=153;Object.assign(h.rect,{top:-.3,bottom:416.7,height:417});
 assert.match(h.sample(),/viewportCovered=true rootLocked=true/);
});
test('Chromium visual-only offset also covers the same document viewport',()=>{
 const h=harness();Object.assign(h.viewport,{height:300,offsetTop:180,pageTop:180});Object.assign(h.rect,{top:180,bottom:480,height:300});assert.match(h.sample(),/viewportCovered=true rootLocked=true/);
});
test('the probe still rejects real page movement and an overlay that misses the visible viewport',()=>{
 const h=harness();h.win.scrollY=60;h.viewport.pageTop=60;assert.match(h.sample(),/rootLocked=false/);
 h.rect.top=70;h.rect.bottom=1002;assert.match(h.sample(),/viewportCovered=false/);
});
