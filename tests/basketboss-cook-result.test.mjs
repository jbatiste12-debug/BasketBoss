import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../bb-cook-result.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../make-a-meal.js',import.meta.url),'utf8');
const validRecipe=()=>({title:'Chicken & broccoli pasta',summary:'A simple dinner.',servings:4,prepMinutes:10,cookMinutes:20,ingredients:[{name:'Cooked chicken',quantity:'200 g',fromHome:true},{name:'Pasta',quantity:'300 g',fromHome:true}],steps:['1. Review cooking instructions.'],extraIngredients:[],allergens:['Wheat'],safetyNotes:['Check ingredient labels and safe handling.']});
function renderer({imageAvailable=true,attachError=false,market='Jersey'}={}){
 const calls=[],events=new Map(),globalEvents=new Map();let cancellations=0,again=0,current=true;
 const image={textContent:'',classList:{add(name){this.name=name;}}};
 const button={addEventListener:(name,callback)=>events.set(name,callback),removeEventListener:name=>events.delete(name)};
 const panels={'[data-bb-result-ingredients]':{innerHTML:''},'[data-bb-result-method]':{innerHTML:''},'[data-bb-result-safety]':{innerHTML:''}};
 const host={isConnected:true,innerHTML:'',querySelector:selector=>selector==='[data-bb-meal-image]'?image:selector==='[data-bb-meal-again]'?button:panels[selector]||null,replaceChildren(){this.innerHTML='';}};
 const window={localStorage:{getItem:key=>key==='basketboss_321_v7_market'?market:null,setItem(){throw Error('Rendering must not save data');}},fetch(){throw Error('Renderer must not send requests');},addEventListener:(event,listener)=>globalEvents.set(event,listener),removeEventListener:event=>globalEvents.delete(event)};
 for(const file of ['bb-duration.js','bb-recipe-measures.js','bb-cook-step-layout.js'])vm.runInNewContext(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{window,globalThis:window});
 if(imageAvailable)window.BBMealImage={attach(imageHost,options){calls.push({imageHost,options,textBeforeImage:host.innerHTML});if(attachError)throw Error('image provider failed');return {cancel(){cancellations++;}};}};
 vm.runInNewContext(source,{window});
 const options={mealImage:{ticket:'signed-recipe-ticket'},getToken:()=> 'member-token',isCurrent:()=>current,onTryAgain:()=>again++};
 return {api:window.BBCookResult,host,image,events,calls,options,panels,globalEvents,setMarket:value=>{market=value;globalEvents.get('storage')?.({type:'storage',key:'basketboss_321_v7_market'});},setCurrent:value=>{current=value;},get cancellations(){return cancellations;},get again(){return again;}};
}

test('created recipe text and review controls render before asynchronous picture work starts',()=>{
 const h=renderer(),recipe=validRecipe();h.api.render(h.host,recipe,h.options);
 assert.equal(h.calls.length,1);assert.match(h.calls[0].textBeforeImage,/Chicken &amp; broccoli pasta/);
 assert.match(h.calls[0].textBeforeImage,/<details class="bb-cook-result__review">/);
 assert.match(h.calls[0].textBeforeImage,/Review ingredients &amp; steps/);
 assert.match(h.calls[0].textBeforeImage,/30mins estimated/);
 assert.match(h.calls[0].textBeforeImage,/Wheat/);assert.match(h.calls[0].textBeforeImage,/not added to Planner or Shopping/);
 assert.equal(h.calls[0].options.recipe,recipe);assert.equal(h.calls[0].options.ticket,'signed-recipe-ticket');
 assert.equal(h.calls[0].options.getToken(),'member-token');
});

test('recipe fields are escaped and cannot supply an arbitrary image or executable markup',()=>{
 const h=renderer(),recipe=validRecipe(),attack='"><img src=x onerror=alert(1)>';
 recipe.title=attack;recipe.summary=attack;recipe.ingredients[0].name=attack;recipe.ingredients[0].quantity=attack;recipe.steps=[attack];recipe.allergens=[attack];recipe.safetyNotes=[attack];recipe.image='https://untrusted.invalid/tracker';
 h.api.render(h.host,recipe,h.options);
 assert.ok(!h.host.innerHTML.includes(attack));assert.match(h.host.innerHTML,/&lt;img src=x onerror=alert\(1\)&gt;/);
 assert.doesNotMatch(h.host.innerHTML,/<img|untrusted\.invalid|onclick=|onerror="/);
});

test('AI recipe review uses American measures only for the saved US region and keeps actions scannable',()=>{
 for(const market of ['US','UK','Jersey','Guernsey']){
  const h=renderer({market}),recipe=validRecipe();recipe.ingredients[0]={name:'Plain flour',quantity:'120 g',fromHome:true};recipe.steps=['1. Heat oven to 200°C. Stir in flour; Bake for 90 minutes.'];
  recipe.safetyNotes=['Check chicken reaches 75°C.'];const original=JSON.stringify(recipe);h.api.render(h.host,recipe,h.options);
  assert.match(h.host.innerHTML,/<ul class="bb-cook-actions" data-bb-measures><li>Heat oven/);
  assert.match(h.host.innerHTML,/<li>Stir in flour;<\/li><li>Bake for 1hr 30mins\./);
  if(market==='US'){
   assert.match(h.host.innerHTML,/≈ 1 US cup \(120 g\)/);assert.match(h.host.innerHTML,/392°F \(200°C\)/);assert.match(h.host.innerHTML,/167°F \(75°C\)/);
  }else{
   assert.match(h.host.innerHTML,/>120 g<\/span>/);assert.match(h.host.innerHTML,/200°C/);assert.doesNotMatch(h.host.innerHTML,/US cup|°F/);
  }
  assert.equal(JSON.stringify(recipe),original);
 }
});

test('changing region updates recipe text without requesting another generated image or mutating stock',()=>{
 const h=renderer({market:'US'}),recipe=validRecipe();recipe.ingredients[0]={name:'Plain flour',quantity:'120 g',fromHome:true};recipe.steps=['Bake at 200°C.'];
 h.api.render(h.host,recipe,h.options);assert.match(h.host.innerHTML,/US cup/);
 h.setMarket('UK');assert.match(h.panels['[data-bb-result-ingredients]'].innerHTML,/>120 g<\/span>/);assert.doesNotMatch(h.panels['[data-bb-result-method]'].innerHTML,/°F/);
 h.setMarket('US');assert.match(h.panels['[data-bb-result-ingredients]'].innerHTML,/US cup/);assert.match(h.panels['[data-bb-result-method]'].innerHTML,/392°F/);
 assert.equal(h.calls.length,1);h.api.clear(h.host);assert.equal(h.globalEvents.size,0);
});

test('Make a Meal catalogue cards use the same region setting, safe quantities, action bullets and duration display',()=>{
 const helpers=app.slice(app.indexOf('function bbMealMarket(){'),app.indexOf('const alias='));
 const card=app.slice(app.indexOf('function recipeCard('),app.indexOf('function renderRecipes(){'));
 for(const market of ['US','UK','Jersey','Guernsey']){
  const window={},input={r:{id:'flour-test',name:'Bread',mins:90,servings:4,method:['Heat oven to 200°C. Mix the ingredients; Bake for 90 minutes.']},matched:[],related:[],missing:[],ing:[{name:'Plain flour',amount:'120 g'}]};
  for(const file of ['bb-duration.js','bb-recipe-measures.js','bb-cook-step-layout.js'])vm.runInNewContext(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{window,globalThis:window});
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const html=vm.runInNewContext(helpers+'\n'+card+'\nrecipeCard(input,0)',{window,input,esc,localStorage:{getItem:key=>key==='basketboss_321_v7_market'?market:null}});
  assert.match(html,/1hr 30mins/);assert.match(html,/<ul class="bb-cook-actions" data-bb-measures>/);
  if(market==='US'){assert.match(html,/US cup/);assert.match(html,/392°F/);}else assert.doesNotMatch(html,/US cup|°F/);
  assert.equal(input.ing[0].amount,'120 g');
 }
});

test('missing or failed picture support preserves the complete usable recipe without stock substitution',()=>{
 for(const fixture of [{imageAvailable:false},{attachError:true}]){
  const h=renderer(fixture);h.api.render(h.host,validRecipe(),h.options);
  assert.match(h.image.textContent,/Meal picture unavailable/);assert.match(h.host.innerHTML,/Chicken &amp; broccoli pasta/);
  assert.match(h.host.innerHTML,/Method · review for food safety/);assert.doesNotMatch(h.host.innerHTML,/\.webp|https?:/);
 }
});

test('replacement, account invalidation and explicit clearing cancel image work and stale retry actions',()=>{
 const h=renderer();const first=h.api.render(h.host,validRecipe(),h.options);
 h.events.get('click')();assert.equal(h.again,1);
 h.setCurrent(false);h.events.get('click')();assert.equal(h.again,1);assert.equal(h.calls[0].options.isCurrent(),false);
 h.setCurrent(true);h.api.render(h.host,validRecipe(),h.options);assert.equal(h.cancellations,1);
 assert.equal(h.calls[0].options.isCurrent(),false);
 first.cancel();assert.equal(h.cancellations,1);
 h.api.clear(h.host);assert.equal(h.cancellations,2);assert.equal(h.host.innerHTML,'');assert.equal(h.events.size,0);
});

const generationSource=app.slice(app.indexOf('function bbClearGeneratedMeal(){'),app.indexOf('// One streamlined Make a Meal workspace.'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function generation(){
 const requests=[],rendered=[],messages=[],consents=[],events=new Map();let token='member-A',deleting=false,allowConsent=true,cancelled=0;
 const controls={'#generated':{innerHTML:'',replaceChildren(){this.innerHTML='';}},'#generate':{disabled:false}};
 const window={BBAccountDeletion:{isDeleting:()=>deleting},BBMealImage:{cancelAll(){cancelled++;}},addEventListener:(name,callback)=>events.set(name,callback),BBCookResult:{render(host,recipe,options){rendered.push({recipe,options});host.innerHTML='RECIPE READY';return{cancel(){cancelled++;}};},clear(host){host.replaceChildren();}}};
 const context=vm.createContext({window,bbPaidToken:()=>token,list:()=>[{name:'Cooked chicken'},{name:'Pasta'}],message:(...values)=>messages.push(values),confirm:text=>{consents.push(text);return allowConsent;},$:selector=>controls[selector],esc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),requestBody:(verb,body)=>new Promise((resolve,reject)=>requests.push({verb,body,resolve,reject}))});
 vm.runInContext('let bb5Confirmed=true,mode="only",generateInFlight=false,generateRevision=0,generateActor=null,generatedView=null;\n'+generationSource,context);
 return {context,requests,rendered,messages,consents,events,controls,run:script=>vm.runInContext(script,context),setToken:value=>{token=value;},setDeleting:value=>{deleting=value;},denyConsent:()=>{allowConsent=false;},get cancelled(){return cancelled;}};
}

test('creation keeps confirmation, ingredient bounds, deletion and explicit photo-purpose consent gates',()=>{
 for(const change of ['bb5Confirmed=false','list=()=>[]','list=()=>Array.from({length:13},(_,n)=>({name:"Food "+n}))']){
  const h=generation();h.run(change);h.run('generate()');assert.equal(h.requests.length,0);assert.equal(h.consents.length,0);
 }
 const deleting=generation();deleting.setDeleting(true);deleting.run('generate()');assert.equal(deleting.requests.length,0);
 const signedOut=generation();signedOut.setToken(null);signedOut.run('generate()');assert.equal(signedOut.requests.length,0);
 const declined=generation();declined.denyConsent();declined.run('generate()');assert.equal(declined.requests.length,0);assert.equal(declined.controls['#generated'].innerHTML,'');
 assert.match(declined.consents[0],/ingredient names \(not stock quantities\)/);assert.match(declined.consents[0],/illustrative picture/);assert.match(declined.consents[0],/not your email or a personal photo/);
});

test('one recipe request is in flight and captured ingredient mode governs a delayed result',async()=>{
 const h=generation();h.run('generate();generate()');assert.equal(h.requests.length,1);assert.equal(h.controls['#generate'].disabled,true);
 assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].body)),{ingredients:['Cooked chicken','Pasta'],mode:'only_have',servings:4});
 h.run('mode="extras"');const recipe=validRecipe();recipe.ingredients.push({name:'Cream',quantity:'100 ml',fromHome:false});recipe.extraIngredients=['Cream'];
 h.requests[0].resolve({ok:true,reviewRequired:true,recipe});await tick();
 assert.equal(h.rendered.length,0);assert.match(h.controls['#generated'].innerHTML,/AI suggested ingredients you do not have/);assert.equal(h.controls['#generate'].disabled,false);
 const extras=generation();extras.run('mode="extras";generate();mode="only"');extras.requests[0].resolve({ok:true,reviewRequired:true,recipe,mealImage:{ticket:'ticket'}});await tick();
 assert.equal(extras.rendered.length,1);assert.equal(extras.rendered[0].options.mealImage.ticket,'ticket');
});

test('recipe text is shown with the image ticket only after validation and the original account is still current',async()=>{
 const h=generation();h.run('generate()');h.requests[0].resolve({ok:true,reviewRequired:true,recipe:validRecipe(),mealImage:{ticket:'recipe-ticket'}});await tick();
 assert.equal(h.controls['#generated'].innerHTML,'RECIPE READY');assert.equal(h.rendered[0].options.isCurrent(),true);
 assert.equal(h.rendered[0].options.getToken(),'member-A');assert.equal(h.controls['#generate'].disabled,false);
 h.setToken('member-B');h.run('bbCheckGeneratedMealAccount()');assert.equal(h.controls['#generated'].innerHTML,'');assert.equal(h.rendered[0].options.isCurrent(),false);
 for(const response of [{ok:true,reviewRequired:false,recipe:validRecipe()},{ok:true,reviewRequired:true,recipe:{...validRecipe(),title:''}}]){
  const invalid=generation();invalid.run('generate()');invalid.requests[0].resolve(response);await tick();assert.equal(invalid.rendered.length,0);assert.match(invalid.controls['#generated'].innerHTML,/Incomplete recipe response/);
 }
});

test('account switch, sign-out and deletion cannot display a stale recipe or error',async()=>{
 for(const reject of [false,true])for(const kind of ['switch','sign-out','deletion']){
  const h=generation();h.run('generate()');
  if(kind==='deletion'){h.setDeleting(true);h.events.get('basketboss:account-deletion-started')();}
  else{h.setToken(kind==='switch'?'member-B':null);h.run('bbCheckGeneratedMealAccount()');}
  if(reject)h.requests[0].reject(Error('<private old account error>'));else h.requests[0].resolve({ok:true,reviewRequired:true,recipe:validRecipe(),mealImage:{ticket:'old'}});
  await tick();assert.equal(h.rendered.length,0);assert.equal(h.controls['#generated'].innerHTML,'');assert.equal(h.controls['#generate'].disabled,false);
 }
});

test('an old request cannot unlock or replace a newer account’s in-flight request',async()=>{
 const h=generation();h.run('generate()');h.setToken('member-B');h.run('bbCheckGeneratedMealAccount();generate()');assert.equal(h.requests.length,2);
 h.requests[0].resolve({ok:true,reviewRequired:true,recipe:validRecipe()});await tick();
 assert.equal(h.controls['#generate'].disabled,true);assert.equal(h.run('generateInFlight'),true);assert.equal(h.rendered.length,0);
 h.requests[1].resolve({ok:true,reviewRequired:true,recipe:validRecipe()});await tick();assert.equal(h.rendered.length,1);assert.equal(h.controls['#generate'].disabled,false);
});
