/* Personal Auto-fill ingredient choices. These describe declared ingredients,
 * never grant recipe access and never change meals already on the planner. */
(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BBIngredientPreferences=api;
})(typeof window!=='undefined'?window:null,function(root){
  'use strict';
  const STORAGE_KEY='basketboss_ingredient_avoidance_v1';
  const text=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’']/g,'').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
  // Ingredient families include preparation forms and named derivatives, e.g.
  // chicken stock. Composite products only match their declared ingredient name.
  const rows=[
    ['chicken','Chicken','Meat & fish','Cooked chicken','🍗',/\bchicken\b/,'food-thumbs/chicken-breast.webp'],
    ['beef','Beef','Meat & fish','Beef','🥩',/\bbeef|brisket|sirloin|ribeye|rump|fillet steak\b/],
    ['pork','Pork','Meat & fish','Bacon','🥓',/\bpork|bacon|ham|gammon|chorizo|pancetta|prosciutto|salami\b/],
    ['sausages','Sausages','Meat & fish','Frozen sausages','🌭',/\bsausages?\b/],
    ['lamb','Lamb','Meat & fish','Lamb','🍖',/\blamb|mutton\b/],
    ['turkey','Turkey','Meat & fish','Turkey','🦃',/\bturkey\b/],
    ['duck','Duck','Meat & fish','Duck','🦆',/\bduck\b/],
    ['fish','Fish','Meat & fish','Frozen fish','🐟',/\bfish|salmon|tuna|cod|haddock|pollock|hake|trout|mackerel|sardines?|anchov(?:y|ies)|seabass|sea bass|swordfish\b/],
    ['prawns','Prawns','Meat & fish','Frozen prawns','🦐',/\bprawns?|shrimp\b/],
    ['shellfish','Other shellfish','Meat & fish','Shellfish','🦪',/\bmussels?|clams?|scallops?|oysters?|squid|calamari|crab|lobster\b/],
    ['eggs','Eggs','Dairy & alternatives','Eggs','🥚',/\beggs?\b/],
    ['cheese','Cheese','Dairy & alternatives','Cheddar','🧀',/\bcheese|cheddar|mozzarella|parmesan|pecorino|ricotta|feta|halloumi|paneer|burrata|mascarpone|gruyere|brie|stilton\b/],
    ['milk','Milk','Dairy & alternatives','Milk','🥛',/\bmilk\b/],
    ['cream','Cream','Dairy & alternatives','Cream','🥛',/\bcream\b/],
    ['yoghurt','Yoghurt','Dairy & alternatives','Yoghurt','🥣',/\byog(?:h)?urt(?:s)?\b/],
    ['butter','Butter','Dairy & alternatives','Butter','🧈',/\bbutter\b/],
    ['tofu','Tofu & tempeh','Dairy & alternatives','Tofu','🧊',/\btofu|tempeh\b/],
    ['onion','Onions','Vegetables','Onion','🧅',/\bonions?|shallots?|scallions?\b/],
    ['garlic','Garlic','Vegetables','Garlic','🧄',/\bgarlic\b/],
    ['mushrooms','Mushrooms','Vegetables','Mushrooms','🍄',/\bmushrooms?|shiitake|portobello|porcini\b/],
    ['peppers','Peppers','Vegetables','Bell peppers','🫑',/\bpeppers\b|\b(?:bell|red|yellow|green|orange|sweet) pepper\b/],
    ['tomatoes','Tomatoes','Vegetables','Tomatoes','🍅',/\btomato(?:es)?|passata\b/],
    ['broccoli','Broccoli','Vegetables','Broccoli','🥦',/\bbroccoli|tenderstem\b/],
    ['carrots','Carrots','Vegetables','Carrots','🥕',/\bcarrots?\b/],
    ['spinach','Spinach','Vegetables','Spinach','🥬',/\bspinach\b/],
    ['courgette','Courgette','Vegetables','Courgette','🥒',/\bcourgettes?|zucchini\b/,'food-thumbs/courgette.webp'],
    ['aubergine','Aubergine','Vegetables','Aubergine','🍆',/\baubergines?|eggplants?\b/],
    ['peas','Peas','Vegetables','Frozen peas','🫛',/\bpeas\b/],
    ['sweetcorn','Sweetcorn','Vegetables','Frozen sweetcorn','🌽',/\bsweetcorn|sweet corn|corn kernels\b/],
    ['cabbage','Cabbage','Vegetables','Cabbage','🥬',/\bcabbage|coleslaw\b/],
    ['celery','Celery','Vegetables','Celery','🥬',/\bcelery|celeriac\b/],
    ['leeks','Leeks','Vegetables','Leeks','🥬',/\bleeks?\b/],
    ['cauliflower','Cauliflower','Vegetables','Cauliflower','🥦',/\bcauliflower\b/],
    ['cucumber','Cucumber','Vegetables','Cucumber','🥒',/\bcucumbers?\b/],
    ['lettuce','Lettuce & salad leaves','Vegetables','Lettuce','🥬',/\blettuce|salad leaves|rocket|arugula|watercress\b/],
    ['asparagus','Asparagus','Vegetables','Asparagus','🌱',/\basparagus\b/],
    ['potatoes','Potatoes','Vegetables','Potatoes','🥔',/\bpotato(?:es)?|gnocchi\b/],
    ['sweet-potatoes','Sweet potatoes','Vegetables','Sweet potatoes','🍠',/\bsweet potato(?:es)?\b/],
    ['beans','Beans','Pulses & grains','Tinned beans','🫘',/\bbeans?|edamame\b/],
    ['chickpeas','Chickpeas','Pulses & grains','Chickpeas','🫘',/\bchickpeas?|chana|falafel\b/],
    ['lentils','Lentils','Pulses & grains','Lentils','🫘',/\blentils?|dhal|dal\b/],
    ['rice','Rice','Pulses & grains','Rice','🍚',/\brice\b/],
    ['pasta','Pasta','Pulses & grains','Pasta','🍝',/\bpasta|penne|spaghetti|linguine|tagliatelle|macaroni|fusilli|rigatoni|orzo|tortellini|ravioli|lasagn[ae]\b/],
    ['noodles','Noodles','Pulses & grains','Noodles','🍜',/\bnoodles?|udon|soba|ramen\b/],
    ['bread','Bread & breadcrumbs','Pulses & grains','Bread','🍞',/\bbread|breadcrumbs?|panko|baguettes?|brioche|buns?|flatbreads?|pitta|pita|bagels?|croutons?\b/],
    ['oats','Oats','Pulses & grains','Oats','🥣',/\boats?|oatmeal\b/],
    ['peanuts','Peanuts','Flavours & extras','Peanut butter','🥜',/\bpeanuts?|groundnuts?\b/],
    ['nuts','Other nuts','Flavours & extras','Nuts','🌰',/\balmonds?|cashews?|walnuts?|hazelnuts?|pistachios?|pecans?|brazil nuts?|macadamia|pine nuts?\b/],
    ['sesame','Sesame','Flavours & extras','Sesame','🌰',/\bsesame|tahini\b/],
    ['coconut','Coconut','Flavours & extras','Coconut','🥥',/\bcoconut\b/],
    ['chilli','Chilli','Flavours & extras','Chilli','🌶️',/\bchill?i(?:es)?|jalapenos?|cayenne|sriracha|harissa\b/],
    ['ginger','Ginger','Flavours & extras','Ginger','🫚',/\bginger\b/],
    ['olives','Olives','Flavours & extras','Olives','🫒',/\bolives?\b/],
    ['coriander','Coriander','Flavours & extras','Coriander','🌿',/\bcoriander|cilantro\b/],
    ['lemon','Lemon','Flavours & extras','Lemon','🍋',/\blemons?\b/],
    ['lime','Lime','Flavours & extras','Lime','🍋‍🟩',/\blimes?\b/],
    ['mustard','Mustard','Flavours & extras','Mustard','🟡',/\bmustard\b/],
    ['soy-sauce','Soy sauce','Flavours & extras','Soy sauce','🥢',/\bsoy sauce|soya sauce|tamari\b/],
    ['honey','Honey','Flavours & extras','Honey','🍯',/\bhoney\b/]
  ];
  const aliases={chicken:['chicken breast','chicken thighs','chicken stock'],beef:['steak','mince','brisket'],pork:['bacon','ham','gammon','chorizo'],fish:['salmon','tuna','cod','haddock','anchovies'],prawns:['shrimp'],shellfish:['mussels','oysters','squid','crab'],cheese:['cheddar','parmesan','halloumi','feta','mozzarella'],onion:['onions','shallots','spring onion','scallion'],peppers:['bell pepper','capsicum'],tomatoes:['tomato','passata'],courgette:['zucchini'],aubergine:['eggplant'],peas:['pea'],sweetcorn:['corn'],lettuce:['rocket','arugula','salad'],beans:['kidney beans','butter beans','edamame'],chickpeas:['chana','falafel'],lentils:['dal','dhal'],pasta:['spaghetti','penne','orzo','lasagne'],bread:['panko','breadcrumbs','pitta','brioche'],nuts:['almonds','cashews','walnuts'],sesame:['tahini'],chilli:['chili','jalapeno','cayenne'],coriander:['cilantro'],tofu:['tempeh'],yoghurt:['yogurt']};
  const CATALOG=Object.freeze(rows.map(([id,name,group,thumbnail,emoji,,image])=>Object.freeze({id,name,group,thumbnail,emoji,searchTerms:Object.freeze(aliases[id]||[]),...(image?{image}:{})})));
  const patterns=new Map(rows.map(row=>[row[0],new RegExp('\\b(?:'+row[5].source+')\\b')]));
  const ids=new Set(CATALOG.map(x=>x.id));
  function validIds(value){return Array.isArray(value)?CATALOG.filter(x=>value.includes(x.id)).map(x=>x.id):[];}
  const validScope=value=>typeof value==='string'&&/^[a-z0-9._-]{1,128}$/i.test(value)&&!['__proto__','constructor','prototype'].includes(value);
  function normalize(value){
    if(value?.version!==1||!validScope(value.scope)||!Array.isArray(value.excluded))return null;
    return {version:1,scope:value.scope,excluded:validIds(value.excluded)};
  }
  function ingredientNames(recipe){
    return (Array.isArray(recipe?.ingredients)?recipe.ingredients:[]).flatMap(ingredient=>{
      if(Array.isArray(ingredient))return [text(ingredient[0])];
      if(typeof ingredient==='string')return [text(ingredient)];
      return [text(ingredient?.name),text(ingredient?.key)];
    }).filter(Boolean);
  }
  function ingredientMatches(id,name){
    name=text(name);
    // Keep similar words and distinct foods separate. These exceptions are
    // ingredient-name rules, not assumptions about an entire recipe's diet.
    if(id==='milk'&&/\b(?:coconut|almond|oat|soya?|rice|cashew|hazelnut|plant) milk\b/.test(name))return false;
    if(['cream','yoghurt'].includes(id)&&/\b(?:coconut|oat|soya?|vegan|plant)\b/.test(name))return false;
    if(id==='butter'&&/\bbutter beans?\b|\b(?:peanut|almond|cashew|nut|cocoa|apple) butter\b/.test(name))return false;
    if(id==='potatoes'&&/\bsweet potato(?:es)?\b/.test(name))return false;
    if(id==='beans'&&/\b(?:vanilla|cocoa|coffee) beans?\b/.test(name))return false;
    if(id==='olives'&&/\bolive oil\b/.test(name))return false;
    if(id==='pork'&&/\bsausages?\b/.test(name)&&!(/\bchicken|turkey|beef|lamb|vegan|vegetarian|plant\b/.test(name)))return true;
    if(id==='beef'&&/\bsteaks?\b/.test(name)&&!(/\bcauliflower|cabbage|aubergine|eggplant|mushroom|tofu|tempeh|vegetable|vegan|tuna|salmon|swordfish|fish|pork|lamb\b/.test(name)))return true;
    return patterns.get(id)?.test(name)===true;
  }
  let adapter=null;
  const listeners=new Set();
  function scope(){
    try{const value=JSON.parse(root?.localStorage?.getItem('basketboss_cloud_session_v1')||'null');const id=value?.user?.id;
      return validScope(id)?id:'guest';
    }catch(_){return 'guest';}
  }
  function read(){
    if(adapter)return normalize(adapter.read());
    try{return normalize(JSON.parse(root?.localStorage?.getItem(STORAGE_KEY+':'+scope())||'null'));}catch(_){return null;}
  }
  function getSelected(){const value=read();return value?.scope===scope()?value.excluded.slice():[];}
  function matches(recipe,selected=getSelected()){
    const names=ingredientNames(recipe);
    return validIds(selected).filter(id=>names.some(name=>ingredientMatches(id,name)));
  }
  function recipeAllowed(recipe,selected=getSelected()){return !!recipe&&matches(recipe,selected).length===0;}
  function emit(){const value={scope:scope(),selected:getSelected()};for(const listener of listeners)try{listener(value);}catch(_){};}
  function setSelected(value){
    if(!Array.isArray(value)||value.some(id=>!ids.has(id)))return {ok:false,selected:getSelected(),error:'Choose ingredients from the list.'};
    const excluded=validIds(value),next={version:1,scope:scope(),excluded};
    try{
      if(root?.BBAccountDeletion?.isDeleting?.()===true)throw Error('Account deletion is in progress.');
      if(adapter){if(adapter.write(next)!==true)throw Error('Could not save ingredient choices.');}
      else{
        if(!root?.localStorage)throw Error('Saving is unavailable.');
        const key=STORAGE_KEY+':'+scope(),raw=JSON.stringify(next);
        root.localStorage.setItem(key,raw);
        if(root.localStorage.getItem(key)!==raw)throw Error('Could not save ingredient choices.');
      }
      emit();return {ok:true,selected:excluded.slice()};
    }catch(error){return {ok:false,selected:getSelected(),error:error?.message||'Could not save ingredient choices.'};}
  }
  function configure(value){
    if(typeof value?.read!=='function'||typeof value?.write!=='function')throw Error('Ingredient state adapter requires read and write.');
    adapter=value;emit();
  }
  root?.addEventListener?.('basketboss:session-changed',emit);
  root?.addEventListener?.('storage',event=>{if(event.key===null||event.key==='basketboss_cloud_session_v1'||event.key?.startsWith(STORAGE_KEY)||event.key==='basketboss_321_unified_state_v1')emit();});
  return Object.freeze({CATALOG,STORAGE_KEY,normalize,ingredientNames,ingredientMatches,scope,getSelected,setSelected,matches,recipeAllowed,configure,subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);}});
});
