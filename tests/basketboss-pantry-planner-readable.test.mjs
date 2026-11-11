import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const formatter=createRequire(import.meta.url)('../bb-shop-purchase-ui.js');
const html=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const start=html.indexOf('function bbPantryPlannerModal(){');
const end=html.indexOf('function bbPantryPlannerAttach(',start);
assert.ok(start>=0&&end>start,'the existing planner modal remains available');
const modalSource=html.slice(start,end);

function freeze(value){
 if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}
 return value;
}

function fixture(data,{withFormatter=true,result={ok:true,added:[{day:'Monday'}]}}={}){
 const all=(node=doc.body)=>[node,...node.children.flatMap(child=>all(child))];
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.style={};this.attributes=new Map();this.events=new Map();this._text='';this.disabled=false;this.checked=false;this.open=false;}
  append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
  set textContent(value){for(const child of this.children)child.parentNode=null;this.children=[];this._text=String(value);}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  getAttribute(name){return this.attributes.get(name)??null;}
  addEventListener(name,handler,options={}){const handlers=this.events.get(name)||[];handlers.push({handler,once:options.once===true});this.events.set(name,handlers);}
  dispatch(name){for(const event of [...(this.events.get(name)||[])]){event.handler({target:this});if(event.once)this.events.set(name,this.events.get(name).filter(value=>value!==event));}}
  click(){if(!this.disabled)this.onclick?.({target:this});}
  showModal(){this.open=true;}
  close(){this.open=false;this.dispatch('close');}
 }
 const doc={createElement:tag=>new Element(tag),getElementById:id=>all().find(node=>node.id===id)||null};doc.body=new Element('body');
 const calls=[],notifications=[];
 const context=vm.createContext({document:doc,window:withFormatter?{BBShopPurchaseUI:formatter}:{},bb307Market:'Guernsey',bbPantryRecipeMatches:()=>data,
  bbPantryPlannerPopulate:candidates=>{calls.push(candidates);return result;},notify:message=>notifications.push(message)});
 vm.runInContext(modalSource,context);
 return {doc,all,calls,notifications,open:()=>context.bbPantryPlannerModal(),button:label=>all().find(node=>node.tagName==='BUTTON'&&node.textContent===label)};
}

function fractionalData(){return freeze({
 stock:[{id:'rice|g',name:'Rice',qty:533.333333,unit:'g'},{id:'reserve|g',name:'Tiny reserve',qty:.000001,unit:'g'}],
 questionable:[{id:'flour|ml',name:'Flour',qty:1.333333,unit:'ml'}],
 recipes:[{id:'rice-dinner',name:'Rice dinner',matched:[{id:'rice|g',name:'Rice',qty:666.667,unit:'g'}]},
  {id:'rice-lunch',name:'Rice lunch',matched:[{id:'rice|g',name:'Rice',qty:233.333333,unit:'g'}]}]
});}

for(const withFormatter of [true,false])test('pantry planner renders readable quantities without changing exact data '+(withFormatter?'with the shared formatter':'before the formatter loads'),()=>{
 const data=fractionalData(),before=JSON.stringify(data),h=fixture(data,{withFormatter});h.open();
 const dialog=h.doc.getElementById('bbPantryPlannerDialog');assert.ok(dialog);assert.equal(dialog.open,true);
 const text=dialog.textContent;
 assert.match(text,/Pantry detected: Rice 533 g · Tiny reserve <1 g/);
 assert.match(text,/Check units before matching: Flour \(1 ml\)/);
 assert.match(text,/Uses Pantry: Rice \(667 g\)/);
 assert.doesNotMatch(text,/\d+\.\d{3,}|NaN|Infinity/);
 assert.equal(h.calls.length,0,'reviewing suggestions must not populate or deduct stock');
 assert.equal(JSON.stringify(data),before);
 assert.equal(data.stock[0].qty,533.333333);assert.equal(data.questionable[0].qty,1.333333);assert.equal(data.recipes[0].matched[0].qty,666.667);assert.equal(data.stock[1].qty,.000001);
});

test('pantry planner keeps the existing dialog ID, checkbox selection and Populate Planner handler',()=>{
 const data=fractionalData(),before=JSON.stringify(data),h=fixture(data);h.open();
 const original=h.doc.getElementById('bbPantryPlannerDialog');h.open();
 const dialog=h.doc.getElementById('bbPantryPlannerDialog');assert.notEqual(dialog,original);assert.equal(original.parentNode,null);
 assert.equal(h.all().filter(node=>node.id==='bbPantryPlannerDialog').length,1);
 const checkboxes=h.all().filter(node=>node.tagName==='INPUT'&&node.type==='checkbox');assert.equal(checkboxes.length,2);assert.equal(checkboxes[0].checked,true);assert.equal(checkboxes[1].checked,true);
 checkboxes[0].checked=false;checkboxes[0].dispatch('change');
 const populate=h.button('Populate Planner');assert.equal(populate.disabled,false);populate.click();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].length,1);assert.equal(h.calls[0][0],data.recipes[1],'the original selected recipe object reaches the existing handler');
 assert.equal(h.calls[0][0].matched[0].qty,233.333333);assert.equal(JSON.stringify(data),before);
 assert.equal(h.doc.getElementById('bbPantryPlannerDialog'),null);assert.equal(dialog.open,false);
 assert.deepEqual(h.notifications,['✨ 1 Pantry-inspired meals added to empty days. Existing meals preserved.']);
});

test('planner failure and cancel retain source quantities and empty suggestions disable population',()=>{
 const data=fractionalData(),before=JSON.stringify(data),h=fixture(data,{result:{ok:false,reason:'Planner save failed. Your existing week was restored.'}});h.open();
 h.button('Populate Planner').click();assert.match(h.doc.body.textContent,/Planner save failed/);assert.ok(h.doc.getElementById('bbPantryPlannerDialog'));assert.equal(h.notifications.length,0);
 h.button('Cancel').click();assert.equal(h.doc.getElementById('bbPantryPlannerDialog'),null);assert.equal(JSON.stringify(data),before);
 const empty=fixture(freeze({stock:[],questionable:[],recipes:[]}));empty.open();
 assert.match(empty.doc.body.textContent,/No measured Pantry ingredients found/);assert.match(empty.doc.body.textContent,/No recipes match your Pantry/);
 assert.equal(empty.button('Populate Planner').disabled,true);empty.button('Populate Planner').click();assert.equal(empty.calls.length,0);
});
