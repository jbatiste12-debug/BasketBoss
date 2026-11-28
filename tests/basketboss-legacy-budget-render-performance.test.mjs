import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const baseline=execFileSync('git',['show','c05180b1d28b4c30d2ae7b272faeab0f0565e546:app.html'],{cwd:root,encoding:'utf8',maxBuffer:8e6});
const source=process.env.BB_LEGACY_BUDGET_BASELINE==='1'?baseline:fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const body=text=>text.slice(text.indexOf('function bb172RenderBudget('),text.indexOf('function bb172ImageMark('));

function fixture({tab='week',classes=[],modern=false,existing=false,section=false,total=94.35,pending=0,target=200,throws=false,save=true}={},text=source){
 const stats={summaries:0,warnings:0,creates:0,inserts:0,writes:0,bindings:0,saves:[]};
 const input={value:String(target),addEventListener(type,callback){assert.equal(type,'change');this.change=callback;stats.bindings++;}};
 let html='',budget=existing?makeBudget():null;
 function makeBudget(){return {dataset:{},querySelector(selector){assert.equal(selector,'#bb172BudgetInput');return input;},set innerHTML(value){html=value;stats.writes++;},get innerHTML(){return html;}};}
 const app={classList:{contains:value=>classes.includes(value)},firstChild:null,
  querySelector(selector){if(selector==='.bb1748-planner-budget,.bbnext-plan-budget')return modern?{}:null;if(selector==='#bb172WeeklyBudget')return budget;if(selector==='.section-head')return section?{insertAdjacentElement(where,node){assert.equal(where,'afterend');budget=node;stats.inserts++;}}:null;throw Error('Unexpected selector '+selector);},
  insertBefore(node,before){assert.equal(before,null);budget=node;stats.inserts++;}};
 const context=vm.createContext({tab,bb172BudgetTarget:target,
  console:{warn(){stats.warnings++;}},
  document:{createElement(tag){assert.equal(tag,'section');stats.creates++;return makeBudget();}},
  bb321WeeklySummary(){stats.summaries++;if(throws)throw Error('Unavailable');return {total,pending};},
  bb172Money:n=>'£'+Number(n).toFixed(2),
  bb172SaveBudget(value){stats.saves.push(value);if(save)context.bb172BudgetTarget=value;return save;}});
 vm.runInContext(body(text),context);
 return {context,app,input,stats,run(){context.bb172RenderBudget(app);},state(){return {stats:{...stats,saves:[...stats.saves]},html,input:input.value,signature:budget?.dataset.bb172Signature,target:context.bb172BudgetTarget};}};
}

for(const owner of ['bb1748-plan-active','bb1756-planner-flow'])for(const node of ['.bb1748-planner-budget','.bbnext-plan-budget'])test(owner+' skips only the retired hidden meter when '+node+' is present',()=>{
 const f=fixture({classes:[owner],modern:true});f.run();assert.equal(f.stats.summaries,0);assert.equal(f.stats.creates,0);assert.equal(f.stats.writes,0);
});

test('At home cupboard owner skips its already hidden retired budget meter',()=>{
 const f=fixture({tab:'shop',classes:['bb1756-cupboard-only']});f.run();assert.equal(f.stats.summaries,0);assert.equal(f.stats.creates,0);
});

for(const options of [
 {label:'Plan without current owner',tab:'week',modern:false},
 {label:'Plan owner flag before modern budget mounts',tab:'week',classes:['bb1748-plan-active']},
 {label:'second Plan owner flag before modern budget mounts',tab:'week',classes:['bb1756-planner-flow']},
 {label:'unowned modern budget node',tab:'week',modern:true},
 {label:'ordinary Shop fallback',tab:'shop'},
 {label:'stale cupboard flag on Plan',tab:'week',classes:['bb1756-cupboard-only'],modern:true}
])test(options.label+' preserves original render and current calculations',()=>{
 const current=fixture({...options,pending:2,total:225.5,existing:true}),old=fixture({...options,pending:2,total:225.5,existing:true},baseline);
 current.run();old.run();assert.deepEqual(current.state(),old.state());assert.equal(current.stats.summaries,1);
 assert.match(current.state().html,/£225\.50/);assert.match(current.state().html,/2 unpriced shopping items/);assert.match(current.state().html,/bb172-over/);
});

test('non-budget tabs retain their original early exits',()=>{
 for(const tab of ['overview','discover','cook','at-home','settings']){const f=fixture({tab});f.run();assert.equal(f.stats.summaries,0);assert.equal(f.stats.creates,0);}
});

test('fallback signature still avoids duplicate DOM while recalculating current summary',()=>{
 const f=fixture({section:true});f.run();f.run();assert.deepEqual({summaries:f.stats.summaries,creates:f.stats.creates,inserts:f.stats.inserts,writes:f.stats.writes,bindings:f.stats.bindings},{summaries:2,creates:1,inserts:1,writes:1,bindings:1});
});

for(const save of [true,false])test('fallback budget input keeps original '+(save?'successful save and redraw':'failed save and input restoration'),()=>{
 const current=fixture({save}),old=fixture({save},baseline);
 for(const f of [current,old]){f.run();f.input.value='250';f.input.change();}
 assert.deepEqual(current.state(),old.state());assert.deepEqual(current.stats.saves,[250]);assert.equal(current.input.value,save?'250':'200');assert.equal(current.stats.summaries,save?2:1);
});

test('fallback summary error still warns once without creating partial budget UI',()=>{
 const f=fixture({throws:true});f.run();assert.equal(f.stats.summaries,1);assert.equal(f.stats.warnings,1);assert.equal(f.stats.creates,0);
});

test('retired-meter gate is the only change in the complete renderer and its original input handler',()=>{
 const added=" // The current owners hide this retired meter with their existing CSS.\n // Keep the original fallback until the current Plan budget is actually present.\n if(tab==='week'&&(app.classList.contains('bb1748-plan-active')||app.classList.contains('bb1756-planner-flow'))&&app.querySelector('.bb1748-planner-budget,.bbnext-plan-budget'))return;\n if(tab==='shop'&&app.classList.contains('bb1756-cupboard-only'))return;\n";
 if(process.env.BB_LEGACY_BUDGET_BASELINE!=='1')assert.equal(body(source).replace(added,''),body(baseline));
});
