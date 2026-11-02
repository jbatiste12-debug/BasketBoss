import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../bb-premium-feature-badges.js',import.meta.url),'utf8');
function fixture({state='free',verifiedState=state,comparison=true}={}){
 let phase=state,fallback=verifiedState,observing=false,callback,observer,queryCount=0;
 const microtasks=[],mutationRecords=[];
 const changed=record=>{if(observing&&(record.target===document.body||descendants(document.body).includes(record.target)))mutationRecords.push(record);};
 const descendants=node=>node.childNodes.flatMap(child=>[child,...descendants(child)]);
 function matches(node,selector){
  if(node.nodeType!==1)return false;
  return selector.split(',').some(value=>{
   const part=value.trim();
   if(part.includes('>')){const [parent,child]=part.split(/\s*>\s*/);return matches(node,child)&&!!node.parentElement?.matches(parent);}
   const pieces=part.split(/\s+(?![^\[]*\])/);
   if(pieces.length>1){const last=pieces.pop();return matches(node,last)&&!!node.parentElement?.closest(pieces.join(' '));}
   const tag=part.match(/^([a-z][\w-]*)/i);if(tag&&node.tagName!==tag[1].toUpperCase())return false;
   const id=part.match(/#([\w-]+)/);if(id&&node.id!==id[1])return false;
   for(const [,name]of part.matchAll(/\.([\w-]+)/g))if(!node.classList.contains(name))return false;
   for(const [,name,double,single,bare]of part.matchAll(/\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/g)){
    const value=double??single??bare;if(value===undefined?!node.hasAttribute(name):node.getAttribute(name)!==value)return false;
   }
   return true;
  });
 }
 class Text{
  constructor(value){this.nodeType=3;this._value=String(value);this.childNodes=[];this.parentNode=null;}
  get nodeValue(){return this._value;}set nodeValue(value){const oldValue=this._value;this._value=String(value);changed({type:'characterData',target:this,oldValue,addedNodes:[],removedNodes:[]});}
  get textContent(){return this.nodeValue;}set textContent(value){this.nodeValue=value;}
  get data(){return this.nodeValue;}set data(value){this.nodeValue=value;}
  get parentElement(){return this.parentNode;}
  after(...nodes){const parent=this.parentNode;if(!parent)return;const reference=parent.childNodes[parent.childNodes.indexOf(this)+1]||null;for(const node of nodes)parent.insertBefore(node,reference);}
  remove(){if(this.parentNode)this.parentNode.removeChild(this);}
  replaceWith(...nodes){const parent=this.parentNode;if(!parent)return;for(const node of nodes)parent.insertBefore(node,this);this.remove();}
 }
 class Element extends EventTarget{
  constructor(tag){super();this.nodeType=1;this.tagName=tag.toUpperCase();this.childNodes=[];this.parentNode=null;this.attrs=new Map();this.dataset={};this.hidden=false;}
  get children(){return this.childNodes.filter(node=>node.nodeType===1);}
  get lastElementChild(){return this.children.at(-1)||null;}
  get parentElement(){return this.parentNode?.nodeType===1?this.parentNode:null;}
  get id(){return this.getAttribute('id')||'';}set id(value){this.setAttribute('id',value);}
  get className(){return this.getAttribute('class')||'';}set className(value){this.setAttribute('class',value);}
  get classList(){return {contains:name=>this.className.split(/\s+/).includes(name),add:(...names)=>{this.className=[...new Set([...this.className.split(/\s+/),...names].filter(Boolean))].join(' ');},remove:(...names)=>{this.className=this.className.split(/\s+/).filter(name=>!names.includes(name)).join(' ');}};}
  get textContent(){return this.childNodes.map(node=>node.textContent).join('');}
  set textContent(value){this.replaceChildren(...(String(value)?[new Text(value)]:[]));}
  setAttribute(name,value){this.attrs.set(name,String(value));if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}
  getAttribute(name){if(this.attrs.has(name))return this.attrs.get(name);if(name.startsWith('data-'))return this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]??null;return null;}
  hasAttribute(name){return this.getAttribute(name)!==null;}
  removeAttribute(name){this.attrs.delete(name);}
  append(...nodes){for(let node of nodes){if(typeof node==='string')node=new Text(node);node.remove();node.parentNode=this;this.childNodes.push(node);changed({type:'childList',target:this,addedNodes:[node],removedNodes:[]});}}
  appendChild(node){this.append(node);return node;}
  insertBefore(node,reference){if(typeof node==='string')node=new Text(node);node.remove();const index=this.childNodes.indexOf(reference);node.parentNode=this;this.childNodes.splice(index<0?this.childNodes.length:index,0,node);changed({type:'childList',target:this,addedNodes:[node],removedNodes:[]});return node;}
  removeChild(node){const index=this.childNodes.indexOf(node);if(index>=0){this.childNodes.splice(index,1);node.parentNode=null;changed({type:'childList',target:this,addedNodes:[],removedNodes:[node]});}return node;}
  replaceChildren(...nodes){for(const node of [...this.childNodes])this.removeChild(node);this.append(...nodes);}
  remove(){if(this.parentNode)this.parentNode.removeChild(this);}
  replaceWith(...nodes){const parent=this.parentNode;if(!parent)return;for(const node of nodes)parent.insertBefore(node,this);this.remove();}
  matches(selector){return matches(this,selector);}
  closest(selector){return matches(this,selector)?this:this.parentElement?.closest(selector)||null;}
  querySelectorAll(selector){return descendants(this).filter(node=>matches(node,selector));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  get isConnected(){return this===document.body||descendants(document.body).includes(this);}
  click(){this.onclick?.(new Event('click'));this.dispatchEvent(new Event('click'));}
 }
 const document=new EventTarget();document.body=new Element('body');document.readyState='complete';
 document.createElement=tag=>new Element(tag);document.createTextNode=value=>new Text(value);
 document.querySelectorAll=selector=>{queryCount++;return document.body.querySelectorAll(selector);};
 document.querySelector=selector=>document.querySelectorAll(selector)[0]||null;
 document.getElementById=id=>document.querySelector('#'+id);
 document.createTreeWalker=node=>{const nodes=descendants(node).filter(child=>child.nodeType===3);let index=0;return {nextNode:()=>nodes[index++]||null};};
 const control=(label,{tag='button',id,className,attrs={}}={})=>{const node=new Element(tag);node.textContent=label;if(id)node.id=id;if(className)node.className=className;for(const [name,value]of Object.entries(attrs))node.setAttribute(name,value);document.body.append(node);return node;};
 const paid=[control('Trim my basket',{className:'bb81-trim-button'}),control('Batch cook',{className:'bb-manual-batch-btn'}),control('Evening Pivot',{className:'bb-evening-pivot-open'}),control('Voice Cook',{className:'bbcv-toggle'}),control('Shop mode',{id:'bb172ShopModeButton'}),control('Store mode',{id:'bb172StoreMode'}),control('Begin shop',{className:'bbm-begin'}),control('Begin trip',{className:'bb-r6-begin'}),control('Share with partner',{attrs:{'data-bbhs-trigger':''}}),control('Scan food',{attrs:{'data-ai-scan-btn':''}}),control('Create a meal',{attrs:{'data-ai-meal-btn':''}}),control('Open photo scan',{attrs:{'data-open-tool':'scan'}}),control('Open meal creator',{attrs:{'data-open-tool':'meal'}}),control('Scan',{id:'scanBtn'}),control('Create meal',{id:'generate'}),control('Choose food photo',{tag:'label',attrs:{for:'ai-photo-input'}})];
 const photoInput=new Element('input');photoInput.id='ai-photo-input';photoInput.setAttribute('type','file');paid.at(-1).append(photoInput);
 const begin=paid[6],arrow=new Element('span');arrow.className='begin-arrow';arrow.textContent='→';begin.append(arrow);
 const shop=paid.splice(4,4);
 const free=[control('Auto-Fill week',{id:'basicAutoFill'}),control('Pantry',{id:'pantry'}),control('Ingredients to Avoid',{id:'ingredientsToAvoid'}),control('Upgrade to Premium',{id:'bb175Compare'}),control('Premium AI meal scan'),control('Diet option',{className:'bb81-pro-pill'})];
 const receipt=control('',{attrs:{'data-bb-receipt-entry':'1','aria-label':'Scan receipt'}}),receiptLabel=new Element('span'),receiptBadge=new Element('span');receiptLabel.textContent='Scan receipt';receiptBadge.textContent='Premium';receiptBadge.className='bb-receipt-entry-badge';receipt.append(receiptLabel,' · ',receiptBadge);
 const filterGroup=control('',{tag:'section',className:'bb81-pro-filters'}),filterHeading=new Element('div'),filterBadge=new Element('span');filterHeading.className='bb81-pro-filters-heading';filterBadge.textContent='Premium filters';filterHeading.append(filterBadge);filterGroup.append(filterHeading);
 const recipe=control('Premium meal',{tag:'article',className:'bb18-locked-recipe',attrs:{'data-bb18-premium':'1','aria-label':'Unlock Premium meal'}}),recipeCrown=new Element('span');recipeCrown.className='bb18-premium-crown';recipeCrown.setAttribute('aria-hidden','true');recipeCrown.textContent='♛';recipe.append(recipeCrown);
 const legacy=control('Batch cook · Premium',{className:'bb-manual-batch-btn'});
 const win=new EventTarget();win.BasketBossVerifiedPremium={state:()=>fallback};if(comparison)win.BasketBossMembershipUI={state:()=>phase};
 class Observer{constructor(fn){callback=fn;observer=this;}observe(){observing=true;}disconnect(){observing=false;mutationRecords.length=0;}}
 vm.runInNewContext(source,{window:win,document,MutationObserver:Observer,Node:{TEXT_NODE:3,ELEMENT_NODE:1},NodeFilter:{SHOW_TEXT:4},queueMicrotask:fn=>microtasks.push(fn),setTimeout:fn=>{microtasks.push(fn);return microtasks.length;},clearTimeout(){},Event});
 const flush=()=>{let runs=0;while((mutationRecords.length||microtasks.length)&&runs++<15){if(mutationRecords.length)callback(mutationRecords.splice(0));while(microtasks.length)microtasks.shift()();}assert.ok(runs<15,'decoration must settle instead of observing its own writes');};flush();
 const badges=node=>node.querySelectorAll('.bb-premium-feature-badge');
 const accessible=node=>node.getAttribute?.('aria-label')??(node.hidden||node.getAttribute?.('aria-hidden')==='true'?'':node.nodeType===3?node.textContent:node.childNodes.map(accessible).join(''));
 return {win,document,control,paid,shop,free,receipt,receiptBadge,filterGroup,filterBadge,legacy,photoInput,begin,arrow,recipe,recipeCrown,badges,accessible,flush,get observer(){return observer;},get queryCount(){return queryCount;},setRawState(value){phase=value;},eventState(value,event,target='document'){phase=value;(target==='document'?document:win).dispatchEvent(new Event(event));flush();},setState(value){phase=value;win.BasketBossPremiumFeatureBadges.refresh();flush();},setFallback(value){fallback=value;win.BasketBossPremiumFeatureBadges.refresh();flush();}};
}

for(const state of ['free','signed_out'])test(state+' receives decorative Premium badges only on known paid controls',()=>{
 const h=fixture({state});
 for(const node of h.paid){const badge=h.badges(node);assert.equal(badge.length,1,node.textContent);assert.equal(badge[0].textContent,'Premium');assert.equal(badge[0].getAttribute('aria-hidden'),'true');assert.equal(badge[0].hidden,false);}
 for(const node of [...h.free,...h.shop])assert.equal(h.badges(node).length,0,node.textContent);
 assert.equal(h.badges(h.filterGroup).length,1);assert.equal(h.badges(h.filterGroup)[0],h.filterBadge);
});

test('membership checking, unavailable and Premium never show an upgrade badge',()=>{
 const h=fixture();
 for(const state of ['checking','unavailable','premium']){h.setState(state);assert.equal(h.document.querySelectorAll('.bb-premium-feature-badge').filter(node=>!node.hidden).length,0,state);for(const node of h.paid)assert.equal(h.badges(node).length,0);}
 h.setState('free');assert.equal(h.paid.every(node=>h.badges(node).length===1),true);
});

test('decoration preserves original controls, accessible names and event handlers',()=>{
 const h=fixture(),button=h.paid[0],input=h.photoInput,buttonName='Trim my basket',label=h.paid.at(-1);let clicked=0,changed=0;
 const click=()=>clicked++,change=()=>changed++;button.onclick=click;input.addEventListener('change',change);
 for(const state of ['free','premium','signed_out','checking','free']){h.setState(state);assert.equal(h.document.querySelector('.bb81-trim-button'),button);assert.equal(h.document.getElementById('ai-photo-input'),input);assert.equal(h.accessible(button),buttonName);assert.equal(h.accessible(label),'Choose food photo');assert.equal(button.onclick,click);}
 button.click();input.dispatchEvent(new Event('change'));assert.equal(clicked,1);assert.equal(changed,1);
});

test('existing receipt and filter labels are adopted without duplicate Premium nodes',()=>{
 const h=fixture();
 for(let i=0;i<4;i++){h.win.BasketBossPremiumFeatureBadges.refresh();h.flush();assert.equal(h.badges(h.receipt).length,1);assert.equal(h.badges(h.receipt)[0],h.receiptBadge);assert.equal(h.badges(h.filterGroup)[0],h.filterBadge);assert.equal(h.accessible(h.receipt),'Scan receipt');}
 h.setState('premium');assert.equal(h.receiptBadge.parentNode,h.receipt);assert.equal(h.receiptBadge.hidden,true);assert.equal(h.filterBadge.hidden,true);
 h.setState('signed_out');assert.equal(h.receiptBadge.hidden,false);assert.equal(h.badges(h.receipt).length,1);
});

test('legacy Premium suffix is wrapped without changing text or its accessible name',()=>{
 const h=fixture(),text='Batch cook · Premium';assert.equal(h.legacy.textContent,text);assert.equal(h.accessible(h.legacy),text);
 assert.equal(h.badges(h.legacy).length,1);assert.notEqual(h.badges(h.legacy)[0].getAttribute('aria-hidden'),'true');
 h.setState('premium');assert.equal(h.badges(h.legacy).length,0);assert.equal(h.legacy.textContent,text);assert.equal(h.accessible(h.legacy),text);
 h.setState('free');assert.equal(h.badges(h.legacy).length,1);assert.equal(h.legacy.textContent,text);
});

test('membership comparison state takes precedence and verified status is a safe fallback',()=>{
 const h=fixture({state:'premium',verifiedState:'free'});assert.equal(h.badges(h.paid[0]).length,0);
 h.setState('free');assert.equal(h.badges(h.paid[0]).length,1);
 const fallback=fixture({comparison:false,verifiedState:'signed_out'});assert.equal(fallback.badges(fallback.paid[0]).length,1);
 fallback.setFallback('unavailable');assert.equal(fallback.badges(fallback.paid[0]).length,0);
});

test('dynamic paid controls receive one badge while unrelated additions remain unchanged',()=>{
 const h=fixture(),oldBadge=h.badges(h.paid[0])[0];
 const added=h.control('New batch action',{className:'bb-manual-batch-btn'}),ordinary=h.control('Scan meal Premium');h.flush();
 assert.equal(h.badges(added).length,1);assert.equal(h.badges(ordinary).length,0);assert.equal(h.badges(h.paid[0])[0],oldBadge);
 for(let i=0;i<4;i++){h.win.BasketBossPremiumFeatureBadges.refresh();h.flush();assert.equal(h.badges(added).length,1);}
});


test('membership events refresh badges without changing the shopping arrow or recipe control',()=>{
 const h=fixture();assert.equal(h.begin.lastElementChild,h.arrow);assert.equal(h.badges(h.recipe).length,1);assert.ok(h.badges(h.recipe)[0]===h.recipeCrown);assert.equal(h.accessible(h.recipe),'Unlock Premium meal');
 h.eventState('premium','basketboss:premium-verified');assert.equal(h.badges(h.paid[0]).length,0);assert.equal(h.recipeCrown.hidden,true);assert.equal(h.begin.lastElementChild,h.arrow);
 h.eventState('signed_out','basketboss:session-changed','window');assert.equal(h.badges(h.paid[0]).length,1);assert.equal(h.recipeCrown.hidden,false);assert.equal(h.begin.lastElementChild,h.arrow);
 h.eventState('unavailable','focus','window');assert.equal(h.badges(h.paid[0]).length,0);assert.equal(h.recipeCrown.hidden,true);assert.equal(h.accessible(h.recipe),'Unlock Premium meal');
});


test('unrelated price text mutations never trigger a whole-document badge rescan',()=>{
 const h=fixture(),price=h.control('£4.99',{tag:'span',className:'trial-renewal-price'});h.flush();
 const before=h.queryCount;
 for(let i=0;i<100;i++){
  if(i%2)price.childNodes[0].nodeValue='£'+i;
  else price.textContent='£'+i;
  h.flush();
 }
 assert.equal(h.queryCount,before,'price render churn must not repeatedly query every paid control');
 assert.equal(h.badges(h.paid[0]).length,1);
});

test('a newly inserted subtree containing a paid control is decorated, and native header changes refresh state',()=>{
 const h=fixture(),section=h.document.createElement('section'),button=h.document.createElement('button');button.className='bb-manual-batch-btn';button.textContent='Batch this meal';section.append(button);
 h.document.body.append(section);h.flush();assert.equal(h.badges(button).length,1);
 const before=h.queryCount;h.setRawState('premium');h.free[3].textContent='PREMIUM';h.flush();
 assert.ok(h.queryCount>before,'a native membership label update must refresh paid feature presentation');
 assert.equal(h.badges(button).length,0);assert.equal(h.badges(h.free[3]).length,0,'the header remains an undecorated membership action');
});

test('all advanced shopping launchers stay outside Premium-only badges',()=>{
 const h=fixture(),button=h.control('Go Shopping →',{className:'bb1745-go-button'});let clicks=0;const click=()=>clicks++;button.onclick=click;h.flush();
 for(const state of ['free','signed_out','premium']){h.setState(state);for(const node of [...h.shop,button])assert.equal(h.badges(node).length,0,'weekly allowance owns the launcher badge');}
 assert.equal(h.accessible(button),'Go Shopping →');assert.equal(button.onclick,click);button.click();assert.equal(clicks,1);
});
