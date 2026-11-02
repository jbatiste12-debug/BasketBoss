/* BasketBoss editorial browse collections, 2 November 2026.
 * Membership is a deliberate stable-ID editorial decision about presentation,
 * not cuisine origin, popularity research, child suitability or kitchen testing.
 * The 321-record historical baseline supplies familiar/occasion candidates;
 * new-release groups are provisional title-based assignments pending full
 * ingredient/method review. No ingredient records or Premium access is shipped.
 * Time labels always use the actual supplied record, never an ID-based estimate.
 */
(function(root,factory){
  'use strict';
  const planning=typeof module==='object'&&module.exports?require('./bb-recipe-planning.js'):null;
  const api=factory(()=>root?.BBRecipePlanning||planning);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BBRecipeEditorial=api;
})(typeof window!=='undefined'?window:null,function(getPlanning){
  'use strict';
  const GROUPS={
    "Everyday Favourites": `
      aubergine-parmigiana
      baked-feta-orzo
      baked-potato-beans
      bbq-chicken-pizza
      beef-chilli
      beef-meatballs
      black-bean-sweetcorn-tortilla-soup
      blackened-catfish-celery-rice
      butterbean-and-tomato-hand-pies
      cajun-prawn-cheddar-grits
      chicken-burgers
      chicken-katsu-curry
      chicken-noodle-soup
      chicken-okra-dark-roux-gumbo
      chicken-waldorf-salad
      chickpea-curry
      chorizo-chickpea-stew
      coconut-lentil-dhal
      creamy-pasta
      crispy-fish-tacos
      cullen-skink-smoked-haddock
      extra-15-minute-pesto-tortellini
      extra-20-minute-prawn-fried-rice
      extra-air-fryer-bbq-chicken-wings
      extra-air-fryer-crispy-chicken-tenders
      extra-air-fryer-crispy-tofu-bowls
      extra-air-fryer-halloumi-wraps
      extra-air-fryer-lemon-cod
      extra-air-fryer-pork-schnitzel
      extra-air-fryer-salmon-bites
      extra-air-fryer-stuffed-mushrooms
      extra-air-fryer-turkey-meatballs
      extra-baked-bean-cheese-toasties
      extra-balsamic-roast-chicken-thighs
      extra-bbq-pulled-jackfruit-buns
      extra-black-bean-sweet-potato-tacos
      extra-broccoli-cheddar-baked-rice
      extra-broccoli-pesto-baked-potatoes
      extra-caprese-stuffed-portobellos
      extra-cauliflower-coconut-korma
      extra-chickpea-tomato-shakshuka
      extra-creamy-lemon-tuna-pasta
      extra-creamy-mushroom-pasta
      extra-creamy-pumpkin-sage-pasta
      extra-crispy-chilli-beef
      extra-crispy-potato-and-egg-hash
      extra-crispy-roast-pork-loin
      extra-garlic-butter-roast-turkey-breast
      extra-garlic-chickpea-flatbreads
      extra-garlic-shrimp-protein-pasta
      extra-greek-chicken-protein-bowls
      extra-harissa-chickpea-feta-bowls
      extra-herb-roast-chicken-dinner
      extra-homemade-chicken-tikka-masala
      extra-homemade-doner-style-chicken
      extra-honey-mustard-chicken-wraps
      extra-korean-beef-bulgogi-bowls
      extra-lemon-herb-chicken-quinoa
      extra-lemon-thyme-roast-salmon-side
      extra-lentil-shepherdless-pie
      extra-maple-glazed-gammon-roast
      extra-mediterranean-tuna-couscous
      extra-miso-mushroom-noodle-soup
      extra-mushroom-walnut-wellington
      extra-mustard-roast-beef-with-veg
      extra-peanut-sesame-tofu-noodles
      extra-quick-chicken-quesadillas
      extra-roasted-vegetable-quinoa-bake
      extra-rosemary-roast-lamb-shoulder
      extra-salmon-avocado-rice-bowls
      extra-salt-and-pepper-prawns
      extra-sausage-and-bean-casserole
      extra-seared-tuna-edamame-bowls
      extra-speedy-beef-udon-noodles
      extra-speedy-spinach-ricotta-ravioli
      extra-spinach-feta-filo-parcels
      extra-steak-and-black-bean-salad
      extra-sticky-orange-chicken
      extra-stuffed-roast-butternut-squash
      extra-teriyaki-tofu-rice-bowls
      extra-thai-basil-turkey-mince
      extra-thai-green-chicken-curry
      extra-tomato-butter-bean-stew
      extra-turkey-burger-lettuce-cups
      extra-turkey-chilli-quinoa-bowls
      fajitas
      falafel-pitas
      family-15-minute-butterbean-tomato-pasta
      family-15-minute-cheesy-broccoli-pasta
      family-15-minute-creamy-pea-pasta
      family-15-minute-tomato-and-basil-gnocchi
      family-20-minute-beef-noodle-bowls
      family-20-minute-chicken-ramen-bowls
      family-20-minute-creamy-pesto-pasta
      family-20-minute-vegetable-udon-noodles
      family-baked-chicken-parmesan
      family-baked-cod-with-cheesy-breadcrumbs
      family-beef-and-broccoli-noodles
      family-beef-and-carrot-shepherd-s-pie
      family-beef-and-mushroom-stroganoff
      family-beef-and-pepper-stuffed-potatoes
      family-beef-and-sweet-potato-stuffed-courgettes
      family-beef-and-tomato-macaroni
      family-beef-burger-rice-bowls
      family-beef-mince-and-potato-hotpot
      family-broccoli-cheddar-and-white-bean-fritters
      family-butterbean-and-roasted-carrot-hummus-bowls
      family-cheddar-broccoli-potato-gratin
      family-cheesy-bean-quesadillas
      family-cheesy-cauliflower-macaroni
      family-cheesy-chicken-and-rice-bake
      family-cheesy-meatball-orzo
      family-cheesy-spinach-stuffed-shells
      family-chicken-and-avocado-toasties
      family-chicken-and-cheese-tortilla-bake
      family-chicken-and-courgette-fritters
      family-chicken-and-ham-pasta-gratin
      family-chicken-and-potato-casserole
      family-chicken-and-sweetcorn-chowder
      family-chicken-and-sweetcorn-enchiladas
      family-chicken-and-vegetable-couscous
      family-chicken-broccoli-and-lemon-potato-cakes
      family-chicken-broccoli-and-potato-rosti-bake
      family-chicken-ginger-and-vegetable-noodle-soup
      family-chicken-mushroom-and-lemon-noodle-soup
      family-chicken-pesto-pasta-shells
      family-chicken-pie
      family-chicken-sweetcorn-and-polenta-skillet-bake
      family-chicken-sweetcorn-potato-croquettes
      family-chicken-wraps
      family-cottage-pie
      family-creamy-cauliflower-chicken-bake
      family-creamy-chicken-and-broccoli-pasta-bake
      family-creamy-chicken-and-spinach-risotto
      family-creamy-mushroom-chicken-rice
      family-creamy-salmon-and-pea-pasta
      family-crispy-oven-chicken-goujons
      family-fish-pie
      family-garlic-butter-chicken-noodles
      family-ginger-chicken-and-carrot-noodle-broth
      family-ham-and-pea-macaroni-cheese
      family-homemade-crunchy-fish-fingers
      family-lasagne
      family-leftover-mashed-potato-cheese-cakes
      family-lemon-salmon-vegetable-rice-parcels
      family-mac-cheese
      family-meatball-vegetable-rice-bake
      family-meatballs
      family-mild-beef-chilli-with-rice
      family-mild-chicken-korma-with-rice
      family-mild-chickpea-tikka-masala
      family-mild-coconut-chicken-curry
      family-mild-lamb-and-chickpea-stew
      family-mild-lentil-and-sweet-potato-dhal
      family-mini-beef-and-bean-burritos
      family-mini-cottage-pies-with-peas
      family-mini-turkey-meatloaves
      family-mushroom-and-cheese-omelette-wraps
      family-one-pan-chicken-taco-rice
      family-one-pot-tomato-lentil-pasta
      family-pesto-chicken-green-bean-bulgur-bowls
      family-pizza-toast
      family-pork-and-apple-meatballs
      family-pork-and-pineapple-rice-bowls
      family-prawn-courgette-and-lemon-couscous-parcels
      family-quick-beef-and-sweetcorn-quesadillas
      family-quick-cheesy-bean-burritos
      family-quick-chicken-and-spinach-orzo
      family-quick-ham-and-pea-risotto-style-rice
      family-quick-lemon-tuna-rice-bowls
      family-quick-salmon-and-broccoli-noodles
      family-quick-tomato-and-mozzarella-flatbreads
      family-quick-turkey-mince-tacos
      family-quick-vegetable-and-cheese-frittata
      family-roast-vegetable-and-halloumi-wraps
      family-roasted-pumpkin-cheddar-quesadillas
      family-sausage-and-apple-casserole
      family-sausage-and-tomato-pasta-bake
      family-sausage-apple-and-potato-traybake
      family-sausage-squash-and-cheddar-baked-polenta
      family-slow-cooker-chicken-casserole
      family-smoky-chicken-pepper-flatbreads
      family-smoky-lentil-and-pepper-flatbread-pizzas
      family-speedy-chicken-and-mushroom-wraps
      family-speedy-fish-finger-tacos
      family-speedy-halloumi-and-pepper-wraps
      family-speedy-hummus-and-roasted-pepper-pittas
      family-speedy-sausage-and-tomato-couscous
      family-speedy-spinach-tomato-couscous
      family-speedy-tuna-and-lemon-pasta
      family-spinach-and-cheese-cannelloni
      family-sticky-pork-apple-and-red-cabbage-traybake
      family-sweet-potato-and-black-bean-enchiladas
      family-sweet-sour
      family-sweetcorn-and-cheddar-fritters
      family-sweetcorn-courgette-fritters
      family-taco-bowls
      family-tomato-and-mozzarella-gnocchi-bake
      family-tomato-and-ricotta-stuffed-peppers
      family-tomato-basil-chicken-meatballs
      family-tuna-and-sweetcorn-jacket-potatoes
      family-tuna-sweetcorn-pasta-fritters
      family-turkey-and-spinach-lasagne
      family-turkey-and-vegetable-cottage-pie
      family-turkey-bolognese-spaghetti
      family-turkey-red-pepper-and-bulgur-skillet
      family-turkey-sweetcorn-and-cheddar-stuffed-peppers
      fishcakes
      glamorgan-leek-cheese-sausages
      greek-chicken-tray
      halloumi-grain-bowls
      ham-pea-bread-pudding
      honey-garlic-tofu
      hoppin-john-black-eyed-peas
      lancashire-potato-butter-pie
      leftover-beef-baguettes
      leftover-beef-hash
      leftover-bolognese-bake
      leftover-chicken-pie
      leftover-chicken-rice
      leftover-chickpea-jackets
      leftover-chilli-peppers
      leftover-gammon-bake
      leftover-gammon-rice
      leftover-greek-pitas
      leftover-katsu-wraps
      leftover-lamb-flatbreads
      leftover-meatball-subs
      leftover-pork-jackets
      leftover-pork-noodles
      leftover-quinoa-patties
      leftover-salmon-fishcakes
      leftover-sausage-frittata
      leftover-turkey-pasta
      leftover-veg-quesadillas
      lemon-chicken-orzo
      lentil-bolognese
      liver-onion-butterbean-mash
      loaded-nachos
      miso-salmon-rice
      mushroom-pearl-barley-soup
      mushroom-risotto
      pan-fajita-rice
      pan-gnocchi-spinach
      pan-lemon-chicken
      pan-sausage-rice
      pan-teriyaki-salmon
      pan-tomato-orzo
      pesto-gnocchi
      pesto-salmon-potatoes
      pork-apple-tray
      pulled-pork
      roast-veg-couscous
      salmon
      salmon-yoghurt-flatbread-pockets
      sausage-gnocchi
      sausage-lentil-stew
      slow-beef-stew
      slow-bolognese
      slow-chicken-curry
      slow-honey-chicken
      slow-lamb-tagine
      slow-veggie-chilli
      smoked-haddock-kedgeree
      smoky-prawn-cannellini-skillet
      spinach-ricotta-shells
      steamed-beef-carrot-puddings
      steamed-lentil-oatmeal-haggis-neeps-tatties
      stir-fry
      sweet-potato-soup
      tangy-beef-sloppy-joes
      teriyaki-beef-noodles
      toad-hole-onion-gravy
      tomato-mozzarella-pasta
      traybake-sausage
      tuna-sweetcorn-pasta
      turkey-chilli
      veggie-fried-rice
      yellow-pea-ham-soup
    `.trim().split(/\s+/),
    "Try the World": `
      adjarian-cheese-egg-bread-boats
      aji-chicken-walnut-potatoes
      anchovy-onion-pissaladiere
      argentine-beef-olive-empanadas
      baked-lentil-and-carrot-kibbeh-squares
      banh-xeo-prawn-pork-crepes
      bean-cheese-pupusas-curtido
      beef-porkolt-caraway-dumplings
      beef-stifado-pearl-onions
      beetroot-broth-with-lamb-and-bulgur-dumplings
      beetroot-cabbage-borscht
      brazilian-fish-moqueca
      buckwheat-ham-gruyere-galettes
      cabbage-and-chana-dal-dry-curry-with-chapatis
      cambodian-fish-amok
      carrot-chickpea-socca-wedges
      chicken-almond-picada-beans
      chicken-paprikash-nokedli
      chicken-pozole-verde
      chicken-soboro-three-colour-rice
      chicken-vegetable-omurice
      chicken-vegetable-wonton-soup
      chinese-tomato-eggs-rice
      choucroute-smoked-sausage
      cinnamon-chicken-turnip-rechta-noodles
      cod-potato-egg-bras-skillet
      corn-arepas-egg-avocado
      cottage-cheese-dumplings-peas
      crisp-vegetable-spring-rolls
      cuban-black-bean-moros
      dutch-beef-ragout-croquettes
      egyptian-koshari-crispy-onions
      ethiopian-berbere-lentil-stew-with-flatbread
      filipino-chicken-adobo
      gado-gado-peanut-vegetable-salad
      georgian-walnut-bean-lobio
      goan-recheado-prawns-with-rice-and-green-beans
      greek-green-bean-potato-ladera
      greek-spinach-dill-rice
      greek-trahana-tomato-milk-soup
      grilled-mackerel-ochazuke
      haitian-citrus-pork-griot
      hakka-pork-stuffed-tofu
      herring-apple-rye-plates
      jamaican-brown-stew-dumplings
      janssons-sprat-potato-bake
      karelian-rye-pasties-egg-butter
      kimchi-tofu-jjigae
      king-prawn-chupe
      lebanese-mujadara-with-deeply-caramelised-onions
      lemongrass-chicken-bun-salad
      lentil-manti-dumplings-with-sumac-yoghurt
      malabar-tamarind-mackerel-curry
      mild-beef-and-potato-samosa-triangles
      mild-chicken-causa-layers
      mild-chicken-corn-tamales
      mild-coconut-fish-and-sweetcorn-poha
      mild-saffron-chicken-joojeh-skewers
      moroccan-sardine-kefta-tomato
      mushroom-and-freekeh-pilaf-with-almonds
      mushroom-caraway-barley-kuba
      nigerian-steamed-bean-puddings-with-eggs
      olivier-ham-egg-potato-salad
      paneer-kofta-in-a-mild-spinach-sauce
      pea-and-potato-chapati-roll-ups
      peppery-tomato-rasam-with-crisp-tofu-and-rice
      persian-aubergine-and-yellow-split-pea-khoresh
      persian-herb-and-kidney-bean-beef-stew
      pork-cabbage-okonomiyaki-pancakes
      pork-larb-lettuce-and-sticky-rice
      pork-rice-cabbage-golabki
      portuguese-caldo-verde
      potato-and-chickpea-chaat-with-tamarind-yoghurt
      potato-curd-pierogi
      prawn-coconut-laksa
      prawn-garlic-plantain-mofongo
      pumpkin-yoghurt-kadhi-with-rice
      raggmunk-bacon-lingonberry
      rice-flour-dosas-with-potato-and-pea-masala
      royal-beef-vegetable-rice-cakes
      salmorejo-egg-ham
      savoury-curd-cheese-blintzes
      semolina-gnocchi-romana
      senegalese-fish-and-cassava-thieboudienne
      seville-spinach-chickpeas
      sharp-lentils-boiled-eggs
      singapore-curried-rice-vermicelli
      skirlie-oats-poached-eggs
      slow-braised-goat-nihari-with-naan
      soft-polenta-peas-poached-eggs
      somali-spiced-beef-bariis-with-raisins
      spanish-migas-peppers-chorizo
      sri-lankan-beetroot-and-cashew-curry
      sri-lankan-vegetable-and-egg-kottu-roti
      steamed-chicken-bao-buns
      steamed-semolina-cakes-with-pea-tomato-dip
      stracciatella-star-pasta-soup
      sumac-chicken-and-onion-flatbread-roast
      swedish-fish-dumplings-dill
      sweet-potato-edamame-yaki-onigiri
      swiss-rosti-mushroom-ragout
      tapioca-cheese-buns-chicken
      three-cup-mushrooms-rice
      tuna-egg-picnic-gimbap
      tunisian-lablebi-egg-bread
      tunisian-tuna-egg-brik-parcels
      turkey-vegetable-arancini
      turkish-red-lentil-mercimek-soup
      turkish-yoghurt-poached-eggs
      turmeric-chicken-rice-congee-with-crisp-shallots
      turmeric-dill-fish-vermicelli
      tyrolean-bread-cheese-dumplings
      vegetable-egg-foo-young
      walnut-and-pomegranate-chicken-fesenjan
      west-african-peanut-and-black-eyed-bean-stew
      yemeni-lamb-and-vegetable-salta
      zanzibari-coconut-pigeon-pea-pilaf
    `.trim().split(/\s+/),
    "Special Occasion": `
      beef-brioche-mushroom-tournedos
      charred-octopus-romesco
      cheese-souffle-broccoli
      crab-ravioli-sage-butter
      crisp-pork-belly-tamarind-relish
      date-duck-orange
      date-garlic-prawns
      date-lemon-chicken
      date-night-beetroot-goats-cheese-tart
      date-night-lemon-caper-sea-bass
      date-night-miso-aubergine-sesame-rice
      date-night-prosciutto-sage-chicken
      date-night-rosemary-lamb-polenta
      date-night-saffron-seafood-paella
      date-night-scallops-pea-puree
      date-pesto-gnocchi
      date-stuffed-peppers
      duck-leg-confit-lentils
      fennel-rice-stuffed-squid
      freekeh-stuffed-quail-with-pomegranate-glaze
      juniper-venison-celeriac-puree
      langoustine-bisque-gruyere-croutons
      lobster-sweetcorn-chawanmushi
      lobster-thermidor-with-tarragon-mustard-sauce
      monkfish-bourride-aioli
      prawn-linguine
      saffron-halibut-with-jeweled-barberry-rice
      saffron-mussels-fregola
      salt-baked-sea-bream-fennel-orange-salad
      steak
      tamarind-date-lamb-loin-with-cauliflower-pur-e
      tea-smoked-duck-plum-soba
      tuscan-salmon
      whole-bream-black-bean-ginger
    `.trim().split(/\s+/)
  };
  const byId=new Map(Object.entries(GROUPS).flatMap(([group,ids])=>ids.map(id=>[id,group])));
  const allowedGroups=new Set(Object.keys(GROUPS));
  // Existing complete-meal candidates, selected from the historical full records.
  // Familiar-flavour browsing, not an age, nutrition or allergy certification.
  const KIDS_LABEL="Kids' Meals";
  const kidsIds=new Set(`
beef-meatballs
family-homemade-crunchy-fish-fingers
family-crispy-oven-chicken-goujons
family-mini-cottage-pies-with-peas
family-mac-cheese
family-ham-and-pea-macaroni-cheese
family-cheesy-cauliflower-macaroni
family-15-minute-cheesy-broccoli-pasta
family-15-minute-creamy-pea-pasta
family-beef-and-tomato-macaroni
family-meatballs
family-pork-and-apple-meatballs
family-tomato-basil-chicken-meatballs
family-mini-turkey-meatloaves
family-turkey-bolognese-spaghetti
family-pizza-toast
bbq-chicken-pizza
family-cheesy-bean-quesadillas
family-mild-chicken-korma-with-rice
baked-potato-beans
family-cheesy-chicken-and-rice-bake
family-chicken-and-cheese-tortilla-bake
family-baked-cod-with-cheesy-breadcrumbs
  `.trim().split(/\s+/));
  const SIDE_ID='extra-air-fryer-garlic-parmesan-potatoes';
  const fold=value=>typeof value==='string'?value.toLowerCase():'';
  const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
  function isSide(recipe){return !!recipe&&recipe.id===SIDE_ID;}
  function dinner(recipe){
    if(!recipe||typeof recipe!=='object'||typeof recipe.id!=='string'||!recipe.id||isSide(recipe)||recipe.dinnerEligible===false)return false;
    const category=[recipe.category,recipe.tag,recipe.mealType].map(fold).join(' ');
    if(/\b(?:desserts?|baking|breakfast|brunch|sweet treats?|snacks?|side(?: dish(?:es)?)?|lunch(?:box)?|drinks?|smoothies?)\b|after.school/.test(category))return false;
    // Unknown records need an explicit dinner signal; an ID or title alone
    // must not invent meal eligibility or a readiness claim.
    if(!byId.has(recipe.id)&&recipe.dinnerEligible!==true&&!/\bdinner\b/.test(category))return false;
    const planning=getPlanning();
    if(typeof planning?.isDinner==='function')return planning.isDinner(recipe)===true;
    // Conservative load-order fallback, using the planning module's name guards.
    const name=fold(recipe.name);
    if(/\b(?:brownies?|cookies?|muffins?|cupcakes?|waffles?|porridge|granola|overnight oats|french toast)\b/.test(name))return false;
    const savouryPancakes=/\bokonomiyaki\b|\bsavou?ry\b.*\bpancakes?\b|\b(?:potato|courgette|cabbage|chickpea|spinach)\b.*\bpancakes?\b/.test(name);
    return !(/\bpancakes?\b/.test(name)&&!savouryPancakes);
  }
  function isKidsMeal(recipe){
    return dinner(recipe)&&recipe.kidFriendly!==false&&
      (kidsIds.has(recipe.id)||recipe.kidFriendly===true||recipe.expansionGroup==='kid-friendly');
  }
  function totalMinutes(recipe){
    if(!recipe||typeof recipe!=='object')return null;
    const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
    if(own(recipe,'prep_mins')||own(recipe,'cook_mins')){
      if(!finite(recipe.prep_mins)||!finite(recipe.cook_mins))return null;
      const total=recipe.prep_mins+recipe.cook_mins;
      return Number.isFinite(total)&&total>0?total:null;
    }
    return typeof recipe.mins==='number'&&Number.isFinite(recipe.mins)&&recipe.mins>0?recipe.mins:null;
  }
  function primaryCollection(recipe){
    if(!dinner(recipe))return null;
    return allowedGroups.has(recipe.editorialCollection)?recipe.editorialCollection:(byId.get(recipe.id)||null);
  }
  function collections(recipe){
    if(!dinner(recipe))return [];
    const primary=primaryCollection(recipe),result=primary?[primary]:[];
    if(isKidsMeal(recipe))result.push(KIDS_LABEL);
    const minutes=totalMinutes(recipe);
    if(minutes!==null&&minutes<=60)result.push('60 Minutes or Less');
    const category=[recipe.category,recipe.tag,recipe.mealType].map(fold).join(' ');
    if((minutes!==null&&minutes>60)||/\bslow[ -]?cook(?:er|ing)?\b/.test(category))result.push('Weekend & Slow Cooking');
    return result;
  }
  return Object.freeze({primaryCollection,collections,isSide,isKidsMeal,totalMinutes});
});
