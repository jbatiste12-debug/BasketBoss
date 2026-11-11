/* Leave the page and forms in charge of scrolling. Only the fixed app dock
 * steps out of the way while a touch device's keyboard occupies the viewport. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root?.document&&!root.BBKeyboardLayout)root.BBKeyboardLayout=api.install(root);
})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const textTypes=new Set(['text','search','email','password','tel','url','number','date','time','datetime-local','month','week']);
 function editable(node){
  if(!node||node.disabled||node.readOnly)return false;
  return node.tagName==='TEXTAREA'||node.tagName==='SELECT'||node.tagName==='INPUT'&&textTypes.has(String(node.type||'text').toLowerCase())||node.isContentEditable===true;
 }
 function outsideDialog(event){
  const node=event?.target;
  if(node?.tagName!=='DIALOG'||!node.open||typeof node.getBoundingClientRect!=='function'||!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY))return false;
  const box=node.getBoundingClientRect();
  return event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom;
 }
 function dismissBackdrop(win,event){
  if(event.defaultPrevented||!outsideDialog(event))return false;
  const dialog=event.target;
  // Owners keep control of in-flight purchases, scans and guarded stock writes.
  if(dialog.getAttribute?.('aria-busy')==='true')return false;
  event.preventDefault();
  if(typeof dialog.requestClose==='function')dialog.requestClose();
  else if(dialog.dispatchEvent(new win.Event('cancel',{cancelable:true})))dialog.close?.();
  return true;
 }
 function install(win){
  const doc=win.document,classes=doc.documentElement.classList;
  let restingHeight=0,lastWidth=0,opened=false,rotatingFrom=0,frame=null,backdropStart=null;
  function measure(){
   const viewport=win.visualViewport,scale=Number(viewport?.scale)||1;
   // Normalise pinch zoom so zooming a page cannot masquerade as a keyboard.
   return {height:Math.min(Number(viewport?.height)*scale||win.innerHeight,win.innerHeight),width:Number(viewport?.width)*scale||win.innerWidth};
  }
  function refresh(){
   frame=null;
   const {height,width}=measure();if(!(height>0&&width>0))return;
   const touch=win.BBNative?.isNative===true||win.matchMedia?.('(pointer: coarse)').matches===true||(win.navigator?.maxTouchPoints||0)>0;
   const editing=editable(doc.activeElement),turned=lastWidth>0&&Math.abs(width-lastWidth)>40;
   if(!restingHeight)restingHeight=height;
   if(turned){
    // A rotation alone is not a keyboard. If it happens during editing, keep
    // an already hidden dock hidden until the new viewport grows on Done.
    if(opened)rotatingFrom=height;
    else restingHeight=height;
   }
   lastWidth=width;
   if(rotatingFrom){
    if(height-rotatingFrom>=100){opened=false;rotatingFrom=0;restingHeight=height;}
   }else{
    if(!editing&&!opened)restingHeight=height;
    const keyboardLoss=restingHeight-height;
    const threshold=opened?60:Math.max(120,restingHeight*.18);
    opened=touch&&keyboardLoss>=threshold&&(editing||opened);
    // Blur often precedes the keyboard's closing animation. Retain the lock
    // through blur/field changes; restore only when visible height recovers.
    if(!opened)restingHeight=Math.max(restingHeight,height);
   }
   const style=doc.documentElement.style;
   const viewportValues={'--bb-edit-viewport-height':height+'px','--bb-edit-viewport-top':Math.max(0,Number(win.visualViewport?.offsetTop)||0)+'px'};
   for(const [name,value]of Object.entries(viewportValues))if(style?.getPropertyValue?.(name)!==value)style?.setProperty?.(name,value);
   classes.toggle('bb-keyboard-open',opened);
  }
  function schedule(){if(frame===null)frame=win.requestAnimationFrame(refresh);}
  function releaseAfterDismissal(){
   // WKWebView may keep a shorter layout viewport after a modal's keyboard
   // closes. Its old resting height must not leave the app dock hidden forever.
   // A field still being edited belongs to another surface and retains its lock.
   if(editable(doc.activeElement))return false;
   opened=false;rotatingFrom=0;restingHeight=measure().height;
   classes.toggle('bb-keyboard-open',false);
   schedule();return true;
  }
  doc.addEventListener('focusin',schedule);
  doc.addEventListener('focusout',schedule);
  doc.addEventListener('pointerdown',event=>{backdropStart=outsideDialog(event)?event.target:null;},true);
  doc.addEventListener('pointercancel',()=>{backdropStart=null;},true);
  doc.addEventListener('click',event=>{
   const started=backdropStart;backdropStart=null;
   // A thumb swipe that starts in the form and ends beyond its edge is not
   // a backdrop tap. Older browsers without pointer events retain click support.
   if(win.PointerEvent&&event.detail>0&&started!==event.target)return;
   dismissBackdrop(win,event);
  });
  doc.addEventListener('close',releaseAfterDismissal,true);
  win.visualViewport?.addEventListener('resize',schedule);
  win.visualViewport?.addEventListener('scroll',schedule);
  win.addEventListener('resize',schedule);
  win.addEventListener('pageshow',schedule);
  refresh();
  return Object.freeze({refresh,releaseAfterDismissal});
 }
 return Object.freeze({editable,outsideDialog,dismissBackdrop,install});
});
