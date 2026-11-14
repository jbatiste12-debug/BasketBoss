import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../bb-day-plan-sheet.js',import.meta.url),'utf8');

function fixture({open=[],count=8,bannerHidden=false}={}){
 let doc,clock=0,sequence=0,foreignModal=false;const frames=[],timers=new Map(),listeners=new Map(),toggles=[],calls=[];
 const listen=(map,name,fn)=>{const list=map.get(name)||[];list.push(fn);map.set(name,list);};
 const walk=node=>[node,...node.children.flatMap(walk)];
 function match(node,selector){
  const parts=selector.trim().split(/\s+|\s*>\s*/).filter(Boolean);
  if(parts.length>1){if(!match(node,parts.at(-1)))return false;for(let parent=node.parentNode;parent;parent=parent.parentNode)if(match(parent,parts.slice(0,-1).join(' ')))return true;return false;}
  let part=parts[0]||'*';if(part==='*')return true;
  if(part.includes(':not([hidden])')){if(node.hidden)return false;part=part.replace(':not([hidden])','');}
  if(part.includes(':not([disabled])')){if(node.disabled)return false;part=part.replace(':not([disabled])','');}
  const tag=part.match(/^[a-z][\w-]*/i)?.[0];if(tag&&node.tagName!==tag.toLowerCase())return false;
  for(const [,id]of part.matchAll(/#([\w-]+)/g))if(node.id!==id)return false;
  for(const [,name]of part.matchAll(/\.([\w-]+)/g))if(!node.classList.contains(name))return false;
  for(const [,name,value]of part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)){
   const actual=name==='open'?(node.open?'':undefined):name.startsWith('data-')?node.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]:node.attributes[name];
   if(actual===undefined||value!==undefined&&String(actual)!==value)return false;
  }
  return true;
 }
 class Node{
  constructor(tag){Object.assign(this,{tagName:tag,children:[],parentNode:null,ownerDocument:doc,dataset:{},attributes:{},className:'',events:new Map(),hidden:false,disabled:false,_open:false,_text:'',style:{values:new Map(),getPropertyValue(name){return this.values.get(name)||'';},setProperty(name,value){this.values.set(name,value);}}});}
  get classList(){const node=this;return {contains:name=>node.className.split(/\s+/).includes(name),add(...names){node.className=[...new Set([...node.className.split(/\s+/).filter(Boolean),...names])].join(' ');},remove(...names){node.className=node.className.split(/\s+/).filter(name=>!names.includes(name)).join(' ');}};}
  get open(){return this._open;}
  set open(value){const changed=this._open!==!!value;this._open=!!value;if(changed){for(const fn of listeners.get('toggle')||[])fn({target:this});for(const fn of this.events.get('toggle')||[])fn({target:this});}}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set textContent(value){this._text=String(value);this.children=[];}
  get isConnected(){return this===doc?.documentElement||!!this.parentNode?.isConnected;}
  append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
  prepend(...nodes){for(const node of nodes.reverse()){node.remove();node.parentNode=this;this.children.unshift(node);}}
  before(node){const parent=this.parentNode;node.remove();node.parentNode=parent;parent.children.splice(parent.children.indexOf(this),0,node);}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}
  matches(selector){return selector.split(',').some(part=>match(this,part));}
  closest(selector){for(let node=this;node;node=node.parentNode)if(node.matches(selector))return node;return null;}
  querySelectorAll(selector){if(selector.startsWith(':scope>'))return this.children.filter(node=>node.matches(selector.slice(7)));return walk(this).slice(1).filter(node=>node.matches(selector));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  addEventListener(name,fn){listen(this.events,name,fn);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  removeAttribute(name){delete this.attributes[name];}
  contains(node){return walk(this).includes(node);}
  focus(){doc.activeElement=this;}
  getClientRects(){return this.hidden?[]:[this.getBoundingClientRect()];}
  getBoundingClientRect(){return {top:10,bottom:92,width:366,height:82};}
 }
 doc={readyState:'complete',createElement:tag=>new Node(tag),addEventListener:(name,fn)=>listen(listeners,name,fn),getElementById:id=>walk(doc.documentElement).find(node=>node.id===id)||null,
  querySelectorAll:selector=>doc.documentElement.querySelectorAll(selector),querySelector:selector=>selector==='dialog[open],#cloud-panel.open,#modalRoot > *,.bbui-settings-overlay:not([hidden])'?(foreignModal?{}:null):doc.documentElement.querySelector(selector)};
 doc.documentElement=new Node('html');doc.body=new Node('body');doc.body.dataset.bbnextView='week';doc.documentElement.append(doc.body);doc.activeElement=doc.body;
 const app=new Node('div');app.id='app';app.className='bbnext-plan';doc.body.append(app);
 const rows=Object.fromEntries(['Monday','Tuesday'].map(day=>{
  const row=new Node('details');row.className='bbnext-day';row.dataset.bbnextDay=day;row.open=open.includes(day);
  const summary=new Node('summary');summary.className='bbnext-day-toggle';const badge=new Node('span');badge.className='bbnext-day-label';const description=new Node('span');description.className='bbnext-day-description';const title=new Node('strong');title.textContent=day+' actual recipe';description.append(title);summary.append(badge,description);
  const content=new Node('div');content.className='bbnext-day-content';const ingredients=new Node('div');ingredients.className='bbnext-meal-ingredients';if(count!==null)ingredients.dataset.bbIngredientCount=String(count);const text=new Node('p');text.textContent='Original recipe ingredient text · full-precision state unchanged';ingredients.append(text);
  const owner=new Node('div');owner.className='bb172-planner-controls';const cook=new Node('button');cook.attributes['data-cook']='real-recipe';cook.addEventListener('click',()=>calls.push(day));owner.append(cook);content.append(ingredients,owner);row.append(summary,content);app.append(row);row.addEventListener('toggle',()=>toggles.push({day,open:row.open}));return [day,{row,summary,badge,title,content,ingredients,text,owner,cook}];
 }));
 const banner=new Node('aside');banner.id='bbFunnelNudge';banner.hidden=bannerHidden;const signup=new Node('button'),dismiss=new Node('button');signup.addEventListener('click',()=>calls.push('signup'));dismiss.addEventListener('click',()=>{banner.hidden=true;calls.push('dismiss');});banner.append(signup,dismiss);doc.body.append(banner);
 const win={document:doc,innerHeight:844,requestAnimationFrame:fn=>{frames.push(fn);},addEventListener(){},setTimeout:(fn,ms)=>{timers.set(++sequence,{fn,at:clock+ms});return sequence;},clearTimeout:id=>timers.delete(id),localStorage:{getItem(){throw Error('Presentation must not read account or pantry storage');},setItem(){throw Error('Presentation must not write storage');}}};
 vm.runInNewContext(source,{window:win,document:doc,Element:Node,MutationObserver:class{observe(){}disconnect(){}}});
 function flush(){let limit=20;while(frames.length){assert.ok(limit--,'presentation refresh must settle');frames.shift()();}}
 function fire(name,target,extra={}){
  const event={target,key:'',defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra};
  for(const fn of listeners.get(name)||[])fn(event);
  if(!event.stopped)for(const fn of target.events.get(name)||[])fn(event);
  if(name==='click'&&!event.defaultPrevented){const summary=target.closest('summary');if(summary)summary.parentNode.open=!summary.parentNode.open;}
  flush();return event;
 }
 return {doc,win,rows,banner,signup,dismiss,calls,toggles,fire,flush,setModal:value=>{foreignModal=value;},advance(ms){clock+=ms;for(const [id,timer]of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}flush();}};
}

test('opening the day sheet preserves all original control identities, owners and other open days',()=>{
 const h=fixture({open:['Monday','Tuesday']}),m=h.rows.Monday,t=h.rows.Tuesday,parent=m.cook.parentNode,ingredientsText=m.ingredients.textContent;
 h.fire('click',m.title);
 assert.equal(m.row.open,true);assert.equal(t.row.open,true);
 assert.equal(m.row.classList.contains('bbdps-active'),true);assert.equal(t.row.classList.contains('bbdps-active'),false);
 assert.equal(m.cook.parentNode,parent);assert.equal(m.ingredients.textContent,ingredientsText);
 assert.equal(m.content.querySelector('.bbdps-ingredients').open,false);assert.equal(m.content.querySelector('.bbdps-ingredients>summary').textContent,'Ingredients (8)');
 h.fire('click',m.cook);assert.deepEqual(h.calls,['Monday']);assert.equal(m.row.open,true,'an existing action cannot become a disclosure toggle');
});

test('closing the active sheet uses its native disclosure and never reopens an older day',()=>{
 const h=fixture({open:['Monday','Tuesday']});h.fire('click',h.rows.Monday.title);
 h.fire('click',h.rows.Monday.content.querySelector('.bbdps-close'));
 assert.equal(h.rows.Monday.row.open,false);assert.equal(h.rows.Tuesday.row.open,true);
 h.win.BBPlanDaySheet.refresh();assert.equal(h.rows.Tuesday.row.classList.contains('bbdps-active'),false);
 assert.equal(h.doc.documentElement.classList.contains('bb-day-plan-sheet-open'),false);
 assert.ok(h.toggles.some(item=>item.day==='Monday'&&!item.open),'the original native toggle listener still sees dismissal');
});

test('unknown ingredient counts never invent zero and existing reminder identity and dismissal remain intact',()=>{
 const h=fixture({count:null});h.fire('click',h.rows.Monday.title);
 assert.equal(h.rows.Monday.content.querySelector('.bbdps-ingredients>summary').textContent,'Ingredients');
 assert.equal(h.doc.getElementById('bbFunnelNudge'),h.banner);assert.equal(h.banner.hidden,false);
 h.fire('click',h.dismiss);assert.equal(h.banner.hidden,true);assert.deepEqual(h.calls,['dismiss']);
 h.win.BBPlanDaySheet.refresh();assert.equal(h.banner.hidden,true,'opening or measuring a sheet never forces signup back on');
});

test('Escape and focus handling yield to a nested native or account modal',()=>{
 const h=fixture();h.fire('click',h.rows.Monday.title);h.setModal(true);
 assert.equal(h.fire('keydown',h.rows.Monday.content,{key:'Escape'}).defaultPrevented,false);assert.equal(h.rows.Monday.row.open,true);
 h.setModal(false);assert.equal(h.fire('keydown',h.rows.Monday.content,{key:'Escape'}).defaultPrevented,true);assert.equal(h.rows.Monday.row.open,false);
});

test('badge double-tap time remains reachable before presentation covers the original gesture target',()=>{
 const h=fixture();h.fire('click',h.rows.Monday.badge);
 assert.equal(h.rows.Monday.row.open,true);assert.equal(h.rows.Monday.row.classList.contains('bbdps-active'),false);
 h.advance(320);assert.equal(h.rows.Monday.row.classList.contains('bbdps-active'),false);
 h.advance(10);assert.equal(h.rows.Monday.row.classList.contains('bbdps-active'),true);
 const guarded=fixture();guarded.fire('click',guarded.rows.Monday.badge,{defaultPrevented:true});guarded.advance(500);
 assert.equal(guarded.rows.Monday.row.open,false,'an existing prevented drag/double-tap action is never replaced');
 assert.equal(guarded.rows.Monday.row.classList.contains('bbdps-active'),false);
});

test('leaving Plan removes only presentation state and preserves the native open-day choices',()=>{
 const h=fixture();h.fire('click',h.rows.Monday.title);h.doc.body.dataset.bbnextView='discover';h.win.BBPlanDaySheet.refresh();
 assert.equal(h.rows.Monday.row.open,true);assert.equal(h.doc.documentElement.classList.contains('bb-day-plan-sheet-open'),false);
 h.doc.body.dataset.bbnextView='week';h.win.BBPlanDaySheet.refresh();assert.equal(h.rows.Monday.row.classList.contains('bbdps-active'),false);
});
