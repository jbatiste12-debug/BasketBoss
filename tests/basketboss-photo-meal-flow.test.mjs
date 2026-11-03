import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app=fs.readFileSync(new URL('../make-a-meal.js',import.meta.url),'utf8');
const studio=fs.readFileSync(new URL('../bb-cook-studio.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const recipe=()=>({title:'Reviewed chicken and rice',summary:'A simple meal.',servings:4,prepMinutes:5,cookMinutes:20,ingredients:[{name:'Cooked chicken',quantity:'200 g',fromHome:true},{name:'Rice',quantity:'250 g',fromHome:true}],steps:['Review ingredient labels and cook safely.'],extraIngredients:[],allergens:[],safetyNotes:['Check safe handling and cooking temperatures.']});

function harness({pantry=false,deferResize=false}={}){
 let token='member-A',actor='actor-A',deleting=false,consent=true;
 const values=new Map(),writes=[],requests=[],rendered=[],dialogs=[],events=new Map(),controls=new Map();
 values.set('basketboss_321_v7_measured_pantry','{"garlic|clove":7}');
 values.set('basketboss_makeameal_v1_inventory','{"cupboard|garlic":{"name":"Garlic","selected":true}}');
 const storage={getItem(key){if(key==='basketboss_cloud_session_v1')return token?JSON.stringify({access_token:token,expires_at:Date.now()/1000+3600,user:{id:actor}}):null;return values.get(key)??null;},setItem(key,value){writes.push({key,value});values.set(key,value);},removeItem(key){writes.push({key});values.delete(key);}};
 const element=()=>({innerHTML:'',textContent:'',hidden:false,disabled:false,dataset:{},style:{setProperty(){},removeProperty(){}},classList:{add(){},remove(){},toggle(){}},setAttribute(){},removeAttribute(){},replaceChildren(){this.innerHTML='';this.textContent='';},scrollIntoView(){},focus(){},querySelector(){return null;},querySelectorAll(){return [];}});
 const get=selector=>{if(!controls.has(selector))controls.set(selector,element());return controls.get(selector);};
 const on=(name,listener)=>{if(!events.has(name))events.set(name,[]);events.get(name).push(listener);};
 const document={readyState:'loading',hidden:false,addEventListener:on,querySelector:get,querySelectorAll:()=>[],getElementById:id=>get('#'+id),documentElement:{classList:{add(){}}},createElement:tag=>tag==='canvas'?{getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,'+'A'.repeat(80)}:element()};
 let resizeResolve;
 const bitmap={width:640,height:480,close(){}};
 const fetch=async(url,options)=>{
  const action=String(url).split('/').pop();
  if(action==='status')return {ok:true,json:async()=>({status:'available',premium_ai:true,siteKey:'fixture-key',turnstileRequired:false})};
  return new Promise((resolve,reject)=>requests.push({action,body:JSON.parse(options.body),options,resolve:payload=>resolve({ok:true,json:async()=>payload}),reject}));
 };
 const window={document,location:{href:'http://localhost/make-a-meal.html'+(pantry?'?bbscan=pantry&location=fridge':''),search:pantry?'?bbscan=pantry&location=fridge':''},BB173_FREE_RECIPE_IDS:[],BBAccountDeletion:{isDeleting:()=>deleting},BasketBossVerifiedPremium:{isActive:()=>!!token&&!deleting},localStorage:storage,addEventListener:on,BBMealImage:{cancelAll(){}},BBCookResult:{render(host,value,options){rendered.push({recipe:value,options});host.innerHTML='RECIPE READY';return{cancel(){host.innerHTML='';}};},clear:host=>host.replaceChildren()}};
 const context=vm.createContext({window,document,location:window.location,URL,URLSearchParams,localStorage:storage,Date,AbortController,fetch,confirm:message=>{dialogs.push(message);return consent;},setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:fn=>fn(),MutationObserver:class{observe(){}},createImageBitmap:()=>deferResize?new Promise(resolve=>{resizeResolve=resolve;}):Promise.resolve(bitmap),console});
 vm.runInContext(studio,context);
 const injection=`\nwindow.__photoTest={renderScanResponse,bbConfirmPhotoMeal,scanPhoto,generate,bbCheckGeneratedMealAccount,bbClearGeneratedMeal,
  choosePhoto(file){photoFile=file;bbPhotoReviewToken=bbPaidToken();scanRevision++;},
  configure(){aiEnabled=true;bbTurnstileRequired=false;inventory={'cupboard|garlic':{name:'Garlic',selected:true}};},
  state(){return {names:bbPhotoMealNames,reviewToken:bbPhotoReviewToken,generateInFlight,scanInFlight};}
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
 return {api,window,requests,rendered,controls,writes,dialogs,get,form,values,setToken(value,newActor=actor){token=value;actor=newActor;},setDeleting:value=>{deleting=value;},denyConsent:()=>{consent=false;},duringConsent(callback){context.confirm=message=>{dialogs.push(message);callback();return true;};},resolveResize:()=>resizeResolve(bitmap),emit(name){for(const listener of events.get(name)||[])listener({type:name});}};
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
