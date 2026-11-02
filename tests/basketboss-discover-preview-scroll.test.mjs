import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('let bbDiscoverScrollRequest=0;'),end=html.indexOf('function renderDiscover(app){',start);
assert.ok(start>0&&end>start);
function fixture({reduced=false,recipeId='pasta'}={}){
 let frames=[],overlay=false;
 const events=[],card={dataset:{bbFeaturedRecipe:recipeId},style:{},scrollIntoView:options=>events.push({type:'preview',options})};
 const header={position:'sticky',getBoundingClientRect:()=>({bottom:68})},dock={position:'fixed',getBoundingClientRect:()=>({height:76})};
 const document={querySelector(selector){return selector==='#app .bb-featured-card'?card:selector==='.shell > header.top'?header:selector==='.shell .tabs'?dock:selector==='.cook-overlay'&&overlay?{}:null;}};
 const context=vm.createContext({document,tab:'discover',selectedRecipe:null,window:{matchMedia:()=>({matches:reduced})},getComputedStyle:node=>({position:node.position}),requestAnimationFrame:fn=>frames.push(fn)});
 vm.runInContext(html.slice(start,end),context);
 return {card,events,context,overlay:()=>{overlay=true;},reveal:id=>vm.runInContext('bbDiscoverRevealRecipe('+JSON.stringify(id)+')',context),frame(){const pending=frames;frames=[];for(const fn of pending)fn();},restore(){frames.push(()=>events.push({type:'restore'}));}};
}

test('selected Discover preview scroll runs after render restores the old gallery position',()=>{
 const h=fixture();h.restore();h.reveal('pasta');assert.deepEqual(h.events,[]);h.frame();assert.deepEqual(h.events.map(event=>event.type),['restore']);h.frame();assert.deepEqual(h.events.map(event=>event.type),['restore','preview']);
 assert.equal(h.card.style.scrollMarginTop,'80px');assert.equal(h.card.style.scrollMarginBottom,'88px');assert.equal(h.events[1].options.block,'start');assert.equal(h.events[1].options.inline,'nearest');assert.equal(h.events[1].options.behavior,'smooth');
});

test('a newer selection wins and reduced motion uses an immediate featured-card reveal',()=>{
 const h=fixture({reduced:true,recipeId:'second'});h.reveal('first');h.reveal('second');h.frame();h.frame();assert.equal(h.events.length,1);assert.equal(h.events[0].options.behavior,'instant');
});

test('leaving Discover or opening Cook before the deferred reveal cancels the page movement',()=>{
 for(const change of [h=>vm.runInContext("tab='week'",h.context),h=>vm.runInContext("selectedRecipe={id:'pasta'}",h.context),h=>h.overlay()]){
  const h=fixture();h.reveal('pasta');change(h);h.frame();h.frame();assert.deepEqual(h.events,[]);
 }
});

test('a rerender that changes the featured recipe cannot scroll an outdated selection into view',()=>{
 const h=fixture();h.reveal('pasta');h.card.dataset.bbFeaturedRecipe='another-recipe';h.frame();h.frame();assert.deepEqual(h.events,[]);
});
