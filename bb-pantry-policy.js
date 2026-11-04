/* Shared pantry rules. Container estimates are labelled; unknown units never
   imply zero stock and no general weight/volume density is invented. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BBPantryPolicy=api;})(typeof window==='undefined'?(typeof globalThis==='undefined'?null:globalThis):window,function(){
 'use strict';
 const MAX=1000000;
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const clean=value=>typeof value==='string'?value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,' ').toLowerCase().replace(/[–—]/g,'-').replace(/\s+/g,' ').trim():'';
 const number=value=>value!==null&&value!==undefined&&value!==''&&typeof value!=='boolean'&&Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=MAX?Number(value):null;
 const round=value=>Math.round(value*1000000)/1000000;
 const aliases={gram:'g',grams:'g',kilogram:'kg',kilograms:'kg',millilitre:'ml',millilitres:'ml',milliliter:'ml',milliliters:'ml',litre:'l',litres:'l',liter:'l',liters:'l',counts:'each',count:'each',unit:'each',units:'each',piece:'each',pieces:'each',item:'each',items:'each',pcs:'each',pc:'each',cloves:'clove',tins:'tin',can:'tin',cans:'tin',packs:'pack',packets:'pack',packet:'pack',bags:'bag',bottles:'bottle',jars:'jar',pouches:'pouch',bunches:'bunch',teaspoon:'tsp',teaspoons:'tsp',tablespoon:'tbsp',tablespoons:'tbsp',pints:'pint',pinches:'pinch',dashes:'dash',cups:'cup',ounce:'oz',ounces:'oz',pound:'lb',pounds:'lb',lbs:'lb','fluid ounce':'fl oz','fluid ounces':'fl oz',floz:'fl oz','us cup':'cup','us cups':'cup','us fl oz':'fl oz'};
 const unit=value=>{const key=clean(value).replace(/^fl\.?\s*oz\.?$/,'fl oz');return aliases[key]||key;};
 const safeName=value=>!!value&&!value.includes('|')&&!['__proto__','constructor','prototype'].includes(value)&&value.length<=200;
 function canonicalName(value,canonicalize){
  let raw=clean(value);if(!safeName(raw))return '';
  const originalStates=[...new Set(raw.match(/\b(?:cooked|frozen|dried|raw|fresh)\b/g)||[])];
  raw=raw.replace(/\([^)]*\)/g,' ').replace(/\s+/g,' ').trim();
  raw=raw.replace(/(?:\b\d+(?:\.\d+)?\s*[x×]\s*)?\b\d+(?:\.\d+)?\s*(?:kg|g|ml|litres?|liters?|l)\b/g,' ').replace(/\(\s*\)/g,' ').replace(/\s+/g,' ').trim();
  if(!safeName(raw))return '';
  const states=originalStates;
  const cannedTomatoes=!states.includes('fresh')&&/^(?:(?:tinned|canned|tin) (?:chopped |whole |plum )?tomato(?:es)?|chopped (?:tinned |canned )?tomato(?:es)?)$/.test(raw);
  const alias=label=>cannedTomatoes?'chopped tomatoes':label.replace(/^(?:tinned|canned) ((?:(?:red |white |black |kidney |baked |butter |cannellini |borlotti )?beans?|chickpeas?|lentils?))$/,'$1').replace(/^tomato ketchup$/,'ketchup');
  let result=alias(raw).replace(/\bground beef\b/g,'beef mince').replace(/\bground turkey\b/g,'turkey mince').replace(/\bzucchini\b/g,'courgette').replace(/\beggplant\b/g,'aubergine').replace(/\bscallions?\b/g,'spring onion');
  if(typeof canonicalize==='function')try{const mapped=clean(canonicalize(result));if(safeName(mapped))result=alias(mapped);}catch{}
  const plurals={potatoes:'potato',carrots:'carrot',onions:'onion','red onions':'red onion','spring onions':'spring onion',courgettes:'courgette',aubergines:'aubergine',cucumbers:'cucumber',shallots:'shallot',eggs:'egg',apples:'apple',bananas:'banana',lemons:'lemon',limes:'lime',oranges:'orange'};result=plurals[result]||result;
  for(const state of states)if(!new RegExp('\\b'+state+'\\b').test(result))result=state+' '+result;
  return safeName(result)?result:'';
 }
 function isStaple(value){
  const name=canonicalName(value);if(!name)return false;
  // Bell/chilli peppers, canned vegetables and complete meals stay measured.
  if(/\b(?:bell peppers?|red peppers?|green peppers?|yellow peppers?|mixed peppers?|chilli peppers?|chili peppers?|peppercorn chicken|peppered (?:beef|steak))\b/.test(name)&&!/\b(?:flakes?|powder|ground|dried)\b/.test(name))return false;
  if(/\b(?:beans?|tomato(?:es)?|meat|chicken|beef|pork|fish|pasta|rice|noodles?|potatoes?)\s+(?:in|with)\s+.*sauce\b/.test(name))return false;
  if(/\b(?:chicken|beef|pork|lamb|turkey|bacon|ham|salmon|fish|tofu|sausages?)\b/.test(name)&&!/(?:^| )fish sauce$/.test(name)&&!/\b(?:powder|seasoning|spice)\b/.test(name))return false;
  if(/^(?:salt|pepper|black pepper|white pepper|ground pepper|sea salt|table salt|rock salt|kosher salt)$/.test(name))return true;
  if(/\b(?:ketchup|mustard|mayonnaise|mayo|honey|vinegar|soy sauce|tamari|worcestershire|worcester sauce|fish sauce|oyster sauce|hot sauce|sriracha|tabasco|barbecue sauce|bbq sauce|brown sauce|sweet chilli sauce|sweet chili sauce|teriyaki sauce|hoisin sauce|salad dressing|condiment)\b/.test(name))return true;
  if(/\b(?:olive|cooking|vegetable|sunflower|rapeseed|sesame|coconut|groundnut|peanut|corn|canola|avocado) oil\b/.test(name)||name==='oil')return true;
  if(/\b(?:dried herbs?|mixed herbs?|dried (?:basil|oregano|thyme|rosemary|parsley|mint|sage)|spices?|seasoning|paprika|ground cumin|cumin|turmeric|ground coriander|coriander powder|cinnamon|nutmeg|allspice|garam masala|curry powder|chilli powder|chili powder|red pepper flakes?|cayenne|ground ginger|garlic powder|onion powder|peppercorns?)\b/.test(name))return true;
  if(!/^fresh /.test(name)&&(/\b(?:dressing|herbs?)$/.test(name)))return true;
  return /\bsauce$/.test(name)&&!/^fresh /.test(name);
 }
 function containerLabel(value){
  const name=canonicalName(value);
  if(/\b(?:salt|pepper|paprika|cumin|turmeric|coriander powder|cinnamon|nutmeg|allspice|masala|powder|spice|herb|honey|mustard|jam|paste|peanut butter|pesto)\b/.test(name))return 'jar';
  return isStaple(name)?'bottle':'unit';
 }
 const uk=market=>market===undefined||market===null||['UK','GB','Guernsey','Jersey'].includes(market);
 // Approximate weights for a 240 ml US cup, matched by ingredient and form.
 // Dry rice and cooked rice are deliberately separate. Never apply a generic
 // liquid density to unknown dry ingredients.
 const cupTable=Object.freeze({'plain flour':120,'all purpose flour':120,'all-purpose flour':120,'strong white bread flour':120,'self raising flour':120,'self-raising flour':120,flour:120,rice:185,'dry rice':185,'long-grain rice dry':185,'risotto rice':200,'cooked rice':158,oats:90,'rolled oats':90,breadcrumbs:108,'panko breadcrumbs':60,'caster sugar':190,'granulated sugar':200,'icing sugar':120,'light brown sugar':200,'soft brown sugar':200,butter:227,'unsalted butter':227,'cold butter':227,cheddar:113,'grated cheddar':113,'grated cheese':113,parmesan:100,'grated parmesan':100,mozzarella:112,ricotta:246,'cottage cheese':226,'cream cheese':225,'soured cream':240,'greek yoghurt':245,'natural yoghurt':245,yoghurt:245,pesto:240,'chopped tomatoes':240,passata:240,'chopped onion':160,onion:160,'red onion':160,carrot:128,carrots:128,'chopped carrot':128,celery:101,courgette:124,aubergine:82,'mixed peppers':149,'bell peppers':149,peppers:149,mushrooms:70,broccoli:91,spinach:30,'fresh spinach':30,'salad leaves':35,lettuce:36,'romaine lettuce':47,parsley:60,'fresh parsley':60,basil:24,'fresh basil':24,chives:48,cabbage:89,cucumber:104,tomato:180,'cherry tomatoes':149,potato:150,potatoes:150,'sweet potato':133,'frozen peas':145,peas:145,sweetcorn:164,'frozen sweetcorn':164,'kidney beans':177,'mixed beans':177,'butter beans':177,chickpeas:164,chickpea:164,'red lentils':192,'green lentils':192,couscous:173,quinoa:170,'penne pasta':100,penne:100,'dried pasta':100,pasta:100,orzo:180,'pitted dates':147,'chocolate chips':170,'cocoa powder':85,cornflour:128,cornflakes:28,blueberries:148,'dried apricots':130,'sesame seeds':144,'bicarbonate of soda':220,'baking powder':192,'vanilla ice cream':132,'ice cream':132});
 const countGrams=Object.freeze({aubergine:250,courgette:200,'mixed peppers':160,'bell peppers':160,peppers:160,onion:150,'red onion':150,cucumber:300,'sweet potato':200,'baking potato':200,avocado:150,carrot:80,potato:180,tomato:120,'spring onion':15,shallot:40,lettuce:300,apple:180,banana:120,lemon:100,lime:70,orange:180,broccoli:350,mushroom:20,'cherry tomatoes':15,parsnip:150});
 function cupGrams(value){const name=canonicalName(value),grams=cupTable[name];return grams?{grams,estimated:true,assumption:'Approximate ingredient-specific kitchen weight: 1 US cup (240 ml) '+name+' ≈ '+grams+' g. Check preparation and packing.'}:null;}
 function baseUnit(value){const name=canonicalName(value);if(!name)return null;if(isStaple(name))return 'staple';if(/^(?:whole )?eggs?$/.test(name)||/\bgarlic(?: cloves?)?$/.test(name)||/\b(?:wraps?|buns?|pitta breads?|flatbreads?|bread slices?)$/.test(name))return 'each';if(/\b(?:milk|cream|juice|liquid stock|stock|gravy|custard|syrup|extract|water)\b/.test(name)&&!/\b(?:powder|cube|cream cheese|ice cream|soured cream)\b/.test(name))return 'ml';return 'g';}
 function defaultPack(value,rawUnit,options={}){
  options=object(options)?options:{};
  const name=canonicalName(value,options.canonicalize),from=unit(rawUnit);if(!name)return null;
  let quantity=null,to='g';
  if(from==='tin'&&!/\b(?:fresh|frozen|dried|dry|raw)\b/.test(name)&&/\b(?:tomato(?:es)?|beans?|chickpeas?|lentils?)\b/.test(name))quantity=options.market==='US'?411:400;
  else if(from==='bag'&&!/\b(?:frozen|cooked|dried|dry)\b/.test(name)&&/\b(?:spinach|salad(?: leaves)?|mixed leaves|lettuce)\b/.test(name))quantity=200;
  else if(from==='pack'&&!/\b(?:cooked|ready|dried|dry)\b/.test(name)&&/\b(?:mince|minced (?:beef|pork|lamb|turkey))\b/.test(name))quantity=options.market==='US'?454:500;
  else if(from==='pint'&&/\bmilk\b/.test(name)){quantity=options.market==='US'?473:568;to='ml';}
  if(quantity===null)return null;
  return {quantity,unit:to,estimated:true,assumption:'Standard '+(options.market==='US'?'US':'UK')+' default: 1 '+from+' = '+quantity+' '+to+' for '+name+'. Check the actual container size.'};
 }
 function metric(value,rawUnit){
  const quantity=number(value),from=unit(rawUnit);if(quantity===null)return null;
  const factors={g:1,kg:1000,ml:1,l:1000,each:1,tbsp:15,tsp:5,oz:28.35,lb:453.6,'fl oz':30},factor=factors[from];if(factor===undefined)return null;
  const amount=round(quantity*factor);if(amount>MAX||quantity>0&&amount===0)return null;
  return {quantity:amount,unit:['kg','oz','lb'].includes(from)?'g':['l','tbsp','tsp','fl oz'].includes(from)?'ml':from,estimated:false,assumption:['tbsp','tsp'].includes(from)?'Standard culinary volume: 1 '+from+' = '+factor+' ml.':''};
 }
 function normalizeRaw(value,quantity,rawUnit,options={}){
  options=object(options)?options:{};
  const name=canonicalName(value,options.canonicalize),from=unit(rawUnit),count=number(quantity);if(!name||count===null)return null;
  if(from==='cup'){
   const density=cupGrams(name);if(density)return count*density.grams<=MAX?{quantity:round(count*density.grams),unit:'g',estimated:true,assumption:density.assumption}:null;
   if(baseUnit(name)==='ml'||isStaple(name))return count*240<=MAX?{quantity:round(count*240),unit:'ml',estimated:false,assumption:'US kitchen cup: 1 cup = 240 ml.'}:null;
   return null;
  }
  if(['loaf','loaves'].includes(from)&&/\bbread\b/.test(name))return {quantity:count*(options.market==='US'?567:800),unit:'g',estimated:true,assumption:'Estimated regional loaf weight; check the actual loaf.'};
  if(['slice','slices'].includes(from)&&/\bbread\b/.test(name))return {quantity:count*(options.market==='US'?28:50),unit:'g',estimated:true,assumption:'Estimated regional bread slice weight; check the actual slice.'};
  const direct=metric(count,from);if(direct){
   if(direct.unit==='g'&&(/^(?:whole )?eggs?$/.test(name)||name==='garlic')){const weight=name==='garlic'?5:50;return {quantity:round(direct.quantity/weight),unit:'each',estimated:true,assumption:'Estimated '+weight+' g per '+(name==='garlic'?'garlic clove':'egg')+'. Check the actual size.'};} 
   if(direct.unit==='each'&&countGrams[name])return {quantity:round(count*countGrams[name]),unit:'g',estimated:true,assumption:'Estimated '+countGrams[name]+' g per whole '+name+'. Review the actual size.'};
   if(direct.unit==='ml'&&baseUnit(name)==='g'){const density=cupGrams(name);if(density)return {quantity:round(direct.quantity*density.grams/240),unit:'g',estimated:true,assumption:density.assumption};return null;}
   return direct;
  }
  if(['stalk','stalks','stick','sticks'].includes(from)&&name==='celery')return {quantity:count*40,unit:'g',estimated:true,assumption:'Estimated 40 g per celery stalk. Check the actual size.'};
  if(from==='clove'&&/\bgarlic\b/.test(name))return {quantity:count,unit:'each',estimated:false,assumption:'1 garlic clove = 1 counted clove.'};
  if(from==='pint'){const size=options.market==='US'?473:568,amount=round(count*size);return amount<=MAX&&(count===0||amount>0)?{quantity:amount,unit:'ml',estimated:false,assumption:(options.market==='US'?'US':'UK')+' pint: 1 pint = '+size+' ml.'}:null;}
  if(from==='bulb'&&/\bgarlic\b/.test(name))return {quantity:count*10,unit:'each',estimated:true,assumption:'Estimated 10 cloves per garlic bulb. Check the actual bulb.'};
  if(!['tin','pack','bag','bottle','jar','pouch','bunch'].includes(from))return null;
  if(options.reviewed===true||options.packReviewed===true){
   const contents=metric(options.packQuantity,options.packUnit);if(!contents||!(contents.quantity>0))return null;
   const amount=round(count*contents.quantity);if(amount>MAX||count>0&&amount===0)return null;
   return {quantity:amount,unit:contents.unit,estimated:false,assumption:'Reviewed contents: 1 '+from+' = '+contents.quantity+' '+contents.unit+'.',packQuantity:contents.quantity,packUnit:contents.unit};
  }
  const pack=defaultPack(name,from,options);if(!pack)return null;
  const amount=round(count*pack.quantity);if(amount>MAX||count>0&&amount===0)return null;
  return {...pack,quantity:amount,packQuantity:pack.quantity,packUnit:pack.unit};
 }
 function normalize(value,quantity,rawUnit,options={}){const result=normalizeRaw(value,quantity,rawUnit,options);return result&&Number.isFinite(result.quantity)&&result.quantity>=0&&result.quantity<=MAX&&(Number(quantity)===0||result.quantity>0)?result:null;}
 function smallUse(value,quantity,rawUnit){
  if(!isStaple(value))return false;const from=unit(rawUnit),amount=number(quantity);
  if(['to taste','as needed'].includes(from))return true;
  if(amount===null||amount<=0)return false;
  if(['pinch','dash'].includes(from))return amount<=4;
  const measured=metric(amount,from);return !!measured&&(measured.unit==='ml'?measured.quantity<=60:measured.unit==='g'&&measured.quantity<=30);
 }
 function staplePurchase(input={}){
  if(!object(input))return null;
  const name=input.name||input.canonicalKey||input.key||input.description;if(!isStaple(name))return null;
  const from=unit(input.unit),quantity=number(input.quantity);
  let count=null,estimated=false;
  if(input.packCount!==undefined&&input.packCount!==null&&input.packCount!=='')count=number(input.packCount);
  else if(['each','pack','bottle','jar','pouch'].includes(from))count=quantity;
  else if(quantity!==null&&quantity>0&&(metric(quantity,from)||from==='cup')){count=1;estimated=true;}
  else if(number(input.packQuantity)>0&&metric(input.packQuantity,input.packUnit)){count=1;estimated=true;}
  if(count===null||!Number.isInteger(count)||count<=0||count>10000)return null;
  return {quantity:count,unit:'each',label:containerLabel(name),estimated,assumption:estimated?'One purchased container assumed for this measured receipt line. Check the container count.':'Purchased container count; contents are tracked by stock status.'};
 }
 function stapleStatus(record,stock){
  if(record===null||record===undefined)return 'unknown';
  if(typeof record==='string')record={status:record};
  const status=clean(record.stapleStatus??record.stockStatus??record.status).replace(/[ _-]+/g,' ');
  if(['in','in stock','available','on hand'].includes(status))return 'in';
  if(['low','running low'].includes(status))return 'low';
  if(['out','out of stock','empty'].includes(status))return 'out';
  const count=number(record.stapleCount??record.containerCount??record.count??record.qty);
  if(count!==null)return count>0?'in':'out';
  if(typeof stock==='number'){const amount=number(stock);if(amount!==null)return amount>0?'in':'out';}
  if(stock&&typeof stock==='object'&&record.bb173StockKey&&Object.hasOwn(stock,record.bb173StockKey)){const amount=number(stock[record.bb173StockKey]);if(amount!==null)return amount>0?'in':'out';}
  return 'unknown';
 }
 return Object.freeze({canonicalName,isStaple,containerLabel,defaultPack,normalize,smallUse,staplePurchase,stapleStatus,baseUnit,cupGrams,cupTable,countGrams});
});
