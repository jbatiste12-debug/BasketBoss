import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const libraryStart=index.indexOf('const BB321Lunch=(()=>{');
const libraryEnd=index.indexOf('})();',libraryStart);
const actionStart=index.indexOf('function bb172CopySavedLunchAcrossSchoolDays(');
const actionEnd=index.indexOf('\nfunction bb172RenderLunchCustom(){',actionStart);
assert.ok(libraryStart>=0&&libraryEnd>libraryStart&&actionStart>libraryEnd&&actionEnd>actionStart,
 'School lunchbox logic must be present');
const source=index.slice(libraryStart,libraryEnd+5)+'\n'+index.slice(actionStart,actionEnd);
function harness(seed,{approve=true,canSave=true}={}){
 const ctx={console,window:{confirm:()=>approve},renderCount:0,refreshCount:0,writes:0,notices:[],seed,canSave};
 vm.createContext(ctx);
 vm.runInContext(source+[
  'let bb321LunchState=BB321Lunch.normaliseLunchbox(seed);',
  'const bb321StoreLunch=next=>{if(!canSave)return false;bb321LunchState=BB321Lunch.normaliseLunchbox(next);writes++;return true;};',
  'const render=()=>{renderCount++};',
  'const bb172RefreshLunchbox=()=>{refreshCount++;render();};',
  'const notify=text=>notices.push(text);'
 ].join('\n'),ctx);
 return {
  run:day=>vm.runInContext('bb172CopySavedLunchAcrossSchoolDays('+JSON.stringify(day)+')',ctx),
  // Deserialize in the test realm so equality checks compare data rather than
  // the prototypes of arrays created by a separate vm context.
  state:()=>JSON.parse(vm.runInContext('JSON.stringify(bb321LunchState)',ctx)),
  shop:()=>JSON.parse(vm.runInContext('JSON.stringify(BB321Lunch.lunchRequirements(bb321LunchState))',ctx)),
  ctx
 };
}
const monday=[
 {name:'Bread slices',qty:2,unit:'each'}, {name:'Tortilla wraps',qty:1,unit:'each'},
 {name:'Cheddar cheese',qty:25,unit:'g'}, {name:'Tuna',qty:40,unit:'g'},
 {name:'Apples',qty:1,unit:'each'}, {name:'Oranges',qty:1,unit:'each'}
];
const initial={children:4,days:{Monday:monday},menus:{Monday:'A school lunch'}};

test('checking all days copies saved Monday lunch to Friday with correct shopping quantities',()=>{
 const h=harness(initial);
 assert.equal(h.run('Monday'),true);
 for(const day of ['Monday','Tuesday','Wednesday','Thursday','Friday'])
  assert.deepEqual(h.state().days[day],monday,day);
 assert.equal(h.state().children,4);
 assert.equal(h.ctx.writes,1);
 assert.equal(h.ctx.renderCount,1);
 assert.equal(h.ctx.refreshCount,1);
 assert.equal(h.shop().find(x=>x.name==='Bread slices').qty,40,'2 slices * 4 children * 5 days');
});
test('different saved weekday lunch is protected if user declines replacement',()=>{
 const h=harness({...initial,days:{...initial.days,Wednesday:[{name:'Fruit',qty:1,unit:'each'}]}},{approve:false});
 assert.equal(h.run('Monday'),false);
 assert.equal(h.ctx.writes,0);
 assert.equal(h.ctx.refreshCount,0);
 assert.deepEqual(h.state().days.Wednesday,[{name:'Fruit',qty:1,unit:'each'}]);
});
test('failed save leaves existing and empty school lunches unchanged',()=>{
 const h=harness(initial,{canSave:false});
 assert.equal(h.run('Monday'),false);
 assert.equal(h.ctx.writes,0);
 assert.equal(h.ctx.refreshCount,0);
 assert.deepEqual(h.state().days.Tuesday,[]);
 assert.deepEqual(h.state().days.Monday,monday);
});
test('checking before choosing foods does not create phantom lunch plans',()=>{
 const h=harness({children:4,days:{},menus:{}});
 assert.equal(h.run('Monday'),true);
 assert.equal(h.ctx.writes,0);
 assert.equal(h.ctx.refreshCount,0);
 assert.deepEqual(h.state().days.Friday,[]);
});
test('production entrypoints match and checkbox triggers the saved-lunch copy',()=>{
 assert.equal(index,app);
 assert.match(index,/BB_LUNCH_COPY_WEEK_V1/);
 assert.match(index,/if\(!bb172CopySavedLunchAcrossSchoolDays\(sourceDay\)\)/);
 assert.match(index,/if\(!bb172AllDays\)return;/);
});
