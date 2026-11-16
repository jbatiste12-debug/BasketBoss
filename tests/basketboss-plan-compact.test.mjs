import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../bb-plan-compact.js',import.meta.url),'utf8');
function fixture({opted=true,ready=true}={}){
 class Node{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.id='';this.open=false;this.parentNode=null;this.textContent='';}
  append(...nodes){for(const node of nodes){if(node.parentNode)node.parentNode.children=node.parentNode.children.filter(child=>child!==node);node.parentNode=this;this.children.push(node);}}
  setAttribute(name,value){this.attributes[name]=String(value);}
 }
 const app=new Node(),card=new Node('section'),actions=new Node(),filters=new Node(),mode=new Node(),working=new Node('button'),add=new Node('button'),next=new Node('button'),info=new Node('details'),tabs=new Node();
 app.id='app';card.id='bbpolAutofillCard';filters.className='bbpc-filter-row';actions.className='bbnext-plan-actions';mode.className='bb-pantry-first-controls';add.className='bbnext-plan-secondary';working.id='bb172FillSixDinners';
 actions.append(mode,working,add,next);card.append(filters,actions,info);app.append(card,tabs);
 let openedControl=null;
 const ownerControls=[mode,working,add,next,info,filters];
 for(const [index,node]of ownerControls.entries())node.onclick=()=>index;
 const owners=ownerControls.map(node=>node.parentNode),handlers=ownerControls.map(node=>node.onclick);
 actions.querySelector=selector=>selector===':scope>.bb-pantry-first-controls'?mode:selector===':scope>[data-bb-start-next-week]'?next:selector==='#bb172FillSixDinners'?working:selector.startsWith('.bbnext-plan-secondary')?add:null;
 card.querySelector=selector=>selector===':scope>.bbnext-plan-actions'?actions:selector==='.bbpc-filter-row'?ready?filters:null:selector===':scope>#bbnextPlanAutofill'?info:selector===':scope>.bbpc-more-options'?card.children.find(node=>node.className==='bbpc-more-options')||null:selector.includes('#bbSimpleBudget[open]')?openedControl:null;
 app.querySelector=selector=>selector==='#bbpolAutofillCard'?card:selector==='.bbpc-budget-overview'?new Node():selector==='#bbSimplePlannerTabs'?tabs:null;
 const doc={readyState:'complete',querySelector:()=>opted?app:null,getElementById:id=>id==='app'?app:null,createElement:tag=>new Node(tag)};
 const window={requestAnimationFrame(){},get localStorage(){throw Error('Presentation must not read storage');},get fetch(){throw Error('Presentation must not request data');}};
 vm.runInNewContext(source,{window,document:doc,MutationObserver:class{observe(){}}});
 return {window,app,card,actions,filters,add,controls:ownerControls,owners,handlers,more:()=>card.children.find(node=>node.className==='bbpc-more-options'),openValidation(){openedControl=new Node('details');openedControl.open=true;}};
}

test('More options preserves every existing control parent, handler and live control object',()=>{
 const h=fixture(),more=h.more();assert.ok(more);assert.equal(more.tagName,'details');assert.equal(more.open,false);assert.equal(more.children[0].textContent,'More options');
 assert.equal(more.children[0].attributes['aria-controls'],h.filters.id+' '+h.add.id);
 assert.deepEqual(h.controls.map(node=>node.parentNode),h.owners);
 assert.deepEqual(h.controls.map(node=>node.onclick),h.handlers);
 assert.equal(h.app.dataset.bbCompactHeader,'true');
});
test('refresh is idempotent and preserves the user’s native disclosure choice',()=>{
 const h=fixture(),more=h.more();more.open=true;h.window.BBPlanCompact.refresh();h.window.BBPlanCompact.refresh();
 assert.equal(h.more(),more);assert.equal(more.open,true);assert.equal(h.card.children.filter(node=>node.className==='bbpc-more-options').length,1);
 more.open=false;h.window.BBPlanCompact.refresh();assert.equal(more.open,false);
 assert.deepEqual(h.controls.map(node=>node.parentNode),h.owners);
});
test('existing validation disclosures remain reachable when the owning form opens',()=>{
 const h=fixture();h.openValidation();h.window.BBPlanCompact.refresh();assert.equal(h.more().open,true);
 assert.deepEqual(h.controls.map(node=>node.onclick),h.handlers);
});
test('unopted and incomplete views are left untouched',()=>{
 for(const options of [{opted:false},{ready:false}]){const h=fixture(options);assert.equal(h.more(),undefined);assert.equal(h.app.dataset.bbCompactHeader,undefined);assert.deepEqual(h.controls.map(node=>node.parentNode),h.owners);}
});
