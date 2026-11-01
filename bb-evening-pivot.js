/* Evening Pivot: read-only comparisons of dinners already on this week's plan.
 * No generated recipes, stock credits, inferred use-by dates or storage writes. */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BBEveningPivot=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const DAYS=Object.freeze(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']);
  const normalize=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  function canonical(value){
    return normalize(value).replace(/\s+(?:(?:washed|cored|drained) and (?:sliced|rinsed)|(?:thinly|thickly|finely|roughly) (?:chopped|sliced|crushed|grated|diced)|(?:chopped|sliced|crushed|grated|halved|quartered|diced|peeled|shredded|drained|rinsed))$/,'').replace(/^(?:fresh|large|small|medium) /,'').replace(/^garlic cloves?$/,'garlic').trim();
  }
  const preserved=/\b(?:tinned|canned|jarred|dried|dehydrated|powder(?:ed)?|frozen|freeze dried|stock|broth|bouillon|seasoning|flour|cornflour|breadcrumbs?|panko|cornflakes|baking powder|bicarbonate|vanilla extract|cocoa|sugar|salt|honey|syrup|vinegar|oil|soy sauce|soya sauce|fish sauce|oyster sauce|teriyaki sauce|bbq sauce|ketchup|mustard|jam|chutney|relish|passata|tomato puree|tomato paste|chopped tomatoes|curry paste|curry powder|chilli flakes?|chilli powder|paprika|cumin|cinnamon|nutmeg|saffron|coriander seeds?|sesame seeds?|pine nuts?|peanuts?|almonds?|cashews?|walnuts?|hazelnuts?|pistachios?|pecans?|olives?|capers?|water)\b/;
  const chilled=/\b(?:chicken|beef|pork|lamb|mutton|turkey|duck|venison|meat|sausages?|steaks?|brisket|bacon|ham|gammon|chorizo|pancetta|salami|prosciutto|mince|salmon|tuna|cod|haddock|pollock|hake|trout|fish|seafood|prawns?|shrimp|mussels?|squid|calamari|scallops?|crab|lobster|eggs?|milk|cream|cheese|cheddar|parmesan|mozzarella|feta|halloumi|ricotta|burrata|mascarpone|paneer|yog(?:h)?urt|butter|tofu|tempeh|hummus|coleslaw)\b/;
  const produce=/\b(?:apples?|bananas?|oranges?|lemons?|limes?|pears?|berries|blueberries|raspberries|strawberries|pineapple|grapes?|avocados?|fruit|asparagus|aubergines?|eggplants?|beetroots?|broccoli|tenderstem|cauliflower|cabbage|carrots?|celery|chill?is?|courgettes?|zucchini|cucumbers?|garlic|ginger|leeks?|lettuce|onions?|shallots?|scallions?|peppers?|potato(?:es)?|parsnips?|pumpkin|spinach|pak choi|mushrooms?|salad|rocket|sweetcorn|peas|edamame|squash|tomato(?:es)?|vegetables?|herbs?|parsley|basil|chives?|mint|rosemary|sage|thyme|coriander|cilantro|dill)\b/;
  const pantry=/\b(?:rice|pasta|penne|spaghetti|linguine|macaroni|fusilli|orzo|noodles?|udon|soba|couscous|quinoa|bulgur|polenta|oats?|lentils?|chickpeas?|beans?|cereal|granola|chocolate|raisins?|dates?|apricots?|tortilla chips|crisps?|crackers?|biscuits?)\b/;
  function freshIngredients(recipe){
    if(!recipe)return [];
    const declared=Array.isArray(recipe.ingredients)?recipe.ingredients:[],items=new Map();
    for(const ingredient of declared){
      const name=String(Array.isArray(ingredient)?ingredient[0]:typeof ingredient==='string'?ingredient:ingredient?.name||ingredient?.key||'').trim();
      if(!name)continue;
      const key=canonical(Array.isArray(ingredient)?name:ingredient?.key||name),words=normalize(name),state=normalize(ingredient?.state||ingredient?.storage);
      if(!key)continue;
      // A preservation term must describe the whole ingredient. Oil or honey
      // within a meat ingredient does not make that meat safe to postpone.
      const thawed=/\b(?:thawed|defrosted)\b/.test(state+' '+words);
      const declaredFresh=thawed||/\b(?:fresh|raw|chilled|refrigerated)\b/.test(state+' '+words);
      const preservedState=/\b(?:frozen|canned|tinned|dried|shelf stable)\b/.test(state);
      const preservedName=/^(?:tinned|canned|jarred|dried|dehydrated|freeze dried|sun dried|frozen)\b/.test(words);
      if(!thawed&&(preservedState||preservedName))continue;
      const nonFreshFood=/^(?:butter beans?|peanut butter|coconut milk|condensed milk|evaporated milk|egg noodles?|black pepper|white pepper|peppercorns?)(?:\s|$)/.test(words);
      // Named stock/sauce products are derivatives rather than the fresh animal
      // or vegetable. Explicit fresh/chilled forms still require a date check.
      const pantryDerivative=/\b(?:stock|broth|bouillon)(?: (?:cubes?|pots?|powder|granules?))?$/.test(words)||/^(?:(?:light|dark|sweet|hot|ground) )?(?:soy|soya|fish|oyster|teriyaki|bbq|chilli|tomato|peppercorn) sauce$/.test(words)||/\b(?:paste|puree|vinegar|oil|jam|chutney|relish|seasoning|powder)$/.test(words);
      const namedFreshFood=chilled.test(words)||produce.test(words);
      const compoundFresh=namedFreshFood&&/\b(?:with|in|marinated|glazed|coated|rubbed|seasoned)\b/.test(words);
      const obviousFresh=declaredFresh||compoundFresh||(!nonFreshFood&&!pantryDerivative&&namedFreshFood);
      if(!obviousFresh&&(nonFreshFood||pantryDerivative||preserved.test(words)||pantry.test(words)))continue;
      items.set(key,{key,name,kind:obviousFresh?'fresh':'check'});
    }
    if(!declared.length||!declared.some(x=>Array.isArray(x)?x[0]:typeof x==='string'?x:x?.name||x?.key))items.set('ingredients-unavailable',{key:'ingredients-unavailable',name:'Ingredients for '+String(recipe.name||'this dinner'),kind:'check'});
    return [...items.values()];
  }
  function localDate(value){
    if(value instanceof Date)return Number.isFinite(value.getTime())?new Date(value.getTime()):null;
    if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)){
      const [year,month,day]=value.split('-').map(Number),date=new Date(year,month-1,day);
      return date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day?date:null;
    }
    return null;
  }
  const dateISO=date=>String(date.getFullYear()).padStart(4,'0')+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
  const weekday=date=>DAYS[(date.getDay()+6)%7];
  const duration=recipe=>typeof recipe?.mins==='number'&&Number.isFinite(recipe.mins)&&recipe.mins>0&&recipe.mins<=1440?recipe.mins:null;
  const validCount=value=>Number.isInteger(Number(value))&&Number(value)>=1&&Number(value)<=12?Number(value):null;
  function check(fn,...args){try{return typeof fn==='function'&&fn(...args)===true;}catch(_){return false;}}
  function countFor(fn,day,recipe){try{return validCount(typeof fn==='function'?fn(day,recipe):null);}catch(_){return null;}}
  function validPlan(planned){return Array.isArray(planned)&&planned.every(x=>x&&DAYS.includes(x.day)&&typeof x.recipeId==='string'&&x.recipeId)&&new Set(planned.map(x=>x.day)).size===planned.length;}
  function getSuggestions(options={}){
    const {planned,allowed,recipeAllowed,servingsForDay,isLinked,isReady,useBy}=options;
    const date=localDate(options.date===undefined?new Date():options.date);
    if(!date||!validPlan(planned)||!Array.isArray(options.recipes)||typeof isLinked!=='function')return [];
    const today=options.today===undefined?weekday(date):options.today;
    if(today!==weekday(date)||!DAYS.includes(today)||!check(day=>!isLinked?.(day),today))return [];
    const byId=new Map(options.recipes.filter(x=>typeof x?.id==='string').map(x=>[x.id,x]));
    const current=planned.find(x=>x.day===today),currentRecipe=byId.get(current?.recipeId),currentMinutes=duration(currentRecipe);
    const currentServings=countFor(servingsForDay,today,currentRecipe);
    if(!currentRecipe||!currentMinutes||!currentServings||!check(allowed,currentRecipe))return [];
    const fresh=freshIngredients(currentRecipe),results=[];
    for(const entry of planned){
      const day=entry.day,offset=DAYS.indexOf(day)-DAYS.indexOf(today);
      if(offset<=0||!check(value=>!isLinked?.(value),day)||entry.recipeId===current.recipeId)continue;
      const candidateRecipe=byId.get(entry.recipeId),minutes=duration(candidateRecipe);
      const candidateServings=countFor(servingsForDay,day,candidateRecipe);
      if(!candidateRecipe||minutes===null||currentMinutes-minutes<5||!candidateServings||!check(allowed,candidateRecipe)||!check(recipeAllowed,candidateRecipe))continue;
      if(!check(isReady,candidateRecipe,{day,fromDay:day,toDay:today,servings:candidateServings}))continue;
      const movedDate=new Date(date.getFullYear(),date.getMonth(),date.getDate()+offset),movedDateISO=dateISO(movedDate);
      let expired=false;
      const requiresFreshness=fresh.map(item=>{
        let raw=null;try{raw=typeof useBy==='function'?useBy(item.key,item):useBy?.[item.key];}catch(_){}
        const known=localDate(raw);
        if(known&&dateISO(known)<movedDateISO)expired=true;
        return {...item,...(known?{useByISO:dateISO(known)}:{})};
      });
      if(expired)continue;
      results.push({day,candidateRecipe,currentRecipe,minsSaved:currentMinutes-minutes,movedDateISO,requiresFreshness,currentServings,candidateServings});
    }
    return results.sort((a,b)=>Number(duration(b.candidateRecipe)<=30)-Number(duration(a.candidateRecipe)<=30)||b.minsSaved-a.minsSaved||DAYS.indexOf(a.day)-DAYS.indexOf(b.day));
  }
  function previewSwap(options={}){
    const {planned,today,day,servingsForDay}=options;
    if(!validPlan(planned)||!DAYS.includes(today)||DAYS.indexOf(day)<=DAYS.indexOf(today))return null;
    const byId=new Map((Array.isArray(options.recipes)?options.recipes:[]).map(x=>[x.id,x]));
    const current=planned.find(x=>x.day===today),candidate=planned.find(x=>x.day===day);
    const currentRecipe=byId.get(current?.recipeId),candidateRecipe=byId.get(candidate?.recipeId);
    if(!currentRecipe||!candidateRecipe||currentRecipe.id===candidateRecipe.id)return null;
    const currentServings=countFor(servingsForDay,today,currentRecipe),candidateServings=countFor(servingsForDay,day,candidateRecipe);
    if(!currentServings||!candidateServings)return null;
    return {
      planned:planned.map(entry=>entry.day===today?{...entry,recipeId:candidate.recipeId}:entry.day===day?{...entry,recipeId:current.recipeId}:{...entry}),
      dayServings:{...(options.dayServings||{}),[today]:{recipeId:candidate.recipeId,count:candidateServings},[day]:{recipeId:current.recipeId,count:currentServings}}
    };
  }
  return Object.freeze({DAYS,canonical,freshIngredients,getSuggestions,previewSwap});
});
