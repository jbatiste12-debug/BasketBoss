import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code=fs.readFileSync(new URL('../bb-membership-compare.js',import.meta.url),'utf8');
function fixture({phase='checking',native=false}={}){
 const nodes=[],calls={settings:0,signin:0,refresh:0,destinations:[]};
 let memberPhase=phase;
 const matches=(node,selector)=>selector.split(',').some(part=>{
  part=part.trim();
  if(part.startsWith('#'))return node.id===part.slice(1);
  if(part.startsWith('.'))return node.className.split(/\s+/).includes(part.slice(1));
  const attr=part.match(/^\[([^\]]+)\]$/);if(attr){const key=attr[1].replace(/^data-/,'').replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());return attr[1].startsWith('data-')?Object.hasOwn(node.dataset,key):node.getAttribute(attr[1])!==null;}
  return node.tagName===part.toUpperCase();
 });
 class Element extends EventTarget{
  constructor(tag){super();this.tagName=tag.toUpperCase();this.id='';this.className='';this.dataset={};this.attrs=new Map();this.children=[];this.ownText='';this.hidden=false;this.open=false;this.disabled=false;nodes.push(this);this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(/\s+/),...names].filter(Boolean))].join(' ');}};}
  set textContent(value){this.ownText=String(value);this.children=[];}
  get textContent(){return this.ownText+this.children.map(child=>child.textContent).join('');}
  setAttribute(name,value){this.attrs.set(name,String(value));if(name==='id')this.id=String(value);}
  getAttribute(name){return name==='id'?(this.id||null):this.attrs.get(name)??null;}
  removeAttribute(name){this.attrs.delete(name);if(name==='open')this.open=false;}
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  querySelectorAll(selector){const result=[];for(const child of this.children){if(matches(child,selector))result.push(child);result.push(...child.querySelectorAll(selector));}return result;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){return matches(this,selector)?this:this.parentElement?.closest(selector)||null;}
  showModal(){this.open=true;}
  close(){this.open=false;this.dispatchEvent(new Event('close'));}
  click(){this.dispatchEvent(new Event('click'));}
  focus(){document.activeElement=this;}
  scrollIntoView(){}
 }
 const document=new EventTarget();document.readyState='complete';document.createElement=tag=>new Element(tag);document.body=new Element('body');document.activeElement=null;
 document.getElementById=id=>nodes.find(node=>node.id===id)||null;
 document.querySelectorAll=selector=>nodes.filter(node=>matches(node,selector));
 const compare=new Element('button');compare.id='bb175Compare';document.body.append(compare);
 const pill=new Element('button');pill.id='bbpolUpgradePill';pill.hidden=true;document.body.append(pill);
 const mount=new Element('section');mount.dataset.bbMembershipComparison='true';document.body.append(mount);
 const settings=new Element('button');settings.id='bbuiOpenSettings';settings.addEventListener('click',()=>calls.settings++);document.body.append(settings);
 const signin=new Element('button');signin.id='cloud-open';signin.addEventListener('click',()=>calls.signin++);document.body.append(signin);
 const win=new EventTarget();win.BBNative={isNative:native};win.location={protocol:native?'capacitor:':'https:',href:native?'capacitor://localhost/index.html':'https://basketboss.co.uk/app',assign:value=>calls.destinations.push(value)};
 win.BasketBossVerifiedPremium={state:()=>memberPhase,refresh:()=>{calls.refresh++;return Promise.resolve(memberPhase==='premium');}};
 vm.runInNewContext(code,{window:win,document,URL,Event});
 const update=next=>{memberPhase=next;document.dispatchEvent(new Event('basketboss:premium-verified'));};
 const clickHeader=()=>{const event=new Event('click',{cancelable:true});Object.defineProperty(event,'target',{value:compare});document.dispatchEvent(event);return event;};
 return {window:win,document,calls,compare,pill,mount,settings,signin,update,clickHeader,api:win.BasketBossMembershipUI,dialog:()=>document.getElementById('bbMembershipCompare')};
}

test('header labels follow verified membership and never call an unknown account Free',()=>{
 const h=fixture();assert.equal(h.compare.textContent,'Checking membership…');assert.equal(h.pill.hidden,false);
 for(const [phase,label]of [['free','FREE · Upgrade to Premium'],['premium','PREMIUM'],['unavailable','Check membership'],['signed_out','FREE · Upgrade to Premium'],['unexpected','Check membership']]){
  h.update(phase);assert.equal(h.compare.textContent,label);assert.equal(h.pill.textContent,label);assert.equal(h.compare.getAttribute('aria-label'),label);
 }
});

test('verified Free header opens a real Free/Premium comparison and preserves the existing web plan route',()=>{
 const h=fixture({phase:'free'}),click=h.clickHeader(),dialog=h.dialog();assert.equal(click.defaultPrevented,true);assert.equal(dialog.open,true);
 const table=dialog.querySelector('table'),rows=table.querySelector('tbody').children.map(row=>row.children.map(cell=>cell.textContent));
 assert.deepEqual(rows.find(row=>row[0]==='Recipe collection'),['Recipe collection','100 recipes','All 500 recipes']);
 assert.deepEqual(rows.find(row=>row[0]==='Weekly meal planning'),['Weekly meal planning','Basic weekly plan','Smart Auto-Fill and advanced filters']);
 assert.ok(rows.some(row=>row[0]==='Advanced shopping trips'&&row[1]==='1 per week with a Free account'&&row[2]==='Unlimited'));
 assert.ok(rows.some(row=>row[0]==='Pantry'&&row[1].includes('Add and manage')));
 assert.ok(rows.some(row=>row[0]==='Ingredients to avoid'&&row[1]==='Preferences for future Auto-Fill'));
 assert.ok(rows.some(row=>row[0]==='Evening Pivot'&&row[2]==='Included'));
 const reduced=rows.find(row=>row[0]==='Yellow sticker & reduced-food tools');assert.equal(reduced[1],'—');assert.match(reduced[2],/UK, Guernsey & Jersey/);assert.match(reduced[2],/Use soon/);
 assert.ok(rows.some(row=>row[0]==='Voice Cook'&&row[2].includes('device')));
 assert.equal(rows.find(row=>row[0]==='AI photo scans')[2],'Up to 5 per day*');assert.equal(rows.find(row=>row[0]==='AI meal ideas')[2],'Up to 10 per day*');
 const link=dialog.querySelector('a');assert.equal(link.href,'pricing-sandbox.html#monthly');assert.equal(link.hidden,false);
 assert.doesNotMatch(dialog.textContent,/39\.99|annual|yearly/i);assert.equal(h.calls.destinations.length,0);assert.equal(h.calls.settings,0);
});

test('unknown membership checks instead of presenting an upgrade or pretending Free',()=>{
 const h=fixture({phase:'unavailable'});h.clickHeader();const dialog=h.dialog(),link=dialog.querySelector('a');assert.equal(dialog.open,true);assert.equal(link.hidden,true);assert.equal(h.calls.refresh,1);
 const check=dialog.querySelector('.bb-membership-compare-actions').children[1];assert.equal(check.textContent,'Check membership');assert.equal(check.disabled,false);check.click();assert.equal(h.calls.refresh,2);
 h.update('checking');assert.equal(check.textContent,'Checking membership…');assert.equal(check.disabled,true);assert.equal(link.hidden,true);
});

test('signed-out membership check delegates to the existing account form',()=>{
 const h=fixture({phase:'signed_out'});assert.equal(h.compare.textContent,'FREE · Upgrade to Premium');h.clickHeader();const dialog=h.dialog();assert.equal(dialog.querySelector('a').hidden,false);assert.match(dialog.textContent,/using Free access/);dialog.querySelector('.bb-membership-compare-actions').children[1].click();
 assert.equal(h.calls.signin,1);assert.equal(dialog.open,false);assert.equal(h.calls.destinations.length,0);
});

test('Premium header opens existing management settings and never opens pricing',()=>{
 const h=fixture({phase:'premium'});h.clickHeader();assert.equal(h.calls.settings,1);assert.equal(h.dialog(),null);assert.deepEqual(h.calls.destinations,[]);assert.equal(h.mount.hidden,true);
});

test('native membership state uses the bundled Apple plan screen without web checkout',()=>{
 const h=fixture({native:true});assert.equal(h.compare.textContent,'Checking membership…');h.api.setNativeState('free');assert.equal(h.compare.textContent,'FREE · Upgrade to Premium');
 h.clickHeader();assert.deepEqual(h.calls.destinations,['capacitor://localhost/pricing-sandbox.html']);assert.equal(h.dialog(),null);
 h.api.setNativeState('premium');assert.equal(h.compare.textContent,'PREMIUM');assert.equal(h.mount.hidden,true);
 h.api.setNativeState('unavailable');assert.equal(h.compare.textContent,'Check membership');
});
