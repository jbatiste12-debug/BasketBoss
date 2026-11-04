import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../bb-cook-studio.js',import.meta.url),'utf8');
function harness({pantry=false,missingStage=false}={}){
 const observers=[],events=new Map();
 const element=()=>({attributes:{},dataset:{},classList:{values:new Set(),add(...values){for(const value of values)this.values.add(value);},remove(...values){for(const value of values)this.values.delete(value);}},isConnected:true,innerHTML:'',textContent:'',hidden:false,children:[],setAttribute(key,value){this.attributes[key]=value;},getAttribute(key){return this.attributes[key]??null;},removeAttribute(key){delete this.attributes[key];},append(...nodes){for(const node of nodes){if(node.parentNode)node.parentNode.children=node.parentNode.children.filter(child=>child!==node);this.children.push(node);node.parentNode=this;}},querySelector(){return null;},querySelectorAll(){return [];}});
 const workspace=element(),hub=element(),stage=element(),scanner=element(),meal=element(),body=element(),close=element(),scan=element(),generate=element();
 const scanHeading=element(),mealHeading=element(),upload=element(),disclosure=element(),warning=element(),input=element();
 disclosure.textContent='Original Pantry disclosure';scanHeading.innerHTML='Original Pantry heading';
 stage.attributes={role:'dialog','aria-modal':'true'};stage.hidden=true;stage.classList.add('bb-ai-native-visible');stage.append(scanner,meal);body.append(stage);
 scanner.append(input);scanner.querySelector=selector=>selector==='.ai-feature-heading'?scanHeading:selector==='label[for="ai-photo-input"]'?upload:selector==='.disclosure'?disclosure:null;
 meal.querySelector=selector=>selector==='.ai-feature-heading'?mealHeading:selector==='.warning'?warning:null;
 stage.querySelector=selector=>selector==='[data-close-tool]'?close:null;
 const generated=element(),steps=[1,2,3].map(index=>{const step=element();step.setAttribute('data-bbpm-step',String(index));return step;});hub.querySelectorAll=selector=>selector==='[data-bbpm-step]'?steps:[];
 const nodes={bbToolStage:missingStage?null:stage,aiScanner:scanner,aiMeal:meal,scanBtn:scan,generate,generated,'ai-photo-input':input};
 const document={body,hidden:false,getElementById:id=>nodes[id]||null,createElement:element,addEventListener:(name,listener)=>events.set(name,listener),removeEventListener:name=>events.delete(name)};hub.ownerDocument=document;
 const window={document,location:{href:'http://localhost/make-a-meal.html'+(pantry?'?bbscan=pantry&location=fridge':'')},MutationObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(target,options){this.target=target;this.options=options;}disconnect(){this.disconnected=true;}},fetch(){throw Error('The presentation must not send requests');}};
 Object.defineProperty(window,'localStorage',{get(){throw Error('The presentation must not read or write stored food');}});
 vm.runInNewContext(source,{window,URL});
 return {window,document,hub,workspace,stage,scanner,meal,close,scan,generate,generated,steps,nodes,observers,events,scanHeading,mealHeading,upload,disclosure,warning,input,body,args:{hub,workspace},mount:()=>window.BBCookStudio.mount({hub,workspace})};
}

test('photo workspace has one inline photo flow and retains the original camera and output controls',()=>{
 const h=harness(),controller=h.mount();assert(controller);
 assert.match(h.hub.innerHTML,/Photo to meal steps/);assert.match(h.hub.innerHTML,/Ingredients/);assert.match(h.hub.innerHTML,/Meal \+ picture/);
 assert.doesNotMatch(h.hub.innerHTML,/Scan my food|Create a meal|Find recipes|bbcs-hero-food|release-assets\//);assert.match(h.hub.innerHTML,/src="icons\/basketboss-crowned[^\"]+"[^>]+aria-hidden="true"/);
 assert.equal(h.workspace.hidden,true);assert.equal(h.stage.parentNode,h.hub);assert.equal(h.stage.hidden,false);
 assert.equal(h.stage.attributes.role,undefined);assert.equal(h.stage.attributes['aria-modal'],undefined);assert.equal(h.stage.classList.values.has('bb-ai-native-visible'),false);
 assert.equal(h.close.hidden,true);assert.equal(h.scanner.hidden,false);assert.equal(h.meal.hidden,true);
 assert.equal(h.input.parentNode,h.scanner);assert.equal(h.upload.attributes['aria-label'],'Take or choose a photo');assert.match(h.upload.innerHTML,/<strong>Take or choose a photo<\/strong>/);assert.match(h.upload.innerHTML,/aria-hidden="true"/);assert.match(h.upload.innerHTML,/<svg[^>]+focusable="false"/);assert.equal(h.scan.hidden,true);assert.equal(h.generate.hidden,true);
 assert.equal(h.upload.attributes.role,'button');assert.equal(h.upload.tabIndex,0);assert.equal(h.upload.attributes['data-ai-scan-btn'],'');
 assert.match(h.disclosure.textContent,/Nothing is added to At home or your shopping list/);
 assert.equal(h.body.classList.values.has('bb-photo-meal-page'),true);
});

test('ingredient dedupe normalizes case, Unicode, whitespace and safe plurals while preserving food forms',()=>{
 const {window}=harness(),names=window.BBCookStudio.ingredientNames(['  Rice  ','Ｒｉｃｅ','rice','Red onions','red onion','Raw chicken','Cooked chicken','Frozen chicken','Chicken','Peppers','Black pepper','Tinned tomatoes','Fresh tomatoes','',null]);
 assert.deepEqual(Array.from(names),['Rice','Red onions','Raw chicken','Cooked chicken','Frozen chicken','Chicken','Peppers','Black pepper','Tinned tomatoes','Fresh tomatoes']);
 assert.deepEqual(Array.from(window.BBCookStudio.ingredientNames(['Lettuce','lettuce','Garlic','garlic'])),['Lettuce','Garlic']);
});

test('the At home camera handoff retains storage review copy without extra meal actions',()=>{
 const h=harness({pantry:true});h.mount();
 assert.match(h.hub.innerHTML,/AT HOME · PHOTO SCAN/);assert.doesNotMatch(h.hub.innerHTML,/Photo to meal steps|Meal \+ picture/);
 assert.equal(h.hub.attributes['aria-label'],'Scan food for At home');assert.equal(h.disclosure.textContent,'Original Pantry disclosure');assert.equal(h.scanHeading.innerHTML,'Original Pantry heading');
 assert.equal(h.scanner.hidden,false);assert.equal(h.meal.hidden,true);assert.equal(h.input.parentNode,h.scanner);
});

test('showing and clearing a meal only changes visibility and does not recreate the camera input',()=>{
 const h=harness(),controller=h.mount();controller.showMeal();assert.equal(h.meal.hidden,false);controller.clearMeal();assert.equal(h.meal.hidden,true);
 controller.refresh();assert.equal(h.stage.parentNode,h.hub);assert.equal(h.input.parentNode,h.scanner);assert.equal(h.hub.children.filter(child=>child===h.stage).length,1);
});

test('repeated mounting is idempotent and an unavailable original panel fails without mutation',()=>{
 const h=harness(),controller=h.mount(),before=h.hub.innerHTML,children=h.hub.children.length;
 assert.equal(h.window.BBCookStudio.mount(h.args),controller);assert.equal(h.hub.innerHTML,before);assert.equal(h.hub.children.length,children);
 assert.equal(h.observers.length,1);assert.equal(h.observers[0].target,h.stage);assert.equal(h.events.size,1);
 assert.equal(h.window.BBCookStudio.mount({hub:h.hub}),null);
 const absent=harness({missingStage:true});assert.equal(absent.mount(),null);assert.equal(absent.workspace.hidden,false);assert.equal(absent.hub.innerHTML,'');
});

test('progress reflects real scan and recipe work while a ready recipe keeps its third step during picture loading',()=>{
 const h=harness(),controller=h.mount();assert.equal(h.hub.dataset.phase,'photo');assert.equal(h.steps[0].attributes['aria-current'],'step');
 h.scan.disabled=true;h.observers[0].callback();assert.equal(h.hub.dataset.phase,'scanning');
 h.scan.disabled=false;h.nodes.reviewMealFoods={};h.observers[0].callback();assert.equal(h.hub.dataset.phase,'review');assert.equal(h.steps[0].dataset.state,'done');assert.equal(h.steps[1].attributes['aria-current'],'step');assert.equal(h.steps[0].attributes['aria-current'],undefined);
 h.generate.disabled=true;h.observers[0].callback();assert.equal(h.hub.dataset.phase,'creating');assert.equal(h.steps[2].attributes['aria-current'],'step');
 h.generated.querySelector=selector=>selector==='.bb-cook-result'?{picturePending:true}:null;h.observers[0].callback();assert.equal(h.hub.dataset.phase,'ready');assert.equal(h.steps[2].attributes['aria-current'],'step');
 h.document.hidden=true;h.events.get('visibilitychange')();assert.equal(h.hub.dataset.paused,'true');h.document.hidden=false;h.events.get('visibilitychange')();assert.equal(h.hub.dataset.paused,'false');
 controller.destroy();assert.equal(h.observers[0].disconnected,true);assert.equal(h.events.size,0);
});
