import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const start=html.indexOf('function bb172StaplesPanel(app){'),end=html.indexOf('\nconst BB172_LUNCH_CHIPS=',start);
assert.ok(start>0&&end>start);
function fixture(view){
 const nodes=[],placed=[],saved=[],state={},grid={children:[],append(node){this.children.push(node);}},count={};let refreshes=0;
 const element=tag=>({tag,children:[],attrs:{},events:{},append(...children){this.children.push(...children);},setAttribute(key,value){this.attrs[key]=value;},addEventListener(key,fn){this.events[key]=fn;},querySelector(selector){return selector==='.bb172-staple-grid'?grid:count;}});
 const document={body:{dataset:{bbnextView:view}},getElementById:()=>null,createElement:tag=>{const n=element(tag);nodes.push(n);return n;},querySelector:()=>({click(){refreshes++;}})};
 const ctx=vm.createContext({window:{bb172ActiveTab:'shop'},document,BB172_STAPLES:[['salt','🧂 Salt'],['rice','🍚 Rice']],BB172_STAPLES_KEY:'legacy-staples',bb172StapleSaved:()=>state,bb172SaveObject:(key,value)=>{saved.push({key,value});return true;}});
 vm.runInContext(html.slice(start,end),ctx);
 const app={querySelector:()=>null,prepend:node=>placed.push(node)};ctx.bb172StaplesPanel(app);
 return {nodes,placed,saved,grid,refreshes:()=>refreshes};
}
test('actual Shop does not construct legacy cupboard thumbnails even with the old Shop alias',()=>{
 const h=fixture('shop-list');assert.equal(h.nodes.length,0);assert.equal(h.placed.length,0);assert.equal(h.saved.length,0);
});
test('At home retains its cupboard controls and their existing action',()=>{
 const h=fixture('shop');assert.equal(h.placed.length,1);assert.equal(h.grid.children.length,2);
 h.grid.children[0].events.click();assert.equal(h.saved.length,1);assert.equal(h.saved[0].value.salt,true);assert.equal(h.refreshes(),1);
});
test('other primary views never receive cupboard thumbnails from the legacy alias',()=>{
 for(const view of ['week','discover','cook',undefined])assert.equal(fixture(view).nodes.length,0);
});
