import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../bb-food-visuals.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../bb-food-visuals.css',import.meta.url),'utf8');
function fixture(scriptURL='https://basketboss.co.uk/bb-food-visuals.js?v=2',scriptSource=source){
 const listeners=new Map(),document={currentScript:{src:scriptURL},addEventListener(type,handler,capture){assert.equal(capture,true);listeners.set(type,handler);}};
 const window={document,location:{href:new URL('app.html',scriptURL).href}};
 vm.runInNewContext(scriptSource,{window,URL});
 return {api:window.BBFoodVisuals,listeners,window};
}
const {api}=fixture();

// Extract independently from the real picker definitions, without evaluating
// the app or duplicating the inline renderer manifest as a test fixture.
function literal(text,name,context={}){
 const marker='const '+name+'=',start=text.indexOf(marker);assert.notEqual(start,-1,'Missing builtin '+name);
 let position=start+marker.length,begin=position,depth=0,quote=null,escaped=false;
 for(;position<text.length;position++){
  const character=text[position];
  if(quote){if(escaped)escaped=false;else if(character==='\\')escaped=true;else if(character===quote)quote=null;continue;}
  if(character==='"'||character==="'"){quote=character;continue;}
  if(character==='['||character==='{')depth++;
  if(character===']'||character==='}')depth--;
  if(depth===0)return vm.runInNewContext('('+text.slice(begin,position+1)+')',context);
 }
 throw Error('Unclosed builtin '+name);
}
function builtinNames(){
 const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
 const main=read('index.html'),cook=read('make-a-meal.js'),kitchen=read('shopping-inventory.js'),records=[];
 const items=literal(kitchen,'ITEMS');
 for(const [file,groups,context] of [['make-a-meal.js',literal(cook,'FOODS'),'cook'],['shopping-inventory.js',literal(kitchen,'BB5_FOODS',{ITEMS:items}),'pantry']])
  for(const [group,list] of Object.entries(groups))for(const [,name]of list)records.push({file,group,name,context});
 for(const [group,list]of Object.entries(literal(main,'BB172_DEFAULT_CHOICES')))for(const [,,name]of list)records.push({file:'index.html',group,name,context:'lunch'});
 for(const constant of ['BB172_PANTRY_PRESETS','BB172_FRIDGE_PRESETS'])for(const [,,name]of literal(main,constant))records.push({file:'index.html',group:constant,name,context:'pantry'});
 for(const item of literal(main,'BB172_LUNCH_CHIPS'))records.push({file:'index.html',group:'BB172_LUNCH_CHIPS',name:item.ingredients[0][0],context:'lunch'});
 return records;
}

test('every real Kitchen, Cook and School Lunch builtin has an exact shared photograph',()=>{
 const records=builtinNames();assert.ok(records.length>=198,'Picker coverage unexpectedly shrank');
 for(const record of records){
  const food=api.resolve(record.name,record.context);
  assert.ok(food,JSON.stringify(record));
  assert.match(api.html(record.name,{context:record.context}),/class="bb-food-visual__sprite"/);
 }
 assert.ok(api.foods.length>=78);assert.equal(new Set(api.foods.map(food=>food.id)).size,api.foods.length);
});

test('matching preserves cooked, dry, frozen and canned distinctions without fuzzy substitutions',()=>{
 assert.equal(api.resolve(' Rice ').state,'dry');assert.equal(api.resolve('DRY   RICE').id,'rice');assert.equal(api.resolve('ＲＩＣＥ').id,'rice');
 assert.equal(api.resolve('Cooked rice'),null);assert.equal(api.resolve('rice pudding'),null);
 assert.equal(api.resolve('Cooked chicken').id,'cooked-chicken');assert.equal(api.resolve('Cooked chicken').state,'cooked-chilled');
 assert.equal(api.resolve('Frozen chicken').state,'frozen-raw');assert.notEqual(api.resolve('Frozen chicken').id,api.resolve('Cooked chicken').id);
 assert.equal(api.resolve('Raw chicken breast'),null);assert.equal(api.resolve('chicken soup'),null);
 assert.equal(api.resolve('Chicken'),null);assert.equal(api.resolve('Chicken','lunch').id,'cooked-chicken');assert.equal(api.resolve('Chicken',{context:'school-lunch'}).id,'cooked-chicken');assert.equal(api.resolve('Chicken','pantry'),null);
 assert.equal(api.resolve('Pepper').id,'black-pepper');assert.equal(api.resolve('Peppers').id,'peppers');
 assert.equal(api.resolve('Tuna').state,'canned');assert.equal(api.resolve('Tuna steak'),null);
 assert.equal(api.resolve('Tinned beans').id,'tinned-beans');assert.equal(api.resolve('Tinned beans','legacy-pantry').id,'baked-beans');
 assert.notEqual(api.resolve('Frozen broccoli').id,api.resolve('Broccoli').id);
});

test('known photographs use all six correct cropped cells and native-local lazy image URLs',()=>{
 for(const scriptURL of ['https://basketboss.co.uk/bb-food-visuals.js?v=2','https://preview.example/app/bb-food-visuals.js','capacitor://localhost/bb-food-visuals.js']){
  const {api:local}=fixture(scriptURL),base=new URL('./',scriptURL);
  for(const food of local.foods){
   const output=local.html(food.name,{variant:'chip'}),expected=new URL(food.atlas,base).href;
   assert.ok(output.includes('src="'+expected+'"'),food.name);assert.match(output,/alt="" loading="lazy" decoding="async" width="1536" height="1024"/);
   assert.ok(output.includes('style="left:'+(-100*(food.cell%3))+'%;top:'+(-100*Math.floor(food.cell/3))+'%"'));
   assert.match(output,/bb-food-visual--chip/);assert.match(output,/aria-hidden="true"/);
  }
  assert.deepEqual([...new Set(local.foods.map(food=>food.cell))].sort(),[0,1,2,3,4,5]);
 }
 assert.doesNotMatch(source,/\bfetch\s*\(|XMLHttpRequest|https:\/\/(?:images|cdn)\./);
});

test('custom unknown emoji stays escaped and user text cannot inject names, URLs, attributes or styles',()=>{
 const attack='"><img src=x onerror=alert(1)>',output=api.html('<script>private custom name</script>',{emoji:attack,variant:'chip" onclick="evil',context:'https://evil.example/'});
 assert.match(output,/bb-food-visual--fallback/);assert.match(output,/bb-food-visual--tile/);assert.match(output,/&lt;img/);assert.doesNotMatch(output,/<img|<script|private custom name|class="[^\"]*onclick=/);
 assert.equal(api.html('Custom family food',{emoji:'🥑'}).includes('🥑'),true);
 assert.doesNotMatch(api.html('Rice',{image:'https://evil.example/photo.png',url:'javascript:alert(1)',className:'" onerror="evil'}),/evil\.example|javascript:|onerror=/);
 assert.equal((api.html('Custom',{emoji:'x'.repeat(10000)}).match(/x/g)||[]).length,32);
});

test('single captured image listeners replace neutral loading plates with art or a safe failure fallback',()=>{
 const {api:local,listeners,window}=fixture(),classes=new Set(['bb-food-visual','bb-food-visual--photo']);
 const holder={classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)}};
 const image={tagName:'IMG',classList:{contains:value=>value==='bb-food-visual__sprite'},hasAttribute:name=>name==='data-bb-food-sprite',closest:selector=>selector==='.bb-food-visual'?holder:null};
 assert.equal(listeners.size,2);listeners.get('load')({target:image});assert.ok(classes.has('bb-food-visual--ready'));assert.ok(!classes.has('bb-food-visual--failed'));
 listeners.get('error')({target:image});assert.ok(classes.has('bb-food-visual--failed'));assert.ok(!classes.has('bb-food-visual--ready'));
 const before=[...classes];listeners.get('error')({target:{tagName:'IMG',classList:{contains:()=>false}}});assert.deepEqual([...classes],before);
 vm.runInNewContext(source,{window,URL});assert.equal(window.BBFoodVisuals,local);assert.equal(listeners.size,2);
 assert.match(css,/bb-food-visual--ready[^}]*opacity:1/);assert.match(css,/bb-food-visual--failed[^}]*bb-food-visual__fallback[^}]*display:grid/);
});

test('shared metadata is immutable and styling changes only decorative art with stable tile sizes',()=>{
 assert.ok(Object.isFrozen(api));assert.ok(Object.isFrozen(api.foods));assert.ok(Object.isFrozen(api.layout));
 for(const food of api.foods){assert.ok(Object.isFrozen(food));assert.ok(Object.isFrozen(food.aliases));assert.ok(Object.isFrozen(food.contextAliases));}
 assert.match(css,/\.bb-food-visual\.bb-food-visual\{[^}]*width:64px;height:64px/);assert.match(css,/bb-food-visual--chip\{width:48px;height:48px/);
 assert.match(css,/width:300%!important;height:200%!important/);assert.match(css,/bb-food-visual__crop\{[^}]*overflow:hidden/);
 assert.match(css,/button\[aria-pressed="true"\] \.bb-food-visual::after/);assert.match(css,/pointer-events:none/);
 assert.doesNotMatch(css,/(?:^|\n)(?:body|html|\.tile\s*\{|button\s*\{|#app\s*\{)/);
});

function losslessWebPHeader(bytes,name){
 assert.equal(bytes.toString('ascii',0,4),'RIFF',name);assert.equal(bytes.toString('ascii',8,12),'WEBP',name);
 assert.equal(bytes.readUInt32LE(4)+8,bytes.length,'Complete WebP RIFF size: '+name);
 let extended=null,lossless=null;
 for(let offset=12;offset+8<=bytes.length;){
  const kind=bytes.toString('ascii',offset,offset+4),length=bytes.readUInt32LE(offset+4),data=offset+8;
  assert.ok(data+length<=bytes.length,'Complete WebP chunk: '+name);
  if(kind==='VP8X'){
   assert.ok(length>=10);extended={width:bytes.readUIntLE(data+4,3)+1,height:bytes.readUIntLE(data+7,3)+1,alpha:Boolean(bytes[data]&0x10)};
  }
  if(kind==='VP8L'){
   assert.ok(length>=5);assert.equal(bytes[data],0x2f,'Lossless bitstream signature: '+name);
   const packed=bytes.readUInt32LE(data+1);lossless={width:(packed&0x3fff)+1,height:((packed>>>14)&0x3fff)+1,alpha:Boolean((packed>>>28)&1)};
   assert.equal(packed>>>29,0,'Supported lossless bitstream version: '+name);
  }
  offset=data+length+(length%2);
 }
 assert.ok(lossless,'A lossless VP8L bitstream is required: '+name);
 if(extended){assert.equal(extended.width,lossless.width);assert.equal(extended.height,lossless.height);}
 return {...lossless,alpha:lossless.alpha||Boolean(extended?.alpha)};
}

test('all shipped food atlases exist with transparent lossless WebP at 1536 by 1024',()=>{
 const paths=[...new Set(api.foods.map(food=>food.atlas))];assert.ok(paths.length>=13);
 for(const name of paths){
  assert.match(name,/\.webp$/);
  const header=losslessWebPHeader(fs.readFileSync(new URL('../'+name,import.meta.url)),name);
  assert.equal(header.width,1536,name);assert.equal(header.height,1024,name);assert.equal(header.alpha,true,'The atlas must preserve alpha: '+name);
 }
});

test('per-food sizing scales the already-clipped inner viewport without changing atlas cells or tile layout',()=>{
 const scaledSource=source.replace(/"cell":0(?:,"visualScale":[0-9.]+)?/,'"cell":0,"visualScale":0.84');
 const {api:scaled}=fixture(undefined,scaledSource),food=scaled.foods[0],output=scaled.html(food.name);
 assert.equal(food.visualScale,0.84);assert.equal(api.foods[0].visualScale,1);
 assert.ok(output.includes('style="--bb-food-scale:0.84"'));assert.ok(output.includes('style="left:0%;top:0%"'));
 assert.match(css,/bb-food-visual__crop\{[^}]*overflow:hidden[^}]*transform:scale\(var\(--bb-food-scale,1\)\)/);
 assert.doesNotMatch(css,/bb-food-visual__sprite\{[^}]*transform:scale/);
 for(const invalid of ['0','-1','1.2','"x);background:url(https://evil.example)"'])assert.throws(()=>fixture(undefined,source.replace(/"cell":0(?:,"visualScale":[0-9.]+)?/,'"cell":0,"visualScale":'+invalid)),/invalid visual scale/);
});
