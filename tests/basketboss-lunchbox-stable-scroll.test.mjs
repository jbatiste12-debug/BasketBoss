import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const begin=index.indexOf('function bb321LunchboxRenderStable(){');
const end=index.indexOf('function bb321LunchboxBind(app){',begin);
assert.ok(begin>0&&end>begin);
const helper=index.slice(begin,end);
function check(tab,open){
 let node={getBoundingClientRect:()=>({top:-800})},scroll=0,renders=0;
 const panel={open},frames=[];
 const context={tab,document:{getElementById:id=>id==='bb1756Lunchboxes'?panel:id==='bb321SchoolLunchbox'?node:null},
  window:{__bb1757LunchOpen:false,__bb1756LastExtra:null,scrollBy:arg=>{scroll+=arg.top}},
  render:()=>{renders++;node={getBoundingClientRect:()=>({top:-150})};frames.push(()=>{})},
  requestAnimationFrame:fn=>frames.push(fn)};
 vm.createContext(context);vm.runInContext(helper,context);vm.runInContext('bb321LunchboxRenderStable()',context);
 for(const frame of frames)frame();
 return {scroll,renders,flags:context.window};
}
test('lunchbox stays open and keeps its viewport anchor after save',()=>{
 const x=check('week',true);assert.equal(x.scroll,650);assert.equal(x.renders,1);
 assert.equal(x.flags.__bb1757LunchOpen,true);
 assert.equal(x.flags.__bb1756LastExtra,'bb1756Lunchboxes');
});
test('closed lunchboxes and other tabs are not forcibly scrolled',()=>{
 const closed=check('week',false),other=check('shop',true);
 assert.equal(closed.scroll,0);assert.equal(closed.flags.__bb1757LunchOpen,false);
 assert.equal(other.scroll,0);assert.equal(other.flags.__bb1757LunchOpen,false);
});
test('all lunchbox save paths use stable rendering in both mirrored app pages',()=>{
 assert.equal(index,app);
 assert.equal((index.match(/bb321LunchboxRenderStable\(\)/g)||[]).length,9);
 assert.match(index,/if\(!group\.isConnected\)return/);
 assert.match(index,/if\(lunch\.isConnected\)window\.__bb1757LunchOpen=lunch\.open/);
});
