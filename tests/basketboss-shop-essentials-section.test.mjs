import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
function actual(name){const start=html.indexOf('function '+name+'(');assert.ok(start>=0,name);const lineEnd=html.indexOf('\n',start);if(html.slice(start,lineEnd).endsWith('}'))return html.slice(start,lineEnd);const end=html.indexOf('\n}',start);assert.ok(end>start,name);return html.slice(start,end+2);}
const dataKey=name=>name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
class Element{
 constructor(tag,cls='',text=''){this.tagName=tag;this.className=cls||'';this.ownText=text;this.children=[];this.dataset={};this.attributes={};this.events={};this.parentElement=null;this.checked=false;this.open=false;this.classList={contains:value=>this.className.split(/\s+/).includes(value)};}
 append(...nodes){for(const node of nodes){if(node.tagName==='#fragment'){this.append(...[...node.children]);continue;}node.remove();node.parentElement=this;this.children.push(node);}}
 appendChild(node){this.append(node);return node;}
 remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(x=>x!==this);this.parentElement=null;}}
 replaceChildren(...nodes){for(const node of this.children)node.parentElement=null;this.children=[];this.ownText='';this.append(...nodes);}
 setAttribute(key,value){this.attributes[key]=String(value);if(key==='id')this.id=String(value);if(key.startsWith('data-'))this.dataset[dataKey(key)]=String(value);}
 addEventListener(type,fn){this.events[type]=fn;}
 get textContent(){return this.ownText+this.children.map(x=>x.textContent).join('');}
 set textContent(value){this.ownText=String(value);this.replaceChildren();this.ownText=String(value);}
 matches(selector){if(selector[0]==='#')return this.id===selector.slice(1);if(selector[0]==='.')return this.classList.contains(selector.slice(1));if(selector[0]==='['){const key=selector.slice(1,-1);return key.startsWith('data-')?Object.hasOwn(this.dataset,dataKey(key)):Object.hasOwn(this.attributes,key);}return this.tagName===selector;}
 closest(selector){for(let n=this;n;n=n.parentElement)if(n.matches(selector))return n;return null;}
 get isConnected(){let n=this;while(n.parentElement)n=n.parentElement;return n.tagName==='document';}
 descendants(){return this.children.flatMap(x=>[x,...x.descendants()]);}
 querySelectorAll(selector){if(selector.startsWith(':scope > '))return this.children.filter(x=>x.matches(selector.slice(9)));const parts=selector.split(' ');if(parts.length>1)return this.descendants().filter(x=>x.matches(parts.at(-1))&&(()=>{let parent=x.parentElement;for(let i=parts.length-2;i>=0;i--){while(parent&&!parent.matches(parts[i]))parent=parent.parentElement;if(!parent)return false;parent=parent.parentElement;}return true;})());return this.descendants().filter(x=>x.matches(selector));}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
function fixture(records){
 const doc=new Element('document'),app=new Element('main'),list=new Element('section'),content=new Element('main');app.id='app';list.id='bb321Printable';content.id='bb172StorefrontAisles';app.append(list);doc.append(app,content);doc.getElementById=id=>doc.querySelector('#'+id);doc.createElement=tag=>new Element(tag);doc.createDocumentFragment=()=>new Element('#fragment');
 const title=new Element('div','bb321-shop-list-heading');title.append(new Element('h4','','What to buy'));list.append(title,new Element('h4','bb321-shop-subheading','Weekly essentials'));
 const inputs=records.map((record,i)=>{const row=new Element('div','bb321-buy-row'+(record.essential?' bb321-essential-row':''));row.category=record.aisle;const box=new Element('input');box.dataset.bb321Tick=record.id;box.checked=!!record.checked;box.purchaseHandler={stableId:i};const info=new Element('div','bb321-shop-info'),name=new Element('label','bb321-shop-name',record.name),qty=new Element('div','bb321-shop-quantity');qty.append(new Element('strong','',record.qty));info.append(name,qty);row.append(box,info);list.append(row);return {row,box,record};});
 const summary={items:records.filter(x=>!x.essential).map(x=>({key:x.name,unit:x.unit||'g',toBuy:x.required||500})),essentials:records.filter(x=>x.essential).map(x=>({id:x.id.slice(4),name:x.name,unit:x.unit||'each',qty:x.required||1}))};
 let renders=0;
 const context=vm.createContext({document:doc,tab:'shop',bb172ShopAisleOpen:{},bb172StorefrontOpenedAisles:{},bb172StorefrontFilter:'all',bb172StorefrontQuery:'',bb307Market:'UK',
  bb172ShopCategoryFor:row=>row.category,bb172ShopAisleOptions:()=>'',bb172ShopMoveAisle(){},bb172ShopControls(){},bb172ShopRefreshStatus(){},bb172StorefrontRefresh(){},bb321WeeklySummary:()=>summary,BB307Pantry:{pantryId:(name,unit)=>name.toLowerCase()+'|'+unit},bbPartialDetails:()=>null,
  bb172StorefrontEl:(tag,cls,text)=>new Element(tag,cls,text),bb172StorefrontMakeRow:item=>{const row=new Element('div','projected-row',item.name);row.sourceId=item.id;row.sourceBox=item.box;renders++;return row;}});
 const start=html.indexOf('const BB172_AISLES=['),end=html.indexOf('\nlet bb172ShopActive',start);assert.ok(end>start);vm.runInContext(html.slice(start,end),context);
 for(const name of ['bb172ShopAllRows','bb172ShopUncheckedRows','bb172ShopRowName','bb172ShopOrganize','bb172ShopNormalize','bb172StorefrontAll','bb172StorefrontDrawAisles','bb172ShopOutstandingText'])vm.runInContext(actual(name),context);
 return {doc,app,list,content,context,inputs,summary,renders:()=>renders,organize:()=>context.bb172ShopOrganize(),sections:()=>list.querySelectorAll('.bb172-aisle-section'),draw:(filter='all',query='')=>{context.bb172StorefrontFilter=filter;context.bb172StorefrontQuery=query;context.bb172StorefrontDrawAisles();return content.querySelectorAll('.bb172-storefront-aisle');}};
}
const rows=()=>[
 {id:'ess:rolls',name:'Toilet rolls',qty:'Buy 4 each',unit:'each',required:4,aisle:'household',essential:true},
 {id:'rice|g',name:'Rice',qty:'Buy 500 g',aisle:'dry'},
 {id:'carrots|g',name:'Carrots',qty:'Buy 160 g',aisle:'produce'},
 {id:'ess:soap',name:'Hand soap',qty:'Buy 1 bottle',unit:'each',aisle:'household',essential:true,checked:true}
];
test('basic shopping keeps a single final Weekly essentials section and the original purchase controls',()=>{
 const h=fixture(rows()),before=h.inputs.map(x=>x.box);h.organize();const sections=h.sections();assert.deepEqual(sections.map(x=>x.dataset.bb172Aisle),['produce','dry','essentials']);assert.match(sections.at(-1).textContent,/Weekly essentials1 left of 2/);assert.equal(sections.at(-1).open,true);assert.equal(h.list.querySelector('.bb321-shop-subheading'),null);assert.equal(h.list.querySelectorAll('.bb321-buy-row').length,4);
 for(let i=0;i<h.inputs.length;i++)assert.equal(h.inputs[i].row.querySelector('[data-bb321-tick]'),before[i],'purchase checkbox and attached handler are preserved');
 assert.equal(h.inputs[0].row.querySelector('.bb172-aisle-edit'),null);assert.ok(h.inputs[1].row.querySelector('.bb172-aisle-edit'),'food keeps the original aisle control');
 h.organize();assert.equal(h.sections().length,3,'repeat render does not duplicate sections');h.list.dataset.bb172Aisled='';h.organize();assert.equal(h.sections().length,3);assert.equal(h.list.querySelectorAll('.bb321-buy-row').length,4,'regrouping moves rows instead of cloning them');
});
test('an essentials-only week renders without a food group and preserves bought state when reopened',()=>{
 const h=fixture(rows().filter(x=>x.essential));h.organize();assert.deepEqual(h.sections().map(x=>x.dataset.bb172Aisle),['essentials']);h.sections()[0].open=false;h.sections()[0].events.toggle();h.list.dataset.bb172Aisled='';h.organize();assert.equal(h.sections()[0].open,false);assert.equal(h.inputs[1].box.checked,true);assert.equal(h.list.querySelectorAll('[data-bb321-tick]').length,2);
});
test('storefront projection retains canonical IDs, required quantities and actual aisles independently of its display section',()=>{
 const h=fixture(rows());h.organize();const projected=h.context.bb172StorefrontAll(),soap=projected.find(x=>x.id==='ess:soap'),rice=projected.find(x=>x.id==='rice|g');assert.equal(soap.essential,true);assert.equal(soap.aisle,'household');assert.equal(soap.checked,true);assert.equal(soap.box,h.inputs[3].box);assert.equal(soap.basketItem.toBuy,1);assert.equal(rice.essential,false);assert.equal(rice.basketItem.toBuy,500);assert.equal(rice.box,h.inputs[1].box);assert.equal(projected.length,4);
});
test('in-store All, To buy and Bought filters keep essentials once at the bottom with search support',()=>{
 const h=fixture(rows());h.organize();let sections=h.draw();assert.deepEqual(sections.map(x=>x.dataset.aisle),['produce','dry','essentials']);assert.deepEqual(sections.at(-1).querySelectorAll('.projected-row').map(x=>x.sourceId),['ess:rolls','ess:soap']);assert.equal(h.content.querySelectorAll('.projected-row').length,4);
 sections=h.draw('left');assert.deepEqual(sections.map(x=>x.dataset.aisle),['produce','dry','essentials']);assert.deepEqual(sections.at(-1).querySelectorAll('.projected-row').map(x=>x.sourceId),['ess:rolls']);
 sections=h.draw('bought');assert.deepEqual(sections.map(x=>x.dataset.aisle),['essentials']);assert.deepEqual(sections[0].querySelectorAll('.projected-row').map(x=>x.sourceId),['ess:soap']);
 sections=h.draw('all','TOILET');assert.deepEqual(sections.map(x=>x.dataset.aisle),['essentials']);assert.equal(h.content.querySelectorAll('.projected-row').length,1);assert.match(sections[0].textContent,/Toilet rolls/);
 sections=h.draw('all','missing item');assert.equal(sections.length,0);assert.match(h.content.textContent,/No matching items/);
});
test('in-store essentials-only and fully bought weeks remain visible in the appropriate views',()=>{
 const h=fixture(rows().filter(x=>x.essential));h.organize();assert.deepEqual(h.draw('left').map(x=>x.dataset.aisle),['essentials']);h.inputs[0].box.checked=true;assert.equal(h.draw('left').length,0);assert.match(h.content.textContent,/All done/);assert.equal(h.draw('bought')[0].querySelectorAll('.projected-row').length,2);
});
test('Copy remaining includes one final essentials group and excludes bought household items',()=>{
 const h=fixture(rows());h.organize();const text=h.context.bb172ShopOutstandingText();assert.ok(text.indexOf('PRODUCE')<text.indexOf('CUPBOARD / PANTRY'));assert.ok(text.indexOf('CUPBOARD / PANTRY')<text.indexOf('WEEKLY ESSENTIALS'));assert.equal(text.match(/WEEKLY ESSENTIALS/g).length,1);assert.match(text,/Toilet rolls — Buy 4 each/);assert.doesNotMatch(text,/Hand soap/);assert.match(text,/Items still to buy: 3/);
});

function overview(h){
 const source=fs.readFileSync(new URL('../bb-beta-six-fixes.js',import.meta.url),'utf8'),start=source.indexOf('  function appendWeeklyEssentials('),end=source.indexOf('\n  }',start);assert.ok(start>=0&&end>start);
 const navigation=[],tab=new Element('button');tab.id='bbKitchenEssentialsTab';let selected=0,refreshed=0;tab.click=()=>selected++;h.doc.append(tab);
 Object.assign(h.context,{node:(tag,cls,text)=>new Element(tag,cls,text),safeText:value=>String(value||'').replace(/\s+/g,' ').trim(),navTo:view=>navigation.push(view),requestAnimationFrame:fn=>fn(),window:{BBKitchenEssentials:{refresh:()=>refreshed++}},doc:h.doc});
 vm.runInContext(source.slice(start,end+4),h.context);
 const container=new Element('section');h.doc.append(container);const render=()=>{container.replaceChildren();h.context.appendWeeklyEssentials(container,h.inputs.map(x=>x.box));return container.querySelector('#bbShopWeeklyEssentials');};
 return {container,render,navigation,selected:()=>selected,refreshed:()=>refreshed};
}
test('mobile overview shows only needed essentials with live quantities and delegates each checkbox to the canonical purchase control',()=>{
 const h=fixture(rows()),v=overview(h);let calls=0;const original=h.inputs[0].box;original.click=()=>{calls++;original.checked=true;};
 let section=v.render();assert.match(section.textContent,/Weekly essentials1 to buy/);assert.equal(section.querySelectorAll('.bb-r6-essential-row').length,1);assert.match(section.textContent,/Toilet rollsBuy 4 each/);assert.doesNotMatch(section.textContent,/Hand soap|Rice|Carrots/);
 const proxy=section.querySelector('input');assert.equal(proxy.attributes['aria-label'],'Mark bought: Toilet rolls');proxy.events.change();assert.equal(calls,1);assert.equal(original.checked,true);proxy.events.change();assert.equal(calls,1,'a stale visible proxy cannot double-toggle an already bought item');
 section=v.render();assert.match(section.textContent,/0 to buyNothing extra to buy/);assert.equal(section.querySelectorAll('input').length,0);
 original.checked=false;h.inputs[0].row.querySelector('.bb321-shop-quantity strong').textContent='Buy 2 each';section=v.render();assert.match(section.textContent,/Toilet rollsBuy 2 each/,'next render reads reconciled quantity, not a cached duplicate');
 h.inputs[0].row.remove();section.querySelector('input').events.change();assert.equal(calls,1,'a detached source control cannot receive a stale purchase intent');
});
test('empty weekly essentials overview offers a direct route to the At home essentials section',()=>{
 const h=fixture(rows().filter(x=>!x.essential)),v=overview(h),section=v.render();assert.match(section.textContent,/Weekly essentials0 to buyNothing extra to buy/);assert.equal(section.querySelectorAll('input').length,0);const edit=section.querySelector('button');assert.equal(edit.textContent,'Update essentials');edit.events.click();assert.deepEqual(v.navigation,['shop']);assert.equal(v.refreshed(),1);assert.equal(v.selected(),1);
});
