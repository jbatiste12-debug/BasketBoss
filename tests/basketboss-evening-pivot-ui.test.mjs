import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../bb-evening-pivot-ui.js',import.meta.url),'utf8');
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
function suggestion(overrides={}){
 return {day:'Wednesday',candidateRecipe:{id:'pasta',name:'Quick tomato pasta',mins:20},currentRecipe:{id:'chicken',name:'Sheet-pan chicken',mins:45},minsSaved:25,movedDateISO:'2026-11-04',currentServings:4,candidateServings:3,requiresFreshness:[{key:'chicken breast',name:'Chicken breast',kind:'fresh'},{key:'peppers',name:'Mixed peppers',kind:'fresh'}],token:{revision:'reviewed'},...overrides};
}
function fixture(options={}){
 let doc,premium=options.premium!==false;
 const matches=(node,selector)=>selector.split(',').some(raw=>{
  const part=raw.trim();
  if(part.startsWith('#'))return node.id===part.slice(1);
  if(part.startsWith('.'))return node.className.split(' ').includes(part.slice(1));
  if(part==='[hidden]')return node.hidden===true;
  return node.tagName.toLowerCase()===part;
 });
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.className='';this.attributes={};this.handlers={};this._text='';this.hidden=false;this.disabled=false;this.checked=false;this.value='';this.id='';this.readOnly=false;this.open=false;
   this.classList={toggle:(name,on)=>{const classes=new Set(this.className.split(' ').filter(Boolean));if(on)classes.add(name);else classes.delete(name);this.className=[...classes].join(' ');}};
  }
  append(...nodes){for(const node of nodes){node.parentNode?.removeChild(node);node.parentNode=this;this.children.push(node);}}
  removeChild(node){this.children=this.children.filter(child=>child!==node);node.parentNode=null;}
  remove(){this.parentNode?.removeChild(this);}
  replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];this._text='';this.append(...nodes);}
  get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
  set textContent(value){this.replaceChildren();this._text=String(value);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  addEventListener(type,fn){(this.handlers[type]??=[]).push(fn);}
  fire(type,event={}){for(const fn of this.handlers[type]||[])fn(event);}
  click(){if(!this.disabled)this.fire('click');}
  focus(){doc.activeElement=this;}
  showModal(){this.open=true;}
  close(){this.open=false;}
  get isConnected(){return this===doc.body||Boolean(this.parentNode?.isConnected);}
  querySelectorAll(selector){const nodes=[];for(const child of this.children){if(matches(child,selector))nodes.push(child);nodes.push(...child.querySelectorAll(selector));}return nodes;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){for(let node=this;node;node=node.parentNode)if(matches(node,selector))return node;return null;}
 }
 const body=new Element('body');doc={body,activeElement:null,createElement:tag=>new Element(tag),querySelector:selector=>body.querySelector(selector)};
 const window={document:doc};vm.runInNewContext(source,{window});
 const calls={preview:[],apply:[],upgrade:[]},suggestions=options.suggestions||[suggestion()];
 const api=window.BBEveningPivotUI;
 const adapter={currentDay:()=>options.today||'Monday',isPremium:()=>premium,upgrade:details=>{calls.upgrade.push(details);},preview:context=>{calls.preview.push(context);return options.preview?options.preview(context):{suggestions,reason:options.reason};},apply:(chosen,checks)=>{calls.apply.push({chosen,checks});return options.apply?options.apply(chosen,checks):{ok:true};}};
 if(options.missingPremium)delete adapter.isPremium;
 if(options.missingUpgrade)delete adapter.upgrade;
 api.configure(adapter);
 const wrapper=api.createButton({day:'Monday',recipeId:'chicken'});if(wrapper)body.append(wrapper);
 const $=selector=>doc.querySelector(selector);
 const checkboxes=()=>[$('.bbep-freshness-check').children[0],$('.bbep-ready-check').children[0]];
 return {doc,api,adapter,calls,suggestions,$,wrapper,setPremium:value=>{premium=value;},get opener(){return $('.bb-evening-pivot-open');},get dialog(){return $('#bbEveningPivotDialog');},get submit(){return $('.bbep-submit');},
  async open(){this.opener.click();await flush();},
  dates(values){for(const [index,input]of $('.bbep-review').querySelectorAll('input').filter(node=>node.type==='date').entries()){input.value=values[index]||'';input.fire('input');}},
  checks(value=true){for(const input of checkboxes()){input.checked=value;input.fire('change');}},
  async commit(){let prevented=false;$('.bbep-form').fire('submit',{preventDefault(){prevented=true;}});assert.equal(prevented,true);await flush();}
 };
}

test('the compact tonight control creates no sheet or preview until clicked, and other days get no control',async()=>{
 const h=fixture();assert.ok(h.wrapper);assert.equal(h.dialog,null);assert.equal(h.calls.preview.length,0);assert.equal(h.calls.apply.length,0);assert.equal(h.opener.textContent,'Evening Pivot · Need a quicker dinner?');
 assert.equal(h.api.createButton({day:'Tuesday',recipeId:'pasta'}),null);
 await h.open();assert.equal(h.calls.preview.length,1);assert.equal(h.dialog.open,true);assert.equal(h.calls.apply.length,0);assert.match(h.dialog.textContent,/PANTRY amounts checked/);assert.match(h.dialog.textContent,/Tonight · Monday/);assert.match(h.dialog.textContent,/Wednesday,? 4 November/);assert.match(h.dialog.textContent,/3 servings/);assert.match(h.dialog.textContent,/4 servings/);assert.equal(h.submit.disabled,true);
});

test('Free users see the Premium control and only open the existing upgrade route',async()=>{
 const h=fixture({premium:false});assert.match(h.opener.textContent,/· Premium$/);await h.open();assert.equal(h.dialog,null);assert.equal(h.calls.preview.length,0);assert.equal(h.calls.apply.length,0);assert.equal(h.calls.upgrade.length,1);assert.equal(h.calls.upgrade[0].feature,'Evening Pivot');
});

test('missing or failing Premium verification fails closed even when a plan adapter is configured',async()=>{
 for(const options of [{missingPremium:true},{premium:false,missingUpgrade:true}]){
  const h=fixture(options);await h.open();assert.equal(h.dialog,null);assert.equal(h.calls.preview.length,0);assert.equal(h.calls.apply.length,0);
  if(options.missingUpgrade)assert.match(h.opener.textContent,/unavailable/);else assert.equal(h.calls.upgrade.length,1);
 }
 const h=fixture();h.adapter.isPremium=()=>{throw Error('Unavailable');};await h.open();assert.equal(h.dialog,null);assert.equal(h.calls.preview.length,0);assert.equal(h.calls.upgrade.length,1);
});

test('loss of Premium before confirming blocks apply and removes the date review',async()=>{
 const h=fixture();await h.open();h.dates(['2026-11-04','2026-11-04']);h.checks();assert.equal(h.submit.disabled,false);h.setPremium(false);await h.commit();assert.equal(h.calls.apply.length,0);assert.equal(h.submit.hidden,true);assert.equal(h.$('.bbep-review').hidden,true);assert.equal(h.$('.bbep-use-by'),null);assert.match(h.$('.bbep-message').textContent,/Premium access could not be confirmed/);
});

test('Premium is checked again when an asynchronous preview finishes',async()=>{
 let resolve;const h=fixture({preview:()=>new Promise(done=>{resolve=done;})});h.opener.click();assert.equal(h.calls.preview.length,1);h.setPremium(false);resolve({suggestions:[suggestion()]});await flush();assert.equal(h.$('.bbep-use-by'),null);assert.equal(h.$('.bbep-choice'),null);assert.equal(h.submit.hidden,true);assert.match(h.$('.bbep-message').textContent,/Premium access could not be confirmed/);assert.equal(h.calls.apply.length,0);
});

test('swap requires every use-by date to cover the moved day and both ingredient confirmations',async()=>{
 const h=fixture();await h.open();h.dates(['2026-11-04','2026-11-04']);assert.equal(h.submit.disabled,true);h.checks();assert.equal(h.submit.disabled,false);
 h.dates(['2026-11-03','2026-11-04']);assert.equal(h.submit.disabled,true);assert.match(h.$('.bbep-validation-hint').textContent,/on or after/);
 await h.commit();assert.equal(h.calls.apply.length,0);
 h.dates(['2026-11-04','2026-02-30']);assert.equal(h.submit.disabled,true);await h.commit();assert.equal(h.calls.apply.length,0);
 h.dates(['2026-11-04','2026-11-06']);h.checks(false);await h.commit();assert.equal(h.calls.apply.length,0);
 h.checks();await h.commit();assert.equal(h.calls.apply.length,1);assert.equal(h.calls.apply[0].chosen,h.suggestions[0]);assert.deepEqual({...h.calls.apply[0].checks.useBy},{'chicken breast':'2026-11-04',peppers:'2026-11-06'});assert.equal(h.calls.apply[0].checks.confirmed,true);assert.equal(h.calls.apply[0].checks.readyToCook,true);assert.equal(h.dialog,null);assert.equal(h.doc.activeElement,h.opener);
});

test('known expiry before the moved day blocks the swap even if both checks are ticked',async()=>{
 const h=fixture({suggestions:[suggestion({requiresFreshness:[{key:'chicken',name:'Chicken',kind:'fresh',useByISO:'2026-11-03'}]})]});await h.open();h.checks();
 const input=h.$('.bbep-use-by');assert.equal(input.readOnly,true);assert.equal(input.value,'2026-11-03');assert.equal(h.submit.disabled,true);assert.match(h.$('.bbep-validation-hint').textContent,/past its use-by/);
 input.value='2026-11-08';input.fire('input');await h.commit();assert.equal(h.calls.apply.length,0,'editing a known expired field cannot bypass the recorded date');
});

test('changing the chosen dinner resets the date and suitability review',async()=>{
 const h=fixture({suggestions:[suggestion(),suggestion({day:'Thursday',movedDateISO:'2026-11-05',candidateRecipe:{id:'eggs',name:'Quick eggs',mins:10},minsSaved:35})]});await h.open();h.dates(['2026-11-06','2026-11-06']);h.checks();assert.equal(h.submit.disabled,false);
 h.$('.bbep-choices').querySelectorAll('button')[1].click();assert.equal(h.submit.disabled,true);assert.equal(h.$('.bbep-use-by').value,'');assert.match(h.$('.bbep-meal-swap').textContent,/Quick eggs/);assert.match(h.$('.bbep-meal-swap').textContent,/Thursday,? 5 November/);assert.equal(h.$('.bbep-ready-check').children[0].checked,false);
});

test('a failed or stale save leaves the review open and exposes the adapter error without a second automatic attempt',async()=>{
 const h=fixture({apply:()=>({ok:false,error:'Your plan changed. Close this sheet and review it again.'})});await h.open();h.dates(['2026-11-04','2026-11-04']);h.checks();await h.commit();assert.equal(h.calls.apply.length,1);assert.equal(h.dialog.open,true);assert.match(h.$('.bbep-message').textContent,/Your plan changed/);assert.equal(h.$('.bbep-message').getAttribute('role'),'alert');assert.equal(h.submit.disabled,false);
});

test('empty results keep the plan unchanged and Escape closes the sheet with focus restored',async()=>{
 const h=fixture({suggestions:[],reason:'No quicker dinner has enough confirmed PANTRY ingredients.'});await h.open();assert.match(h.$('.bbep-message').textContent,/No quicker dinner/);assert.equal(h.submit.hidden,true);let prevented=false;h.dialog.fire('keydown',{key:'Escape',preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(h.dialog,null);assert.equal(h.doc.activeElement,h.opener);assert.equal(h.calls.apply.length,0);
});

test('closing while a preview is pending prevents late results from reopening the sheet',async()=>{
 let resolve;const h=fixture({preview:()=>new Promise(done=>{resolve=done;})});h.opener.click();assert.ok(h.dialog);h.$('.bbep-cancel').click();assert.equal(h.dialog,null);resolve({suggestions:[suggestion()]});await flush();assert.equal(h.dialog,null);assert.equal(h.calls.apply.length,0);
});

test('focus stays inside the sheet and a pending save cannot be double-submitted or silently cancelled',async()=>{
 let resolve;const h=fixture({apply:()=>new Promise(done=>{resolve=done;})});await h.open();h.dates(['2026-11-04','2026-11-04']);h.checks();h.submit.focus();let prevented=false;h.dialog.fire('keydown',{key:'Tab',preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(h.doc.activeElement,h.$('.bbep-dismiss'));
 h.$('.bbep-form').fire('submit',{preventDefault(){}});assert.equal(h.calls.apply.length,1);h.$('.bbep-form').fire('submit',{preventDefault(){}});h.dialog.fire('cancel',{preventDefault(){}});assert.ok(h.dialog);assert.equal(h.calls.apply.length,1);assert.equal(h.dialog.getAttribute('aria-busy'),'true');resolve({ok:true});await flush();assert.equal(h.dialog,null);
});
