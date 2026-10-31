/* BasketBoss dinner metadata and confirmed-only Auto-fill rotation.
 * Metadata describes the dish; it never grants Free/Premium access.
 * Rotation candidates must also pass the caller's current entitlement check.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BBRecipePlanning=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const STORAGE_KEY='basketboss_autofill_rotation_v1';
  const text=value=>String(value||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
  const idOf=recipe=>typeof recipe?.id==='string'?recipe.id:'';
  function ingredientName(ingredient){return text(Array.isArray(ingredient)?ingredient[0]:(ingredient?.name||ingredient?.key));}
  const CHEESE=/\b(?:cheese|cheddar|mozzarella|parmesan|pecorino|ricotta|feta|halloumi|paneer|burrata|mascarpone|gruyere|brie|stilton)\b/;
  const PROTEINS=[
    ['chicken',/\bchicken\b/],['turkey',/\bturkey\b/],['beef',/\bbeef|brisket\b/],
    ['pork',/\bpork|bacon|ham|gammon|chorizo|pancetta|sausage(?:s)?\b/],['lamb',/\blamb\b/],['duck',/\bduck\b/],
    ['fish',/\bsalmon|tuna|cod|haddock|pollock|hake|trout|mackerel|sardines?|anchov(?:y|ies)|sea\s*bass|fish\b/],
    ['prawns',/\bprawns?|shrimp\b/],['seafood',/\bmussels?|clams?|scallops?|squid|calamari|crab|lobster|seafood\b/],
    ['tofu',/\btofu|tempeh|quorn\b/],['lentils',/\blentils?\b/],['chickpeas',/\bchickpeas?|chana|falafel\b/],
    ['beans',/\bbeans?|edamame\b/]
  ];
  function proteinAlias(value){
    if(typeof value!=='string')return null;
    const key=text(value).trim().replace(/[ _]+/g,'-');
    if(!/^[a-z][a-z0-9-]{0,39}$/.test(key))return null;
    const words=key.replace(/-/g,' ');
    for(const [protein,pattern] of PROTEINS)if(pattern.test(words))return protein;
    if(/^(?:egg|eggs)$/.test(key))return 'eggs';
    if(CHEESE.test(words))return 'cheese';
    if(/^(?:plant|vegetarian|vegan|vegetable|vegetables)$/.test(key))return 'vegetables';
    return key;
  }
  function isDinner(recipe){
    if(!recipe||!idOf(recipe))return false;
    const category=text(recipe.category)+' '+text(recipe.tag)+' '+text(recipe.mealType);
    const name=text(recipe.name);
    // A boolean flag cannot turn a labelled dessert into an Auto-fill dinner.
    if(/\b(?:desserts?|baking|breakfast|brunch|sweet treats?|snacks?|side dishes?|lunch(?:box)?|drinks?|smoothies?)\b|after.school/.test(category))return false;
    if(/\b(?:brownies?|cookies?|muffins?|cupcakes?|waffles?|porridge|granola|overnight oats|french toast)\b/.test(name))return false;
    const savouryPancakes=/\bokonomiyaki\b|\bsavou?ry\b.*\bpancakes?\b|\b(?:potato|courgette|cabbage|chickpea|spinach)\b.*\bpancakes?\b/.test(name);
    if(/\bpancakes?\b/.test(name)&&!savouryPancakes)return false;
    if(recipe.dinnerEligible===false)return false;
    return true;
  }
  function metadata(recipe){
    const name=text(recipe?.name);
    const ingredients=Array.isArray(recipe?.ingredients)?recipe.ingredients:[];
    // Broth, sauces and seasoning names are not evidence of a primary protein.
    const mainIngredients=ingredients.map(ingredientName).filter(s=>!(/\b(?:stock|broth|bouillon|flavou?r(?:ing)?|seasoning|gravy)\b|\b(?:fish|oyster) sauce\b/.test(s)));
    let primaryProtein=proteinAlias(recipe?.primaryProtein);
    if(!primaryProtein){
      const redSteak=s=>/\bsteaks?\b/.test(s)&&!(/\b(?:cauliflower|aubergine|eggplant|cabbage|mushroom|tofu|tempeh|vegetable|vegan|tuna|salmon|swordfish|fish)\b/.test(s));
      const beefIngredient=mainIngredients.some(s=>/\bbeef|brisket\b/.test(s)||redSteak(s));
      const scored=PROTEINS.map(([key,pattern],order)=>({key,order,score:(pattern.test(name)||(key==='beef'&&redSteak(name)&&beefIngredient)?100:0)+mainIngredients.reduce((score,s,index)=>score+(pattern.test(s)||(key==='beef'&&redSteak(s))?Math.max(1,20-index):0),0)}));
      scored.sort((a,b)=>b.score-a.score||a.order-b.order);
      if(scored[0].score>0)primaryProtein=scored[0].key;
      else if(/\beggs?|frittata|omelette|shakshuka\b/.test(name))primaryProtein='eggs';
      else if(/\bhalloumi|paneer|ricotta|burrata|goat.?s? cheese\b/.test(name))primaryProtein='cheese';
      else primaryProtein='vegetables';
    }
    let cheeseHeavy=typeof recipe?.cheeseHeavy==='boolean'?recipe.cheeseHeavy:null;
    if(cheeseHeavy===null){
      const servings=Math.max(1,Number(recipe?.baseServings)||Number(recipe?.servings)||4);
      let cheeseGrams=0;
      for(const ingredient of ingredients){
        if(!CHEESE.test(ingredientName(ingredient)))continue;
        const quantity=Array.isArray(ingredient)?ingredient[1]:ingredient?.quantity;
        const unit=Array.isArray(ingredient)?'':text(ingredient?.unit);
        const weight=String(quantity??'').match(/^\s*(\d+(?:\.\d+)?)\s*(kg|g)\b/i);
        if(weight)cheeseGrams+=Number(weight[1])*(text(weight[2])==='kg'?1000:1);
        else if(typeof quantity==='number'&&['kg','g'].includes(unit))cheeseGrams+=quantity*(unit==='kg'?1000:1);
      }
      // A planning heuristic, not a nutrition or child-suitability claim. New
      // recipes should set cheeseHeavy explicitly during editorial review.
      const cheeseLed=/\b(?:mac(?:aroni)?\s*(?:and\s*)?cheese|cheesy|four cheese|pizza|halloumi|paneer|burrata|parmesan|mozzarella|ricotta|feta|goat.?s? cheese)\b/.test(name);
      cheeseHeavy=cheeseLed||cheeseGrams/servings>=40;
    }
    return {primaryProtein,cheeseHeavy,dinnerEligible:isDinner(recipe)};
  }
  function annotate(recipes){return (Array.isArray(recipes)?recipes:[]).map(recipe=>({...recipe,...metadata(recipe)}));}
  function defaultStorage(){try{return typeof window!=='undefined'?window.localStorage:null;}catch(_){return null;}}
  function createRotation(options={}){
    const recipes=Array.isArray(options.recipes)?options.recipes:[];
    const byId=new Map(recipes.filter(r=>idOf(r)).map(r=>[r.id,r]));
    const allowed=typeof options.isAllowed==='function'?options.isAllowed:()=>false;
    const suitable=typeof options.isEligible==='function'?options.isEligible:()=>true;
    const eligible=recipes.filter(r=>isDinner(r)&&allowed(r)===true&&suitable(r)===true);
    const eligibleIds=new Set(eligible.map(r=>r.id));
    const storage=options.storage===undefined?defaultStorage():options.storage;
    const scope=options.scope===undefined?'default':String(options.scope);
    const key=(options.key||STORAGE_KEY)+':'+encodeURIComponent(scope);
    let originalRaw=null,storageReady=!!storage,seen=new Set(),cycle=0,last=[],recovered=false,lastReason='',committed=false;
    try{
      originalRaw=storage?.getItem(key)??null;
      if(originalRaw!==null){
        const saved=JSON.parse(originalRaw);
        if(saved?.version!==1||!Array.isArray(saved.seen)||!Number.isSafeInteger(saved.cycle)||saved.cycle<0)throw Error('Invalid rotation state');
        // Locked/unloaded Premium IDs remain history, never permissions. This
        // preserves the same account's progress across tier changes and loads.
        seen=new Set(saved.seen.slice(0,10000).filter(id=>typeof id==='string'&&/^[a-z0-9][a-z0-9._-]{0,255}$/i.test(id)));
        cycle=saved.cycle;
        last=Array.isArray(saved.last)?saved.last.filter(id=>typeof id==='string').slice(0,7):[];
      }else if(typeof options.legacyKey==='string'){
        const legacy=JSON.parse(storage?.getItem(options.legacyKey)||'[]');
        if(!Array.isArray(legacy)||legacy.some(id=>typeof id!=='string'))throw Error('Invalid legacy rotation state');
        seen=new Set(legacy);
      }
    }catch(error){
      // Malformed history is recovered in memory only; opening Auto-fill never
      // resets storage or consumes recipes. A confirmed commit writes recovery.
      if(originalRaw!==null){seen=new Set();cycle=0;recovered=true;}
      else storageReady=false;
    }
    const reserved=[];
    const selectedIds=new Set();
    function eligibilityChanged(){
      const current=new Set(recipes.filter(r=>isDinner(r)&&allowed(r)===true&&suitable(r)===true).map(r=>r.id));
      return current.size!==eligibleIds.size||[...current].some(id=>!eligibleIds.has(id));
    }
    const resolve=entry=>entry?.recipe||byId.get(entry?.recipeId||entry?.id)||null;
    function planEntries(planned){
      const byDay=new Map(),undated=[];
      for(const entry of [...(Array.isArray(planned)?planned:[]),...reserved]){
        const recipe=resolve(entry);
        if(!recipe)continue;
        const row={day:entry.day,recipe};
        if(DAYS.includes(row.day))byDay.set(row.day,row);else undated.push(row);
      }
      return [...byDay.values(),...undated];
    }
    function filter(candidates,context={}){
      if(committed){lastReason='session-committed';return [];}
      if(!storageReady){lastReason='rotation-storage-unavailable';return [];}
      if(!eligibleIds.size){lastReason='no-eligible-dinners';return [];}
      if(eligibilityChanged()){lastReason='rotation-access-changed';return [];}
      if(!DAYS.includes(context.day)){lastReason='invalid-day';return [];}
      // Category, time and protein constraints never cause an early reset.
      // Only having seen every currently accessible eligible dinner does.
      if([...eligibleIds].every(id=>seen.has(id))){seen=new Set([...seen].filter(id=>!eligibleIds.has(id)));cycle++;}
      const plan=planEntries(context.planned),plannedIds=new Set(plan.map(row=>row.recipe.id));
      if(plan.some(row=>row.day===context.day)){lastReason='occupied-day';return [];}
      const dayIndex=DAYS.indexOf(context.day);
      const neighbours=plan.filter(row=>dayIndex>=0&&Math.abs(DAYS.indexOf(row.day)-dayIndex)===1&&DAYS.includes(row.day));
      const neighbouringProteins=new Set(neighbours.map(row=>metadata(row.recipe).primaryProtein));
      if(dayIndex===0&&typeof options.previousProtein==='string')neighbouringProteins.add(proteinAlias(options.previousProtein));
      const heavy=plan.filter(row=>metadata(row.recipe).cheeseHeavy).length;
      const pool=(Array.isArray(candidates)?candidates:[]).filter(r=>idOf(r)&&eligibleIds.has(r.id)&&!plannedIds.has(r.id)&&!selectedIds.has(r.id));
      const unseen=pool.filter(r=>!seen.has(r.id));
      const result=unseen.filter(r=>{
        const m=metadata(r);
        return !neighbouringProteins.has(m.primaryProtein)&&(!m.cheeseHeavy||heavy<2);
      });
      lastReason=result.length?'':!pool.length?'no-recipes-match':!unseen.length?'rotation-filter-exhausted':'variety-filter-exhausted';
      return result;
    }
    function take(recipe,context={}){
      const canonical=byId.get(recipe?.id);
      if(!canonical||!filter([canonical],context).length)return false;
      seen.add(canonical.id);selectedIds.add(canonical.id);reserved.push({day:context.day,recipeId:canonical.id});
      lastReason='';return true;
    }
    function choose(candidates,context={}){
      const available=filter(candidates,context);
      if(!available.length)return null;
      const selected=typeof context.pick==='function'?context.pick(available):available[0];
      return selected&&take(selected,context)?byId.get(selected.id):null;
    }
    function commit(){
      if(committed)return true;
      if(!storageReady){lastReason='rotation-storage-unavailable';return false;}
      if(eligibilityChanged()){lastReason='rotation-access-changed';return false;}
      if(!reserved.length)return true;
      try{
        if((storage.getItem(key)??null)!==originalRaw){lastReason='rotation-changed';return false;}
        const raw=JSON.stringify({version:1,cycle,seen:[...seen],last:[...selectedIds].slice(-7)});
        storage.setItem(key,raw);
        if(storage.getItem(key)!==raw)throw Error('Rotation write did not persist');
        originalRaw=raw;committed=true;lastReason='';return true;
      }catch(error){lastReason='rotation-storage-unavailable';return false;}
    }
    return {
      key,eligible:eligible.slice(),filter,take,choose,commit,
      get reason(){return lastReason;},
      snapshot:()=>({version:1,cycle,seen:[...seen],last:[...last],selected:[...selectedIds],eligibleCount:eligibleIds.size,recovered,storageReady,committed})
    };
  }
  return Object.freeze({DAYS,STORAGE_KEY,metadata,isDinner,annotate,proteinAlias,createRotation});
});
