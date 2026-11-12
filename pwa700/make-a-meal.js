(()=>{'use strict';
function bbPwa700Digest(value){
 if(typeof value!=='string')throw TypeError('Catalogue digest input must be text');
 const bytes=new TextEncoder().encode(value),size=Math.ceil((bytes.length+9)/64)*64,padded=new Uint8Array(size),view=new DataView(padded.buffer);
 padded.set(bytes);padded[bytes.length]=0x80;
 const bits=bytes.length*8;view.setUint32(size-8,Math.floor(bits/0x100000000),false);view.setUint32(size-4,bits>>>0,false);
 const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
 const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],w=new Uint32Array(64),rotate=(n,bits)=>(n>>>bits)|(n<<(32-bits));
 for(let offset=0;offset<size;offset+=64){
  for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4,false);
  for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2],s0=rotate(a,7)^rotate(a,18)^(a>>>3),s1=rotate(b,17)^rotate(b,19)^(b>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;}
  let [a,b,c,d,e,f,g,last]=h;
  for(let i=0;i<64;i++){
   const s1=rotate(e,6)^rotate(e,11)^rotate(e,25),choice=(e&f)^(~e&g),t1=(last+s1+choice+k[i]+w[i])>>>0,s0=rotate(a,2)^rotate(a,13)^rotate(a,22),majority=(a&b)^(a&c)^(b&c),t2=(s0+majority)>>>0;
   last=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
  }
  const state=[a,b,c,d,e,f,g,last];for(let i=0;i<8;i++)h[i]=(h[i]+state[i])>>>0;
 }
 return h.map(n=>n.toString(16).padStart(8,'0')).join('');
}
const BB_PWA700_RELEASE=Object.freeze({"catalogueVersion":700,"clientVersion":"1.0.2","releaseId":"catalogue700-20261108-build33","freeRecipesSha256":"ac52369dc2f1d470546c749153197bc2f9d7e81508d9aed443ef35ad5f58f49e","freeNormalizedSha256":"8ebdd985602f1f739c7cd35e8a308f4aec613a41f8e2388fb1af88326da65f04","premiumIds":["family-cottage-pie","family-mac-cheese","family-meatballs","family-chicken-pie","family-fish-pie","family-taco-bowls","family-pizza-toast","family-lasagne","extra-air-fryer-halloumi-wraps","extra-air-fryer-lemon-cod","extra-air-fryer-bbq-chicken-wings","extra-air-fryer-stuffed-mushrooms","extra-air-fryer-crispy-tofu-bowls","extra-air-fryer-pork-schnitzel","extra-quick-chicken-quesadillas","extra-20-minute-prawn-fried-rice","extra-speedy-spinach-ricotta-ravioli","extra-thai-basil-turkey-mince","extra-mediterranean-tuna-couscous","extra-honey-mustard-chicken-wraps","extra-baked-bean-cheese-toasties","extra-creamy-mushroom-pasta","extra-crispy-potato-and-egg-hash","extra-sausage-and-bean-casserole","extra-chickpea-tomato-shakshuka","extra-broccoli-cheddar-baked-rice","extra-steak-and-black-bean-salad","extra-lemon-herb-chicken-quinoa","extra-harissa-chickpea-feta-bowls","extra-garlic-shrimp-protein-pasta","extra-turkey-burger-lettuce-cups","extra-salmon-avocado-rice-bowls","extra-creamy-pumpkin-sage-pasta","extra-black-bean-sweet-potato-tacos","extra-spinach-feta-filo-parcels","extra-miso-mushroom-noodle-soup","extra-cauliflower-coconut-korma","extra-roasted-vegetable-quinoa-bake","extra-caprese-stuffed-portobellos","extra-peanut-sesame-tofu-noodles","extra-broccoli-pesto-baked-potatoes","extra-garlic-butter-roast-turkey-breast","extra-mushroom-walnut-wellington","extra-crispy-roast-pork-loin","extra-lemon-thyme-roast-salmon-side","extra-stuffed-roast-butternut-squash","extra-balsamic-roast-chicken-thighs","extra-homemade-chicken-tikka-masala","extra-crispy-chilli-beef","extra-teriyaki-tofu-rice-bowls","extra-salt-and-pepper-prawns","extra-bbq-pulled-jackfruit-buns","extra-homemade-doner-style-chicken","extra-thai-green-chicken-curry","extra-breakfast-burrito-bowls","extra-french-toast-with-berries","extra-mushroom-avocado-toast","extra-greek-yoghurt-granola-pots","extra-tomato-mozzarella-breakfast-muffins","leftover-chicken-pie","leftover-chicken-rice","leftover-beef-hash","leftover-beef-baguettes","leftover-gammon-bake","leftover-gammon-rice","leftover-lamb-flatbreads","leftover-turkey-pasta","leftover-pork-noodles","leftover-salmon-fishcakes","leftover-pork-jackets","leftover-chilli-peppers","leftover-bolognese-bake","leftover-katsu-wraps","leftover-greek-pitas","leftover-sausage-frittata","leftover-veg-quesadillas","leftover-chickpea-jackets","leftover-meatball-subs","leftover-quinoa-patties","dessert-eton-mess","dessert-victoria-sponge","dessert-bread-butter-pudding","dessert-chocolate-mousse","dessert-banoffee-pie","dessert-raspberry-cheesecake","dessert-chocolate-chip-cookies","dessert-rice-pudding","dessert-classic-apple-pie","dessert-chocolate-ice-cream","dessert-berry-pavlova","dessert-carrot-cake","dessert-jam-roly-poly","dessert-tiramisu","dessert-lemon-cheesecake","dessert-chocolate-profiteroles","dessert-treacle-tart","family-creamy-chicken-and-broccoli-pasta-bake","family-mini-cottage-pies-with-peas","family-cheesy-meatball-orzo","family-mild-chicken-korma-with-rice","family-homemade-crunchy-fish-fingers","family-15-minute-tomato-and-basil-gnocchi","family-chicken-sweetcorn-and-polenta-skillet-bake","family-cheese-and-tomato-pizza-pinwheels","family-mini-spinach-and-cheese-muffins","family-chicken-sweetcorn-potato-croquettes","family-leftover-mashed-potato-cheese-cakes","family-one-pot-tomato-lentil-pasta","family-mild-beef-chilli-with-rice","family-chicken-and-sweetcorn-enchiladas","family-cheddar-broccoli-potato-gratin","family-slow-cooker-chicken-casserole","family-beef-mince-and-potato-hotpot","family-pork-and-apple-meatballs","family-creamy-mushroom-chicken-rice","family-cheesy-spinach-stuffed-shells","family-tomato-and-mozzarella-gnocchi-bake","family-chicken-ginger-and-vegetable-noodle-soup","family-beef-burger-rice-bowls","family-chicken-pesto-pasta-shells","family-turkey-red-pepper-and-bulgur-skillet","family-mild-coconut-chicken-curry","family-lemon-salmon-vegetable-rice-parcels","family-chicken-and-ham-pasta-gratin","family-beef-and-carrot-shepherd-s-pie","family-cheesy-cauliflower-macaroni","family-sausage-and-tomato-pasta-bake","family-chicken-mushroom-and-lemon-noodle-soup","family-mild-lentil-and-sweet-potato-dhal","family-tuna-and-sweetcorn-jacket-potatoes","family-chicken-and-vegetable-couscous","family-mini-beef-and-bean-burritos","family-creamy-chicken-and-spinach-risotto","family-turkey-bolognese-spaghetti","family-cheesy-bean-quesadillas","family-pork-and-pineapple-rice-bowls","family-chicken-and-potato-casserole","family-beef-and-broccoli-noodles","family-roasted-pumpkin-cheddar-quesadillas","family-baked-cod-with-cheesy-breadcrumbs","family-chicken-and-cheese-tortilla-bake","family-sausage-apple-and-potato-traybake","family-turkey-and-vegetable-cottage-pie","family-tomato-basil-chicken-meatballs","family-cheesy-chicken-and-rice-bake","family-beef-and-mushroom-stroganoff","family-sweetcorn-and-cheddar-fritters","family-baked-chicken-parmesan","family-mild-lamb-and-chickpea-stew","family-ham-and-pea-macaroni-cheese","family-chicken-and-courgette-fritters","family-creamy-salmon-and-pea-pasta","family-roast-vegetable-and-halloumi-wraps","family-beef-and-sweet-potato-stuffed-courgettes","family-tomato-and-ricotta-stuffed-peppers","family-sticky-pork-apple-and-red-cabbage-traybake","family-smoky-lentil-and-pepper-flatbread-pizzas","family-chicken-and-sweetcorn-chowder","family-mini-turkey-meatloaves","family-meatball-vegetable-rice-bake","family-creamy-cauliflower-chicken-bake","family-sweet-potato-and-black-bean-enchiladas","family-ginger-chicken-and-carrot-noodle-broth","family-beef-and-tomato-macaroni","family-crispy-oven-chicken-goujons","family-spinach-and-cheese-cannelloni","family-sausage-and-apple-casserole","family-tuna-sweetcorn-pasta-fritters","family-chicken-broccoli-and-potato-rosti-bake","family-mild-chickpea-tikka-masala","family-broccoli-cheddar-and-white-bean-fritters","family-beef-and-pepper-stuffed-potatoes","family-turkey-and-spinach-lasagne","family-quick-tomato-and-mozzarella-flatbreads","family-speedy-sausage-and-tomato-couscous","family-20-minute-creamy-pesto-pasta","family-sausage-squash-and-cheddar-baked-polenta","family-garlic-butter-chicken-noodles","family-speedy-tuna-and-lemon-pasta","family-sweetcorn-courgette-fritters","family-quick-cheesy-bean-burritos","family-speedy-spinach-tomato-couscous","family-smoky-chicken-pepper-flatbreads","family-butterbean-and-roasted-carrot-hummus-bowls","family-quick-salmon-and-broccoli-noodles","family-mushroom-and-cheese-omelette-wraps","family-one-pan-chicken-taco-rice","family-15-minute-creamy-pea-pasta","family-speedy-halloumi-and-pepper-wraps","family-quick-turkey-mince-tacos","family-prawn-courgette-and-lemon-couscous-parcels","family-chicken-and-avocado-toasties","family-20-minute-beef-noodle-bowls","family-baked-potato-spinach-and-egg-muffin-cups","family-quick-chicken-and-spinach-orzo","family-15-minute-butterbean-tomato-pasta","family-speedy-fish-finger-tacos","family-quick-vegetable-and-cheese-frittata","family-20-minute-chicken-ramen-bowls","family-speedy-hummus-and-roasted-pepper-pittas","family-quick-beef-and-sweetcorn-quesadillas","family-15-minute-cheesy-broccoli-pasta","family-speedy-chicken-and-mushroom-wraps","family-quick-lemon-tuna-rice-bowls","family-20-minute-vegetable-udon-noodles","family-turkey-sweetcorn-and-cheddar-stuffed-peppers","family-quick-ham-and-pea-risotto-style-rice","family-pesto-chicken-green-bean-bulgur-bowls","family-chicken-broccoli-and-lemon-potato-cakes","baking-cheddar-chive-scones","baking-rosemary-sea-salt-focaccia","baking-chocolate-orange-marble-loaf","baking-raspberry-white-chocolate-blondies","baking-jam-thumbprint-biscuits","date-night-lemon-caper-sea-bass","date-night-scallops-pea-puree","date-night-rosemary-lamb-polenta","date-night-beetroot-goats-cheese-tart","date-night-miso-aubergine-sesame-rice","date-night-prosciutto-sage-chicken","date-night-saffron-seafood-paella","smoky-prawn-cannellini-skillet","black-bean-sweetcorn-tortilla-soup","pork-cabbage-okonomiyaki-pancakes","turkish-red-lentil-mercimek-soup","tunisian-tuna-egg-brik-parcels","cinnamon-chicken-turnip-rechta-noodles","moroccan-sardine-kefta-tomato","seville-spinach-chickpeas","portuguese-caldo-verde","spanish-migas-peppers-chorizo","chicken-almond-picada-beans","greek-spinach-dill-rice","greek-green-bean-potato-ladera","potato-curd-pierogi","mushroom-caraway-barley-kuba","chicken-paprikash-nokedli","beef-stifado-pearl-onions","anchovy-onion-pissaladiere","swiss-rosti-mushroom-ragout","georgian-walnut-bean-lobio","adjarian-cheese-egg-bread-boats","egyptian-koshari-crispy-onions","tunisian-lablebi-egg-bread","buckwheat-ham-gruyere-galettes","cod-potato-egg-bras-skillet","turkish-yoghurt-poached-eggs","fennel-rice-stuffed-squid","dutch-beef-ragout-croquettes","swedish-fish-dumplings-dill","turkey-vegetable-arancini","semolina-gnocchi-romana","cottage-cheese-dumplings-peas","salmorejo-egg-ham","olivier-ham-egg-potato-salad","stracciatella-star-pasta-soup","greek-trahana-tomato-milk-soup","carrot-chickpea-socca-wedges","saffron-mussels-fregola","juniper-venison-celeriac-puree","duck-leg-confit-lentils","crab-ravioli-sage-butter","monkfish-bourride-aioli","vanilla-creme-brulee","pear-almond-frangipane-galette","cherry-clafoutis","orange-crepes-suzette","apricot-pistachio-honey-nougat","lebanese-mujadara-with-deeply-caramelised-onions","ethiopian-berbere-lentil-stew-with-flatbread","zanzibari-coconut-pigeon-pea-pilaf","persian-herb-and-kidney-bean-beef-stew","sumac-chicken-and-onion-flatbread-roast","west-african-peanut-and-black-eyed-bean-stew","somali-spiced-beef-bariis-with-raisins","peppery-tomato-rasam-with-crisp-tofu-and-rice","malabar-tamarind-mackerel-curry","yemeni-lamb-and-vegetable-salta","potato-and-chickpea-chaat-with-tamarind-yoghurt","persian-aubergine-and-yellow-split-pea-khoresh","beetroot-broth-with-lamb-and-bulgur-dumplings","turmeric-chicken-rice-congee-with-crisp-shallots","sri-lankan-beetroot-and-cashew-curry","goan-recheado-prawns-with-rice-and-green-beans","senegalese-fish-and-cassava-thieboudienne","nigerian-steamed-bean-puddings-with-eggs","lentil-manti-dumplings-with-sumac-yoghurt","mushroom-and-freekeh-pilaf-with-almonds","cabbage-and-chana-dal-dry-curry-with-chapatis","rice-flour-dosas-with-potato-and-pea-masala","sri-lankan-vegetable-and-egg-kottu-roti","walnut-and-pomegranate-chicken-fesenjan","mild-saffron-chicken-joojeh-skewers","steamed-semolina-cakes-with-pea-tomato-dip","paneer-kofta-in-a-mild-spinach-sauce","mild-beef-and-potato-samosa-triangles","baked-lentil-and-carrot-kibbeh-squares","pumpkin-yoghurt-kadhi-with-rice","salmon-yoghurt-flatbread-pockets","mild-coconut-fish-and-sweetcorn-poha","butterbean-and-tomato-hand-pies","pea-and-potato-chapati-roll-ups","saffron-halibut-with-jeweled-barberry-rice","tamarind-date-lamb-loin-with-cauliflower-pur-e","freekeh-stuffed-quail-with-pomegranate-glaze","lobster-thermidor-with-tarragon-mustard-sauce","slow-braised-goat-nihari-with-naan","pistachio-and-rose-baklava-diamonds","saffron-semolina-halva-with-almonds","coconut-and-cardamom-ladoo","poached-pumpkin-with-tahini-and-walnuts","orange-blossom-jalebi-syrup-spirals","pork-larb-lettuce-and-sticky-rice","lemongrass-chicken-bun-salad","filipino-chicken-adobo","gado-gado-peanut-vegetable-salad","singapore-curried-rice-vermicelli","kimchi-tofu-jjigae","chinese-tomato-eggs-rice","chicken-soboro-three-colour-rice","turmeric-dill-fish-vermicelli","prawn-coconut-laksa","grilled-mackerel-ochazuke","three-cup-mushrooms-rice","cambodian-fish-amok","chicken-pozole-verde","cuban-black-bean-moros","aji-chicken-walnut-potatoes","brazilian-fish-moqueca","prawn-garlic-plantain-mofongo","bean-cheese-pupusas-curtido","argentine-beef-olive-empanadas","jamaican-brown-stew-dumplings","haitian-citrus-pork-griot","hakka-pork-stuffed-tofu","banh-xeo-prawn-pork-crepes","chicken-vegetable-wonton-soup","vegetable-egg-foo-young","royal-beef-vegetable-rice-cakes","steamed-chicken-bao-buns","sweet-potato-edamame-yaki-onigiri","mild-chicken-corn-tamales","chicken-vegetable-omurice","tuna-egg-picnic-gimbap","crisp-vegetable-spring-rolls","mild-chicken-causa-layers","tea-smoked-duck-plum-soba","whole-bream-black-bean-ginger","lobster-sweetcorn-chawanmushi","crisp-pork-belly-tamarind-relish","king-prawn-chupe","mango-coconut-sticky-rice","black-sesame-red-bean-mochi","lychee-ginger-granita","cinnamon-churros-chocolate","dulce-de-leche-alfajores","cullen-skink-smoked-haddock","pork-rice-cabbage-golabki","beef-porkolt-caraway-dumplings","karelian-rye-pasties-egg-butter","sharp-lentils-boiled-eggs","beetroot-cabbage-borscht","yellow-pea-ham-soup","toad-hole-onion-gravy","smoked-haddock-kedgeree","glamorgan-leek-cheese-sausages","lancashire-potato-butter-pie","cajun-prawn-cheddar-grits","blackened-catfish-celery-rice","chicken-okra-dark-roux-gumbo","hoppin-john-black-eyed-peas","tangy-beef-sloppy-joes","steamed-lentil-oatmeal-haggis-neeps-tatties","raggmunk-bacon-lingonberry","choucroute-smoked-sausage","janssons-sprat-potato-bake","mushroom-pearl-barley-soup","skirlie-oats-poached-eggs","herring-apple-rye-plates","chicken-waldorf-salad","liver-onion-butterbean-mash","egg-hole-spinach-toast","steamed-beef-carrot-puddings","ham-pea-bread-pudding","cheese-souffle-broccoli","soft-polenta-peas-poached-eggs","tyrolean-bread-cheese-dumplings","savoury-curd-cheese-blintzes","oatcakes-lentil-pate","corn-arepas-egg-avocado","tapioca-cheese-buns-chicken","salt-baked-sea-bream-fennel-orange-salad","langoustine-bisque-gruyere-croutons","beef-brioche-mushroom-tournedos","charred-octopus-romesco","lemon-posset-berries","chocolate-hazelnut-truffles","pumpkin-custard-pie","peach-cornmeal-cobbler","raspberry-vanilla-baked-alaska","crispy-aromatic-duck-pancakes","chicken-satay-skewers-with-peanut-sauce","lamb-rogan-josh","chicken-dhansak","buttermilk-fried-chicken-pieces-with-peppered-gravy","crispy-chicken-chimichangas","salmon-en-croute-with-spinach","moules-marinieres-with-skinny-chips","pan-fried-trout-almondine","coq-au-vin-with-mash","pork-tenderloin-stuffed-with-apple-and-black-pudding","crispy-calamari-with-garlic-mayo-and-warm-potato-salad","seafood-spaghetti-marinara-with-mussels-prawns-and-squid","belgian-breakfast-waffles-with-berries","french-onion-soup-with-cheese-croutons","sausage-plait-with-onion-chutney","ham-egg-and-chips","classic-creamy-stovetop-porridge","chia-seed-breakfast-pudding-with-berries","salisbury-steak-with-mash","beef-and-onion-cobbler","full-english-breakfast-traybake","cajun-chicken-prawn-and-chorizo-jambalaya","homemade-all-butter-croissants","ratatouille-with-crusty-bread","chinese-takeaway-lemon-chicken","chinese-hot-and-sour-soup","chicken-balti-with-naan","vegetable-biryani-with-cucumber-raita","onion-bhajis-with-mango-chutney","philly-cheesesteak-rolls","steak-diane-with-saute-potatoes","sole-meuniere-with-green-beans","fresh-cod-brandade-with-green-salad","mussel-and-saffron-risotto","hot-smoked-salmon-potato-salad-with-horseradish","new-england-clam-chowder","cornish-beef-pasties","chicken-chasseur-with-mash","carrot-and-coriander-soup-with-crusty-bread","american-cobb-salad","reuben-sandwiches","ham-and-mushroom-calzone","cauliflower-cheese-with-crusty-bread","cacio-e-pepe","cranberry-and-orange-breakfast-scones","honey-and-almond-breakfast-flapjacks","black-pudding-and-apple-breakfast-stacks","homemade-fruit-and-nut-muesli","potato-farls-with-fried-eggs","lamb-pasanda-with-almond-rice","king-prawn-puri","chinese-chicken-and-cashew-nuts","chinese-takeaway-crispy-seaweed","cheeseburger-loaded-fries","chicago-deep-dish-pepperoni-pizza","smoked-mackerel-pate-with-toast","cioppino-with-sourdough","salmon-and-prawn-terrine-with-cucumber-salad","grilled-tuna-with-peperonata","dressed-crab-with-brown-bread","prawn-saganaki-with-crusty-bread","corned-beef-and-potato-pie","spanish-tortilla-with-tomato-salad","pasta-alla-norma","beef-olives-with-mash","scotch-broth-with-lamb-and-barley","roast-vegetable-crumble-with-cheddar-oats","panzanella-bread-salad","crispy-bacon-and-cheddar-potato-skins","staffordshire-oatcakes-with-bacon-and-cheese","breakfast-soda-bread-with-marmalade","croque-madame","pan-con-tomate-with-cured-ham","bacon-and-scrambled-egg-breakfast-quesadillas","keema-naan","chinese-ginger-and-spring-onion-lamb-with-rice","buffalo-chicken-wings-with-blue-cheese-dip","beef-barbacoa-tacos","mozzarella-sticks-with-marinara","chilli-con-queso-with-tortilla-chips","chicken-cordon-bleu-with-green-salad","steak-frites-with-cafe-de-paris-butter","king-prawn-and-chorizo-skewers-with-lemon-potatoes","potted-brown-shrimp-with-toast","smoked-haddock-scotch-eggs-with-mustard-leaves","roast-beef-tonnato-with-green-salad","lancashire-lamb-hotpot","steak-pizzaiola-with-potatoes","succotash-with-baked-eggs","american-three-bean-salad-with-cornbread","tuna-melt-toasties","pork-and-liver-faggots-with-mash","cauliflower-steaks-with-romesco-and-butter-beans","crispy-polenta-chips-with-tomato-bean-ragu","warm-pear-and-quinoa-breakfast-bowls","bacon-and-maple-cornbread-breakfast-muffins","homemade-pork-and-sage-breakfast-patties","cottage-cheese-cucumber-and-radish-crispbreads","buck-rarebit"]});
let bbPwa700PremiumRequest=0;
function bbPwa700Identity(){try{const session=JSON.parse(localStorage.getItem('basketboss_cloud_session_v1')||'null');return typeof session?.user?.id==='string'&&session.user.id&&session.access_token===bbPaidToken()?session.user.id+'|'+session.access_token:null;}catch{return null;}}

const STORE='basketboss_makeameal_v1_inventory', STOCK='basketboss_321_v7_measured_pantry', STATE='basketboss_321_unified_state_v1';
const FOODS={
 cupboard:[['🍚','Rice'],['🍝','Pasta'],['🍅','Tinned tomatoes'],['🥫','Tinned beans'],['🫘','Lentils'],['🫒','Cooking oil'],['🧂','Salt'],['🌶️','Pepper'],['🧄','Garlic'],['🌿','Dried herbs'],['🥄','Soy sauce'],['🥖','Breadcrumbs'],['🧊','Stock cubes'],['🥣','Oats'],['🍯','Sugar'],['🥖','Flour'],['🥜','Peanut butter'],['🍯','Honey'],['🥕','Potatoes'],['🥫','Tuna'],['🥫','Chickpeas'],['🍜','Noodles'],['🧂','Paprika'],['🍅','Ketchup'],['🥚','Mayonnaise']],
 fridge:[['🥛','Milk'],['🧀','Cheddar'],['🥣','Yoghurt'],['🍖','Ham'],['🧈','Butter'],['🥚','Eggs'],['🍗','Cooked chicken'],['🥛','Cream'],['🧀','Mozzarella'],['🥬','Spinach'],['🥒','Cucumber'],['🥗','Lettuce'],['🥓','Bacon'],['🍄','Mushrooms'],['🍅','Tomatoes'],['🥕','Carrots'],['🧅','Onion'],['🫑','Peppers'],['🥦','Broccoli'],['🧀','Cheese strings']],
 freezer:[['🫛','Frozen peas'],['🌽','Frozen sweetcorn'],['🥦','Frozen broccoli'],['🍗','Frozen chicken'],['🐟','Frozen fish'],['🦐','Frozen prawns'],['🍟','Frozen chips'],['🥬','Frozen spinach'],['🥩','Frozen mince'],['🍞','Frozen bread'],['🫐','Frozen berries'],['🍖','Frozen sausages'],['🍲','Frozen leftovers'],['🧊','Frozen mixed vegetables'],['🥔','Frozen potato wedges']]
};
/* Premium recipe eligibility is based only on items returned by the authenticated
 * server endpoint. Preview switches/localStorage must never authorize content. */
const bbSecureFreeIds=new Set(Array.isArray(window.BB173_FREE_RECIPE_IDS)?window.BB173_FREE_RECIPE_IDS:[]);
let bbSecurePremiumIds=new Set();
let bbSecureFreeRecipes=[];
let bbSecureLastToken=null;
// Include both the response headers and JSON body in the network deadline. A
// weak store connection can deliver headers then stall without ever finishing
// its body; none of the photo/generate controls may remain locked indefinitely.
async function bbMealJSON(url,options={},timeoutMs=12000){
 if(window.navigator?.onLine===false)throw Error('You are offline. Your saved ingredients were not changed; reconnect to use AI.');
 const controller=new AbortController(),external=options.signal;
 let timeout=false,stop;
 const abort=()=>controller.abort();
 const stopped=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error(timeout?'Request timed out. Your selections were not changed; try again or use local recipes.':'Request cancelled. Your selections were not changed.')),{once:true}));
 if(external?.aborted)abort();else external?.addEventListener?.('abort',abort,{once:true});
 stop=setTimeout(()=>{timeout=true;abort();},timeoutMs);
 const request=Promise.resolve().then(async()=>{
  if(controller.signal.aborted)throw Error('Request cancelled.');
  const response=await fetch(url,{...options,signal:controller.signal});
  const data=await response.json();return {response,data};
 });
 try{return await Promise.race([request,stopped]);}
 catch(error){if(controller.signal.aborted)throw error;throw Error('Connection interrupted. Your selections were not changed; check your signal and try again.');}
 finally{clearTimeout(stop);external?.removeEventListener?.('abort',abort);}
}
function bb176MakeMealAllowed(recipe){
  return !!recipe?.id && (bbSecureFreeIds.has(recipe.id)||bbSecurePremiumIds.has(recipe.id));
}
async function bbSecureRefreshPremiumRecipes(){
 const revision=++bbPwa700PremiumRequest,token=bbPaidToken(),identity=bbPwa700Identity();
 bbSecureLastToken=token;
 if(bbPhotoMealMode)return;
 bbSecurePremiumIds=new Set();recipes=bbSecureFreeRecipes.slice();renderTiles();
 if(!token||!identity||bbSecureFreeRecipes.length!==200||bbPwa700Digest(JSON.stringify(bbSecureFreeRecipes))!==BB_PWA700_RELEASE.freeRecipesSha256)return;
 try{
  const {response,data}=await bbMealJSON('/api/recipes/v700/premium?catalogue=700',{cache:'no-store',credentials:'same-origin',redirect:'manual',headers:{Accept:'application/json',Authorization:'Bearer '+token}});
  if(!response.ok||data?.catalogueVersion!==700||data.releaseId!==BB_PWA700_RELEASE.releaseId||data.count!==500||data.total!==700||data.targetTotal!==700||data.freeRecipesSha256!==BB_PWA700_RELEASE.freeRecipesSha256||data.freeNormalizedSha256!==BB_PWA700_RELEASE.freeNormalizedSha256||!Array.isArray(data.recipes)||data.recipes.length!==500||!Array.isArray(data.normalized)||data.normalized.length!==500)return;
  const ids=new Set();
  for(let index=0;index<500;index++){const recipe=data.recipes[index],normal=data.normalized[index];if(recipe?.id!==BB_PWA700_RELEASE.premiumIds[index]||ids.has(recipe.id)||bbSecureFreeIds.has(recipe.id)||normal?.id!==recipe.id||!Array.isArray(recipe.ingredients)||!Array.isArray(normal.ingredients)||normal.ingredients.length!==recipe.ingredients.length||normal.ingredients.some((row,slot)=>row?.recipe_id!==recipe.id||row.ingredient_index!==slot||row.name!==recipe.ingredients[slot]?.[0]))return;ids.add(recipe.id);}
  if(revision!==bbPwa700PremiumRequest||bbPwa700Identity()!==identity)return;
  bbSecurePremiumIds=ids;recipes=bbSecureFreeRecipes.concat(data.recipes);renderTiles();
 }catch{ /* A missing, stale or unverified response never grants Premium. */ }
}
function bbSecureCheckAccountChange(){
  bbCheckGeneratedMealAccount();
  if(bbPaidToken()!==bbSecureLastToken)void bbSecureRefreshPremiumRecipes();
}
window.addEventListener('focus',bbSecureCheckAccountChange);
// Detect sign-in/out in this tab; storage events normally fire only in other tabs.
setInterval(bbSecureCheckAccountChange,2000);
window.addEventListener('storage',event=>{
  if(event.key==='basketboss_cloud_session_v1')bbSecureCheckAccountChange();
  if(event.key===null||event.key==='basketboss_321_v7_market'||event.key===STATE){bbCheckGeneratedMealAccount();renderRecipes();}
});
window.addEventListener('basketboss:market-changed',()=>renderRecipes());
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden)bbSecureCheckAccountChange();
});

let area='cupboard',mode='only',recipes=[],inventory={},results=[],suggestionOffset=0,photoFile=null;
 let bb5Confirmed=false;
let scanReviewActor=null,pantryScanLocation=null;
let aiEnabled=false, turnstileToken='',turnstileWidgetId=null,scanRevision=0,scanInFlight=false,generateInFlight=false;
let generateRevision=0,generateActor=null,generatePreferenceStamp=null,generatedView=null;
const bbPhotoMealMode=new URLSearchParams(location.search).get('bbscan')!=='pantry';
let bbPhotoMealNames=null,bbPhotoReviewToken=null;
let bbScanRequest=null;
const $=s=>document.querySelector(s), esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Recipe presentation follows the saved shopping region. Inventory remains
// in its original metric/count units for review, planning and reconciliation.
function bbMealMarket(){try{return window.BasketBossMarket?.get?.()||localStorage.getItem('basketboss_321_v7_market')||'Jersey';}catch{return 'Jersey';}}
function bbMealQuantity(text,name){return window.BBRecipeMeasures?.quantity(text,name,bbMealMarket())??String(text??'');}
function bbMealStep(text){const value=window.BBRecipeMeasures?.step(text,bbMealMarket())??String(text??'');return window.BBDuration?.text(value)??value;}
function bbMealDuration(minutes){return window.BBDuration?.format(minutes)??`${minutes}mins`;}
function bbMealMethod(recipe){
 if(window.BBCookMethod?.normalizeMethod)return window.BBCookMethod.normalizeMethod(recipe);
 const source=[recipe?.method,recipe?.steps].find(value=>Array.isArray(value)&&value.length||typeof value==='string'&&value.trim());
 return Array.isArray(source)?source.filter(value=>typeof value==='string'&&value.trim()):typeof source==='string'?[source]:[];
}
function bbMealStepHTML(text){const clean=window.BBCookMethod?.normalizeStep(text)??String(text).replace(/^\s*\d+[.)]\s*/,''),value=bbMealStep(clean),actions=window.BBCookStepLayout?.actions(value)||[value];return `<li><ul class="bb-cook-actions" data-bb-measures>${actions.map(action=>`<li>${esc(action)}</li>`).join('')}</ul></li>`;}
const alias={'cheddar cheese':'cheddar','mature cheddar':'cheddar','cheese (cheddar)':'cheddar','tinned kidney beans':'tinned beans','canned beans':'tinned beans','olive oil':'cooking oil','sunflower oil':'cooking oil','vegetable oil':'cooking oil','chopped tomatoes':'tinned tomatoes','canned tomatoes':'tinned tomatoes','eggs':'egg','tomatoes':'tomato','potatoes':'potato','peppers':'pepper','mushrooms':'mushroom','carrots':'carrot','onions':'onion','wraps':'wrap','peas':'pea','frozen peas':'pea','sweetcorn':'sweetcorn','frozen sweetcorn':'sweetcorn','yoghurts':'yoghurt','chickpeas':'chickpea'};
function canon(s){if(window.BBPantryAliasCanonical)return window.BBPantryPolicy?.canonicalName(s,window.BBPantryAliasCanonical)||window.BBPantryAliasCanonical(s);let t=String(s||'').toLowerCase().normalize('NFKC').replace(/\([^)]*\)/g,' ').replace(/[–—-]/g,' ').replace(/[^\p{L}\s]/gu,' ').replace(/\s+/g,' ').trim();if(alias[t])return alias[t];t=t.replace(/^(fresh|cooked|raw|diced|chopped|sliced|grated|frozen)\s+/g,'').trim();if(alias[t])return alias[t];if(t.endsWith('ies'))t=t.slice(0,-3)+'y';else if(t.endsWith('s')&&!t.endsWith('ss'))t=t.slice(0,-1);return alias[t]||t}
function load(){try{const v=JSON.parse(localStorage.getItem(STORE)||'{}');if(v&&typeof v==='object'&&!Array.isArray(v))inventory=v}catch(e){inventory={}};
// Import measured pantry stock without modifying its original records.
try{const measured=JSON.parse(localStorage.getItem(STOCK)||'{}');if(measured&&typeof measured==='object'){for(const [id,q] of Object.entries(measured)){if(!id.includes('|')||!(Number(q)>0))continue;const [name,unit]=[id.slice(0,id.lastIndexOf('|')),id.slice(id.lastIndexOf('|')+1)];const loc=Object.keys(FOODS).find(k=>FOODS[k].some(([,n])=>canon(n)===canon(name)))||'cupboard';const key=uid(name,loc);if(!inventory[key])inventory[key]={name,loc,selected:true,qty:Number(q),unit,bb173StockKey:id,bb173StockValue:Number(q),bb173ImportedStock:true};}}}catch(e){}
// Legacy name-only ownership is displayed as unknown quantity, not unlimited stock.
try{const state=JSON.parse(localStorage.getItem(STATE)||'{}');for(const [name,val] of Object.entries(state.pantry||{})){if(!val)continue;const loc=Object.keys(FOODS).find(k=>FOODS[k].some(([,n])=>canon(n)===canon(name)))||'cupboard';const key=uid(name,loc);if(!inventory[key])inventory[key]={name,loc,selected:true,qty:null,unit:'each'}}}catch(e){}
}
function save(){try{localStorage.setItem(STORE,JSON.stringify(inventory));return true}catch(e){message('Cannot save ingredients on this device. Check available storage.','warning');return false}}
function uid(n,l){return l+'|'+canon(n)}
/* BB-BETA-QA-PHASE2: suggested units for NEW selections only. Existing stock stays untouched. */
function bb25SuggestedUnit(name){
 const n=String(name||'').toLowerCase();
 if(/\b(?:garlic|cloves?)\b/.test(n))return 'clove';
 if(/\b(?:milk|cream|oil|vinegar|juice|stock|soy sauce|syrup)\b/.test(n))return 'ml';
 if(/\b(?:eggs?|onions?|lemons?|limes?|apples?|bananas?|peppers?|bagels?|wraps?|bread loaf|tins?|cans?)\b/.test(n))return 'each';
 if(/\b(?:fish fillets?|frozen fish|prawns?|shrimp|crisps|frozen leftovers)\b/.test(n))return 'pack';
 if(/\b(?:rice|pasta|lentils?|cheese|cheddar|broccoli|spinach|peas|carrots?|potatoes|flour|sugar|oats|beans|noodles|chicken|beef|lamb|ham|butter|yoghurt|berries|mushrooms|tuna|chickpeas|breadcrumbs|salt)\b/.test(n))return 'g';
 return 'each';
}

function list(){return Object.values(inventory).filter(x=>x&&typeof x.name==='string'&&x.selected)}
function stockDisplay(name){const s=canon(name);try{const data=JSON.parse(localStorage.getItem(STOCK)||'{}');const relevant=Object.entries(data).filter(([k,v])=>canon(k.split('|')[0])===s&&Number(v)>0);return relevant.map(([k,v])=>`${v} ${k.split('|').pop()}`).join(' + ')}catch(e){return ''}}
function stateCount(){const items=list();$('#stockCount').textContent=items.length+' ingredient'+(items.length===1?'':'s');$('#selected').innerHTML=items.length?items.map(x=>`<div class="stock-item"><span>${esc(x.name)} · ${esc(x.loc)} ${x.qty?`· ${esc(x.qty)} ${esc(x.unit)}`:(stockDisplay(x.name)?`· measured: ${esc(stockDisplay(x.name))}`:'· quantity not checked')}</span><button type="button" data-remove="${esc(uid(x.name,x.loc))}" aria-label="Remove ${esc(x.name)}">Remove</button></div>`).join(''):'<p class="hint">No foods selected.</p>';bb5DrawMealReview(items)}
// Batch 5: a single review list for all three storage locations. Editing stays in memory
// until the user confirms. Shopping quantity deductions are a separate explicit action.
const BB5_MEAL_UNITS=['each','g','kg','ml','l','pack','clove'];
const BB_SCAN_UNITS=[...BB5_MEAL_UNITS,'tin','bag','bottle','jar','pouch'];
function bb5MealPanel(){
 let panel=$('#bb5MealReview');if(panel)return panel;
 const sections=$('#inventorySections');if(!sections)return null;
 panel=document.createElement('section');panel.id='bb5MealReview';panel.className='bb5-meal-review';
 panel.innerHTML='<h3>YOUR INGREDIENTS <span id="bb5MealCount"></span></h3><p class="hint">One list for Cupboard, Fridge and Freezer. Edit quantities or remove foods, then confirm to see matching meals. This never updates Shopping.</p><div id="bb5MealRows"></div><p id="bb5MealMessage" role="status" aria-live="polite"></p><button type="button" id="bb5GenerateFromReview" class="button">✓ Confirm — Make a Meal</button>';
 sections.insertAdjacentElement('afterend',panel);
 const css=document.createElement('style');css.id='bb5-meal-review-css';css.textContent=`
 #bb5MealReview{padding:17px;margin:15px 0;background:#f0f7ee;border:1px solid #cee2cf;border-radius:17px;color:#173e38}
 #bb5MealReview h3{margin:0 0 8px;font-size:20px}
 .bb5-meal-item{display:grid;grid-template-columns:minmax(120px,1fr) 95px 100px auto;gap:8px;align-items:end;border-bottom:1px solid #cbded0;padding:10px 0}
 .bb5-meal-item strong{align-self:center;font-size:13px;overflow-wrap:anywhere}.bb5-meal-item strong small{display:block;font-size:11px;color:#658071;font-weight:500}
 .bb5-meal-item label{font-size:11px;font-weight:700;display:grid;gap:5px}
 .bb5-meal-item input,.bb5-meal-item select{max-width:100%;width:100%;padding:10px 6px;min-width:0;border-radius:8px;border:1px solid #b4cdb9;background:white;color:#193f36;font-size:16px}
 .bb5-meal-item button{border:1px solid #eed3c6;border-radius:8px;background:#fff3ee;color:#783e27;padding:10px;font-size:12px;font-weight:750}
 #bb5GenerateFromReview{width:100%;padding:14px;margin-top:12px;min-height:48px}
 #bb5MealMessage{font-size:12px;color:#345d48;min-height:16px}
 @media(max-width:520px){.bb5-meal-item{grid-template-columns:minmax(70px,1fr) minmax(80px,1fr) minmax(70px,1fr)}.bb5-meal-item strong{grid-column:1/-1}.bb5-meal-item button{grid-column:1/-1;justify-self:start}}
 `;document.head.append(css);
 panel.addEventListener('input',e=>{const k=e.target.dataset.bb5MealQty;if(!k||!inventory[k])return;inventory[k].qty=e.target.value;bb5Confirmed=false;bb74MealOverview(list());renderRecipes()});
 panel.addEventListener('change',e=>{const k=e.target.dataset.bb5MealUnit;if(!k||!inventory[k])return;inventory[k].unit=e.target.value;bb5Confirmed=false;bb74MealOverview(list());renderRecipes()});
 panel.addEventListener('click',e=>{const rm=e.target.closest('[data-bb5-meal-remove]');if(rm){const old=inventory[rm.dataset.bb5MealRemove];if(old){inventory[rm.dataset.bb5MealRemove]={...old,selected:false};bb5Confirmed=false;renderTiles()}return}
 if(!e.target.closest('#bb5GenerateFromReview'))return;
 const selected=list();if(!selected.length){$('#bb5MealMessage').textContent='Select at least one food first.';return;}
 for(const food of selected){const raw=food.qty==null?'':String(food.qty).trim();if(!BB5_MEAL_UNITS.includes(food.unit||'each')){$('#bb5MealMessage').textContent='Check the unit for '+food.name;return;}
 if(raw===''){food.qty=null;continue}
 const n=Number(raw);if(!Number.isFinite(n)||n<=0||n>1000000||(['each','pack','clove'].includes(food.unit)&&!Number.isInteger(n))){$('#bb5MealMessage').textContent='Check '+food.name+': enter a positive amount; whole numbers for each, packs and cloves.';return;}food.qty=n;}
 // The names/quantities are stored in Make a Meal inventory. Deducting grocery stock
 // still requires the dedicated Reconcile action in BasketBoss Shopping.
 if(!save()){$('#bb5MealMessage').textContent='Could not confirm ingredients; device storage may be full.';return;}
 bb5Confirmed=true;suggestionOffset=0;renderTiles();$('#bb5MealMessage').textContent='✓ Ingredients confirmed. Your meal ideas are shown below. Shopping has not changed.';
 $('#recipes')?.scrollIntoView({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?'auto':'smooth',block:'start'});
 });
 return panel;
}
function bb74MealOverview(items){
 const parent=$('#inventorySections');if(!parent)return;
 let peek=$('#bb74MealPeek');
 if(!peek){peek=document.createElement('aside');peek.id='bb74MealPeek';peek.setAttribute('aria-label','Overview of foods selected for Make a Meal');peek.innerHTML='<div class="bb74-meal-head"><strong>Your ingredients <span id="bb74MealPeekCount">(0)</span></strong><span class="bb74-meal-draft">Review before making a meal</span></div><div id="bb74MealPeekItems" class="bb74-meal-peek-items" aria-live="polite"></div><button id="bb74MealJump" type="button">↓ Review quantities &amp; confirm — Make a Meal</button>';parent.insertAdjacentElement('beforebegin',peek);peek.querySelector('#bb74MealJump').addEventListener('click',()=>{$('#bb5MealReview')?.scrollIntoView({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?'auto':'smooth',block:'start'})});}
 peek.querySelector('#bb74MealPeekCount').textContent='('+items.length+')';
 peek.querySelector('.bb74-meal-draft').textContent=bb5Confirmed?'✓ Confirmed':'Not confirmed';
 peek.querySelector('#bb74MealPeekItems').innerHTML=items.length?items.map(x=>{
  const raw=x.qty==null?'':String(x.qty).trim();return `<span class="bb74-meal-chip">${x.loc==='fridge'?'🥛':x.loc==='freezer'?'❄️':'🥫'} <strong>${esc(x.name)}</strong> <small>${raw?esc(raw)+' '+esc(x.unit||'each'):'Amount unknown'}</small></span>`;
 }).join(''):'<span class="bb74-meal-empty">Tap the ingredient tiles to build your list.</span>';
 peek.querySelector('#bb74MealJump').disabled=!items.length;
}
function bb5DrawMealReview(items){
 const panel=bb5MealPanel();if(!panel)return;
 const rows=panel.querySelector('#bb5MealRows');panel.querySelector('#bb5MealCount').textContent='('+items.length+')';
 bb74MealOverview(items);
 rows.innerHTML=items.length?['cupboard','fridge','freezer'].map(loc=>{const group=items.filter(x=>x.loc===loc);if(!group.length)return '';const heading={cupboard:'🥫 CUPBOARD',fridge:'🥛 FRIDGE',freezer:'❄️ FREEZER'}[loc];return `<h4 class="bb82-review-category">${heading} · ${group.length}</h4>`+group.map(x=>{const key=uid(x.name,x.loc),opts=BB5_MEAL_UNITS.map(u=>`<option value="${u}" ${x.unit===u?'selected':''}>${u==='l'?'litres':u}</option>`).join('');return `<div class="bb5-meal-item"><strong>${esc(x.name)}<small>${esc(x.loc)}</small></strong><label>Amount<input data-bb5-meal-qty="${esc(key)}" min="0.01" max="1000000" step="any" type="number" inputmode="decimal" placeholder="Unknown" value="${x.qty??''}"></label><label>Unit<select data-bb5-meal-unit="${esc(key)}">${opts}</select></label><button type="button" data-bb5-meal-remove="${esc(key)}">Remove</button></div>`}).join('')}).join(''):'<p class="hint">Tap ingredient tiles above to build your list.</p>';
}
// Smart, local thumbnail matching. No third-party image requests and no AI calls.
// Never use photographs of fresh or raw food to misrepresent a processed food.
const BB_PHOTO_EXACT={
 'tomato':'tomato','tomatoes':'tomato','fresh tomato':'tomato','cherry tomatoes':'tomato',
 'lettuce':'lettuce','romaine lettuce':'lettuce','little gem lettuce':'lettuce',
 'red onion':'red-onion','red onions':'red-onion',
 'onion':'onion','onions':'onion','white onion':'onion','brown onion':'onion',
 'parmesan':'parmesan','parmesan cheese':'parmesan',
 'egg':'eggs','eggs':'eggs','free range eggs':'eggs',
 'raw chicken breast':'chicken-breast','chicken breast':'chicken-breast','chicken breasts':'chicken-breast','chicken fillet':'chicken-breast','chicken fillets':'chicken-breast',
 'rice':'rice','white rice':'rice','basmati rice':'rice','long grain rice':'rice',
 'broccoli':'broccoli','fresh broccoli':'broccoli','broccoli florets':'broccoli',
 'yellow pepper':'yellow-pepper','yellow peppers':'yellow-pepper','yellow bell pepper':'yellow-pepper',
 'red pepper':'red-pepper','red peppers':'red-pepper','red bell pepper':'red-pepper',
 'courgette':'courgette','courgettes':'courgette','zucchini':'courgette'
};
const BB_EMOJI_MATCH=[
 [/\b(chicken|poultry|turkey)\b/i,'🍗'],[/\b(beef|steak|mince|lamb|pork)\b/i,'🥩'],[/\b(bacon|ham|sausage)\b/i,'🥓'],
 [/\b(salmon|tuna|cod|haddock|fish)\b/i,'🐟'],[/\b(prawn|shrimp)\b/i,'🦐'],[/\b(egg)\b/i,'🥚'],
 [/\b(milk|cream)\b/i,'🥛'],[/\b(cheese|cheddar|mozzarella|feta|halloumi)\b/i,'🧀'],[/\b(yoghurt|yogurt)\b/i,'🥣'],
 [/\b(butter)\b/i,'🧈'],[/\b(rice)\b/i,'🍚'],[/\b(pasta|spaghetti|penne|fusilli|macaroni)\b/i,'🍝'],
 [/\b(noodle)\b/i,'🍜'],[/\b(bread|roll|baguette)\b/i,'🥖'],[/\b(flour|oat|porridge)\b/i,'🌾'],
 [/\b(tomato|ketchup)\b/i,'🍅'],[/\b(pepper|paprika|chilli|chili)\b/i,'🫑'],[/\b(onion)\b/i,'🧅'],
 [/\b(potato|chip|fries|wedges)\b/i,'🥔'],[/\b(carrot)\b/i,'🥕'],[/\b(cucumber|courgette|zucchini)\b/i,'🥒'],
 [/\b(broccoli)\b/i,'🥦'],[/\b(spinach|lettuce|kale|leaf|greens)\b/i,'🥬'],[/\b(mushroom)\b/i,'🍄'],
 [/\b(pea|bean|lentil|chickpea)\b/i,'🫘'],[/\b(sweetcorn|corn)\b/i,'🌽'],[/\b(garlic)\b/i,'🧄'],
 [/\b(apple)\b/i,'🍎'],[/\b(banana)\b/i,'🍌'],[/\b(orange|clementine|tangerine)\b/i,'🍊'],
 [/\b(lemon)\b/i,'🍋'],[/\b(lime)\b/i,'🍋‍🟩'],[/\b(avocado)\b/i,'🥑'],[/\b(berry|berries|blueberry)\b/i,'🫐'],
 [/\b(strawberry)\b/i,'🍓'],[/\b(grape)\b/i,'🍇'],[/\b(pear)\b/i,'🍐'],
 [/\b(nut|peanut)\b/i,'🥜'],[/\b(honey)\b/i,'🍯'],[/\b(oil)\b/i,'🫒'],[/\b(salt)\b/i,'🧂'],
 [/\b(herb|basil|parsley|coriander)\b/i,'🌿']
];
function bbPhotoName(name){const nameKey=String(name||'').toLowerCase().normalize('NFKC').trim().replace(/\s+/g,' ');if(['rice','white rice','basmati rice','long grain rice'].includes(nameKey))return null;return BB_PHOTO_EXACT[nameKey]||null}
function bbFoodEmoji(name,preferred){
 const text=String(name||'').toLowerCase();
 if(/\b(sausages?|bratwurst|frankfurter)\b/.test(text))return '🌭';
 if(/\b(breadcrumbs?|panko)\b/.test(text))return '🍞';
 if(/\b(black pepper|ground pepper|peppercorns?|white pepper)\b/.test(text))return '🧂';
 if(/\b(mushrooms?)\b/.test(text))return '🍄';
 if(/\b(carrots?)\b/.test(text))return '🥕';
 if(/\b(prawns?|shrimps?)\b/.test(text))return '🦐';
 if(/\b(cucumbers?)\b/.test(text))return '🥒';
 if(/\b(paprika|chilli powder|chili powder)\b/.test(text))return '🌶️';
 for(const [pattern,glyph] of BB_EMOJI_MATCH)if(pattern.test(name))return glyph;
 return preferred&&preferred!=='✏️'?preferred:'🥣';
}
function bbFoodVisual(name,preferred){const shared=window.BBFoodVisuals?.html(name,{context:'cook',variant:'tile',emoji:bbFoodEmoji(name,preferred)});if(shared)return shared;const photo=bbPhotoName(name);return photo?`<img class="bb-food-photo" src="food-thumbs/${photo}.webp" alt="" loading="lazy" decoding="async">`:`<span class="bb-food-fallback"><span class="bb-food-emoji" aria-hidden="true">${bbFoodEmoji(name,preferred)}</span></span>`}
function bbDisplayFoodName(name){
 const raw=String(name||'').trim().replace(/\s+/g,' ');
 // Preserve user-created names; just tidy labels typed entirely in lowercase or uppercase.
 if(raw===raw.toLocaleLowerCase('en-GB')||raw===raw.toLocaleUpperCase('en-GB'))
   return raw.toLocaleLowerCase('en-GB').replace(/(^|[\s(-])([\p{L}])/gu,(_,gap,letter)=>gap+letter.toLocaleUpperCase('en-GB'));
 return raw;
}
function bbStripItem(group){
 const x=group.first,count=group.count;
 const safeName=esc(bbDisplayFoodName(x.name)),safeLocation=esc(x.loc),id=esc(uid(x.name,x.loc));
 const label=count>1?`Review ${count} ${safeName} entries in your ingredient list`:`Find ${safeName} in ${safeLocation}`;
 const duplicate=count>1?`<span class="bb-mini-group-count" aria-label="${count} entries">×${count}</span>`:'';
 // Do not remove multiple different stock/location records with one button.
 const remove=count===1?`<button class="bb-mini-remove" type="button" data-strip-remove="${id}" aria-label="Remove ${safeName}">×</button>`:'';
 return `<div class="bb-mini-tile">${duplicate}<button class="bb-mini-focus" type="button" data-jump-food="${id}" aria-label="${label}"><span class="bb-mini-image">${bbFoodVisual(x.name)}</span><span class="bb-mini-name">${safeName}</span></button>${remove}</div>`;
}
function bbGroupStrip(items){
 const groups=new Map();
 for(const item of items){const key=canon(item.name)||item.name.toLocaleLowerCase('en-GB');
  if(groups.has(key))groups.get(key).count++;
  else groups.set(key,{first:item,count:1});
 }
 return [...groups.values()];
}
function renderIngredientStrips(){const items=list();for(const [source,box,count] of [['scan','#bbScannedStrip','#bbScannedCount'],['added','#bbAddedStrip','#bbAddedCount']]){const match=items.filter(x=>(x.source==='scan'?'scan':'added')===source);const target=$(box);if(!target)continue;$(count).textContent=match.length+' item'+(match.length===1?'':'s');target.innerHTML=match.length?bbGroupStrip(match).map(bbStripItem).join(''):`<div class="bb-strip-empty">${source==='scan'?'Confirmed photo-scan foods will appear here.':'Your manually added foods will appear here.'}</div>`;}}
function foodTile(emoji,name,location){const id=uid(name,location),saved=inventory[id],isOn=!!saved?.selected;return `<button class="tile bb74-food-tile" type="button" data-food="${esc(name)}" aria-pressed="${isOn}" aria-label="${isOn?'Remove':'Select'} ${esc(name)} from ${esc(location)}"><span class="bb-tile-image">${bbFoodVisual(name,emoji)}</span><span class="bb74-tile-name">${esc(name)}</span><span class="quantity">${isOn?(saved.qty?`${esc(saved.qty)} ${esc(saved.unit)}`:'✓ In my list'):'Tap to add'}</span></button>`}
function renderTiles(){for(const location of Object.keys(FOODS)){const presets=FOODS[location];const custom=list().filter(x=>x.loc===location&&!presets.some(([,n])=>canon(n)===canon(x.name)));const container=$('#tiles-'+location);container.innerHTML=presets.map(([emoji,name])=>foodTile(emoji,name,location)).join('')+custom.map(x=>foodTile('✏️',x.name,location)).join('')}stateCount();renderIngredientStrips();renderRecipes();bb82SyncLocationCounts()}
function bbPantryName(name){const val=String(name||'').trim().toLowerCase().replace(/\s+/g,' ');const aliases={'potatoes':'potato','eggs':'egg','tomatoes':'tomato','onions':'onion','carrots':'carrot','bananas':'banana','apples':'apple','lemons':'lemon','limes':'lime','courgettes':'courgette','mushrooms':'mushroom','scallops':'scallop','wraps':'wrap'};return aliases[val]||val}
function setFood(name,qty,unit,location){const id=uid(name,location);if(inventory[id]?.selected&&qty==null){inventory[id]={...inventory[id],selected:false}}else inventory[id]={...inventory[id],name:name.trim(),loc:location,selected:true,qty:qty||null,unit:unit||inventory[id]?.unit||bb25SuggestedUnit(name),source:inventory[id]?.source||'added'};bb5Confirmed=false;suggestionOffset=0;renderTiles()}
function normalizeIngredients(r){return (r.ingredients||[]).filter(a=>Array.isArray(a)&&a.length>1).map(a=>({name:String(a[0]),amount:String(a[1])}))}
function isDinner(r){if(window.BBRecipePlanning)return window.BBRecipePlanning.isDinner(r);return false;}
function bbPwa700LegacyDinnerUnused(r){const category=String(r.category+' '+r.tag).toLowerCase(),name=String(r.name).toLowerCase();return !/dessert|baking|breakfast|brunch|sweet treats|sweet bread|pudding/.test(category)&&!/\b(cakes?|biscuits?|cookies?|brownies?|cupcakes?|muffins?|puddings?|granola|fudge|tart)\b/.test(name)}
// Recipe discovery should never confuse a theme match with an ingredient the family owns.
// In particular, ready-to-eat cooked chicken is NOT raw chicken breast and rice
// is not automatically the specialised rice needed for risotto.
const FOOD_FAMILIES={
 rice:/\brice\b/,
 chicken:/\bchicken\b/,
 potato:/\bpotato(?:es)?\b/,
 pasta:/\b(?:pasta|spaghetti|penne|fusilli|macaroni|linguine|tagliatelle)\b/,
 tomato:/\btomato(?:es)?\b/,
 cheese:/\b(?:cheese|cheddar|mozzarella|parmesan|feta|halloumi)\b/,
 egg:/\beggs?\b/,
 broccoli:/\bbroccoli\b/,
 spinach:/\bspinach\b/,
 salmon:/\bsalmon\b/,
 pea:/\bpeas?\b/,
 bean:/\bbeans?\b/,
 mushroom:/\bmushrooms?\b/,
 mince:/\bmince\b/,
 noodle:/\bnoodles?\b/
};
function family(name){
 const text=String(name||'').toLowerCase().replace(/[–—-]/g,' ');
 for(const [family,re] of Object.entries(FOOD_FAMILIES)){
  if(!re.test(text))continue;
  if(family==='chicken'&&/\b(?:stock|broth|bouillon|gravy|seasoning|flavour|flavor)\b/.test(text))continue;
  if(family==='rice'&&/\b(?:vinegar|flour|milk|noodles?|cakes?|pudding|wine|paper|crackers?)\b/.test(text))continue;
  if(family==='tomato'&&/\b(?:ketchup|chutney|paste|puree|purée)\b/.test(text))continue;
  if(family==='cheese'&&/\b(?:cheese\s+strings?)\b/.test(text))return 'cheese';
  return family;
 }
 return null;
}
function ingredientMatch(selected,required){
 const sel=String(selected||'').toLowerCase(),req=String(required||'').toLowerCase();
 const have=canon(sel),need=canon(req);
 const a=family(sel),b=family(req);
 const cookedHave=/\b(?:cooked|ready.to.eat|roast|leftover|pre.cooked)\b/.test(sel);
 const cookedNeed=/\b(?:cooked|ready.to.eat|roast|leftover|pre.cooked)\b/.test(req);
 const rawNeed=/\b(?:raw|uncooked|breast|thighs?|fillets?|whole chicken|drumsticks?)\b/.test(req);
 const frozenHave=/\bfrozen\b/.test(sel);
 // An ingredient is counted as on hand only for a direct, safe name match.
 if(have===need){
  if(cookedHave&&!cookedNeed&&(a==='chicken'||a==='salmon'||a==='mince'))return 'related';
  if(frozenHave&&!/\bfrozen\b/.test(req)&&(a==='chicken'||a==='fish'||a==='mince'))return 'related';
  return 'exact';
 }
 if(!a||!b||a!==b)return null;
 if(a==='chicken'||a==='salmon'){
  if(cookedHave&&(!cookedNeed||rawNeed))return 'related';
  if(cookedNeed&&!cookedHave)return 'related';
 }
 // Broader ingredient-family matches are inspiration only until the shopper
 // confirms that the actual variety, form and amount can be substituted.
 return 'related';
}
function scoreRecipe(r,have){
 const ing=normalizeIngredients(r);if(!ing.length)return null;
 const matched=[],related=[],missing=[];
 for(const ingredient of ing){
  let best=null;
  for(const stock of have){const q=ingredientMatch(stock.name,ingredient.name);if(q==='exact'){best={stock,match:q};break}if(q==='related'&&!best)best={stock,match:q}}
  if(!best)missing.push(ingredient);
  else if(best.match==='exact')matched.push(ingredient);
  else {related.push({ingredient,stock:best.stock});missing.push(ingredient)}
 }
 const title=String(r.name||'');
 const titleMatched=have.some(stock=>{const f=family(stock.name);return f?new RegExp('\\b'+f+'\\b','i').test(title):false});
 if(!matched.length&&!related.length&&!titleMatched)return null;
 const suggestions=matched.length+related.length;
 // Show recipes with a real ingredient-family connection before title-only hits.
 const score=matched.length*9+related.length*6+(titleMatched?2:0)-missing.length*.15;
 return {r,matched,related,missing,ing,score,titleMatched,suggestions};
}
function groupRecipe(x){return !x.missing.length?'ready':x.missing.length<=2?'near':'idea'}
function recipeCard(x,index){
 const ready=x.missing.length===0;
 const anyRelated=x.related.length>0;
 const badge=ready?'✓ Ingredient names match':x.missing.length<=2?'1–2 extra ingredients':'More ingredients needed';
 const note=anyRelated?`<div class="related-note"><strong>Check substitutions:</strong> ${x.related.map(z=>`${esc(z.stock.name)} is related to ${esc(z.ingredient.name)}`).join('; ')}. They are not necessarily interchangeable. ${x.related.some(z=>/\bcooked chicken\b/i.test(z.stock.name))?'Cooked and raw chicken require different preparation.':''}</div>`:'';
 return `<article class="recipe" data-id="${esc(x.r.id)}"><h3>${esc(x.r.name)}</h3><p class="meta">⏱ ${Number(x.r.mins)>0?esc(bbMealDuration(Number(x.r.mins))):'? mins'} · ${Number(x.r.servings)||4} servings</p><span class="pill">${x.matched.length} matching ingredient${x.matched.length===1?'':'s'}</span>${x.related.length?`<span class="pill amber">${x.related.length} related item${x.related.length===1?'':'s'}</span>`:''}<span class="pill ${ready?'':'amber'}">${badge}</span>${x.missing.length?`<div class="warning"><strong>Still required or check substitution:</strong> ${x.missing.map(z=>esc(z.name)).join(', ')}</div>`:''}${note}<p class="hint">Confirm quantities, substitutions, allergies and freshness.</p><details><summary>See ingredients and cooking instructions</summary><ul>${x.ing.map(z=>`<li>${esc(z.name)} — <span data-bb-measures>${esc(bbMealQuantity(z.amount,z.name))}</span></li>`).join('')}</ul><ol class="bb-recipe-method">${bbMealMethod(x.r).map(bbMealStepHTML).join('')}</ol><p class="hint">Allergen notes: ${esc(x.r.allergy_advice||'Check packaging and cross-contact risks.')}</p></details><div class="inline-actions"><a class="button" href="index.html?bbcook=${encodeURIComponent(x.r.id)}">Cook with guidance</a><button type="button" class="button" data-plan="${index}">Choose this meal</button></div></article>`;
}
function renderRecipes(){
 const have=list(),dest=$('#recipes'),summary=$('#matchSummary');
 if(!bb5Confirmed){results=[];suggestionOffset=0;dest.innerHTML='<div class="empty">Review your selected foods, then tap <strong>Confirm — Make a Meal</strong> to see suitable recipes.</div>';summary.textContent='Your ingredient selection is a draft until you confirm it.';return}
 if(!have.length){results=[];suggestionOffset=0;dest.innerHTML='<div class="empty">Start by selecting what you have.</div>';summary.textContent='Select a food to browse recipes containing it.';return}
 const matched=[];
 for(const r of recipes){if(!bb176MakeMealAllowed(r)||!bbMealRecipeAllowed(r))continue;if(!isDinner(r))continue;const item=scoreRecipe(r,have);if(item)matched.push(item)}
 matched.sort((a,b)=>{
  const priority=mode==='only'?{ready:0,near:1,idea:2}:{near:0,ready:1,idea:2};
  return priority[groupRecipe(a)]-priority[groupRecipe(b)]||b.score-a.score||a.missing.length-b.missing.length||a.r.name.localeCompare(b.r.name);
 });
 results=matched;
 if(suggestionOffset>=results.length)suggestionOffset=0;
 const names=have.length<=3?have.map(x=>x.name).join(', '):have.length+' selected foods';
 summary.textContent=`Showing the 3 closest ideas from ${matched.length} related BasketBoss dinners for ${names}.`;
 if(!matched.length){dest.innerHTML='<div class="empty">No dinners match these ingredients and your dietary preferences yet. Try another ingredient or review Meal preferences in Plan.</div>';return}
 const start=suggestionOffset,shown=matched.slice(start,start+3);
 const end=start+shown.length;
 const cards=shown.map((x,i)=>recipeCard(x,start+i)).join('');
 dest.innerHTML=`<div class="discovery-explainer">${mode==='only'?'Closest matches first.':'Meals needing up to two extras are prioritised.'} Some suggestions still need more shopping; see each recipe before choosing.</div><div class="recipe-grid">${cards}</div><div class="suggestion-footer"><span>Suggestions ${start+1}–${end} of ${matched.length}</span>${matched.length>3?'<button type="button" id="showMoreRecipes" class="button secondary">↻ Show another 3</button>':''}</div>`;
}
function message(msg,type='success'){const dest=bbActiveTool==='meal'&&!$('#bbToolStage').hidden?$('#generated'):$('#bbToast');dest.hidden=false;dest.innerHTML=`<div class="${type}">${esc(msg)}</div>`;dest.scrollIntoView({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?'auto':'smooth',block:'nearest'})}
let pendingRecipe=null;
function openMealReview(i){
 const x=results[i];if(!x)return;
 if(!bb176MakeMealAllowed(x.r)||!bbMealRecipeAllowed(x.r)){message('This meal no longer matches your access or dietary preferences. Review the current suggestions.','warning');return;}
 const dialog=$('#mealReview');const title=$('#mealReviewTitle'),body=$('#mealReviewItems'),days=$('#mealReviewDay');
 let data=null;try{data=JSON.parse(localStorage.getItem(STATE)||'null')}catch(e){}
 if(!data||!Array.isArray(data.planned)){
  message('Please open BasketBoss Planner once to initialise your saved weekly plan, then choose your meal again.','warning');return;
 }
 if(data.planned.some(p=>String(p.recipeId)===String(x.r.id))){message('That recipe is already in your Planner. Check Shopping for its grocery requirements.','warning');return;}
 const free=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].filter(d=>!data.planned.some(p=>p.day===d));
 pendingRecipe=i;
 title.textContent=x.r.name;
 body.replaceChildren();
 const p=document.createElement('p');p.className='hint';p.textContent='These ingredients are not directly confirmed as available in sufficient quantity. Related ingredients may need a different variety or preparation.';body.append(p);
 if(x.missing.length){const ul=document.createElement('ul');x.missing.forEach(m=>{const li=document.createElement('li');li.textContent=m.name+' — '+m.amount;ul.append(li)});body.append(ul)}
 else {const p=document.createElement('p');p.textContent='All ingredient names are matched. BasketBoss will still check available pantry quantities and add anything else required.';body.append(p)}
 days.replaceChildren();free.forEach(d=>{const op=document.createElement('option');op.value=d;op.textContent=d;days.append(op)});
 $('#mealReviewSave').disabled=!free.length;
 $('#mealReviewNoDay').hidden=!!free.length;
 if(typeof dialog.showModal==='function')dialog.showModal();else {dialog.setAttribute('open','');}
}
function confirmMeal(){
 if(pendingRecipe===null)return;
 const i=pendingRecipe,x=results[i];if(!x)return;
 const day=$('#mealReviewDay').value;
 try{
  const saved=JSON.parse(localStorage.getItem(STATE)||'null');if(!saved||!Array.isArray(saved.planned))throw Error('Planner data unavailable');
  if(!bb176MakeMealAllowed(x.r)||!bbMealRecipeAllowed(x.r))throw Error('This meal no longer matches your access or dietary preferences. Review the current suggestions.');
  if(saved.planned.some(p=>p.day===day)||!['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].includes(day))throw Error('That day is no longer free; reopen the meal selector.');
  if(saved.planned.some(p=>String(p.recipeId)===String(x.r.id)))throw Error('That recipe is already planned.');
  const next=JSON.parse(JSON.stringify(saved));next.planned.push({recipeId:x.r.id,day});
  const value=JSON.stringify(next);localStorage.setItem(STATE,value);if(localStorage.getItem(STATE)!==value)throw Error('Could not verify Planner save');
  const dialog=$('#mealReview');if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');
  pendingRecipe=null;
  message(x.r.name+' added to '+day+'. BasketBoss Shopping now calculates the meal’s required groceries, deducting recognised pantry stock where possible. No separate duplicate list was created.');
 }catch(e){const error=$('#mealReviewError');error.textContent=e.message;error.hidden=false;}
}
function copyMissing(i){const x=results[i];if(!x)return;const text=x.missing.map(z=>z.name+' — '+z.amount).join('\n');if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).then(()=>message('Missing-item checklist copied. Paste it into your shopping list.')).catch(()=>message(text,'warning'));else message(text,'warning')}

// Public beta: the API is a same-origin Cloudflare Pages Function. No API or testing tokens in browser.
function resetHumanCheck(){
 turnstileToken='';
 if(turnstileWidgetId!==null&&window.turnstile?.reset)window.turnstile.reset(turnstileWidgetId);
}
// The native iOS <label for=ai-photo-input> opens the panel via an inline
// synchronous handler, NOT bbOpenTool(). Render only after the panel is visible.
function setupHumanCheck(siteKey){
 // Live subscribers have already been checked by the backend. Do not
 // load the broken Turnstile iframe in their scanner/meal modal.
 if(!bbTurnstileRequired)return;
 const stage=$('#bbToolStage'),host=$('#aiHumanCheck'),status=$('#aiHumanStatus');
 if(!stage||stage.hidden||!host?.isConnected||!status||
    !siteKey||!/^[-_a-zA-Z0-9]+$/.test(siteKey)||
    turnstileWidgetId!==null||bbTurnstileLoading)return;
 const panel=$('#aiSecurityBox');
 if(panel){panel.hidden=false;panel.style.setProperty('display','block','important');}
 bbTurnstileLoading=true;
 status.textContent='Loading human verification…';
 const failed=()=>{
   bbTurnstileLoading=false;turnstileWidgetId=null;
   status.textContent='Human check unavailable. Verified Live Premium members can continue securely.';
 };
 const render=()=>requestAnimationFrame(()=>{
   if(!bbTurnstileRequired||stage.hidden||!host.isConnected){bbTurnstileLoading=false;return;}
   try{
     if(typeof window.turnstile?.render!=='function')throw Error('Turnstile missing');
     const widget=window.turnstile.render(host,{
       sitekey:siteKey,action:'bb_ai',appearance:'always',
       callback:token=>{turnstileToken=token;status.textContent='Verified. You can now request an AI action.';},
       'expired-callback':()=>{turnstileToken='';status.textContent='Verification expired. Complete the check again.';},
       'error-callback':()=>{turnstileToken='';status.textContent='Human verification unavailable. Verified Live Premium members can continue.';}
     });
     if(widget===null||widget===undefined)throw Error('Turnstile did not render');
     turnstileWidgetId=widget;
     status.textContent='Complete the check if prompted. Verified Live Premium members can continue without it.';
     bbTurnstileLoading=false;
   }catch(_){
     document.querySelector('script[data-bb-ai-turnstile]')?.remove();
     failed();
   }
 });
 if(typeof window.turnstile?.render==='function'){render();return;}
 let script=document.querySelector('script[data-bb-ai-turnstile]');
 if(!script){
   script=document.createElement('script');
   script.dataset.bbAiTurnstile='1';
   script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
   script.async=true;
   script.addEventListener('load',render,{once:true});
   script.addEventListener('error',()=>{script.remove();failed();},{once:true});
   document.head.appendChild(script);
 }else{
   script.addEventListener('load',render,{once:true});
   script.addEventListener('error',failed,{once:true});
 }
}
// Track modal attributes, not the camera click. This runs AFTER Safari's
// native file-label activation, and never preventDefault()s the gesture.
function bbObserveAIHumanPanel(){
 const stage=$('#bbToolStage');if(!stage)return;
 let wasOpen=false;
 const check=()=>{
   const open=!stage.hidden;
   if(!open){wasOpen=false;return;}
   if(wasOpen)return;
   wasOpen=true;
   const panel=$('#aiSecurityBox');
   if(panel){
     panel.hidden=!bbTurnstileRequired;
     panel.style.removeProperty('display');
   }
   turnstileToken='';
   if(turnstileWidgetId!==null&&window.turnstile?.reset){
     try{window.turnstile.reset(turnstileWidgetId);}catch(_){turnstileWidgetId=null;}
   }
   // The server supplies the LIVE site key only for verified members.
   requestAnimationFrame(()=>{if(!stage.hidden)void bbRefreshAIStatus();});
 };
 new MutationObserver(check).observe(stage,{attributes:true,attributeFilter:['hidden','class']});
 check();
}
function likelyPerishable(name){return /\b(chicken|beef|pork|lamb|fish|prawns?|shrimp|salmon|raw meat|turkey|milk|yoghurt|cream|cheese|eggs?|ham|bacon)\b/i.test(name) && !/\b(tinned|canned|shelf.stable|dried|powdered)\b/i.test(name);}

function bbScanActor(){try{return JSON.parse(localStorage.getItem('basketboss_cloud_session_v1')||'null')?.user?.id||null;}catch{return null;}}
function scanProductFields(name){
 const product=window.BBScanFoodIdentity?.resolve(name)||{approved:false,family:'',canonicalName:name};
 const variant=product.family==='tinned tuna'?`<label>Packing liquid<select data-scan-variant aria-label="Packing liquid for ${esc(name)}">${window.BBScanFoodIdentity.variantOptions.map(([value,label])=>`<option value="${value}" ${value===product.variant?'selected':''}>${esc(label)}</option>`).join('')}</select></label><label>Weight basis<select data-scan-basis aria-label="Weight basis for ${esc(name)}">${[['','Not confirmed'],['drained','Drained weight'],['net','Net weight including liquid']].map(([value,label])=>`<option value="${value}" ${value===product.quantityBasis?'selected':''}>${esc(label)}</option>`).join('')}</select></label>`:'';
 const group=product.approved?`<p>Food group: <strong>${esc(product.canonicalName)}</strong>. The product name and brand will be kept in its details.</p>`:'';
 return `<div class="bb-scan-product-review">${group}${variant}<details><summary>Container contents (for tins, jars or packs)</summary><p>Use the checked label size. Different containers may hold different amounts.</p><label>One container contains<input type="number" data-scan-pack-quantity min="0.000001" max="1000000" step="any" inputmode="decimal" placeholder="e.g. 145" aria-label="Contents of one container of ${esc(name)}"></label><label>Contents unit<select data-scan-pack-unit aria-label="Container contents unit for ${esc(name)}"><option value="">Choose unit</option><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option><option value="each">each</option></select></label></details><p class="hint">${product.family==='tinned tuna'?'Confirm all product amounts, units and matching tuna weight basis before combining. ':''}Unconfirmed amounts keep existing stock unchanged.</p></div>`;
}
function renderScanResponse(scan){
 scanReviewActor=bbScanActor();
 if(bbPhotoMealMode){
  bbPhotoReviewToken=bbPaidToken();bbPhotoMealNames=null;
  const names=window.BBCookStudio.ingredientNames((Array.isArray(scan?.items)?scan.items:[]).slice(0,20).map(item=>item?.name));
  $('#scanBtn').hidden=true;
  $('#scanResults').innerHTML=names.length?`<form id="reviewMealFoods" class="bb-photo-review"><h3>Check your ingredients</h3><p>Uncheck anything that isn’t there and correct any names. Choose up to 12 foods. We’ll use this list to create your meal and its picture.</p>${names.map((name,index)=>`<div class="bb-photo-food-row"><input type="checkbox" name="mealFood" checked aria-label="Use ingredient ${index+1}"><label>Ingredient ${index+1}<input type="text" data-photo-meal-name maxlength="60" value="${esc(name)}" aria-label="Ingredient ${index+1} name"></label></div>`).join('')}<p id="photoMealReviewMessage" class="warning" role="alert" hidden></p><button class="button ai-primary-button" type="submit">Generate meal &amp; picture</button></form>`:'<p class="bb-photo-empty" role="status">No ingredients were recognised. Try a clearer photo with the food or its packaging in view.</p>';
  $('#scanResults').scrollIntoView({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?'auto':'smooth',block:'start'});return;
 }
 const items=Array.isArray(scan?.items)?scan.items.filter(x=>x&&typeof x.name==='string'&&x.name.trim()).slice(0,20):[];
 const seen=new Set();const unique=items.filter(x=>{const id=canon(x.name);if(!id||seen.has(id))return false;seen.add(id);return true});
 $('#scanResults').innerHTML=unique.length?`<div class="success">Gemini found possible ingredients. Tick only foods you recognise. Enter an amount you have checked to update At home; AI estimates are suggestions only.</div><form id="reviewFoods"><div class="scan-result-list">${unique.map(x=>{const name=x.name.trim().slice(0,70),location=pantryScanLocation&&!(pantryScanLocation==='cupboard'&&likelyPerishable(name))?pantryScanLocation:'';return `<div class="scan-result-row"><label class="scan-item-label"><input type="checkbox" name="food" value="${esc(name)}"><span><strong>${esc(name)}</strong><span class="scan-item-meta">Estimated ${esc(String(x.estimatedQuantity||'unknown').slice(0,60))} · ${esc(String(x.confidence||'uncertain').slice(0,15))} confidence</span><span class="scan-item-meta">${esc(String(x.notes||'').slice(0,150))}</span></span></label><label class="scan-destination">Store this item in<select class="field" data-scan-location aria-label="Choose storage location for ${esc(name)}"><option value="">Choose when saving…</option>${[['fridge','🥛 Fridge'],['freezer','🧊 Freezer'],['cupboard','🥫 Cupboard']].map(([value,label])=>`<option value="${value}" ${location===value?'selected':''}>${label}</option>`).join('')}</select></label><div class="bb-scan-measure"><label>Checked amount here<input type="number" data-scan-quantity min="0" max="1000000" step="any" inputmode="decimal" placeholder="Optional" aria-label="Checked amount of ${esc(name)}"></label><label>Unit<select data-scan-unit aria-label="Unit for ${esc(name)}">${BB_SCAN_UNITS.map(unit=>`<option value="${unit}" ${unit===bb25SuggestedUnit(name)?'selected':''}>${unit}</option>`).join('')}</select></label></div>${scanProductFields(name)}</div>`;}).join('')}</div><div class="scan-review-actions"><p id="scanSaveError" class="warning" role="alert" hidden></p><button class="button ai-primary-button" type="submit">✓ Save my confirmed foods</button><p class="hint">A checked amount replaces the amount in this location; other confirmed locations are kept. Leave it blank to save a food name without changing measured stock. Check packaging before choosing storage for perishables.</p></div></form>`:'<div class="warning">No foods identified. Use manual ingredient entry instead.</div>';
}
function bbInstallPantryScanHandoff(){
 const url=new URL(location.href);if(url.searchParams.get('bbscan')!=='pantry')return;
 pantryScanLocation=['fridge','cupboard'].includes(url.searchParams.get('location'))?url.searchParams.get('location'):'fridge';bbChooseLocation(pantryScanLocation);
 const notice=document.createElement('p');notice.className='bb-pantry-camera-context';notice.textContent='Scan your '+pantryScanLocation+'. Take a food-only photo, then review each food, storage location and checked amount before updating At home.';$('#aiScanner')?.prepend(notice);
 const back=document.createElement('a');back.className='bb-scan-pantry-return';back.href='index.html?bbreturn=pantry';back.textContent='← Back to At home';notice.append(document.createElement('br'),back);
 let opened=false;const open=()=>{if(opened||window.BasketBossVerifiedPremium?.isActive?.()!==true)return;opened=true;bbOpenTool('scan');$('#bbToolStage')?.classList.add('bb-ai-native-visible');$('#scanResults').textContent='Take Photo / Choose Image to start. Your camera opens only when you tap that button.';url.searchParams.delete('bbscan');url.searchParams.delete('location');history.replaceState(null,'',url);};
 document.addEventListener('basketboss:premium-verified',open);open();
}
function bbPaidToken(){
 try{
  const s=JSON.parse(localStorage.getItem('basketboss_cloud_session_v1')||'null');
  return typeof s?.access_token==='string' &&
    Number(s.expires_at)*1000>Date.now()+5000?s.access_token:null;
 }catch{return null;}
}
async function requestBody(verb,body){
 const accessToken=bbPaidToken();
 if(!accessToken)throw Error('Sign in to a verified Premium account first.');
 // A trial may complete after the initial page-load availability probe.
 // Refresh the server check once at the user's explicit AI request.
 if(!aiEnabled)await bbRefreshAIStatus();
 if(bbPaidToken()!==accessToken)throw Error('Account changed. Please try again.');
 if(!aiEnabled)throw Error(bbAIStatusFailure||'Premium AI is not enabled for this account.');
 // The server independently verifies the Supabase bearer and current Live
 // Paddle/D1 entitlement before allowing a request without Turnstile.
 const token=turnstileToken||'';turnstileToken='';
 try{
  const controller=new AbortController();
  if(verb==='scan')bbScanRequest=controller;
  try{
   const {response:r,data:j}=await bbMealJSON('/api/bb173/'+verb,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+accessToken},body:JSON.stringify({...body,turnstileToken:token}),cache:'no-store',credentials:'same-origin',signal:controller.signal},verb==='scan'?25000:30000);
   if(!r.ok)throw Error(String(j?.error||'AI is temporarily unavailable.').slice(0,200));return j;
  }finally{if(bbScanRequest===controller)bbScanRequest=null;}
 }finally{resetHumanCheck();}
}
async function scanPhoto(){
 if(scanInFlight)return;
 const revision=++scanRevision,actor=bbScanActor(),token=bbPaidToken();
 const current=()=>revision===scanRevision&&bbScanActor()===actor&&bbPaidToken()===token&&window.BBAccountDeletion?.isDeleting?.()!==true;
 const f=photoFile;if(!f){$('#scanResults').innerHTML='<div class="warning">Choose a photo first.</div>';return}
 if(!f.type.startsWith('image/')||f.size>12*1024*1024){$('#scanResults').innerHTML='<div class="warning">Choose a food-only photo under 12 MB.</div>';return}
 if(!token){$('#scanResults').textContent='Sign in to your Premium account before scanning.';return;}
 if(bbPhotoMealMode&&bbPhotoReviewToken!==token){$('#scanResults').textContent='Your account changed. Choose the photo again before scanning.';return;}
 if(!confirm('Send this resized food photo to Cloudflare and Google Gemini to identify ingredients? You will check the results before using them. Cancel keeps the photo on this device.'))return;
 scanInFlight=true;
 const btn=$('#scanBtn');btn.disabled=true;$('#scanResults').innerHTML='<p class="notice" role="status">Scanning ingredients…</p>';
 try{
  const bitmap=await createImageBitmap(f);const scale=Math.min(1,1024/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const imageBase64=canvas.toDataURL('image/jpeg',.8).split(',')[1];
  if(!imageBase64||imageBase64.length>2500000)throw Error('Photo remains too large after resizing');
  if(!current())return;
  const res=await requestBody('scan',{mimeType:'image/jpeg',imageBase64});
  if(!current())return;
  if(!res.ok||!res.reviewRequired)throw Error('AI scan result is not ready for review');
  renderScanResponse(res.scan);
 }catch(e){if(current())$('#scanResults').innerHTML='<div class="warning">'+esc(e.message)+'. No inventory was changed.</div>'}
 finally{if(revision===scanRevision){scanInFlight=false;btn.disabled=false;}}
}
function bbClearGeneratedMeal(){
 generateRevision++;generateActor=null;generatePreferenceStamp=null;generateInFlight=false;
 generatedView?.cancel?.();generatedView=null;window.BBMealImage?.cancelAll?.();
 const host=$('#generated');
 if(window.BBCookResult?.clear)window.BBCookResult.clear(host);else host?.replaceChildren();
 const button=$('#generate');if(button)button.disabled=false;
 const reviewButton=$('#reviewMealFoods button[type="submit"]');if(reviewButton)reviewButton.disabled=false;
}
function bbMealPreferenceSnapshot(){
 const storage=window.localStorage||(typeof localStorage==='undefined'?null:localStorage);
 let saved={},session=null;
 try{saved=JSON.parse(storage?.getItem('basketboss_321_unified_state_v1')||'{}');session=JSON.parse(storage?.getItem('basketboss_cloud_session_v1')||'null');}
 catch{throw Error('Your meal preferences could not be read. Open Plan to review them before creating a meal.');}
 const scope=window.BBMealPreferences?.scope?.()||session?.user?.id||'guest';
 const profile=window.BBMealPreferences?.get?.()||saved?.mealPreferences;
 const choices=profile?.scope===scope&&Array.isArray(profile.diets)?profile.diets:[];
 const rules=window.BBDietaryPreferences;
 if(choices.length&&(!rules?.normalizeDiets||choices.some(choice=>rules.normalizeDiets([choice]).length!==1)))throw Error('Your dietary preferences could not load. Reload BasketBoss or review Meal preferences in Plan.');
 const dietaryPreferences=choices.length?rules.normalizeDiets(choices):[];
 const count=Number(saved?.servings),servings=Number.isInteger(count)&&count>=1&&count<=12?count:4;
 return {scope,dietaryPreferences,servings};
}
function bbMealRecipeAllowed(recipe,preferences){
 try{const current=preferences||bbMealPreferenceSnapshot();return !current.dietaryPreferences.length||window.BBDietaryPreferences?.recipeAllowed(recipe,current.dietaryPreferences)===true;}catch{return false;}
}
function bbMealPreferencesCurrent(stamp){try{return JSON.stringify(bbMealPreferenceSnapshot())===stamp;}catch{return false;}}
function bbCheckGeneratedMealAccount(){
 if(bbPhotoMealMode&&bbPhotoReviewToken&&bbPhotoReviewToken!==bbPaidToken())bbClearPhotoMeal();
 if(generateActor&&(bbPaidToken()!==generateActor||window.BBAccountDeletion?.isDeleting?.()===true||generatePreferenceStamp&&!bbMealPreferencesCurrent(generatePreferenceStamp)))bbClearGeneratedMeal();
}
function bbClearPhotoMeal(){
 scanRevision++;bbPhotoMealNames=null;bbPhotoReviewToken=null;photoFile=null;
 bbScanRequest?.abort();bbScanRequest=null;scanInFlight=false;
 bbClearGeneratedMeal();
 const input=$('#ai-photo-input');if(input)input.value='';
 const preview=$('#photoPreview');if(preview){if(preview.dataset.url)URL.revokeObjectURL(preview.dataset.url);preview.removeAttribute('src');delete preview.dataset.url;preview.classList.remove('show');}
 $('#scanResults')?.replaceChildren();if($('#aiMeal'))$('#aiMeal').hidden=true;if($('#scanBtn'))$('#scanBtn').hidden=true;
}
function bbConfirmPhotoMeal(form){
 if(generateInFlight)return;
 const error=form.querySelector('#photoMealReviewMessage');
 const fail=text=>{error.textContent=text;error.hidden=false;};
 if(!bbPhotoReviewToken||bbPhotoReviewToken!==bbPaidToken()||window.BasketBossVerifiedPremium?.isActive?.()!==true||window.BBAccountDeletion?.isDeleting?.()===true){fail('Your account or Premium access changed. Scan the photo again.');return;}
 const checked=[...form.querySelectorAll('.bb-photo-food-row')].filter(row=>row.querySelector('input[name="mealFood"]').checked);
 const raw=checked.map(row=>row.querySelector('[data-photo-meal-name]').value);
 if(raw.some(name=>!name.trim()||name.normalize('NFKC').trim().length>60)){fail('Give each selected ingredient a name of 1–60 characters.');return;}
 const names=window.BBCookStudio.ingredientNames(raw);
 if(!names.length||names.length>12){fail('Choose between 1 and 12 ingredients for this meal.');return;}
 error.hidden=true;bbPhotoMealNames=Object.freeze(names);bbActiveTool='meal';
 generate();if(generateInFlight){$('#aiMeal').hidden=false;$('#generated').scrollIntoView({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?'auto':'smooth',block:'start'});}
}
function bbValidGeneratedRecipe(recipe){
 const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
 const strings=(value,maxItems,maxLength)=>Array.isArray(value)&&value.length<=maxItems&&value.every(item=>text(item,maxLength));
 return recipe&&typeof recipe==='object'&&!Array.isArray(recipe)&&text(recipe.title,160)&&text(recipe.summary,700)&&
  Number.isInteger(recipe.servings)&&recipe.servings>=1&&recipe.servings<=8&&Number.isInteger(recipe.prepMinutes)&&recipe.prepMinutes>=0&&recipe.prepMinutes<=240&&
  Number.isInteger(recipe.cookMinutes)&&recipe.cookMinutes>=1&&recipe.cookMinutes<=360&&
  Array.isArray(recipe.ingredients)&&recipe.ingredients.length>=1&&recipe.ingredients.length<=25&&
  recipe.ingredients.every(item=>item&&text(item.name,120)&&text(item.quantity,120)&&typeof item.fromHome==='boolean')&&
  strings(recipe.steps,15,600)&&recipe.steps.length>=1&&recipe.steps.every(step=>!window.BBCookMethod||text(window.BBCookMethod.normalizeStep(step,recipe),600))&&strings(recipe.extraIngredients,2,120)&&
  strings(recipe.allergens,25,120)&&strings(recipe.safetyNotes,25,400);
}
function generate(){
 bbCheckGeneratedMealAccount();
 if(generateInFlight)return;
 if(window.BBAccountDeletion?.isDeleting?.()===true){message('Finish account deletion before creating a meal.','warning');return;}
 if(bbPhotoMealMode?(!bbPhotoMealNames||bbPhotoReviewToken!==bbPaidToken()):!bb5Confirmed){message('Check and confirm your ingredients before requesting a recipe.','warning');return}
 const confirmedNames=bbPhotoMealMode?bbPhotoMealNames:null;
 const ingredients=bbPhotoMealMode?[...confirmedNames]:[...new Set(list().map(x=>String(x.name||'').trim()).filter(Boolean))];
 if(!ingredients.length){message('Select some ingredients first.','warning');return}
 if(ingredients.length>12){message('Choose up to 12 ingredients for a single AI recipe. Your saved inventory is unchanged.','warning');return}
 let preferences;try{preferences=bbMealPreferenceSnapshot();}catch(error){message(error.message,'warning');return;}
 if(preferences.servings>8){message('AI meal drafts support up to 8 servings. Review your household size in Plan before creating this draft.','warning');return;}
 const incompatible=ingredients.filter(name=>!bbMealRecipeAllowed({ingredients:[name]},preferences));
 if(incompatible.length){message('These foods do not fit your dietary preferences: '+incompatible.join(', ')+'. Remove them from this meal or update Meal preferences in Plan.','warning');return;}
 const preferenceStamp=JSON.stringify(preferences);
 const token=bbPaidToken();if(!token){message('Sign in to a verified Premium account first.','warning');return;}
 if(!confirm('Send these '+ingredients.length+' ingredient names (not stock quantities) to Cloudflare and Google Gemini for a recipe draft and an illustrative picture of the resulting meal? The draft will serve '+preferences.servings+(preferences.dietaryPreferences.length?' and follow '+preferences.dietaryPreferences.map(choice=>window.BBDietaryPreferences.LABELS[choice]).join(', '):'')+'. The picture uses the generated recipe, not your email or a personal photo. Cancel keeps everything local.'))return;
 if(bbPaidToken()!==token||window.BBAccountDeletion?.isDeleting?.()===true||(bbPhotoMealMode&&bbPhotoReviewToken!==token)){
  if(bbPhotoMealMode){bbClearPhotoMeal();$('#scanResults').textContent='Your account changed. Choose the photo again before creating a meal.';}
  else message('Your account changed. Review your ingredients again before creating a meal.','warning');
  return;
 }
 if(!bbMealPreferencesCurrent(preferenceStamp)){message('Your meal preferences changed. Review your selected foods before creating a meal.','warning');return;}
 const requestMode=bbPhotoMealMode?'only':mode,revision=++generateRevision;
 generatedView?.cancel?.();generatedView=null;window.BBMealImage?.cancelAll?.();
 generateActor=token;generatePreferenceStamp=preferenceStamp;
 const isCurrent=()=>revision===generateRevision&&generateActor===token&&bbPaidToken()===token&&(!bbPhotoMealMode||bbPhotoMealNames===confirmedNames)&&window.BBAccountDeletion?.isDeleting?.()!==true&&bbMealPreferencesCurrent(preferenceStamp);
 const btn=$('#generate');generateInFlight=true;btn.disabled=true;$('#generated').innerHTML='<p class="notice" role="status">Creating your recipe draft… Your ingredients stay as they are.</p>';
 const reviewButton=$('#reviewMealFoods button[type="submit"]');if(reviewButton)reviewButton.disabled=true;
 requestBody('generate',{ingredients,mode:requestMode==='only'?'only_have':'up_to_two',servings:preferences.servings,...(preferences.dietaryPreferences.length?{dietaryPreferences:preferences.dietaryPreferences}:{})}).then(j=>{
  if(!isCurrent()){if(revision===generateRevision&&generateActor===token)bbClearGeneratedMeal();return;}
  const r=j.recipe;if(!j.ok||!j.reviewRequired||!bbValidGeneratedRecipe(r))throw Error('Incomplete recipe response');
  if(r.servings!==preferences.servings)throw Error('AI did not use your household serving count');
  if(!bbMealRecipeAllowed(r,preferences))throw Error('AI returned a meal that does not match your dietary preferences');
  const extras=r.ingredients.filter(a=>a.fromHome===false);if(requestMode==='only'&&(extras.length||r.extraIngredients.length))throw Error('AI suggested ingredients you do not have');
  if(requestMode==='extras'&&(extras.length>2||r.extraIngredients.length>2))throw Error('AI exceeded the two-extra-ingredient rule');
  if(window.BBCookResult?.render){
   generatedView=window.BBCookResult.render($('#generated'),r,{mealImage:j.mealImage,getToken:bbPaidToken,isCurrent,onTryAgain:generate});
   return;
  }
  const duration=(Number(r.prepMinutes)||0)+(Number(r.cookMinutes)||0),steps=bbMealMethod(r).slice(0,15),allergens=Array.isArray(r.allergens)?r.allergens:[],safety=Array.isArray(r.safetyNotes)?r.safetyNotes:[];
  $('#generated').innerHTML=`<article class="generated"><div class="eyebrow" style="color:var(--green)">Unverified AI recipe · early access</div><h3>${esc(r.title||'AI meal')}</h3><p>${esc(r.servings)} servings · ${esc(bbMealDuration(duration))} estimated</p><p>${esc(r.summary||'')}</p><p class="hint">No cost estimate. This AI recipe is NOT automatically added to Planner or Shopping.</p><h4>Ingredients</h4><ul>${r.ingredients.map(a=>`<li><span data-bb-measures>${esc(bbMealQuantity(a.quantity||'Quantity unclear',a.name))}</span> ${esc(a.name||'')} · ${a.fromHome===false?'<strong>To buy</strong>':'Have (check quantity)'}</li>`).join('')}</ul><h4>Method (review for food safety)</h4><ol class="bb-recipe-method">${steps.map(bbMealStepHTML).join('')}</ol><h4>Possible allergens</h4><p>${esc(allergens.join(', ')||'Review packaged ingredients and allergens yourself')}</p><h4>Food safety reminders</h4><ul>${safety.map(s=>`<li data-bb-measures>${esc(bbMealStep(s))}</li>`).join('')||'<li>Check safe handling, storage and cooking temperatures.</li>'}</ul><div class="warning">AI-generated, not kitchen-tested or verified as safe for dietary requirements. Confirm all ingredients, allergens, quantities and cooking safety. BasketBoss never automatically adds AI drafts to the Planner.</div></article>`;
 }).catch(e=>{if(isCurrent())$('#generated').innerHTML='<div class="warning">'+esc(e.message+'. Your saved ingredients were not changed. Try again when you are ready.')+'</div>';}).finally(()=>{if(revision===generateRevision){generateInFlight=false;btn.disabled=false;if(reviewButton)reviewButton.disabled=false;}});
}
window.addEventListener('basketboss:account-deletion-started',bbClearGeneratedMeal);
window.addEventListener('basketboss:account-deletion-deleted',bbClearGeneratedMeal);
window.addEventListener('pagehide',bbClearGeneratedMeal);
window.addEventListener('basketboss:session-changed',bbCheckGeneratedMealAccount);
window.BBMealPreferences?.subscribe?.(()=>{bbCheckGeneratedMealAccount();renderRecipes();});
window.addEventListener('basketboss:account-deletion-started',()=>{if(bbPhotoMealMode)bbClearPhotoMeal();});
// One streamlined Make a Meal workspace. Keep the original controls and event hooks.
let bbActiveTool=null,bbSiteKey=null,bbTurnstileLoading=false,bbTurnstileRequired=true;
function bbChooseLocation(loc){
 if(!['cupboard','fridge','freezer'].includes(loc))return;
 for(const location of ['cupboard','fridge','freezer']){
  const section=document.querySelector('[data-location="'+location+'"]');
  if(section)section.hidden=location!==loc;
  const button=document.querySelector('[data-select-location="'+location+'"]');
  if(button)button.setAttribute('aria-pressed',String(location===loc));
 }
}
function bbOpenTool(tool){
 if(!['scan','meal'].includes(tool))return;
 const stage=$('#bbToolStage'),scanner=$('#aiScanner'),meal=$('#aiMeal');
 if(!stage||!scanner||!meal){
  const toast=$('#bbToast');
  if(toast){toast.hidden=false;toast.textContent='AI tool could not open. Reload BasketBoss and try again.';}
  return;
 }
 bbActiveTool=tool;
 stage.hidden=false;
 scanner.hidden=tool!=='scan';
 meal.hidden=tool!=='meal';
 document.querySelectorAll('[data-open-tool]').forEach(btn=>btn.setAttribute('aria-expanded',String(btn.dataset.openTool===tool)));
 if(aiEnabled&&bbSiteKey)setupHumanCheck(bbSiteKey);
 stage.scrollIntoView({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?'auto':'smooth',block:'start'});
}
function bbCloseTool(){
 const stage=$('#bbToolStage');stage.hidden=true;bbActiveTool=null;
 document.querySelectorAll('[data-open-tool]').forEach(btn=>btn.setAttribute('aria-expanded','false'));
 document.querySelector('[data-open-tool]')?.focus({preventScroll:true});
}
function bb74InstallTileStyles(){
 if(document.querySelector('#bb74MakeMealStyles'))return;
 const style=document.createElement('style');style.id='bb74MakeMealStyles';style.textContent=`
 #inventorySections [data-food].bb74-food-tile{position:relative!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:flex-start!important;gap:6px!important;min-width:0!important;min-height:153px!important;max-width:100%!important;padding:9px 6px!important;border:1px solid #cfe2d4!important;border-radius:14px!important;background:white!important;color:#194534!important;box-shadow:0 1px 3px #173d2610!important;text-align:center!important;overflow:hidden!important;line-height:1.25!important}
 #inventorySections [data-food].bb74-food-tile[aria-pressed=true]{background:#eaf7ed!important;border:2px solid #2a7c4c!important;padding:8px 5px!important;box-shadow:inset 0 0 0 1px #b1d8bc!important}
 #inventorySections [data-food].bb74-food-tile[aria-pressed=true]:after{content:'✓';position:absolute;top:4px;right:5px;background:#267348;color:#fff;border-radius:99px;min-width:20px;height:20px;display:grid;place-items:center;font-size:12px;font-weight:900}
 #inventorySections [data-food].bb74-food-tile .bb-tile-image{width:72px!important;height:72px!important;min-width:72px;min-height:72px;margin:0!important;background:#f4f6ef;border-radius:12px;display:grid!important;place-items:center!important;overflow:hidden!important;flex:none!important}
 #inventorySections [data-food].bb74-food-tile .bb-food-photo{width:100%!important;height:100%!important;object-fit:cover!important;display:block!important;aspect-ratio:1/1}
 #inventorySections [data-food].bb74-food-tile .bb-food-fallback{display:grid!important;place-items:center!important;width:100%!important;height:100%!important}
 #inventorySections [data-food].bb74-food-tile .bb-food-emoji{font-size:34px!important;line-height:1.1!important}
 #inventorySections [data-food].bb74-food-tile .bb74-tile-name{font-size:13px!important;font-weight:850!important;line-height:1.25!important;overflow-wrap:anywhere!important;display:block!important;min-height:31px}
 #inventorySections [data-food].bb74-food-tile .quantity{font-size:11px!important;color:#537067!important;font-weight:700!important;line-height:1.15!important;margin-top:auto!important;white-space:normal!important}
 #inventorySections [data-food].bb74-food-tile[aria-pressed=true] .quantity{color:#226742!important}
 #inventorySections #tiles-cupboard,#inventorySections #tiles-fridge,#inventorySections #tiles-freezer{display:grid!important;grid-template-columns:repeat(auto-fill,minmax(110px,1fr))!important;gap:9px!important}
 #bb74MealPeek{border:1px solid #b7d8c0;background:#eaf7ed;border-radius:14px;padding:13px;margin:12px 0 16px;color:#17472e;scroll-margin-top:110px}
 #bb74MealPeek .bb74-meal-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:7px;font-size:15px}
 #bb74MealPeek .bb74-meal-draft{font-size:11px;color:#47775b;font-weight:750}
 #bb74MealPeek .bb74-meal-peek-items{max-height:145px;overflow:auto;display:flex;align-items:start;align-content:start;gap:7px;flex-wrap:wrap;margin:9px 0}
 #bb74MealPeek .bb74-meal-chip{display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap;background:white;border:1px solid #c6dfce;padding:6px 8px;border-radius:9px;font-size:12px;max-width:100%}
 #bb74MealPeek .bb74-meal-chip small{font-size:11px;background:#eef5ee;padding:3px 5px;color:#44664e;border-radius:6px;font-weight:700}
 #bb74MealPeek .bb74-meal-empty{font-size:12px;color:#64816d}
 #bb74MealJump{display:block;width:100%;border:0;border-radius:11px;background:#267047;color:white;font-weight:850;min-height:46px;padding:12px;font-size:13px}
 #bb74MealJump:disabled{opacity:.45}
 #bb5MealReview{scroll-margin-top:100px}
 @media(max-width:540px){#inventorySections #tiles-cupboard,#inventorySections #tiles-fridge,#inventorySections #tiles-freezer{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:7px!important}
 #inventorySections [data-food].bb74-food-tile{min-height:145px!important;padding:8px 3px!important}
 #inventorySections [data-food].bb74-food-tile[aria-pressed=true]{padding:7px 2px!important}
 #inventorySections [data-food].bb74-food-tile .bb-tile-image{width:61px!important;height:61px!important;min-width:61px;min-height:61px}
 #inventorySections [data-food].bb74-food-tile .bb74-tile-name{font-size:11px!important;min-height:31px}
 #inventorySections [data-food].bb74-food-tile .quantity{font-size:10px!important}}
 @media(max-width:340px){#inventorySections #tiles-cupboard,#inventorySections #tiles-fridge,#inventorySections #tiles-freezer{grid-template-columns:repeat(2,minmax(0,1fr))!important}}

 /* 7.10: keep selected-food previews compact; one editable confirmation list owns quantities. */
 #bbAddedStrip,#bbScannedStrip{display:flex!important;flex-wrap:wrap!important;overflow:visible!important;max-width:100%!important;gap:7px!important;align-items:stretch!important}
 #bbAddedStrip .bb-mini-tile,#bbScannedStrip .bb-mini-tile{display:flex!important;align-items:center!important;min-height:46px!important;max-width:100%!important;width:auto!important;min-width:0!important;flex:0 1 auto!important;border:1px solid #d2e5d7!important;border-radius:10px!important;padding:4px 8px!important;background:#f9fcfa!important}
 #bbAddedStrip .bb-mini-focus,#bbScannedStrip .bb-mini-focus{display:flex!important;align-items:center!important;gap:7px!important;flex-direction:row!important;max-width:100%!important;padding:0!important;text-align:left!important}
 #bbAddedStrip .bb-mini-image,#bbScannedStrip .bb-mini-image{width:34px!important;height:34px!important;min-width:34px!important;min-height:34px!important;margin:0!important;display:grid!important;place-items:center!important;overflow:hidden!important;border-radius:8px!important}
 #bbAddedStrip .bb-mini-image img,#bbScannedStrip .bb-mini-image img{width:100%!important;height:100%!important;object-fit:cover!important}
 #bbAddedStrip .bb-mini-name,#bbScannedStrip .bb-mini-name{max-width:125px!important;font-size:11px!important;line-height:1.2!important;font-weight:750!important;white-space:normal!important;overflow-wrap:anywhere!important}
 #bbAddedStrip .bb-mini-remove,#bbScannedStrip .bb-mini-remove{position:static!important;flex:0 0 28px!important;min-width:28px!important;min-height:28px!important;display:grid!important;place-items:center!important}
 #bb5MealReview{border:2px solid #badac1!important;box-shadow:0 5px 16px #173d2612!important}
 #bb5GenerateFromReview{font-size:15px!important;letter-spacing:0!important}
 `;document.head.appendChild(style);
 document.addEventListener('error',e=>{const img=e.target;if(!(img instanceof HTMLImageElement)||!img.matches('#inventorySections .bb-food-photo'))return;const fallback=document.createElement('span');fallback.className='bb-food-fallback';const emoji=document.createElement('span');emoji.className='bb-food-emoji';emoji.textContent=bbFoodEmoji(img.closest('[data-food]')?.dataset.food||'');fallback.append(emoji);img.replaceWith(fallback)},true);
}
/* Batch 7.12: Same pick -> review -> confirm layout as Kitchen, no second pantry database. */
function bb82SyncLocationCounts(){
 for(const details of document.querySelectorAll('.bb82-ingredient-location')){
  const loc=details.dataset.bb82Loc;const count=list().filter(x=>x.loc===loc).length;
  const label=details.querySelector('.bb82-location-count');if(label)label.textContent=count+' selected';
 }
}
function bb82UnifyMealLayout(){
 const source=$('#inventorySections'),review=$('#bb5MealReview');if(!source||!review||$('#bb82MealWorkspace'))return;
 const formerDrawer=$('#bbIngredientsDrawer');
 const dashboard=$('.bb-meal-dashboard');if(!dashboard)return;
 const workspace=document.createElement('section');workspace.id='bb82MealWorkspace';
 workspace.setAttribute('aria-label','Choose foods and confirm your Make a Meal ingredients');
 workspace.innerHTML='<div class="bb82-workspace-intro"><span class="bb82-kicker">YOUR KITCHEN</span><h2>What have you got?</h2><p>Open Cupboard, Fridge or Freezer to choose ingredients. Review everything in one list below, then tap Confirm — Make a Meal.</p></div>';
 // Put the main workspace where the old added/scanned thumbnail sections were.
 const oldCards=['#bbAddedStrip','#bbScannedStrip'].map(s=>$(s)?.closest('section')).filter(Boolean);
 const anchor=oldCards[0]||formerDrawer||source;
 anchor.parentElement?.insertBefore(workspace,anchor);
 workspace.appendChild(source);
 // Keep original buttons/forms inside each existing location, only change their wrappers.
 for(const loc of ['cupboard','fridge','freezer']){
  const section=source.querySelector('[data-location="'+loc+'"]');if(!section)continue;
  section.hidden=false;
  const accord=document.createElement('details');accord.className='bb82-ingredient-location';accord.dataset.bb82Loc=loc;
  accord.open=loc==='cupboard';
  const caption={cupboard:'🥫 What is in your Cupboard?',fridge:'🥛 What is in your Fridge?',freezer:'❄️ What is in your Freezer?'}[loc];
  const summary=document.createElement('summary');summary.innerHTML='<strong>'+caption+'</strong><span class="bb82-location-count">0 selected</span>';
  section.parentNode.insertBefore(accord,section);accord.append(summary,section);
 }
 workspace.appendChild(review);
 // Hide obsolete image strips and read-only duplicates: the one review list owns quantities.
 for(const el of oldCards){if(!el.contains(workspace)){el.hidden=true;el.style.display='none';}}
 const oldPeek=$('#bb74MealPeek');if(oldPeek){oldPeek.hidden=true;oldPeek.style.display='none';}
 const oldSelected=$('#selected');if(oldSelected){oldSelected.hidden=true;oldSelected.style.display='none';}
 // Keep any advanced drawer controls, but not the duplicate three-location picker.
 if(formerDrawer){formerDrawer.hidden=true;formerDrawer.style.display='none';}
 bb82SyncLocationCounts();
 const style=document.createElement('style');style.id='bb82-makeameal-layout';style.textContent=`
 #bb82MealWorkspace{background:#fffdf9;border:1px solid #d6e5d9;border-radius:18px;padding:clamp(12px,3vw,22px);margin:15px auto 23px;max-width:1080px;color:#234e39}
 #bb82MealWorkspace .bb82-kicker{color:#398452;font-size:10px;letter-spacing:1px;font-weight:900}
 #bb82MealWorkspace h2{color:#24573e;font-size:clamp(23px,4vw,30px);margin:6px 0 4px}
 #bb82MealWorkspace .bb82-workspace-intro p{font-size:13px;line-height:1.5;color:#547364;margin:4px 0 14px}
 #bb82MealWorkspace #inventorySections{display:block!important;margin:0!important;padding:0!important;border:0!important;max-height:none!important;overflow:visible!important}
 #bb82MealWorkspace .bb82-ingredient-location{display:block!important;border:1px solid #cbded0;border-radius:13px;background:#f9fcf9;margin:8px 0;overflow:hidden}
 #bb82MealWorkspace .bb82-ingredient-location>summary{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:14px 12px;cursor:pointer;min-height:55px;color:#245b3f;list-style-position:inside}
 #bb82MealWorkspace .bb82-location-count{background:#e5f3e7;border-radius:99px;padding:5px 8px;font-size:11px;font-weight:850;white-space:nowrap}
 #bb82MealWorkspace .bb82-ingredient-location>[data-location]{display:block!important;padding:10px 12px 16px!important;background:#fff!important}
 #bb82MealWorkspace [data-select-location]{display:none!important}
 #bb82MealWorkspace #bb5MealReview{background:#f1f8f1!important;margin:20px 0 0!important;border-radius:15px!important}
 #bb82MealWorkspace #bb5MealReview h3{font-size:23px!important;color:#20543a!important;letter-spacing:.4px}
 #bb82MealWorkspace .bb82-review-category{font-size:13px;color:#276046;font-weight:900;margin:16px 0 2px;padding-top:9px;border-top:1px solid #d4e5d7}
 #bb82MealWorkspace .bb5-meal-item{grid-template-columns:minmax(115px,1fr) minmax(75px,95px) minmax(75px,95px) auto!important}
 #bb82MealWorkspace .bb5-meal-item button{min-height:42px;min-width:67px}
 #bb82MealWorkspace #bb5GenerateFromReview{font-size:15px!important;border-radius:12px!important;background:#2d7248!important}
 #bb74MealPeek,#bbAddedStrip,#bbScannedStrip{display:none!important}
 @media(max-width:570px){#bb82MealWorkspace .bb5-meal-item{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important}
 #bb82MealWorkspace .bb5-meal-item>strong{grid-column:1/-1}
 #bb82MealWorkspace .bb5-meal-item>button{grid-column:1/-1;width:100%}
 #bb82MealWorkspace .bb82-ingredient-location>summary{font-size:13px}}
 `;document.head.append(style);
}
// Batch 7.15: restore the prominent Premium AI entry points without duplicating
// the scanner, generator, inventory, entitlement checks, or request handlers.
function bb15RestorePremiumEntry(){
 const dashboard=document.querySelector('.bb-meal-dashboard'),workspace=$('#bb82MealWorkspace');
 if($('#bb15AiPremiumHub')||!workspace||!window.BBCookStudio?.mount)return;
 const hub=document.createElement('section');hub.id='bb15AiPremiumHub';
 workspace.before(hub);window.BBCookStudio.mount({hub,workspace,getIngredients:list});
 if(!bbPhotoMealMode&&dashboard)dashboard.hidden=true;
}
// Keep AI readiness tied to the CURRENT authenticated account, not the
// browser that happened to load this page earlier. Server checks are authoritative.
let bbAIStatusRequest=0,bbAIStatusFailure=null;
async function bbRefreshAIStatus(){
  const token=bbPaidToken(),requestId=++bbAIStatusRequest;
  aiEnabled=false;bbSiteKey=null;bbAIStatusFailure=null;
  const initialSecurity=$('#aiSecurityBox');if(initialSecurity)initialSecurity.hidden=true;
  $('#aiStatus').textContent=token?'Checking Premium AI availability…':'Sign in to your Premium account to use AI.';
  $('#aiHumanStatus').textContent='Human check is not ready yet.';
  if(!token)return;
  try{
    const {response,data}=await bbMealJSON('/api/bb173/status',{
      cache:'no-store',headers:{Authorization:'Bearer '+token}
    });
    if(!response.ok)throw Error('AI availability could not be checked.');
    if(requestId!==bbAIStatusRequest||bbPaidToken()!==token)return;
    aiEnabled=data?.status==='available'&&data?.premium_ai===true&&!!data?.siteKey;
    // Only authenticated entitlement-backed Live accounts receive false.
    bbTurnstileRequired=!(aiEnabled&&data.turnstileRequired===false);
    const verifyPanel=$('#aiSecurityBox');
    if(verifyPanel){
      verifyPanel.hidden=!bbTurnstileRequired;
      verifyPanel.style.removeProperty('display');
    }
    if(!bbTurnstileRequired){
      turnstileToken='';
      if(turnstileWidgetId!==null&&window.turnstile?.remove){
        try{window.turnstile.remove(turnstileWidgetId);}catch(_){}
      }
      turnstileWidgetId=null;
      bbTurnstileLoading=false;
    }
    if(aiEnabled){
      bbSiteKey=data.siteKey;
      $('#aiStatus').textContent='Premium AI is available, subject to daily limits.';
      $('#aiHumanStatus').textContent='Complete the human check to make an AI request.';
      if(bbTurnstileRequired&&!$('#bbToolStage')?.hidden)setupHumanCheck(bbSiteKey);
      return;
    }
    // The API reveals these CONFIGURATION CODES to the authenticated Owner only;
    // there are no API keys or secret values in this response.
    const descriptions={
      ai_disabled:'Premium AI enable switch is off',
      billing_disabled_owner_preview_not_authorized:'Live billing prerequisite is disabled',
      supabase_or_billing_db_missing:'Billing account/database setup is incomplete',
      gemini_secret_missing:'Gemini API key is missing',
      turnstile_secret_missing:'Turnstile secret is missing',
      turnstile_site_key_missing:'Turnstile site key is missing',
      billing_db_binding_missing:'Billing database binding is missing',
      global_daily_cap_missing_or_invalid:'BB_AI_GLOBAL_DAILY_CAP is missing or invalid'
    };
    const checks=Array.isArray(data?.checks)?data.checks:[];
    $('#aiStatus').textContent=checks.length?
      'Owner AI setup: '+checks.map(x=>descriptions[x]||'A service prerequisite is missing').join('; ')+'.':
      'AI is not available for this login. Check that your Owner/Premium membership is verified.';
    $('#aiHumanStatus').textContent='The human check cannot start until AI is available.';
  }catch(_){
    if(requestId===bbAIStatusRequest&&bbPaidToken()===token){
      bbAIStatusFailure='AI availability could not be checked. Check your connection and try again.';
      $('#aiStatus').textContent=bbAIStatusFailure;
      $('#aiHumanStatus').textContent='Human check is unavailable.';
    }
  }
}
document.addEventListener('basketboss:premium-verified',()=>{void bbRefreshAIStatus();});
window.addEventListener('focus',()=>{void bbRefreshAIStatus();});
function init(){bbObserveAIHumanPanel();bb74InstallTileStyles();if(!bbPhotoMealMode)load();document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.mode;suggestionOffset=0;document.querySelectorAll('[data-mode]').forEach(t=>t.setAttribute('aria-pressed',String(t.dataset.mode===mode)));renderRecipes()}));
// Dashboard thumbnail controls reuse the existing inventory state and save pathway.
// Keep the original synchronous click handler for the existing dashboard
// controls and the scan-result link. No async gate runs before bbOpenTool.
$('.bb-meal-dashboard').addEventListener('click',e=>{
 const opener=e.target.closest('[data-open-tool]');
 if(opener){bbOpenTool(opener.dataset.openTool);return;}
 if(e.target.closest('[data-close-tool]')){bbCloseTool();return;}
 const area=e.target.closest('[data-select-location]');
 if(area){bbChooseLocation(area.dataset.selectLocation);return;}
 const remove=e.target.closest('[data-strip-remove]');
 if(remove){const prior=inventory[remove.dataset.stripRemove];if(prior){inventory[remove.dataset.stripRemove]={...prior,selected:false};bb5Confirmed=false;renderTiles()}return;}
 const jump=e.target.closest('[data-jump-food]');if(!jump)return;
 const ingredient=inventory[jump.dataset.jumpFood];if(!ingredient)return;
 $('#bbIngredientsDrawer').open=true;
 bbChooseLocation(ingredient.loc);
 const section=document.querySelector('[data-location="'+ingredient.loc+'"]');
 section?.scrollIntoView({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?'auto':'smooth',block:'start'});
 const tile=[...(section?.querySelectorAll('[data-food]')||[])].find(t=>canon(t.dataset.food)===canon(ingredient.name));
 if(tile)setTimeout(()=>tile.focus({preventScroll:true}),250);
});
$('#inventorySections').addEventListener('click',e=>{const b=e.target.closest('[data-food]');if(b){const section=b.closest('[data-location]');if(section)setFood(b.dataset.food,null,null,section.dataset.location)}});
$('#selected').addEventListener('click',e=>{const b=e.target.closest('[data-remove]');if(b){const prior=inventory[b.dataset.remove];if(prior)inventory[b.dataset.remove]={...prior,selected:false};bb5Confirmed=false;renderTiles()}});
for(const form of document.querySelectorAll('[data-add-area]')){
 const field=form.querySelector('[data-food-name]'),unit=form.querySelector('[data-food-unit]');
 if(!field||!unit)continue;
 let manuallyChanged=false;
 unit.addEventListener('change',()=>{manuallyChanged=true});
 field.addEventListener('input',()=>{if(manuallyChanged)return;const suggestion=bb25SuggestedUnit(field.value);if([...unit.options].some(o=>o.value===suggestion))unit.value=suggestion});
 form.addEventListener('reset',()=>{manuallyChanged=false});
}
for(const form of document.querySelectorAll('[data-add-area]'))form.addEventListener('submit',e=>{e.preventDefault();const location=form.dataset.addArea;const name=form.querySelector('[data-food-name]').value.trim();if(!name)return;const raw=form.querySelector('[data-food-qty]').value;const qty=raw?Number(raw):null;const unit=form.querySelector('[data-food-unit]').value;if(raw&&(!Number.isFinite(qty)||qty<=0)){message('Enter a positive stock quantity.','warning');return}if(qty&&['each','pack','clove'].includes(unit)&&!Number.isInteger(qty)){message('Use whole numbers for each, packs or cloves.','warning');return}inventory[uid(name,location)]={...inventory[uid(name,location)],name,loc:location,selected:true,qty,unit,source:'added'};bb5Confirmed=false;renderTiles();form.reset()});
$('#ai-photo-input').addEventListener('change',e=>{
 scanRevision++;bbScanRequest?.abort();bbScanRequest=null;scanInFlight=false;$('#scanBtn').disabled=false;
 bbPhotoMealNames=null;bbPhotoReviewToken=null;bbClearGeneratedMeal();$('#aiMeal').hidden=true;
 photoFile=e.target.files?.[0]||null;bbPhotoReviewToken=photoFile?bbPaidToken():null;$('#scanResults').replaceChildren();const p=$('#photoPreview');
 if(p.dataset.url)URL.revokeObjectURL(p.dataset.url);delete p.dataset.url;p.classList.toggle('show',!!photoFile);
 $('#scanBtn').hidden=!photoFile;
 if(photoFile){p.src=p.dataset.url=URL.createObjectURL(photoFile);$('#scanResults').textContent='Photo ready. Tap “Find my ingredients” to scan.';}
 else{p.removeAttribute('src');$('#scanResults').textContent='No photo selected. Take or choose a photo to try again.';}
});
$('#ai-photo-input').addEventListener('cancel',()=>{if(!photoFile)$('#scanResults').textContent='No photo selected. Take or choose a photo to try again.';});
$('#scanBtn').addEventListener('click',scanPhoto);
$('#scanResults').addEventListener('input',e=>{
 if(!bbPhotoMealMode||!e.target.closest('#reviewMealFoods'))return;
 bbPhotoMealNames=null;bbClearGeneratedMeal();$('#aiMeal').hidden=true;
});
$('#scanResults').addEventListener('submit',e=>{
 if(e.target.id==='reviewMealFoods'){e.preventDefault();bbConfirmPhotoMeal(e.target);return;}
 if(e.target.id!=='reviewFoods')return;e.preventDefault();
 const form=e.target,err=form.querySelector('#scanSaveError');
 const checked=[...form.querySelectorAll('input[name="food"]:checked')];
 if(!checked.length){err.textContent='Tick at least one food you recognise before saving.';err.hidden=false;return;}
 const chosen=[];
 if(!scanReviewActor||scanReviewActor!==bbScanActor()||window.BasketBossVerifiedPremium?.isActive?.()!==true){err.textContent='Your account or Premium access changed. Reopen the scan before saving.';err.hidden=false;return;}
 for(const control of checked){
  const row=control.closest('.scan-result-row'),loc=row?.querySelector('[data-scan-location]')?.value;
  if(!['fridge','freezer','cupboard'].includes(loc)){
   err.textContent='Choose Fridge, Freezer or Cupboard for each selected food before saving.';err.hidden=false;row?.querySelector('[data-scan-location]')?.focus();return;
  }
  if(loc==='cupboard'&&likelyPerishable(control.value)){err.textContent='This food is perishable. Choose Fridge or Freezer after checking its packaging and storage requirements.';err.hidden=false;row?.querySelector('[data-scan-location]')?.focus();return;}
  const field=row.querySelector('[data-scan-quantity]'),raw=field?.value.trim()||'',unit=row.querySelector('[data-scan-unit]')?.value||bb25SuggestedUnit(control.value);
  if(raw&&!field.checkValidity()){err.textContent='Check the amount for '+control.value+'.';err.hidden=false;field.focus();return;}
  const packField=row.querySelector('[data-scan-pack-quantity]'),packRaw=packField?.value.trim()||'',packUnit=row.querySelector('[data-scan-pack-unit]')?.value||'';
  if((packRaw||packUnit)&&(!packRaw||!packField.checkValidity()||!packUnit)){err.textContent='Enter a valid container size and contents unit for '+control.value+'.';err.hidden=false;packField?.focus();return;}
  chosen.push({name:control.value,loc,qty:raw===''?null:Number(raw),unit,variant:row.querySelector('[data-scan-variant]')?.value||'',quantityBasis:row.querySelector('[data-scan-basis]')?.value||'',...(packRaw?{packReviewed:true,packQuantity:Number(packRaw),packUnit}:{})});
 }
 err.hidden=true;
 try{
  if(window.BBAccountDeletion?.isDeleting?.()===true)throw Error('Finish account changes before updating your pantry.');
  const deletion=JSON.parse(localStorage.getItem('basketboss_account_deletion_v1')||'null');if(['pending','deleting','deleted'].includes(deletion?.phase))throw Error('Account deletion is in progress.');
  for(const key of ['basketboss_receipt_projection_owner_v1','basketboss_receipt_host_actor_v1']){const owner=JSON.parse(localStorage.getItem(key)||'{}');if(owner.actorId&&owner.actorId!==scanReviewActor)throw Error('Open At home with this account before saving pantry amounts.');}
  const pending=JSON.parse(localStorage.getItem('basketboss_receipt_pending_confirmation_v1:'+encodeURIComponent(scanReviewActor))||'{}');if(pending.receiptId)throw Error('Finish your receipt confirmation before changing pantry amounts.');
  const api=window.BBPantryCamera;if(!api)throw Error('Pantry saving is unavailable. Reload and try again.');
  const expected=Object.fromEntries([STOCK,STORE,'basketboss_cloud_session_v1','basketboss_receipt_projection_owner_v1','basketboss_receipt_host_actor_v1','basketboss_account_deletion_v1','basketboss_receipt_pending_confirmation_v1:'+encodeURIComponent(scanReviewActor)].map(key=>[key,localStorage.getItem(key)]));
  const saved=JSON.parse(expected[STORE]||'{}'),stock=JSON.parse(expected[STOCK]||'{}');
  // Import-only rows carry an explicit snapshot of the existing stock, allowing
  // a location amount to be replaced without crediting the same stock twice.
  for(const [key,row]of Object.entries(inventory))if(row?.bb173ImportedStock&&!saved[key])saved[key]=row;
  const result=api.prepare({stock,inventory:saved,foods:chosen,uid});
  if(scanReviewActor!==bbScanActor())throw Error('Your account changed. Reopen the scan.');
  api.commit(localStorage,result,expected);inventory=result.inventory;bb5Confirmed=false;renderTiles();
  const pendingGroups=result.groups?.filter(group=>group.pending)||[],measured=result.groups?.filter(group=>!group.pending).length??chosen.filter(food=>food.qty!==null).length;
  $('#scanResults').innerHTML='<div class="success">Your reviewed foods were saved. '+(measured?measured+' confirmed food group'+(measured===1?' now updates':'s now update')+' At home and the shopping difference.':'No measured pantry amounts were changed.')+(pendingGroups.length?' <p>'+pendingGroups.length+' food group'+(pendingGroups.length===1?' needs':'s need')+' review. Existing stock was kept: '+pendingGroups.map(group=>esc(group.name)).join(', ')+'. Open its details in At home.</p>':'')+' <a class="bb-scan-pantry-return" href="index.html?bbreturn=pantry">Back to At home →</a></div>';
 }catch(error){err.textContent=String(error.message||'Your pantry could not be saved.');err.hidden=false;}

});
$('#recipes').addEventListener('click',e=>{const a=e.target.closest('[data-plan]'),more=e.target.closest('#showMoreRecipes');if(a)openMealReview(Number(a.dataset.plan));if(more){suggestionOffset=(suggestionOffset+3)%results.length;renderRecipes();}});
$('#mealReviewSave').addEventListener('click',confirmMeal);
$('#mealReviewCancel').addEventListener('click',()=>{pendingRecipe=null;$('#mealReviewError').hidden=true;});
$('#mealReview').addEventListener('close',()=>{$('#mealReviewError').hidden=true;pendingRecipe=null;});
$('#generate').addEventListener('click',generate);bbRefreshAIStatus();
if(!bbPhotoMealMode)bbMealJSON('/pwa700/recipes.json',{cache:'no-store'}).then(({response,data})=>{
  if(!response.ok)throw Error('Free recipe library unavailable');
  return data;
}).then(data=>{
  if(!Array.isArray(data)||data.length!==200||bbSecureFreeIds.size!==200||
      data.some(r=>!r?.id||!bbSecureFreeIds.has(r.id))||
      new Set(data.map(r=>r.id)).size!==200||bbPwa700Digest(JSON.stringify(data))!==BB_PWA700_RELEASE.freeRecipesSha256)
    throw Error('Free recipe catalogue integrity check failed');
  bbSecureFreeRecipes=data;
  void bbSecureRefreshPremiumRecipes();
}).catch(e=>{message(e.message,'warning');renderTiles()});
renderTiles();bb82UnifyMealLayout();bb15RestorePremiumEntry();bbInstallPantryScanHandoff();document.documentElement.classList.add('bb-cook-ready')}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
