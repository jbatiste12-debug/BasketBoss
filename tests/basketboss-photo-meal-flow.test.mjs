import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app=fs.readFileSync(new URL('../make-a-meal.js',import.meta.url),'utf8');
const studio=fs.readFileSync(new URL('../bb-cook-studio.js',import.meta.url),'utf8');
const preferenceSources=['bb-dietary-preferences.js','bb-meal-preferences.js'].map(name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const recipe=()=>({title:'Reviewed chicken and rice',summary:'A simple meal.',servings:4,prepMinutes:5,cookMinutes:20,ingredients:[{name:'Cooked chicken',quantity:'200 g',fromHome:true},{name:'Rice',quantity:'250 g',fromHome:true}],steps:['Review ingredient labels and cook safely.'],extraIngredients:[],allergens:[],safetyNotes:['Check safe handling and cooking temperatures.']});

function harness({pantry=false,deferResize=false,diets=[],servings=4,responseBodyHangs=false,availabilityHangs=false,offline=false}={}){
 let token='member-A',actor='actor-A',deleting=false,consent=true;
 const values=new Map(),writes=[],requests=[],rendered=[],dialogs=[],events=new Map(),controls=new Map(),timers=new Map();let timerId=0;
 values.set('basketboss_321_v7_measured_pantry','{"garlic|clove":7}');
 values.set('basketboss_makeameal_v1_inventory','{"cupboard|garlic":{"name":"Garlic","selected":true}}');
 if(diets.length||servings!==4)values.set('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[],servings,mealPreferences:{version:1,scope:actor,diets,goals:[]}}));
 const storage={getItem(key){if(key==='basketboss_cloud_session_v1')return token?JSON.stringify({access_token:token,expires_at:Date.now()/1000+3600,user:{id:actor}}):null;return values.get(key)??null;},setItem(key,value){writes.push({key,value});values.set(key,value);},removeItem(key){writes.push({key});values.delete(key);}};
 const element=()=>({innerHTML:'',textContent:'',hidden:false,disabled:false,dataset:{},style:{setProperty(){},removeProperty(){}},classList:{add(){},remove(){},toggle(){}},setAttribute(){},removeAttribute(){},replaceChildren(){this.innerHTML='';this.textContent='';},scrollIntoView(){},focus(){},querySelector(){return null;},querySelectorAll(){return [];}});
 const get=selector=>{if(!controls.has(selector))controls.set(selector,element());return controls.get(selector);};
 const on=(name,listener)=>{if(!events.has(name))events.set(name,[]);events.get(name).push(listener);};
 const document={readyState:'loading',hidden:false,addEventListener:on,querySelector:get,querySelectorAll:()=>[],getElementById:id=>get('#'+id),documentElement:{classList:{add(){}}},createElement:tag=>tag==='canvas'?{getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,'+'A'.repeat(80)}:element()};
 let resizeResolve;
 const bitmap={width:640,height:480,close(){}};
 const fetch=async(url,options)=>{
  const action=String(url).split('/').pop();
  if(action==='status'){if(availabilityHangs)return new Promise(()=>{});return {ok:true,json:async()=>({status:'available',premium_ai:true,siteKey:'fixture-key',turnstileRequired:false})};}
  return new Promise((resolve,reject)=>requests.push({action,body:JSON.parse(options.body),options,resolve:payload=>resolve({ok:true,json:async()=>responseBodyHangs?new Promise(()=>{}):payload}),reject}));
 };
 const window={document,navigator:{onLine:!offline},location:{href:'http://localhost/make-a-meal.html'+(pantry?'?bbscan=pantry&location=fridge':''),search:pantry?'?bbscan=pantry&location=fridge':''},BB173_FREE_RECIPE_IDS:[],BBAccountDeletion:{isDeleting:()=>deleting},BasketBossVerifiedPremium:{isActive:()=>!!token&&!deleting},localStorage:storage,addEventListener:on,BBMealImage:{cancelAll(){}},BBCookResult:{render(host,value,options){rendered.push({recipe:value,options});host.innerHTML='RECIPE READY';return{cancel(){host.innerHTML='';}};},clear:host=>host.replaceChildren()}};
 const context=vm.createContext({window,document,location:window.location,URL,URLSearchParams,localStorage:storage,Date,AbortController,fetch,confirm:message=>{dialogs.push(message);return consent;},setInterval:()=>1,clearInterval(){},setTimeout:(fn,wait)=>{const id=++timerId;timers.set(id,{fn,wait});return id;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:fn=>fn(),MutationObserver:class{observe(){}},createImageBitmap:()=>deferResize?new Promise(resolve=>{resizeResolve=resolve;}):Promise.resolve(bitmap),console});
 vm.runInContext(studio,context);
 for(const source of preferenceSources)vm.runInContext(source,context);
 const injection=`\nwindow.__photoTest={renderScanResponse,bbConfirmPhotoMeal,scanPhoto,generate,bbCheckGeneratedMealAccount,bbClearGeneratedMeal,
  choosePhoto(file){photoFile=file;bbPhotoReviewToken=bbPaidToken();scanRevision++;},
  disableAI(){aiEnabled=false;},
  configure(){aiEnabled=true;bbTurnstileRequired=false;inventory={'cupboard|garlic':{name:'Garlic',selected:true}};},
  state(){return {names:bbPhotoMealNames,reviewToken:bbPhotoReviewToken,generateInFlight,scanInFlight};},
  setLibrary(catalog){recipes=catalog;catalog.forEach(row=>bbSecureFreeIds.add(row.id));inventory={'cupboard|rice':{name:'Rice',selected:true}};bb5Confirmed=true;renderRecipes();},
  libraryResults(){return results.map(row=>row.r.id);},
  chooseLibrary(index){pendingRecipe=index;confirmMeal();}
 };\n`;
 const end=app.lastIndexOf('})();');
 assert(end>0,'the page controller must remain an enclosed module');
 vm.runInContext(app.slice(0,end)+injection+app.slice(end),context);
 const api=window.__photoTest;api.configure();
 function form(foods){
  const error=element();
  const rows=foods.map(food=>{
   const check={checked:food.checked!==false},field={value:food.name,checkValidity:()=>true,focus(){}};
   const row={querySelector(selector){return selector.includes('checkbox')||selector.includes('name="food"')||selector.includes('name="mealFood"')?check:selector.includes('photo-meal-name')?field:null;}};
   check.closest=()=>row;field.closest=()=>row;return {row,check,field};
  });
  return {id:'reviewMealFoods',querySelector:()=>error,querySelectorAll(selector){if(selector.includes('bb-photo-food-row'))return rows.map(item=>item.row);if(selector.includes('photo-meal-name'))return rows.filter(item=>!selector.includes(':checked')||item.check.checked).map(item=>item.field);if(selector.includes('checkbox')||selector.includes('name="food"'))return rows.filter(item=>!selector.includes(':checked')||item.check.checked).map(item=>item.check);return [];},error,rows};
 }
 return {api,window,requests,rendered,controls,writes,dialogs,get,form,values,timers,expireRequest(){const entry=[...timers.entries()].at(-1);assert(entry,'a bounded request must have a timer');timers.delete(entry[0]);entry[1].fn();},setToken(value,newActor=actor){token=value;actor=newActor;},setDeleting:value=>{deleting=value;},denyConsent:()=>{consent=false;},duringConsent(callback){context.confirm=message=>{dialogs.push(message);callback();return true;};},resolveResize:()=>resizeResolve(bitmap),emit(name){for(const listener of events.get(name)||[])listener({type:name});}};
}

test('photo scan review contains editable deduplicated names without Pantry destinations or writes',()=>{
 const h=harness();
 h.api.renderScanResponse({items:['Rice',' rice ','Ｒｉｃｅ','Raw chicken','Cooked chicken'].map(name=>({name,estimatedQuantity:'unknown',confidence:'high',notes:''}))});
 const html=h.get('#scanResults').innerHTML;
 assert.match(html,/id="reviewMealFoods"/);assert.match(html,/data-photo-meal-name/);
 assert.equal((html.match(/class="bb-photo-food-row"/g)||[]).length,3);
 assert.match(html,/Raw chicken/);assert.match(html,/Cooked chicken/);
 assert.doesNotMatch(html,/data-scan-location|data-scan-quantity|Save my confirmed foods|id="reviewFoods"/);
 assert.deepEqual(h.writes,[]);
});

test('confirmed edits and checked photo names are the entire recipe payload and preserve stock',async()=>{
 const h=harness();h.api.renderScanResponse({items:[{name:'Rice'}]});
 const form=h.form([{name:'  Rice  '},{name:'Ｒｉｃｅ'},{name:'Cooked chicken'},{name:'Black pepper',checked:false}]);
 h.api.bbConfirmPhotoMeal(form);await tick();
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].action,'generate');
 assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].body)),{ingredients:['Rice','Cooked chicken'],mode:'only_have',servings:4,turnstileToken:''});
 assert.deepEqual(h.writes,[]);assert.equal(h.values.get('basketboss_321_v7_measured_pantry'),'{"garlic|clove":7}');
 const draft=recipe();h.requests[0].resolve({ok:true,reviewRequired:true,recipe:draft,mealImage:{ticket:'bound-to-reviewed-recipe'}});await tick();
 assert.equal(h.rendered.length,1);assert.equal(h.rendered[0].recipe,draft);assert.equal(h.rendered[0].options.mealImage.ticket,'bound-to-reviewed-recipe');
 assert.equal(h.rendered[0].options.getToken(),'member-A');assert.equal(h.get('#generated').innerHTML,'RECIPE READY');
});

test('Cook AI captures scoped dietary choices and the actual household serving count',async()=>{
 const h=harness({diets:['Vegetarian','Dairy-free'],servings:2});h.api.renderScanResponse({items:[{name:'Rice'},{name:'Chickpeas'}]});
 h.api.bbConfirmPhotoMeal(h.form([{name:'Rice'},{name:'Chickpeas'}]));await tick();
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].body.servings,2);
 assert.deepEqual(Array.from(h.requests[0].body.dietaryPreferences),['vegetarian','dairy-free']);
 assert.match(h.dialogs.at(-1),/serve 2 and follow Vegetarian, Dairy-free/);
 const draft={...recipe(),servings:2,ingredients:[{name:'Rice',quantity:'100 g',fromHome:true},{name:'Chickpeas',quantity:'100 g',fromHome:true}]};
 h.requests[0].resolve({ok:true,reviewRequired:true,recipe:draft});await tick();
 assert.equal(h.rendered.length,1);assert.deepEqual(h.writes,[]);
});

test('conflicting selected foods and unsupported serving counts stop before a paid AI request',async()=>{
 const vegetarian=harness({diets:['Vegetarian']});vegetarian.api.renderScanResponse({items:[{name:'Cooked chicken'}]});
 vegetarian.api.bbConfirmPhotoMeal(vegetarian.form([{name:'Cooked chicken'}]));await tick();
 assert.equal(vegetarian.requests.length,0);assert.equal(vegetarian.dialogs.length,0);
 assert.match(vegetarian.get('#generated').innerHTML,/Cooked chicken.*Remove.*Meal preferences/);assert.deepEqual(vegetarian.writes,[]);
 const large=harness({servings:10});large.api.renderScanResponse({items:[{name:'Rice'}]});large.api.bbConfirmPhotoMeal(large.form([{name:'Rice'}]));await tick();
 assert.equal(large.requests.length,0);assert.match(large.get('#generated').innerHTML,/up to 8 servings/);
});

test('a returned meal cannot override the captured dietary or serving choices',async()=>{
 for(const wrong of ['diet','servings']){
  const h=harness({diets:['Dairy-free'],servings:2});h.api.renderScanResponse({items:[{name:'Rice'}]});h.api.bbConfirmPhotoMeal(h.form([{name:'Rice'}]));await tick();
  const draft={...recipe(),servings:wrong==='servings'?4:2,ingredients:[{name:wrong==='diet'?'Cream':'Rice',quantity:'100 g',fromHome:true}]};
  h.requests[0].resolve({ok:true,reviewRequired:true,recipe:draft,mealImage:{ticket:'must-not-render'}});await tick();
  assert.equal(h.rendered.length,0);assert.match(h.get('#generated').innerHTML,wrong==='diet'?/dietary preferences/:/household serving count/);assert.deepEqual(h.writes,[]);
 }
});

test('changed preferences invalidate an in-flight recipe and image without changing pantry',async()=>{
 const h=harness({diets:['Vegetarian']});h.api.renderScanResponse({items:[{name:'Rice'}]});h.api.bbConfirmPhotoMeal(h.form([{name:'Rice'}]));await tick();
 h.values.set('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[],servings:4,mealPreferences:{version:1,scope:'actor-A',diets:['Vegan'],goals:[]}}));
 h.api.bbCheckGeneratedMealAccount();h.requests[0].resolve({ok:true,reviewRequired:true,recipe:recipe(),mealImage:{ticket:'old-preferences'}});await tick();
 assert.equal(h.rendered.length,0);assert.equal(h.get('#generated').innerHTML,'');assert.equal(h.api.state().generateInFlight,false);assert.deepEqual(h.writes,[]);
});

test('another account’s dietary profile is not inherited and changes during consent send nothing',async()=>{
 const h=harness();h.values.set('basketboss_321_unified_state_v1',JSON.stringify({version:2,servings:4,mealPreferences:{version:1,scope:'actor-B',diets:['Vegan'],goals:[]}}));
 h.api.renderScanResponse({items:[{name:'Cooked chicken'}]});h.api.bbConfirmPhotoMeal(h.form([{name:'Cooked chicken'}]));await tick();
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].body.dietaryPreferences,undefined);
 const changed=harness({diets:['Vegetarian']});changed.api.renderScanResponse({items:[{name:'Rice'}]});
 changed.duringConsent(()=>changed.values.set('basketboss_321_unified_state_v1',JSON.stringify({version:2,servings:2,mealPreferences:{version:1,scope:'actor-A',diets:['Vegan'],goals:[]}})));
 changed.api.bbConfirmPhotoMeal(changed.form([{name:'Rice'}]));await tick();assert.equal(changed.requests.length,0);assert.match(changed.get('#generated').innerHTML,/meal preferences changed/);
});

test('Cook library suggestions and a delayed Choose this meal respect the current diet',()=>{
 const h=harness({diets:['Vegetarian']});
 const catalog=[{id:'chicken',name:'Chicken rice',category:'Family dinner',servings:4,ingredients:[['Rice','200 g'],['Chicken','200 g']],method:['Cook safely.']},{id:'veggie',name:'Cheesy rice',category:'Family dinner',servings:4,ingredients:[['Rice','200 g'],['Cheddar','100 g']],method:['Cook safely.']}];
 h.api.setLibrary(catalog);assert.deepEqual(Array.from(h.api.libraryResults()),['veggie']);
 h.values.set('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[],servings:4,mealPreferences:{version:1,scope:'actor-A',diets:['Vegan'],goals:[]}}));
 h.get('#mealReviewDay').value='Monday';h.api.chooseLibrary(0);
 assert.match(h.get('#mealReviewError').textContent,/dietary preferences/);assert.deepEqual(h.writes,[]);
});

test('photo review validates ingredient count and length before making a recipe request',async()=>{
 for(const foods of [[],[{name:' '}],[{name:'x'.repeat(61)}],Array.from({length:13},(_,n)=>({name:'Ingredient '+n}))]){
  const h=harness();h.api.renderScanResponse({items:[{name:'Rice'}]});const form=h.form(foods);h.api.bbConfirmPhotoMeal(form);await tick();
  assert.equal(h.requests.length,0);assert(form.error.textContent,'invalid reviewed names explain what needs correction');assert.deepEqual(h.writes,[]);
 }
});

test('declining the recipe purpose confirmation sends nothing and leaves food data unchanged',async()=>{
 const h=harness();h.api.renderScanResponse({items:[{name:'Rice'}]});h.denyConsent();h.api.bbConfirmPhotoMeal(h.form([{name:'Rice'}]));await tick();
 assert.equal(h.requests.length,0);assert.equal(h.dialogs.length,1);assert.match(h.dialogs[0],/illustrative picture/);assert.deepEqual(h.writes,[]);
});

test('account changes during the consent prompt cannot submit the old food selection under a new account',async()=>{
 for(const mode of ['account','deletion']){
  const h=harness();h.api.renderScanResponse({items:[{name:'Rice'}]});
  h.duringConsent(()=>mode==='account'?h.setToken('member-B','actor-B'):h.setDeleting(true));
  h.api.bbConfirmPhotoMeal(h.form([{name:'Rice'}]));await tick();
  assert.equal(h.requests.length,0);assert.equal(h.api.state().names,null);assert.deepEqual(h.writes,[]);
 }
});

test('repeated generation taps keep the original request and its recipe current',async()=>{
 const h=harness();h.api.renderScanResponse({items:[{name:'Rice'}]});const form=h.form([{name:'Rice'}]);
 h.api.bbConfirmPhotoMeal(form);await tick();h.api.bbConfirmPhotoMeal(form);await tick();assert.equal(h.requests.length,1);
 h.requests[0].resolve({ok:true,reviewRequired:true,recipe:recipe(),mealImage:{ticket:'same-recipe-ticket'}});await tick();
 assert.equal(h.rendered.length,1);assert.equal(h.rendered[0].options.isCurrent(),true);
});

test('account changes or deletion during photo resizing cannot send the previous account’s photo',async()=>{
 for(const kind of ['switch','signout','deletion']){
  const h=harness({deferResize:true});h.api.choosePhoto({type:'image/png',size:100});const work=h.api.scanPhoto();await tick();
  if(kind==='deletion')h.setDeleting(true);else h.setToken(kind==='signout'?null:'member-B','actor-B');
  h.resolveResize();await work;assert.equal(h.requests.length,0,kind);assert.deepEqual(h.writes,[]);
 }
});

test('a stale scan cannot replace the review for a newly chosen photo',async()=>{
 const h=harness();h.api.choosePhoto({type:'image/png',size:100});const work=h.api.scanPhoto();await tick();assert.equal(h.requests.length,1);
 h.api.choosePhoto({type:'image/png',size:101});h.get('#scanResults').innerHTML='NEW PHOTO';
 h.requests[0].resolve({ok:true,reviewRequired:true,scan:{items:[{name:'Old private food'}]}});await work;
 assert.equal(h.get('#scanResults').innerHTML,'NEW PHOTO');assert.deepEqual(h.writes,[]);
});

test('account switching and deletion discard a delayed generated recipe and its matching picture',async()=>{
 for(const kind of ['switch','signout','deletion']){
  const h=harness();h.api.renderScanResponse({items:[{name:'Rice'}]});h.api.bbConfirmPhotoMeal(h.form([{name:'Rice'}]));await tick();assert.equal(h.requests.length,1);
  if(kind==='deletion'){h.setDeleting(true);h.emit('basketboss:account-deletion-started');}else{h.setToken(kind==='signout'?null:'member-B','actor-B');h.api.bbCheckGeneratedMealAccount();}
  h.requests[0].resolve({ok:true,reviewRequired:true,recipe:recipe(),mealImage:{ticket:'old-account-ticket'}});await tick();
  assert.equal(h.rendered.length,0);assert.equal(h.get('#generated').innerHTML,'');assert.deepEqual(h.writes,[]);
 }
});

test('At home camera handoff keeps its explicit storage review instead of the meal-only flow',()=>{
 const h=harness({pantry:true});h.api.renderScanResponse({items:[{name:'Rice',estimatedQuantity:'unknown',confidence:'high',notes:''}]});
 const html=h.get('#scanResults').innerHTML;assert.match(html,/id="reviewFoods"/);assert.match(html,/data-scan-location/);assert.doesNotMatch(html,/id="reviewMealFoods"/);assert.deepEqual(h.writes,[]);
});


test('a stalled scan response body releases its lock and preserves saved stock',async()=>{
 const h=harness({responseBodyHangs:true});h.api.choosePhoto({type:'image/png',size:100});
 const work=h.api.scanPhoto();await tick();assert.equal(h.requests.length,1);
 assert.equal(h.api.state().scanInFlight,true);assert.equal(h.get('#scanBtn').disabled,true);
 h.requests[0].resolve({ok:true,reviewRequired:true,scan:{items:[{name:'Rice'}]}});await tick();
 assert.equal(h.api.state().scanInFlight,true,'receiving headers alone does not finish the scan');
 h.expireRequest();await work;
 assert.equal(h.api.state().scanInFlight,false);assert.equal(h.get('#scanBtn').disabled,false);
 assert.match(h.get('#scanResults').innerHTML,/timed out/);assert.deepEqual(h.writes,[]);assert.equal(h.timers.size,0);
});

test('a stalled availability check cannot leave recipe generation busy forever',async()=>{
 const h=harness({availabilityHangs:true});h.api.disableAI();h.api.renderScanResponse({items:[{name:'Rice'}]});
 h.api.bbConfirmPhotoMeal(h.form([{name:'Rice'}]));await tick();
 assert.equal(h.api.state().generateInFlight,true);assert.equal(h.get('#generate').disabled,true);
 h.expireRequest();await tick();
 assert.equal(h.api.state().generateInFlight,false);assert.equal(h.get('#generate').disabled,false);
 assert.equal(h.requests.length,0,'no paid generation runs without a completed readiness check');
 assert.match(h.get('#generated').innerHTML,/availability could not be checked.*connection/);assert.deepEqual(h.writes,[]);assert.equal(h.timers.size,0);
});

test('offline scans fail locally and release controls without sending photos or losing pantry stock',async()=>{
 const h=harness({offline:true});h.api.choosePhoto({type:'image/png',size:100});await h.api.scanPhoto();
 assert.equal(h.requests.length,0);assert.equal(h.api.state().scanInFlight,false);assert.equal(h.get('#scanBtn').disabled,false);
 assert.match(h.get('#scanResults').innerHTML,/offline/);assert.deepEqual(h.writes,[]);assert.equal(h.values.get('basketboss_321_v7_measured_pantry'),'{"garlic|clove":7}');
});
