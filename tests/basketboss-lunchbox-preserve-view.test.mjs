import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const begin=index.indexOf('/* BB_LUNCHBOX_STAY_IN_VIEW_20261031:');
const end=index.indexOf('/* BB_LUNCH_COPY_WEEK_V1:',begin);
assert.ok(begin>=0&&end>begin,'Lunchbox view helper must exist');
const code=index.slice(begin,end);

function build(tab='week'){
 const scrolls=[],frames=[];
 let renders=0;
 const section={open:false};
 const window={scrollY:1900,__bb1757LunchOpen:false,scrollTo:x=>scrolls.push(x)};
 const document={getElementById:id=>id==='bb1756Lunchboxes'?section:null};
 const ctx={window,document,tab,render:()=>renders++,requestAnimationFrame:fn=>frames.push(fn)};
 vm.createContext(ctx);
 vm.runInContext(code,ctx);
 return {refresh:ctx.bb172RefreshLunchbox,window,section,scrolls,frames,
  get renders(){return renders}};
}
test('app and index remain mirrored; stale accordion toggles are ignored',()=>{
 assert.equal(index,app);
 assert.match(index,/if\(group\.isConnected&&group\.open\)/);
 assert.match(index,/if\(lunch\.isConnected\)window\.__bb1757LunchOpen/);
});
test('lunchbox refresh reopens the section and restores the scroll position',()=>{
 const h=build();h.refresh();
 assert.equal(h.renders,1);
 assert.equal(h.window.__bb1757LunchOpen,true);
 assert.equal(h.window.__bb1756LastExtra,'bb1756Lunchboxes');
 assert.equal(h.frames.length,1);h.frames[0]();
 assert.equal(h.section.open,true);
 assert.equal(h.scrolls[0].top,1900);
 assert.equal(h.scrolls[0].behavior,'instant');
});
test('other tabs use the original render without forced scrolling',()=>{
 const h=build('shop');h.refresh();
 assert.equal(h.renders,1);assert.equal(h.frames.length,0);
 assert.equal(h.scrolls.length,0);
});
test('all lunch save surfaces use the lunchbox-preserving redraw',()=>{
 assert.match(index,/if\(bb321StoreLunch\(next\)\)bb172RefreshLunchbox\(\)/);
 assert.match(index,/if\(bb321StoreLunch\(next\)\)\{bb321LunchDay=day;bb172RefreshLunchbox\(\)/);
 assert.match(index,/if\(bb321StoreLunch\(next\)\)\{bb172RefreshLunchbox\(\);bb172Msg\('Monday lunch repeated/);
 assert.match(index,/if\(bb321StoreLunch\(validated\)\)\{bb172RefreshLunchbox/);
 assert.match(index,/if\(bb321StoreLunch\(\{\.\.\.bb321LunchState,children:n\}\)\)\{bb172RefreshLunchbox/);
 assert.match(index,/if\(bb321StoreLunch\(next\)\)\{bb172RefreshLunchbox\(\);notify\(\(allSet/);
});
