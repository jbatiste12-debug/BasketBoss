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
  function isLegacyDinner(recipe){
    if(!recipe||!idOf(recipe))return false;
    // A serving of potatoes is a side, not an automatic standalone dinner.
    if(recipe.id==='extra-air-fryer-garlic-parmesan-potatoes')return false;
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
  // This generated build alone opts into the reviewed version-700 roles.
  const catalogue700Policy=(function(){// Staged catalogue-700 policy only. This module is deliberately not imported
// by app.html, native bundles, the current API, or the catalogue-500 planner.
// The reviewed role manifest is data, never a Free/Premium entitlement grant.
const text=value=>String(value||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
const NON_DINNER=/\b(?:desserts?|baking|breakfast|brunch|sweet treats?|snacks?|side dishes?|lunch(?:box)?|drinks?|smoothies?)\b|after.school/;
const SWEET_NAME=/\b(?:brownies?|cookies?|muffins?|cupcakes?|waffles?|porridge|granola|overnight oats|french toast)\b/;
const ID=/^[a-z0-9][a-z0-9._-]{0,255}$/i;

function isCatalogueDinner(recipe,{catalogueVersion=500,roles,legacyIsDinner}={}){
 if(typeof legacyIsDinner!=='function')return false;
 // No new interpretation is introduced for any existing client/catalogue.
 if(catalogueVersion!==700)return legacyIsDinner(recipe)===true;
 if(!recipe||typeof recipe.id!=='string'||!ID.test(recipe.id))return false;
 if(roles?.schemaVersion!==1||roles.catalogueVersion!==700||roles.legacyCatalogueVersion!==500||!Array.isArray(roles.legacyRecipeIds)||roles.legacyRecipeIds.length!==500||new Set(roles.legacyRecipeIds).size!==500||roles.legacyRecipeIds.some(id=>typeof id!=='string'||!ID.test(id))||!Array.isArray(roles.recipes))return false;
 // Existing IDs always use the exact old predicate, including old objects
 // with no catalogueNumber. Unknown IDs cannot masquerade as such objects.
 if(roles.legacyRecipeIds.includes(recipe.id))return legacyIsDinner(recipe)===true;
 if(new Set(roles.recipes.map(role=>role?.id)).size!==roles.recipes.length||new Set(roles.recipes.map(role=>role?.catalogueNumber)).size!==roles.recipes.length||roles.recipes.some(role=>!role||typeof role.id!=='string'||!ID.test(role.id)||roles.legacyRecipeIds.includes(role.id)||!Number.isInteger(role.catalogueNumber)||role.catalogueNumber<501||role.catalogueNumber>700||!['dinner','breakfast','dessert','starter','side'].includes(role.kind)))return false;
 const number=recipe.catalogueNumber;
 if(!Number.isInteger(number)||number<501||number>700)return false;
 const matches=roles.recipes.filter(role=>role?.id===recipe.id);
 if(matches.length!==1)return false;
 const role=matches[0];
 if(role.catalogueNumber!==number||role.kind!=='dinner'||recipe.dinnerEligible!==true)return false;
 // Even an explicit dinner flag cannot route a labelled breakfast/dessert
 // into Auto-fill. Reviewed savoury duck pancakes remain a valid dinner.
 const category=[recipe.category,recipe.tag,recipe.mealType].map(text).join(' ');
 const reviewedSavouryWaffles=recipe.id==='southern-chicken-and-waffles'&&number===641&&text(recipe.name)==='southern chicken and waffles'&&recipe.primaryProtein==='chicken';
 return !NON_DINNER.test(category)&&(!SWEET_NAME.test(text(recipe.name))||reviewedSavouryWaffles);
}

// A generated catalogue's authored roles do not change during the session.
// Validate and copy those primitives once; recipe eligibility remains live.
// Keep the dynamic validator above for callers passing mutable role manifests.
function compileCatalogueDinner({catalogueVersion=500,roles,legacyIsDinner}={}){
 if(typeof legacyIsDinner!=='function')return ()=>false;
 if(catalogueVersion!==700)return recipe=>legacyIsDinner(recipe)===true;
 const legacy=roles?.legacyRecipeIds;
 if(roles?.schemaVersion!==1||roles.catalogueVersion!==700||roles.legacyCatalogueVersion!==500||!Array.isArray(legacy)||legacy.length!==500||new Set(legacy).size!==500||legacy.some(id=>typeof id!=='string'||!ID.test(id))||!Array.isArray(roles.recipes))return ()=>false;
 const legacyIds=new Set(legacy),roleIds=new Set(),numbers=new Set(),byId=new Map();
 let validNewRoles=true;
 for(const source of roles.recipes){
  const role=source&&{id:source.id,catalogueNumber:source.catalogueNumber,kind:source.kind};
  if(!role||typeof role.id!=='string'||!ID.test(role.id)||legacyIds.has(role.id)||roleIds.has(role.id)||!Number.isInteger(role.catalogueNumber)||role.catalogueNumber<501||role.catalogueNumber>700||numbers.has(role.catalogueNumber)||!['dinner','breakfast','dessert','starter','side'].includes(role.kind)){validNewRoles=false;break;}
  roleIds.add(role.id);numbers.add(role.catalogueNumber);byId.set(role.id,Object.freeze(role));
 }
 return recipe=>{
  if(!recipe||typeof recipe.id!=='string'||!ID.test(recipe.id))return false;
  // Legacy clients keep their original predicate even if new roles are invalid.
  if(legacyIds.has(recipe.id))return legacyIsDinner(recipe)===true;
  if(!validNewRoles)return false;
  const number=recipe.catalogueNumber,role=byId.get(recipe.id);
  if(!Number.isInteger(number)||number<501||number>700||!role||role.catalogueNumber!==number||role.kind!=='dinner'||recipe.dinnerEligible!==true)return false;
  const category=[recipe.category,recipe.tag,recipe.mealType].map(text).join(' ');
  const reviewedSavouryWaffles=recipe.id==='southern-chicken-and-waffles'&&number===641&&text(recipe.name)==='southern chicken and waffles'&&recipe.primaryProtein==='chicken';
  return !NON_DINNER.test(category)&&(!SWEET_NAME.test(text(recipe.name))||reviewedSavouryWaffles);
 };
}

return compileCatalogueDinner;})();
  const catalogue700Roles={"schemaVersion":1,"catalogueVersion":700,"legacyCatalogueVersion":500,"activationEligible":false,"mode":"complete-catalogue700-staging","legacyRecipeIds":["fajitas","chicken-burgers","creamy-pasta","sausage-gnocchi","pulled-pork","beef-chilli","stir-fry","salmon","steak","tuscan-salmon","traybake-sausage","chickpea-curry","fishcakes","pesto-gnocchi","tomato-mozzarella-pasta","lemon-chicken-orzo","beef-meatballs","veggie-fried-rice","lentil-bolognese","crispy-fish-tacos","mushroom-risotto","honey-garlic-tofu","chicken-pesto-wraps","sweet-potato-soup","prawn-linguine","turkey-chilli","halloumi-grain-bowls","bbq-chicken-pizza","breakfast-shakshuka","banana-oat-pancakes","baked-potato-beans","greek-chicken-tray","teriyaki-beef-noodles","spinach-ricotta-shells","coconut-lentil-dhal","roast-veg-couscous","pork-apple-tray","sausage-lentil-stew","chicken-noodle-soup","baked-feta-orzo","chicken-katsu-curry","loaded-nachos","broccoli-cheddar-soup","tuna-sweetcorn-pasta","aubergine-parmigiana","pesto-salmon-potatoes","chorizo-chickpea-stew","miso-salmon-rice","falafel-pitas","slow-beef-stew","slow-chicken-curry","slow-lamb-tagine","slow-bolognese","slow-honey-chicken","slow-veggie-chilli","date-garlic-prawns","date-duck-orange","date-pesto-gnocchi","date-lemon-chicken","date-stuffed-peppers","pan-lemon-chicken","pan-sausage-rice","pan-tomato-orzo","pan-teriyaki-salmon","pan-gnocchi-spinach","pan-fajita-rice","family-chicken-wraps","family-sweet-sour","extra-air-fryer-crispy-chicken-tenders","extra-air-fryer-salmon-bites","extra-air-fryer-garlic-parmesan-potatoes","extra-air-fryer-turkey-meatballs","extra-15-minute-pesto-tortellini","extra-speedy-beef-udon-noodles","extra-creamy-lemon-tuna-pasta","extra-garlic-chickpea-flatbreads","extra-lentil-shepherdless-pie","extra-tomato-butter-bean-stew","extra-greek-chicken-protein-bowls","extra-turkey-chilli-quinoa-bowls","extra-cottage-cheese-egg-muffins","extra-seared-tuna-edamame-bowls","extra-herb-roast-chicken-dinner","extra-mustard-roast-beef-with-veg","extra-maple-glazed-gammon-roast","extra-rosemary-roast-lamb-shoulder","extra-sticky-orange-chicken","extra-korean-beef-bulgogi-bowls","extra-blueberry-overnight-oats","extra-smoked-salmon-scrambled-eggs","extra-spinach-feta-breakfast-wraps","extra-apple-cinnamon-baked-oats","dessert-chocolate-brownies","dessert-sticky-toffee-pudding","dessert-lemon-drizzle-cake","dessert-apple-crumble","family-chocolate-chip-banana-traybake","family-apple-cinnamon-crumble-muffins","baking-classic-banana-bread","baking-soft-cinnamon-rolls","family-cottage-pie","family-mac-cheese","family-meatballs","family-chicken-pie","family-fish-pie","family-taco-bowls","family-pizza-toast","family-lasagne","extra-air-fryer-halloumi-wraps","extra-air-fryer-lemon-cod","extra-air-fryer-bbq-chicken-wings","extra-air-fryer-stuffed-mushrooms","extra-air-fryer-crispy-tofu-bowls","extra-air-fryer-pork-schnitzel","extra-quick-chicken-quesadillas","extra-20-minute-prawn-fried-rice","extra-speedy-spinach-ricotta-ravioli","extra-thai-basil-turkey-mince","extra-mediterranean-tuna-couscous","extra-honey-mustard-chicken-wraps","extra-baked-bean-cheese-toasties","extra-creamy-mushroom-pasta","extra-crispy-potato-and-egg-hash","extra-sausage-and-bean-casserole","extra-chickpea-tomato-shakshuka","extra-broccoli-cheddar-baked-rice","extra-steak-and-black-bean-salad","extra-lemon-herb-chicken-quinoa","extra-harissa-chickpea-feta-bowls","extra-garlic-shrimp-protein-pasta","extra-turkey-burger-lettuce-cups","extra-salmon-avocado-rice-bowls","extra-creamy-pumpkin-sage-pasta","extra-black-bean-sweet-potato-tacos","extra-spinach-feta-filo-parcels","extra-miso-mushroom-noodle-soup","extra-cauliflower-coconut-korma","extra-roasted-vegetable-quinoa-bake","extra-caprese-stuffed-portobellos","extra-peanut-sesame-tofu-noodles","extra-broccoli-pesto-baked-potatoes","extra-garlic-butter-roast-turkey-breast","extra-mushroom-walnut-wellington","extra-crispy-roast-pork-loin","extra-lemon-thyme-roast-salmon-side","extra-stuffed-roast-butternut-squash","extra-balsamic-roast-chicken-thighs","extra-homemade-chicken-tikka-masala","extra-crispy-chilli-beef","extra-teriyaki-tofu-rice-bowls","extra-salt-and-pepper-prawns","extra-bbq-pulled-jackfruit-buns","extra-homemade-doner-style-chicken","extra-thai-green-chicken-curry","extra-breakfast-burrito-bowls","extra-french-toast-with-berries","extra-mushroom-avocado-toast","extra-greek-yoghurt-granola-pots","extra-tomato-mozzarella-breakfast-muffins","leftover-chicken-pie","leftover-chicken-rice","leftover-beef-hash","leftover-beef-baguettes","leftover-gammon-bake","leftover-gammon-rice","leftover-lamb-flatbreads","leftover-turkey-pasta","leftover-pork-noodles","leftover-salmon-fishcakes","leftover-pork-jackets","leftover-chilli-peppers","leftover-bolognese-bake","leftover-katsu-wraps","leftover-greek-pitas","leftover-sausage-frittata","leftover-veg-quesadillas","leftover-chickpea-jackets","leftover-meatball-subs","leftover-quinoa-patties","dessert-eton-mess","dessert-victoria-sponge","dessert-bread-butter-pudding","dessert-chocolate-mousse","dessert-banoffee-pie","dessert-raspberry-cheesecake","dessert-chocolate-chip-cookies","dessert-rice-pudding","dessert-classic-apple-pie","dessert-chocolate-ice-cream","dessert-berry-pavlova","dessert-carrot-cake","dessert-jam-roly-poly","dessert-tiramisu","dessert-lemon-cheesecake","dessert-chocolate-profiteroles","dessert-treacle-tart","family-creamy-chicken-and-broccoli-pasta-bake","family-mini-cottage-pies-with-peas","family-cheesy-meatball-orzo","family-mild-chicken-korma-with-rice","family-homemade-crunchy-fish-fingers","family-15-minute-tomato-and-basil-gnocchi","family-chicken-sweetcorn-and-polenta-skillet-bake","family-cheese-and-tomato-pizza-pinwheels","family-mini-spinach-and-cheese-muffins","family-chicken-sweetcorn-potato-croquettes","family-leftover-mashed-potato-cheese-cakes","family-one-pot-tomato-lentil-pasta","family-mild-beef-chilli-with-rice","family-chicken-and-sweetcorn-enchiladas","family-cheddar-broccoli-potato-gratin","family-slow-cooker-chicken-casserole","family-beef-mince-and-potato-hotpot","family-pork-and-apple-meatballs","family-creamy-mushroom-chicken-rice","family-cheesy-spinach-stuffed-shells","family-tomato-and-mozzarella-gnocchi-bake","family-chicken-ginger-and-vegetable-noodle-soup","family-beef-burger-rice-bowls","family-chicken-pesto-pasta-shells","family-turkey-red-pepper-and-bulgur-skillet","family-mild-coconut-chicken-curry","family-lemon-salmon-vegetable-rice-parcels","family-chicken-and-ham-pasta-gratin","family-beef-and-carrot-shepherd-s-pie","family-cheesy-cauliflower-macaroni","family-sausage-and-tomato-pasta-bake","family-chicken-mushroom-and-lemon-noodle-soup","family-mild-lentil-and-sweet-potato-dhal","family-tuna-and-sweetcorn-jacket-potatoes","family-chicken-and-vegetable-couscous","family-mini-beef-and-bean-burritos","family-creamy-chicken-and-spinach-risotto","family-turkey-bolognese-spaghetti","family-cheesy-bean-quesadillas","family-pork-and-pineapple-rice-bowls","family-chicken-and-potato-casserole","family-beef-and-broccoli-noodles","family-roasted-pumpkin-cheddar-quesadillas","family-baked-cod-with-cheesy-breadcrumbs","family-chicken-and-cheese-tortilla-bake","family-sausage-apple-and-potato-traybake","family-turkey-and-vegetable-cottage-pie","family-tomato-basil-chicken-meatballs","family-cheesy-chicken-and-rice-bake","family-beef-and-mushroom-stroganoff","family-sweetcorn-and-cheddar-fritters","family-baked-chicken-parmesan","family-mild-lamb-and-chickpea-stew","family-ham-and-pea-macaroni-cheese","family-chicken-and-courgette-fritters","family-creamy-salmon-and-pea-pasta","family-roast-vegetable-and-halloumi-wraps","family-beef-and-sweet-potato-stuffed-courgettes","family-tomato-and-ricotta-stuffed-peppers","family-sticky-pork-apple-and-red-cabbage-traybake","family-smoky-lentil-and-pepper-flatbread-pizzas","family-chicken-and-sweetcorn-chowder","family-mini-turkey-meatloaves","family-meatball-vegetable-rice-bake","family-creamy-cauliflower-chicken-bake","family-sweet-potato-and-black-bean-enchiladas","family-ginger-chicken-and-carrot-noodle-broth","family-beef-and-tomato-macaroni","family-crispy-oven-chicken-goujons","family-spinach-and-cheese-cannelloni","family-sausage-and-apple-casserole","family-tuna-sweetcorn-pasta-fritters","family-chicken-broccoli-and-potato-rosti-bake","family-mild-chickpea-tikka-masala","family-broccoli-cheddar-and-white-bean-fritters","family-beef-and-pepper-stuffed-potatoes","family-turkey-and-spinach-lasagne","family-quick-tomato-and-mozzarella-flatbreads","family-speedy-sausage-and-tomato-couscous","family-20-minute-creamy-pesto-pasta","family-sausage-squash-and-cheddar-baked-polenta","family-garlic-butter-chicken-noodles","family-speedy-tuna-and-lemon-pasta","family-sweetcorn-courgette-fritters","family-quick-cheesy-bean-burritos","family-speedy-spinach-tomato-couscous","family-smoky-chicken-pepper-flatbreads","family-butterbean-and-roasted-carrot-hummus-bowls","family-quick-salmon-and-broccoli-noodles","family-mushroom-and-cheese-omelette-wraps","family-one-pan-chicken-taco-rice","family-15-minute-creamy-pea-pasta","family-speedy-halloumi-and-pepper-wraps","family-quick-turkey-mince-tacos","family-prawn-courgette-and-lemon-couscous-parcels","family-chicken-and-avocado-toasties","family-20-minute-beef-noodle-bowls","family-baked-potato-spinach-and-egg-muffin-cups","family-quick-chicken-and-spinach-orzo","family-15-minute-butterbean-tomato-pasta","family-speedy-fish-finger-tacos","family-quick-vegetable-and-cheese-frittata","family-20-minute-chicken-ramen-bowls","family-speedy-hummus-and-roasted-pepper-pittas","family-quick-beef-and-sweetcorn-quesadillas","family-15-minute-cheesy-broccoli-pasta","family-speedy-chicken-and-mushroom-wraps","family-quick-lemon-tuna-rice-bowls","family-20-minute-vegetable-udon-noodles","family-turkey-sweetcorn-and-cheddar-stuffed-peppers","family-quick-ham-and-pea-risotto-style-rice","family-pesto-chicken-green-bean-bulgur-bowls","family-chicken-broccoli-and-lemon-potato-cakes","baking-cheddar-chive-scones","baking-rosemary-sea-salt-focaccia","baking-chocolate-orange-marble-loaf","baking-raspberry-white-chocolate-blondies","baking-jam-thumbprint-biscuits","date-night-lemon-caper-sea-bass","date-night-scallops-pea-puree","date-night-rosemary-lamb-polenta","date-night-beetroot-goats-cheese-tart","date-night-miso-aubergine-sesame-rice","date-night-prosciutto-sage-chicken","date-night-saffron-seafood-paella","smoky-prawn-cannellini-skillet","black-bean-sweetcorn-tortilla-soup","pork-cabbage-okonomiyaki-pancakes","turkish-red-lentil-mercimek-soup","tunisian-tuna-egg-brik-parcels","cinnamon-chicken-turnip-rechta-noodles","moroccan-sardine-kefta-tomato","seville-spinach-chickpeas","portuguese-caldo-verde","spanish-migas-peppers-chorizo","chicken-almond-picada-beans","greek-spinach-dill-rice","greek-green-bean-potato-ladera","potato-curd-pierogi","mushroom-caraway-barley-kuba","chicken-paprikash-nokedli","beef-stifado-pearl-onions","anchovy-onion-pissaladiere","swiss-rosti-mushroom-ragout","georgian-walnut-bean-lobio","adjarian-cheese-egg-bread-boats","egyptian-koshari-crispy-onions","tunisian-lablebi-egg-bread","buckwheat-ham-gruyere-galettes","cod-potato-egg-bras-skillet","turkish-yoghurt-poached-eggs","fennel-rice-stuffed-squid","dutch-beef-ragout-croquettes","swedish-fish-dumplings-dill","turkey-vegetable-arancini","semolina-gnocchi-romana","cottage-cheese-dumplings-peas","salmorejo-egg-ham","olivier-ham-egg-potato-salad","stracciatella-star-pasta-soup","greek-trahana-tomato-milk-soup","carrot-chickpea-socca-wedges","saffron-mussels-fregola","juniper-venison-celeriac-puree","duck-leg-confit-lentils","crab-ravioli-sage-butter","monkfish-bourride-aioli","vanilla-creme-brulee","pear-almond-frangipane-galette","cherry-clafoutis","orange-crepes-suzette","apricot-pistachio-honey-nougat","lebanese-mujadara-with-deeply-caramelised-onions","ethiopian-berbere-lentil-stew-with-flatbread","zanzibari-coconut-pigeon-pea-pilaf","persian-herb-and-kidney-bean-beef-stew","sumac-chicken-and-onion-flatbread-roast","west-african-peanut-and-black-eyed-bean-stew","somali-spiced-beef-bariis-with-raisins","peppery-tomato-rasam-with-crisp-tofu-and-rice","malabar-tamarind-mackerel-curry","yemeni-lamb-and-vegetable-salta","potato-and-chickpea-chaat-with-tamarind-yoghurt","persian-aubergine-and-yellow-split-pea-khoresh","beetroot-broth-with-lamb-and-bulgur-dumplings","turmeric-chicken-rice-congee-with-crisp-shallots","sri-lankan-beetroot-and-cashew-curry","goan-recheado-prawns-with-rice-and-green-beans","senegalese-fish-and-cassava-thieboudienne","nigerian-steamed-bean-puddings-with-eggs","lentil-manti-dumplings-with-sumac-yoghurt","mushroom-and-freekeh-pilaf-with-almonds","cabbage-and-chana-dal-dry-curry-with-chapatis","rice-flour-dosas-with-potato-and-pea-masala","sri-lankan-vegetable-and-egg-kottu-roti","walnut-and-pomegranate-chicken-fesenjan","mild-saffron-chicken-joojeh-skewers","steamed-semolina-cakes-with-pea-tomato-dip","paneer-kofta-in-a-mild-spinach-sauce","mild-beef-and-potato-samosa-triangles","baked-lentil-and-carrot-kibbeh-squares","pumpkin-yoghurt-kadhi-with-rice","salmon-yoghurt-flatbread-pockets","mild-coconut-fish-and-sweetcorn-poha","butterbean-and-tomato-hand-pies","pea-and-potato-chapati-roll-ups","saffron-halibut-with-jeweled-barberry-rice","tamarind-date-lamb-loin-with-cauliflower-pur-e","freekeh-stuffed-quail-with-pomegranate-glaze","lobster-thermidor-with-tarragon-mustard-sauce","slow-braised-goat-nihari-with-naan","pistachio-and-rose-baklava-diamonds","saffron-semolina-halva-with-almonds","coconut-and-cardamom-ladoo","poached-pumpkin-with-tahini-and-walnuts","orange-blossom-jalebi-syrup-spirals","pork-larb-lettuce-and-sticky-rice","lemongrass-chicken-bun-salad","filipino-chicken-adobo","gado-gado-peanut-vegetable-salad","singapore-curried-rice-vermicelli","kimchi-tofu-jjigae","chinese-tomato-eggs-rice","chicken-soboro-three-colour-rice","turmeric-dill-fish-vermicelli","prawn-coconut-laksa","grilled-mackerel-ochazuke","three-cup-mushrooms-rice","cambodian-fish-amok","chicken-pozole-verde","cuban-black-bean-moros","aji-chicken-walnut-potatoes","brazilian-fish-moqueca","prawn-garlic-plantain-mofongo","bean-cheese-pupusas-curtido","argentine-beef-olive-empanadas","jamaican-brown-stew-dumplings","haitian-citrus-pork-griot","hakka-pork-stuffed-tofu","banh-xeo-prawn-pork-crepes","chicken-vegetable-wonton-soup","vegetable-egg-foo-young","royal-beef-vegetable-rice-cakes","steamed-chicken-bao-buns","sweet-potato-edamame-yaki-onigiri","mild-chicken-corn-tamales","chicken-vegetable-omurice","tuna-egg-picnic-gimbap","crisp-vegetable-spring-rolls","mild-chicken-causa-layers","tea-smoked-duck-plum-soba","whole-bream-black-bean-ginger","lobster-sweetcorn-chawanmushi","crisp-pork-belly-tamarind-relish","king-prawn-chupe","mango-coconut-sticky-rice","black-sesame-red-bean-mochi","lychee-ginger-granita","cinnamon-churros-chocolate","dulce-de-leche-alfajores","cullen-skink-smoked-haddock","pork-rice-cabbage-golabki","beef-porkolt-caraway-dumplings","karelian-rye-pasties-egg-butter","sharp-lentils-boiled-eggs","beetroot-cabbage-borscht","yellow-pea-ham-soup","toad-hole-onion-gravy","smoked-haddock-kedgeree","glamorgan-leek-cheese-sausages","lancashire-potato-butter-pie","cajun-prawn-cheddar-grits","blackened-catfish-celery-rice","chicken-okra-dark-roux-gumbo","hoppin-john-black-eyed-peas","tangy-beef-sloppy-joes","steamed-lentil-oatmeal-haggis-neeps-tatties","raggmunk-bacon-lingonberry","choucroute-smoked-sausage","janssons-sprat-potato-bake","mushroom-pearl-barley-soup","skirlie-oats-poached-eggs","herring-apple-rye-plates","chicken-waldorf-salad","liver-onion-butterbean-mash","egg-hole-spinach-toast","steamed-beef-carrot-puddings","ham-pea-bread-pudding","cheese-souffle-broccoli","soft-polenta-peas-poached-eggs","tyrolean-bread-cheese-dumplings","savoury-curd-cheese-blintzes","oatcakes-lentil-pate","corn-arepas-egg-avocado","tapioca-cheese-buns-chicken","salt-baked-sea-bream-fennel-orange-salad","langoustine-bisque-gruyere-croutons","beef-brioche-mushroom-tournedos","charred-octopus-romesco","lemon-posset-berries","chocolate-hazelnut-truffles","pumpkin-custard-pie","peach-cornmeal-cobbler","raspberry-vanilla-baked-alaska"],"recipes":[{"id":"crispy-aromatic-duck-pancakes","catalogueNumber":501,"kind":"dinner"},{"id":"beef-in-black-bean-sauce-with-rice","catalogueNumber":502,"kind":"dinner"},{"id":"sesame-prawn-toast-with-cucumber-salad","catalogueNumber":503,"kind":"starter"},{"id":"chicken-satay-skewers-with-peanut-sauce","catalogueNumber":504,"kind":"dinner"},{"id":"chicken-jalfrezi-with-pilau-rice","catalogueNumber":505,"kind":"dinner"},{"id":"lamb-rogan-josh","catalogueNumber":506,"kind":"dinner"},{"id":"chicken-dhansak","catalogueNumber":507,"kind":"dinner"},{"id":"lamb-seekh-kebabs-with-mint-yoghurt","catalogueNumber":508,"kind":"dinner"},{"id":"peri-peri-spatchcock-chicken-with-spicy-rice","catalogueNumber":509,"kind":"dinner"},{"id":"double-smash-cheeseburgers-with-burger-sauce","catalogueNumber":510,"kind":"dinner"},{"id":"buttermilk-fried-chicken-pieces-with-peppered-gravy","catalogueNumber":511,"kind":"dinner"},{"id":"crispy-chicken-chimichangas","catalogueNumber":512,"kind":"dinner"},{"id":"battered-haddock-and-chips-with-mushy-peas","catalogueNumber":513,"kind":"dinner"},{"id":"salmon-en-croute-with-spinach","catalogueNumber":514,"kind":"dinner"},{"id":"tuna-steak-nicoise-salad","catalogueNumber":515,"kind":"dinner"},{"id":"moules-marinieres-with-skinny-chips","catalogueNumber":516,"kind":"dinner"},{"id":"smoked-haddock-mornay-with-spinach","catalogueNumber":517,"kind":"dinner"},{"id":"smoked-salmon-leek-and-dill-quiche","catalogueNumber":518,"kind":"dinner"},{"id":"pan-fried-trout-almondine","catalogueNumber":519,"kind":"dinner"},{"id":"crispy-breaded-king-prawns-with-tartare-sauce","catalogueNumber":520,"kind":"dinner"},{"id":"coq-au-vin-with-mash","catalogueNumber":521,"kind":"dinner"},{"id":"chicken-kiev-with-parsley-potatoes","catalogueNumber":522,"kind":"dinner"},{"id":"pork-tenderloin-stuffed-with-apple-and-black-pudding","catalogueNumber":523,"kind":"dinner"},{"id":"crispy-calamari-with-garlic-mayo-and-warm-potato-salad","catalogueNumber":524,"kind":"dinner"},{"id":"seafood-spaghetti-marinara-with-mussels-prawns-and-squid","catalogueNumber":525,"kind":"dinner"},{"id":"smoked-haddock-omelette-arnold-bennett","catalogueNumber":526,"kind":"dinner"},{"id":"spaghetti-carbonara","catalogueNumber":527,"kind":"dinner"},{"id":"belgian-breakfast-waffles-with-berries","catalogueNumber":528,"kind":"breakfast"},{"id":"penne-puttanesca","catalogueNumber":529,"kind":"dinner"},{"id":"french-onion-soup-with-cheese-croutons","catalogueNumber":530,"kind":"dinner"},{"id":"homemade-crumpets-with-butter","catalogueNumber":531,"kind":"breakfast"},{"id":"sausage-plait-with-onion-chutney","catalogueNumber":532,"kind":"dinner"},{"id":"steak-and-ale-pie","catalogueNumber":533,"kind":"dinner"},{"id":"ham-egg-and-chips","catalogueNumber":534,"kind":"dinner"},{"id":"bangers-and-mash-with-onion-gravy","catalogueNumber":535,"kind":"dinner"},{"id":"classic-creamy-stovetop-porridge","catalogueNumber":536,"kind":"breakfast"},{"id":"leek-and-potato-soup","catalogueNumber":537,"kind":"dinner"},{"id":"chia-seed-breakfast-pudding-with-berries","catalogueNumber":538,"kind":"breakfast"},{"id":"american-biscuits-with-sausage-gravy","catalogueNumber":539,"kind":"breakfast"},{"id":"salisbury-steak-with-mash","catalogueNumber":540,"kind":"dinner"},{"id":"homemade-boiled-and-baked-breakfast-bagels","catalogueNumber":541,"kind":"breakfast"},{"id":"beef-and-onion-cobbler","catalogueNumber":542,"kind":"dinner"},{"id":"eggs-benedict","catalogueNumber":543,"kind":"breakfast"},{"id":"full-english-breakfast-traybake","catalogueNumber":544,"kind":"breakfast"},{"id":"sticky-bbq-pork-spare-ribs-with-slaw","catalogueNumber":545,"kind":"dinner"},{"id":"cajun-chicken-prawn-and-chorizo-jambalaya","catalogueNumber":546,"kind":"dinner"},{"id":"american-hot-dogs-with-mustard-onions","catalogueNumber":547,"kind":"dinner"},{"id":"homemade-all-butter-croissants","catalogueNumber":548,"kind":"breakfast"},{"id":"soft-boiled-eggs-with-buttered-toast-soldiers","catalogueNumber":549,"kind":"breakfast"},{"id":"ratatouille-with-crusty-bread","catalogueNumber":550,"kind":"dinner"},{"id":"chicken-chow-mein","catalogueNumber":551,"kind":"dinner"},{"id":"chinese-takeaway-lemon-chicken","catalogueNumber":552,"kind":"dinner"},{"id":"chinese-chicken-and-sweetcorn-soup","catalogueNumber":553,"kind":"starter"},{"id":"chinese-hot-and-sour-soup","catalogueNumber":554,"kind":"starter"},{"id":"char-siu-pork-with-rice","catalogueNumber":555,"kind":"dinner"},{"id":"chicken-balti-with-naan","catalogueNumber":556,"kind":"dinner"},{"id":"lamb-vindaloo-with-rice","catalogueNumber":557,"kind":"dinner"},{"id":"vegetable-biryani-with-cucumber-raita","catalogueNumber":558,"kind":"dinner"},{"id":"tandoori-chicken-with-mint-salad","catalogueNumber":559,"kind":"dinner"},{"id":"onion-bhajis-with-mango-chutney","catalogueNumber":560,"kind":"starter"},{"id":"lahmacun-with-chopped-salad","catalogueNumber":561,"kind":"dinner"},{"id":"philly-cheesesteak-rolls","catalogueNumber":562,"kind":"dinner"},{"id":"beef-birria-quesatacos","catalogueNumber":563,"kind":"dinner"},{"id":"steak-diane-with-saute-potatoes","catalogueNumber":564,"kind":"dinner"},{"id":"beef-wellington-with-red-wine-gravy","catalogueNumber":565,"kind":"dinner"},{"id":"sole-meuniere-with-green-beans","catalogueNumber":566,"kind":"dinner"},{"id":"poached-salmon-with-hollandaise-and-new-potatoes","catalogueNumber":567,"kind":"dinner"},{"id":"fresh-cod-brandade-with-green-salad","catalogueNumber":568,"kind":"dinner"},{"id":"pancetta-wrapped-monkfish-with-crushed-peas","catalogueNumber":569,"kind":"dinner"},{"id":"mussel-and-saffron-risotto","catalogueNumber":570,"kind":"dinner"},{"id":"brown-shrimp-and-asparagus-puff-tart","catalogueNumber":571,"kind":"dinner"},{"id":"hot-smoked-salmon-potato-salad-with-horseradish","catalogueNumber":572,"kind":"dinner"},{"id":"maryland-style-crab-cakes-with-remoulade","catalogueNumber":573,"kind":"dinner"},{"id":"new-england-clam-chowder","catalogueNumber":574,"kind":"dinner"},{"id":"grilled-sardines-with-tomato-bread","catalogueNumber":575,"kind":"dinner"},{"id":"cornish-beef-pasties","catalogueNumber":576,"kind":"dinner"},{"id":"boston-baked-beans-with-cornbread","catalogueNumber":577,"kind":"dinner"},{"id":"chicken-chasseur-with-mash","catalogueNumber":578,"kind":"dinner"},{"id":"creamy-tomato-soup-with-cheese-toasties","catalogueNumber":579,"kind":"dinner"},{"id":"carrot-and-coriander-soup-with-crusty-bread","catalogueNumber":580,"kind":"dinner"},{"id":"minestrone-with-crusty-bread","catalogueNumber":581,"kind":"dinner"},{"id":"american-cobb-salad","catalogueNumber":582,"kind":"dinner"},{"id":"ploughmans-cheese-and-pickle-supper","catalogueNumber":583,"kind":"dinner"},{"id":"reuben-sandwiches","catalogueNumber":584,"kind":"dinner"},{"id":"bacon-and-cabbage-with-parsley-sauce","catalogueNumber":585,"kind":"dinner"},{"id":"ham-and-mushroom-calzone","catalogueNumber":586,"kind":"dinner"},{"id":"lamb-moussaka","catalogueNumber":587,"kind":"dinner"},{"id":"cauliflower-cheese-with-crusty-bread","catalogueNumber":588,"kind":"dinner"},{"id":"american-pot-roast-beef-with-carrots","catalogueNumber":589,"kind":"dinner"},{"id":"cacio-e-pepe","catalogueNumber":590,"kind":"dinner"},{"id":"homemade-english-breakfast-muffins","catalogueNumber":591,"kind":"breakfast"},{"id":"cranberry-and-orange-breakfast-scones","catalogueNumber":592,"kind":"breakfast"},{"id":"cinnamon-raisin-breakfast-loaf","catalogueNumber":593,"kind":"breakfast"},{"id":"honey-and-almond-breakfast-flapjacks","catalogueNumber":594,"kind":"breakfast"},{"id":"sausage-breakfast-baps-with-brown-sauce","catalogueNumber":595,"kind":"breakfast"},{"id":"black-pudding-and-apple-breakfast-stacks","catalogueNumber":596,"kind":"breakfast"},{"id":"grilled-kippers-with-lemon-butter-and-toast","catalogueNumber":597,"kind":"breakfast"},{"id":"homemade-fruit-and-nut-muesli","catalogueNumber":598,"kind":"breakfast"},{"id":"toasted-fruit-teacakes","catalogueNumber":599,"kind":"breakfast"},{"id":"potato-farls-with-fried-eggs","catalogueNumber":600,"kind":"breakfast"},{"id":"chicken-madras-with-rice","catalogueNumber":601,"kind":"dinner"},{"id":"lamb-pasanda-with-almond-rice","catalogueNumber":602,"kind":"dinner"},{"id":"paneer-tikka-skewers-with-mint-chutney","catalogueNumber":603,"kind":"dinner"},{"id":"king-prawn-puri","catalogueNumber":604,"kind":"starter"},{"id":"bombay-potatoes","catalogueNumber":605,"kind":"side"},{"id":"chinese-chicken-and-cashew-nuts","catalogueNumber":606,"kind":"dinner"},{"id":"kung-pao-chicken-with-rice","catalogueNumber":607,"kind":"dinner"},{"id":"chinese-takeaway-crispy-seaweed","catalogueNumber":608,"kind":"side"},{"id":"chinese-curry-chicken-and-chips","catalogueNumber":609,"kind":"dinner"},{"id":"cheeseburger-loaded-fries","catalogueNumber":610,"kind":"dinner"},{"id":"pork-tacos-al-pastor","catalogueNumber":611,"kind":"dinner"},{"id":"chicago-deep-dish-pepperoni-pizza","catalogueNumber":612,"kind":"dinner"},{"id":"prawn-cocktail-with-brown-bread","catalogueNumber":613,"kind":"starter"},{"id":"smoked-mackerel-pate-with-toast","catalogueNumber":614,"kind":"starter"},{"id":"seafood-crepes-in-white-wine-cream-sauce","catalogueNumber":615,"kind":"dinner"},{"id":"cioppino-with-sourdough","catalogueNumber":616,"kind":"dinner"},{"id":"mackerel-escabeche-with-crusty-bread","catalogueNumber":617,"kind":"dinner"},{"id":"salmon-and-prawn-terrine-with-cucumber-salad","catalogueNumber":618,"kind":"starter"},{"id":"herb-stuffed-whole-baked-trout","catalogueNumber":619,"kind":"dinner"},{"id":"grilled-tuna-with-peperonata","catalogueNumber":620,"kind":"dinner"},{"id":"sea-bass-en-papillote-with-fennel","catalogueNumber":621,"kind":"dinner"},{"id":"dressed-crab-with-brown-bread","catalogueNumber":622,"kind":"starter"},{"id":"smoked-salmon-blinis-with-lemon-creme-fraiche","catalogueNumber":623,"kind":"starter"},{"id":"prawn-saganaki-with-crusty-bread","catalogueNumber":624,"kind":"dinner"},{"id":"coquilles-saint-jacques","catalogueNumber":625,"kind":"dinner"},{"id":"corned-beef-and-potato-pie","catalogueNumber":626,"kind":"dinner"},{"id":"chicken-and-mushroom-vol-au-vents","catalogueNumber":627,"kind":"dinner"},{"id":"spanish-tortilla-with-tomato-salad","catalogueNumber":628,"kind":"dinner"},{"id":"rigatoni-allamatriciana","catalogueNumber":629,"kind":"dinner"},{"id":"pasta-alla-norma","catalogueNumber":630,"kind":"dinner"},{"id":"swedish-meatballs-with-creamy-gravy","catalogueNumber":631,"kind":"dinner"},{"id":"beef-olives-with-mash","catalogueNumber":632,"kind":"dinner"},{"id":"cock-a-leekie-soup-with-bread","catalogueNumber":633,"kind":"dinner"},{"id":"scotch-broth-with-lamb-and-barley","catalogueNumber":634,"kind":"dinner"},{"id":"tartiflette-style-potato-bake","catalogueNumber":635,"kind":"dinner"},{"id":"roast-vegetable-crumble-with-cheddar-oats","catalogueNumber":636,"kind":"dinner"},{"id":"lentil-and-walnut-nut-roast","catalogueNumber":637,"kind":"dinner"},{"id":"panzanella-bread-salad","catalogueNumber":638,"kind":"dinner"},{"id":"salade-lyonnaise-with-poached-eggs","catalogueNumber":639,"kind":"dinner"},{"id":"crispy-bacon-and-cheddar-potato-skins","catalogueNumber":640,"kind":"dinner"},{"id":"southern-chicken-and-waffles","catalogueNumber":641,"kind":"dinner"},{"id":"staffordshire-oatcakes-with-bacon-and-cheese","catalogueNumber":642,"kind":"breakfast"},{"id":"homemade-hot-cross-buns","catalogueNumber":643,"kind":"breakfast"},{"id":"breakfast-soda-bread-with-marmalade","catalogueNumber":644,"kind":"breakfast"},{"id":"homemade-malt-loaf","catalogueNumber":645,"kind":"breakfast"},{"id":"croque-madame","catalogueNumber":646,"kind":"breakfast"},{"id":"baked-eggs-in-cream-with-chives","catalogueNumber":647,"kind":"breakfast"},{"id":"pan-con-tomate-with-cured-ham","catalogueNumber":648,"kind":"breakfast"},{"id":"sausage-egg-and-cheese-breakfast-muffins","catalogueNumber":649,"kind":"breakfast"},{"id":"bacon-and-scrambled-egg-breakfast-quesadillas","catalogueNumber":650,"kind":"breakfast"},{"id":"mushroom-bhaji-with-naan","catalogueNumber":651,"kind":"dinner"},{"id":"keema-naan","catalogueNumber":652,"kind":"dinner"},{"id":"chicken-pakora-with-mint-yoghurt","catalogueNumber":653,"kind":"dinner"},{"id":"chinese-ginger-and-spring-onion-lamb-with-rice","catalogueNumber":654,"kind":"dinner"},{"id":"salt-and-pepper-chips","catalogueNumber":655,"kind":"side"},{"id":"buffalo-chicken-wings-with-blue-cheese-dip","catalogueNumber":656,"kind":"dinner"},{"id":"battered-sausage-with-chip-shop-curry-sauce","catalogueNumber":657,"kind":"dinner"},{"id":"beef-barbacoa-tacos","catalogueNumber":658,"kind":"dinner"},{"id":"chicken-fajita-crunchwraps","catalogueNumber":659,"kind":"dinner"},{"id":"mozzarella-sticks-with-marinara","catalogueNumber":660,"kind":"starter"},{"id":"jalapeno-poppers-with-ranch-dip","catalogueNumber":661,"kind":"starter"},{"id":"chilli-con-queso-with-tortilla-chips","catalogueNumber":662,"kind":"starter"},{"id":"beef-bourguignon-with-mash","catalogueNumber":663,"kind":"dinner"},{"id":"chicken-cordon-bleu-with-green-salad","catalogueNumber":664,"kind":"dinner"},{"id":"lamb-cutlets-with-mint-pesto-and-dauphinoise","catalogueNumber":665,"kind":"dinner"},{"id":"steak-frites-with-cafe-de-paris-butter","catalogueNumber":666,"kind":"dinner"},{"id":"hake-with-clams-and-parsley-sauce","catalogueNumber":667,"kind":"dinner"},{"id":"king-prawn-and-chorizo-skewers-with-lemon-potatoes","catalogueNumber":668,"kind":"dinner"},{"id":"sole-veronique-with-steamed-potatoes","catalogueNumber":669,"kind":"dinner"},{"id":"potted-brown-shrimp-with-toast","catalogueNumber":670,"kind":"starter"},{"id":"open-crab-melts-with-lemon-salad","catalogueNumber":671,"kind":"starter"},{"id":"smoked-haddock-scotch-eggs-with-mustard-leaves","catalogueNumber":672,"kind":"dinner"},{"id":"spaghetti-alle-vongole","catalogueNumber":673,"kind":"dinner"},{"id":"roast-beef-tonnato-with-green-salad","catalogueNumber":674,"kind":"starter"},{"id":"hunters-chicken-with-chips","catalogueNumber":675,"kind":"dinner"},{"id":"lancashire-lamb-hotpot","catalogueNumber":676,"kind":"dinner"},{"id":"bacon-and-onion-suet-roly-poly","catalogueNumber":677,"kind":"dinner"},{"id":"steak-pizzaiola-with-potatoes","catalogueNumber":678,"kind":"dinner"},{"id":"sweetcorn-spoonbread-with-black-bean-salad","catalogueNumber":679,"kind":"dinner"},{"id":"succotash-with-baked-eggs","catalogueNumber":680,"kind":"dinner"},{"id":"homemade-corn-dogs-with-slaw","catalogueNumber":681,"kind":"dinner"},{"id":"american-three-bean-salad-with-cornbread","catalogueNumber":682,"kind":"dinner"},{"id":"classic-blt-sandwiches","catalogueNumber":683,"kind":"dinner"},{"id":"tuna-melt-toasties","catalogueNumber":684,"kind":"dinner"},{"id":"monte-cristo-sandwiches","catalogueNumber":685,"kind":"dinner"},{"id":"pork-and-liver-faggots-with-mash","catalogueNumber":686,"kind":"dinner"},{"id":"cajun-dirty-rice","catalogueNumber":687,"kind":"dinner"},{"id":"cauliflower-steaks-with-romesco-and-butter-beans","catalogueNumber":688,"kind":"dinner"},{"id":"roast-cabbage-wedges-with-cheddar-white-beans","catalogueNumber":689,"kind":"dinner"},{"id":"crispy-polenta-chips-with-tomato-bean-ragu","catalogueNumber":690,"kind":"dinner"},{"id":"peanut-butter-and-banana-smoothie-bowls","catalogueNumber":691,"kind":"breakfast"},{"id":"warm-pear-and-quinoa-breakfast-bowls","catalogueNumber":692,"kind":"breakfast"},{"id":"baked-ricotta-with-roasted-plums","catalogueNumber":693,"kind":"breakfast"},{"id":"bacon-and-maple-cornbread-breakfast-muffins","catalogueNumber":694,"kind":"breakfast"},{"id":"cinnamon-baked-apples-with-cottage-cheese-and-pecans","catalogueNumber":695,"kind":"breakfast"},{"id":"homemade-pork-and-sage-breakfast-patties","catalogueNumber":696,"kind":"breakfast"},{"id":"dutch-baby-with-lemon-and-blueberries","catalogueNumber":697,"kind":"breakfast"},{"id":"cottage-cheese-cucumber-and-radish-crispbreads","catalogueNumber":698,"kind":"breakfast"},{"id":"baked-grapefruit-with-honey-and-yoghurt","catalogueNumber":699,"kind":"breakfast"},{"id":"buck-rarebit","catalogueNumber":700,"kind":"breakfast"}]};
  const catalogue700Dinner=catalogue700Policy({catalogueVersion:700,roles:catalogue700Roles,legacyIsDinner:isLegacyDinner});
  const catalogue700PersonalRecipes=new WeakSet();
  function registerPersonalRecipe(recipe){if(recipe&&typeof recipe==='object'&&/^bb172-own-[0-9a-z-]{8,52}$/.test(recipe.id)&&recipe.tag==='MY RECIPE'&&Array.isArray(recipe.ingredients)&&recipe.ingredients.length>0){catalogue700PersonalRecipes.add(recipe);return true;}return false;}
  function isDinner(recipe){if(catalogue700PersonalRecipes.has(recipe))return isLegacyDinner(recipe);return catalogue700Dinner(recipe);}
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
    // Auto-fill can score adjacency and dated recency instead of excluding
    // those candidates. Ordinary/manual planning retains the strict defaults.
    const softProteinAdjacency=options.softProteinAdjacency===true;
    const softRecentRecipes=options.softRecentRecipes===true;
    const recipes=Array.isArray(options.recipes)?options.recipes:[];
    const byId=new Map(recipes.filter(r=>idOf(r)).map(r=>[r.id,r]));
    const allowed=typeof options.isAllowed==='function'?options.isAllowed:()=>false;
    const suitable=typeof options.isEligible==='function'?options.isEligible:()=>true;
    const eligible=recipes.filter(r=>isDinner(r)&&allowed(r)===true&&suitable(r)===true);
    const eligibleIds=new Set(eligible.map(r=>r.id));
    // Optional editorial cohorts rotate independently while sharing the same
    // optimistic, single-record commit. Ordinary callers retain whole-pool
    // rotation; filtering alone can never create or shrink a cohort.
    const rotationGroup=typeof options.rotationGroup==='function'?options.rotationGroup:null;
    const groupOf=recipe=>{const group=rotationGroup?.(recipe);return typeof group==='string'?group:'';};
    const groupsById=new Map(),groupIds=new Map();
    if(rotationGroup)for(const recipe of eligible){
      const group=groupOf(recipe);groupsById.set(recipe.id,group);
      if(!groupIds.has(group))groupIds.set(group,new Set());
      groupIds.get(group).add(recipe.id);
    }
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
      const current=recipes.filter(r=>isDinner(r)&&allowed(r)===true&&suitable(r)===true);
      const currentIds=new Set(current.map(r=>r.id));
      return currentIds.size!==eligibleIds.size||current.some(recipe=>!eligibleIds.has(recipe.id)||
        (rotationGroup&&groupsById.get(recipe.id)!==groupOf(recipe)));
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
      // Without editorial cohorts, preserve the original complete-pool rule.
      // Category, time and protein constraints never cause an early reset.
      if(!softRecentRecipes&&!rotationGroup&&[...eligibleIds].every(id=>seen.has(id))){seen=new Set([...seen].filter(id=>!eligibleIds.has(id)));cycle++;}
      const plan=planEntries(context.planned),plannedIds=new Set(plan.map(row=>row.recipe.id));
      if(plan.some(row=>row.day===context.day)){lastReason='occupied-day';return [];}
      const dayIndex=DAYS.indexOf(context.day);
      const neighbours=plan.filter(row=>dayIndex>=0&&Math.abs(DAYS.indexOf(row.day)-dayIndex)===1&&DAYS.includes(row.day));
      const neighbouringProteins=new Set(neighbours.map(row=>metadata(row.recipe).primaryProtein));
      if(dayIndex===0&&typeof options.previousProtein==='string')neighbouringProteins.add(proteinAlias(options.previousProtein));
      const proteinCounts=new Map();
      if(softProteinAdjacency)for(const row of plan){const protein=metadata(row.recipe).primaryProtein;proteinCounts.set(protein,(proteinCounts.get(protein)||0)+1);}
      const heavy=plan.filter(row=>metadata(row.recipe).cheeseHeavy).length;
      const pool=(Array.isArray(candidates)?candidates:[]).filter(r=>idOf(r)&&eligibleIds.has(r.id)&&!plannedIds.has(r.id)&&!selectedIds.has(r.id));
      if(rotationGroup&&!softRecentRecipes){
        const requestedGroups=new Set(pool.map(recipe=>groupsById.get(recipe.id)));
        for(const group of requestedGroups){
          const ids=groupIds.get(group);
          if(ids?.size&&[...ids].every(id=>seen.has(id))){
            for(const id of ids)seen.delete(id);
            cycle++;
          }
        }
      }
      const unseen=softRecentRecipes?pool:pool.filter(r=>!seen.has(r.id));
      const result=unseen.filter(r=>{
        const m=metadata(r);
        const proteinFits=softProteinAdjacency?(proteinCounts.get(m.primaryProtein)||0)<2:!neighbouringProteins.has(m.primaryProtein);
        return proteinFits&&(!m.cheeseHeavy||heavy<2);
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
  return Object.freeze({DAYS,STORAGE_KEY,metadata,isDinner,annotate,proteinAlias,createRotation,registerPersonalRecipe});
});
