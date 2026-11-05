import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {install,editable,outsideDialog,dismissBackdrop}=createRequire(import.meta.url)('../bb-keyboard-layout.js');
function fixture({height=932,width=430,touch=true,viewport=true}={}){
 const handlers=new Map(),classes=new Set(),frames=[];
 const events=prefix=>({addEventListener(name,fn){handlers.set(prefix+name,fn);}});
 const doc={...events('doc:'),activeElement:null,documentElement:{classList:{toggle(name,on){on?classes.add(name):classes.delete(name);}}}};
 const win={...events('win:'),document:doc,innerHeight:height,innerWidth:width,navigator:{maxTouchPoints:touch?5:0},matchMedia:()=>({matches:touch}),requestAnimationFrame(fn){frames.push(fn);return frames.length;}};
 if(viewport)win.visualViewport={...events('view:'),height,width,scale:1};
 const api=install(win);
 const flush=()=>{while(frames.length)frames.shift()();};
 const fire=name=>{handlers.get(name)?.();flush();};
 return {win,doc,api,visible:()=>!classes.has('bb-keyboard-open'),focus(node={tagName:'TEXTAREA'}){doc.activeElement=node;fire('doc:focusin');},blur(){doc.activeElement=null;fire('doc:focusout');},resize(values){Object.assign(win.visualViewport||win,values);fire(viewport?'view:resize':'win:resize');},fire};
}
test('typing in a lunchbox textarea hides the dock only after a real viewport reduction and restores on Done',()=>{
 const h=fixture();h.focus();assert.equal(h.visible(),true);
 h.resize({height:520});assert.equal(h.visible(),false);
 h.fire('view:scroll');assert.equal(h.visible(),false,'manual page/viewport scroll cannot float the dock back in');
 h.blur();assert.equal(h.visible(),false,'blur before the closing animation does not restore the dock');
 h.resize({height:800});assert.equal(h.visible(),false,'the dock stays hidden through the closing animation');
 h.resize({height:932});assert.equal(h.visible(),true);
});
test('field changes, button taps and focus remaining after Done do not flicker the dock',()=>{
 const h=fixture();h.focus({tagName:'INPUT',type:'email'});h.resize({height:500});
 h.blur();h.focus({tagName:'INPUT',type:'password'});assert.equal(h.visible(),false);
 h.focus({tagName:'BUTTON'});assert.equal(h.visible(),false);
 h.focus({tagName:'INPUT',type:'number'});h.resize({height:932});assert.equal(h.visible(),true,'Done can close the keyboard without removing DOM focus');
 h.resize({height:500});assert.equal(h.visible(),false,'the same still-focused input can reopen its keyboard');
});
test('address bar movement, landscape changes, touchless desktop resize and pinch zoom do not hide navigation',()=>{
 const h=fixture();h.focus();h.resize({height:850});assert.equal(h.visible(),true);
 h.blur();h.resize({width:932,height:430});h.focus();assert.equal(h.visible(),true,'a new orientation establishes its own normal height');
 h.resize({height:400});assert.equal(h.visible(),true);
 const zoom=fixture();zoom.focus();zoom.resize({height:466,width:215,scale:2});assert.equal(zoom.visible(),true);
 const desktop=fixture({touch:false});desktop.focus();desktop.resize({height:400});assert.equal(desktop.visible(),true);
});
test('a keyboard rotated while open remains hidden until the landscape viewport grows again',()=>{
 const h=fixture();h.focus();h.resize({height:520});assert.equal(h.visible(),false);
 h.resize({height:210,width:932});assert.equal(h.visible(),false);
 h.blur();assert.equal(h.visible(),false);h.resize({height:430});assert.equal(h.visible(),true);
});
test('native resizing and browsers without visualViewport can still detect keyboard height',()=>{
 for(const viewport of [true,false]){
  const h=fixture({viewport});h.focus({tagName:'INPUT',type:'number'});
  h.win.innerHeight=500;h.resize({height:500});assert.equal(h.visible(),false);
  h.win.innerHeight=932;h.resize({height:932});assert.equal(h.visible(),true);
 }
});
test('only editable controls can start keyboard mode; readonly and non-text controls cannot',()=>{
 for(const node of[{tagName:'INPUT',type:'checkbox'},{tagName:'INPUT',type:'file'},{tagName:'INPUT',type:'text',readOnly:true},{tagName:'TEXTAREA',disabled:true},{tagName:'BUTTON'}])assert.equal(editable(node),false);
 for(const node of[{tagName:'TEXTAREA'},{tagName:'SELECT'},{tagName:'INPUT',type:'email'},{tagName:'INPUT',type:'password'},{tagName:'INPUT',type:'number'},{isContentEditable:true}])assert.equal(editable(node),true);
 const h=fixture();h.focus({tagName:'BUTTON'});h.resize({height:500});assert.equal(h.visible(),true);
});
test('closing a modal releases a stale iOS keyboard baseline without requiring the old viewport height',()=>{
 const h=fixture({height:820,width:375});h.focus({tagName:'INPUT',type:'email'});h.win.innerHeight=656;h.resize({height:417});assert.equal(h.visible(),false);
 h.blur();h.resize({height:656});assert.equal(h.visible(),false,'ordinary blur retains the closing-animation lock');
 assert.equal(h.api.releaseAfterDismissal(),true);assert.equal(h.visible(),true);
 h.fire('view:scroll');assert.equal(h.visible(),true,'a shorter recovered WKWebView viewport cannot hide the dock again');
 h.focus({tagName:'INPUT',type:'number'});h.resize({height:350});assert.equal(h.visible(),false,'a later keyboard still has its own normal lifecycle');
 assert.equal(h.api.releaseAfterDismissal(),false);assert.equal(h.visible(),false,'another surface’s focused field retains keyboard protection');
});
test('native dialog backdrop dismissal respects content bounds, busy guards and owner cancellation',()=>{
 let closed=0,requests=0,cancelled=false;
 const dialog={tagName:'DIALOG',open:true,getBoundingClientRect:()=>({left:12,right:363,top:100,bottom:700}),getAttribute:()=>null,dispatchEvent(event){requests++;assert.equal(event.type,'cancel');return !cancelled;},close(){closed++;}};
 const event=(x,y,target=dialog)=>({target,clientX:x,clientY:y,preventDefault(){this.defaultPrevented=true;}});
 assert.equal(outsideDialog(event(20,120)),false);assert.equal(outsideDialog(event(0,120)),true);assert.equal(outsideDialog(event(0,120,{tagName:'INPUT'})),false);
 assert.equal(dismissBackdrop({Event},event(20,120)),false);assert.equal(closed,0);
 assert.equal(dismissBackdrop({Event},event(0,120)),true);assert.equal(requests,1);assert.equal(closed,1);
 cancelled=true;dismissBackdrop({Event},event(0,120));assert.equal(requests,2);assert.equal(closed,1,'a guarded owner can prevent dismissal');
 dialog.getAttribute=()=> 'true';assert.equal(dismissBackdrop({Event},event(0,120)),false);assert.equal(requests,2,'busy overlays never dispatch a second cancellation');
 dialog.getAttribute=()=>null;dialog.requestClose=()=>requests++;dismissBackdrop({Event},event(374,120));assert.equal(requests,3,'modern browsers use their native requestClose lifecycle');
});
