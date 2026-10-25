/* BasketBoss UI-NEXT v20 — one strict six-aisle taxonomy for ALL shopping screens.
   Pure, local classifier; unknown grocery foods are Cupboard/Pantry REVIEW, never Household.
   Real shelf layout may differ; user aisle overrides remain local and opt-in. */
(function(root){'use strict';
const AISLES=Object.freeze(['Produce','Meat & Fish','Dairy & Chilled','Bakery','Cupboard / Pantry','Household & Other']);
const household=/\b(?:aluminium foil|aluminum foil|foil|cling ?film|plastic wrap|bin bags?|garbage bags?|rubbish bags?|paper towels?|kitchen roll|toilet paper|toilet roll|tissues?|napkins?|serviettes?|washing[- ]up liquid|washing liquid|detergent|dishwashing|dishwasher tablets?|laundry|fabric conditioner|cleaning supplies?|cleaner|disinfectant|bleach|soap|sponges?|scourers?|refuse sacks?|kitchen towels?|baking paper|parchment paper)\b/i;
const foodException=/\b(?:fish|meat|chicken|beef|pork|sausages?|bacon|ham|tomatoes?|beans?|potatoes?|rice|pasta|milk|cheese|eggs?|fruit|vegetables?|apples?|oranges?|capers|mushrooms?|tuna|salmon|prawns?|oil|vinegar)\b/i;
const stable=/\b(?:tinned|canned|canning|tin of|can of|jarred|in (?:a )?tin|in spring water|in juice|dried|dehydrated|powder(?:ed)?|ground|spices?|seasonings?|stock(?: cubes?| pots?| powder)?|harissa|butterbeans|coffee|caramel|tomato pure|bouillon|broth|gravy|vinegars?|(?:cooking|olive|rapeseed|sunflower|sesame|vegetable) oil|oil|soy sauce|(?:chilli|bbq|tomato|fish|white|brown|pasta|teriyaki|peppercorn|sweet sour) sauce|ketchup|mustard|mayonnaise|mayo|dressing|pesto|chutney|relish|passata|purée|puree|paste|capers?|olives?|salsa|jam|marmalade|honey|syrup|molasses|sugar|salt|peppercorns?|black pepper|white pepper|paprika|cumin|coriander seeds?|cinnamon|oregano|saffron|nutmeg|chilli flakes?|chilli powder|curry powder|baking powder|bicarbonate|baking soda|vanilla extract|cocoa|cornflour|flour|breadcrumbs?|panko|lasagne|oats?|cereals?|granola|cornflakes|rice|pasta|penne|spaghetti|linguine|macaroni|fusilli|noodles?|orzo|gnocchi|couscous|quinoa|bulgur|polenta|lentils?|chickpeas?|beans?|chocolate|raisins?|dates?|apricots?|nuts?|walnuts?|peanuts?|sesame seeds?|tortilla chips|crisps?|crackers?|biscuits?|instant yeast|suet|water)\b/i;
const meat=/\b(?:sausages?|chorizo|salami|prosciutto|pancetta|bacon|gammon|ham|beef|steak|steaks|brisket|pork|porky|lamb|mutton|chicken|turkey|duck|venison|mince|minced meat|meatballs?|meat|salmon|cod|haddock|pollock|hake|tuna|fish|seafood|prawns?|shrimp|scallops?|squid|calamari|mussels?|crab|lobster|anchov(?:y|ies)|sardines?|mackerel|sea bass|fillets?|joint)\b/i;
const bakery=/\b(?:bread|breadsticks?|baguettes?|brioche|buns?|rolls?|bagels?|croissants?|pittas?|pitas?|wraps?|tortillas?|naan|flatbreads?|muffins?|crumpets?|sponge fingers?|scones?|pastry|pastries|meringue nests?|sponge fingers?|pizza bases?)\b/i;
const dairy=/\b(?:milk|cream|crème fraîche|crme frache|mascarpone|ricotta|mozzarella|cheddar|parmesan|feta|halloumi|burrata|cheese|yoghurt|yogurt|butter|eggs?|custard|ice cream|goat s cheese|soured cream|soft cheese)\b/i;
const produce=/\b(?:apples?|bananas?|oranges?|lemons?|limes?|pears?|berries?|blueberries|raspberries|strawberries|cranberries|pineapple|grapes?|avocados?|kiwis?|fruit|asparagus|aubergines?|eggplants?|beetroots?|broccoli|cauliflower|cabbage|carrots?|celery|chillis?|courgettes?|zucchini|cucumbers?|garlic|ginger|leeks?|lettuce|onions?|spring onion|peppers?|potato(?:es)?|parsnips?|pumpkin|spinach|pak choi|mushrooms?|salad|rocket|sweetcorn|peas?|edamame|squash|tomato(?:es)?|vegetables?|herbs?|parsley|basil|chives?|mint|rosemary|sage|thyme|coriander)\b/i;
function normalize(value){return String(value||'').toLowerCase().normalize('NFKC').replace(/[–—]/g,'-').replace(/[^\p{L}\p{N}\s'-]/gu,' ').replace(/\s+/g,' ').trim();}
function classify(raw){
 const n=normalize(raw);
 if(!n)return {aisle:'Cupboard / Pantry',needs_review:true,reason:'empty_name'};
 // Preserved tomato products BEFORE generic fresh tomatoes/produce.
 if(/\b(?:chopped\s+tomatoes?|tinned\s+tomatoes?|plum\s+tomatoes?|passata)\b/.test(n))return {aisle:'Cupboard / Pantry',needs_review:false,reason:'preserved_tomato'}; // bb-qa-final-five-v1768-20261025
 if(household.test(n)&&!foodException.test(n)&&!/\b(?:sponge fingers?|sponge cake)\b/.test(n))return {aisle:'Household & Other',needs_review:false,reason:'confirmed_nonfood'};
 // Non-meat tinned goods and sauces stay in cupboard. Tinned fish is also cupboard, not fresh-fish counter.
 if(/\b(?:tinned|canned|can of|tin of|in spring water|in juice)\b/.test(n))return {aisle:'Cupboard / Pantry',needs_review:false,reason:'preserved_food'};
 if(/\b(?:coconut milk|condensed milk|evaporated milk|butter beans?|peanut butter|cocoa butter|stock|broth|gravy|fish sauce|oyster sauce|tomato sauce|chicken soup|tortilla chips|bread flour|breadcrumb|cooking oil|egg noodles?|chocolate|ice lolly|sorbet)\b/.test(n))return {aisle:'Cupboard / Pantry',needs_review:false,reason:'shelf_stable_exception'};
 // Meat and fish BEFORE dairy: bacon, ham, sausages, smoked salmon all belong to meat/fish.
 if(meat.test(n)&& !/\b(?:fish sauce|chicken stock|beef stock|lamb stock|vegetable or lamb stock|meat stock|fish stock)\b/.test(n))return {aisle:'Meat & Fish',needs_review:false,reason:'meat_fish'};
 if(bakery.test(n)&& !/\b(?:breadcrumbs?|bread flour|tortilla chips|dried|pasta|couscous)\b/.test(n))return {aisle:'Bakery',needs_review:false,reason:'bakery'};
 if(/\b(?:tofu|hummus)\b/.test(n))return {aisle:'Dairy & Chilled',needs_review:true,reason:'refrigerated_food_review'};
 if(dairy.test(n))return {aisle:'Dairy & Chilled',needs_review:false,reason:'dairy_chilled'};
 // Fresh herb and fresh veg form always produce; dried herb blends go to cupboard.
 if(/\b(?:fresh (?:basil|parsley|coriander|thyme|rosemary|mint|sage|chives|dill)|fresh herbs?|green beans?|edamame|salad leaves?|rocket leaves?|fresh tomatoes?|tomatoes?|cherry tomatoes?)\b/.test(n)&& !/\b(?:tinned|canned|dried|passata|sauce|purée|puree|ketchup)\b/.test(n))return {aisle:'Produce',needs_review:false,reason:'fresh_produce'};
 if(stable.test(n))return {aisle:'Cupboard / Pantry',needs_review:false,reason:'cupboard_dry'};
 if(produce.test(n))return {aisle:'Produce',needs_review:false,reason:'produce'};
 // A few common foods need explicit treatment without accidentally classing them as non-food.
 if(/\b(?:tofu|falafel|hummus|coleslaw|ready-to-serve custard|prepared coleslaw|butternut squash|sweet potato|mashed potato|salad)\b/.test(n))return {aisle:'Produce',needs_review:true,reason:'produce_guess_review'};
 // UNKNOWN items must not drop into Household. Require editorial review.
 return {aisle:'Cupboard / Pantry',needs_review:true,reason:'unknown_food_default_review'};
}
function aisle(raw){return classify(raw).aisle;}
function isFood(raw){return aisle(raw)!=='Household & Other';}
root.BBAislesV20=Object.freeze({AISLES,normalize,classify,aisle,isFood});
})(typeof window!=='undefined'?window:globalThis);
