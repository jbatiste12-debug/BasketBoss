// recipes-family.js — 25 Family Favorites & Weeknight Winners
window.FAMILY_RECIPES = [
  {
    id: 'fam_1',
    name: 'Sheet-Pan Chicken Fajitas & Loaded Nachos',
    category: 'Mexican • Family of 6',
    styleTag: 'TRAYBAKE & ROAST',
    styleTagColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    isDateNight: false,
    prepTime: 25,
    estCost: 16.50,
    image: 'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?auto=format&fit=crop&w=800&q=80',
    familyTip: 'Roast chicken and peppers on one big tray. Put wraps, cheddar, and sour cream in the middle of the table.',
    method: ['Preheat oven to 200°C.', 'Slice chicken and peppers.', 'Toss with oil and fajita seasoning.', 'Roast 20 mins and serve in warm wraps.'],
    ingredients: [
      { id: 'f1_1', name: 'Chicken Breast Fillets (1kg)', price: 8.50, category: 'Meat' },
      { id: 'f1_2', name: 'Mixed Bell Peppers (3-pack)', price: 2.10, category: 'Vegetables' },
      { id: 'f1_3', name: 'Tortilla Wraps (8-pack)', price: 1.50, category: 'Grains' },
      { id: 'f1_4', name: 'Soured Cream Dip', price: 1.80, category: 'Dairy' },
      { id: 'f1_5', name: 'Cheddar Block (400g)', price: 3.90, category: 'Dairy' }
    ]
  },
  {
    id: 'fam_2',
    name: 'Crispy Southern-Style Cornflake Chicken',
    category: 'Family Favorite • Friday Night',
    styleTag: 'KID-APPROVED FAVORITE',
    styleTagColor: 'bg-teal-500/20 text-teal-300 border-teal-500/40',
    isDateNight: false,
    prepTime: 25,
    estCost: 14.80,
    image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=800&q=80',
    familyTip: 'Coat chicken breasts in crushed cornflakes before baking for an incredible crunch without frying.',
    method: ['Dip chicken in egg.', 'Press into crushed cornflakes.', 'Bake at 200°C for 22 mins.', 'Serve in brioche buns.'],
    ingredients: [
      { id: 'f2_1', name: 'Chicken Breast Fillets (1kg)', price: 8.50, category: 'Meat' },
      { id: 'f2_2', name: 'Brioche Burger Buns (6-pack)', price: 2.20, category: 'Bakery' },
      { id: 'f2_3', name: 'Cornflakes Box', price: 2.30, category: 'Grains' },
      { id: 'f2_4', name: 'Coleslaw Tub', price: 1.80, category: 'Vegetables' }
    ]
  },
  {
    id: 'fam_3',
    name: 'Classic Homemade Shepherd’s Pie',
    category: 'Traditional • Family Dinner',
    styleTag: 'FAMILY FAVORITE',
    styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    isDateNight: false,
    prepTime: 40,
    estCost: 15.20,
    image: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=800&q=80',
    familyTip: 'Fluff up the potato peaks with a fork before baking so they get extra golden and crispy.',
    method: ['Brown lamb mince with carrots and stock.', 'Boil and mash potatoes.', 'Layer in dish and top with mash.', 'Bake 25 mins.'],
    ingredients: [
      { id: 'f3_1', name: 'Minced Lamb (750g)', price: 8.00, category: 'Meat' },
      { id: 'f3_2', name: 'Maris Piper Potatoes (2.5kg)', price: 2.40, category: 'Vegetables' },
      { id: 'f3_3', name: 'Carrots & Peas Pack', price: 1.80, category: 'Vegetables' },
      { id: 'f3_4', name: 'Beef Stock Cubes', price: 3.00, category: 'Grains' }
    ]
  },
  {
    id: 'fam_4',
    name: 'Loaded Beef & Cheese Quesadillas',
    category: 'Mexican Style • Quick Dinner',
    styleTag: '15-MIN QUICK FIX',
    styleTagColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
    isDateNight: false,
    prepTime: 20,
    estCost: 12.50,
    image: 'https://images.unsplash.com/photo-1618040996337-569042b85294?auto=format&fit=crop&w=800&q=80',
    familyTip: 'Slice into triangles like a pizza for hungry kids.',
    method: ['Mix spiced beef with cheese.', 'Fill wraps and fold.', 'Dry-fry until golden.', 'Serve with salsa.'],
    ingredients: [
      { id: 'f4_1', name: '5% Lean Beef Mince (500g)', price: 5.00, category: 'Meat' },
      { id: 'f4_2', name: 'Tortilla Wraps (8-pack)', price: 1.50, category: 'Grains' },
      { id: 'f4_3', name: 'Cheddar Grating Cheese', price: 3.90, category: 'Dairy' },
      { id: 'f4_4', name: 'Salsa & Guacamole Dips', price: 2.10, category: 'Vegetables' }
    ]
  },
  {
    id: 'fam_5',
    name: 'Honey Mustard Glazed Gammon & Mash',
    category: 'Traditional Sunday • Family of 6',
    styleTag: 'TRAYBAKE & ROAST',
    styleTagColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    isDateNight: false,
    prepTime: 35,
    estCost: 15.00,
    image: 'https://images.unsplash.com/photo-1514944298352-f4d732111d18?auto=format&fit=crop&w=800&q=80',
    familyTip: 'Score the gammon fat in a diamond pattern and brush with honey.',
    method: ['Boil gammon 45 mins.', 'Brush with honey and mustard.', 'Roast at 200°C for 20 mins.', 'Serve with mash.'],
    ingredients: [
      { id: 'f5_1', name: 'Gammon Joint (1.2kg)', price: 8.00, category: 'Meat' },
      { id: 'f5_2', name: 'Maris Piper Potatoes (2.5kg)', price: 2.40, category: 'Vegetables' },
      { id: 'f5_3', name: 'Honey & Mustard', price: 2.60, category: 'Grains' },
      { id: 'f5_4', name: 'Green Cabbage', price: 2.00, category: 'Vegetables' }
    ]
  },
  {
    id: 'fam_6',
    name: 'Crispy Fish Finger & Tartare Wraps',
    category: 'Midweek Quick Fix • Kids Favorite',
    styleTag: '15-MIN QUICK FIX',
    styleTagColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
    isDateNight: false,
    prepTime: 15,
    estCost: 10.50,
    image: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=800&q=80',
    familyTip: 'Bake fish fingers extra crispy in the oven.',
    method: ['Bake fish fingers 15 mins.', 'Warm wraps and spread tartare sauce.', 'Add lettuce and fish fingers.', 'Roll up tight.'],
    ingredients: [
      { id: 'f6_1', name: 'Jumbo Fish Fingers (10-pack)', price: 4.50, category: 'Meat' },
      { id: 'f6_2', name: 'Tortilla Wraps', price: 1.50, category: 'Grains' },
      { id: 'f6_3', name: 'Tartare Sauce Jar', price: 1.80, category: 'Grains' },
      { id: 'f6_4', name: 'Iceberg Lettuce', price: 2.70, category: 'Vegetables' }
    ]
  },
  {
    id: 'fam_7',
    name: 'Creamy Chicken & Mushroom Pie',
    category: 'Classic Comfort • Family Bake',
    styleTag: 'FAMILY FAVORITE',
    styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    isDateNight: false,
    prepTime: 35,
    estCost: 14.50,
    image: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=800&q=80',
    familyTip: 'Top with store-bought puff pastry for a golden crunch.',
    method: ['Sauté chicken and mushrooms.', 'Stir in cream and stock.', 'Top with puff pastry sheet.', 'Bake until golden.'],
    ingredients: [
      { id: 'f7_1', name: 'Chicken Breast (1kg)', price: 8.50, category: 'Meat' },
      { id: 'f7_2', name: 'Mushrooms & Cream', price: 3.20, category: 'Vegetables' },
      { id: 'f7_3', name: 'Ready Rolled Puff Pastry', price: 1.80, category: 'Bakery' }
    ]
  },
  {
    id: 'fam_8',
    name: 'Beef Meatball Marinara Sub Melts',
    category: 'Italian American • Friday Night',
    styleTag: 'KID-APPROVED FAVORITE',
    styleTagColor: 'bg-teal-500/20 text-teal-300 border-teal-500/40',
    isDateNight: false,
    prepTime: 20,
    estCost: 13.20,
    image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=800&q=80',
    familyTip: 'Load into sub rolls and grill with mozzarella until bubbling.',
    method: ['Brown beef meatballs in pan.', 'Simmer in tomato marinara sauce.', 'Spoon into sub rolls and top with cheese.', 'Grill until melted.'],
    ingredients: [
      { id: 'f8_1', name: 'Beef Meatballs (2 packs)', price: 6.00, category: 'Meat' },
      { id: 'f8_2', name: 'Sub Roll Baguette (4-pack)', price: 2.00, category: 'Bakery' },
      { id: 'f8_3', name: 'Marinara Sauce & Mozzarella', price: 5.20, category: 'Dairy' }
    ]
  },
  {
    id: 'fam_9',
    name: 'Honey Glazed Pork Chops & Wedges',
    category: 'Classic British • Family Meal',
    styleTag: 'TRAYBAKE & ROAST',
    styleTagColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    isDateNight: false,
    prepTime: 30,
    estCost: 13.50,
    image: 'https://images.unsplash.com/photo-1514944298352-f4d732111d18?auto=format&fit=crop&w=800&q=80',
    familyTip: 'Roast potato wedges right alongside the chops.',
    method: ['Season pork chops with honey and garlic.', 'Cut potatoes into wedges and oil.', 'Roast both at 200°C for 25 mins.'],
    ingredients: [
      { id: 'f9_1', name: 'Thick Cut Pork Chops (4-pack)', price: 6.50, category: 'Meat' },
      { id: 'f9_2', name: 'Potatoes (2.5kg)', price: 2.40, category: 'Vegetables' },
      { id: 'f9_3', name: 'Honey & Garlic Sauce', price: 4.60, category: 'Grains' }
    ]
  },
  {
    id: 'fam_10',
    name: 'Creamy Chicken & Broccoli Pasta',
    category: 'Midweek Staple • Family of 6',
    styleTag: 'ONE-PAN WONDER',
    styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    isDateNight: false,
    prepTime: 20,
    estCost: 12.00,
    image: 'https://images.unsplash.com/photo-1633964913295-ceb43826e7c9?auto=format&fit=crop&w=800&q=80',
    familyTip: 'A foolproof midweek pasta dish loaded with hidden greens.',
    method: ['Boil pasta and broccoli florets.', 'Sauté chicken in pan with garlic and cream.', 'Combine together with parmesan.'],
    ingredients: [
      { id: 'f10_1', name: 'Chicken Breast (500g)', price: 4.50, category: 'Meat' },
      { id: 'f10_2', name: 'Fusilli Pasta & Broccoli', price: 3.50, category: 'Grains' },
      { id: 'f10_3', name: 'Double Cream & Parmesan', price: 4.00, category: 'Dairy' }
    ]
  },
  { id: 'fam_11', name: 'Loaded Baked Potato Skins & Bacon', category: 'Comfort Food', styleTag: 'TRAYBAKE & ROAST', styleTagColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40', isDateNight: false, prepTime: 35, estCost: 11.00, image: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=800&q=80', familyTip: 'Crispy potato skins stuffed with bacon and melted cheddar.', method: ['Bake jackets, scoop flesh.', 'Fill with bacon and cheese.', 'Grill until crispy.'], ingredients: [{ id: 'f11_1', name: 'Baking Potatoes & Bacon', price: 11.00, category: 'Meat' }] },
  { id: 'fam_12', name: 'Classic Beef Burgers & Chips', category: 'Friday Night', styleTag: 'KID-APPROVED FAVORITE', styleTagColor: 'bg-teal-500/20 text-teal-300 border-teal-500/40', isDateNight: false, prepTime: 20, estCost: 13.00, image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=800&q=80', familyTip: 'Juicy beef patties with melted cheese.', method: ['Pan-fry beef burgers.', 'Oven-bake chips.', 'Assemble in buns.'], ingredients: [{ id: 'f12_1', name: 'Beef Burgers & Buns', price: 13.00, category: 'Meat' }] },
  { id: 'fam_13', name: 'Sweet Chilli Chicken & Rice', category: 'Quick Dinner', styleTag: '15-MIN QUICK FIX', styleTagColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40', isDateNight: false, prepTime: 15, estCost: 12.50, image: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=800&q=80', familyTip: 'Sweet sticky chicken with fluffy rice.', method: ['Stir-fry chicken strips.', 'Toss in sweet chilli sauce.', 'Serve over rice.'], ingredients: [{ id: 'f13_1', name: 'Chicken & Sweet Chilli', price: 12.50, category: 'Meat' }] },
  { id: 'fam_14', name: 'Sausage Mash & Onion Gravy', category: 'Traditional', styleTag: 'FAMILY FAVORITE', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 25, estCost: 10.50, image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80', familyTip: 'Bangers and mash smothered in rich gravy.', method: ['Bake sausages.', 'Make mash.', 'Pour onion gravy over.'], ingredients: [{ id: 'f14_1', name: 'Sausages & Potatoes', price: 10.50, category: 'Meat' }] },
  { id: 'fam_15', name: 'Creamy Tomato & Basil Chicken', category: 'Italian Style', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 13.50, image: 'https://images.unsplash.com/photo-1604908176997-125f2596f3ed?auto=format&fit=crop&w=800&q=80', familyTip: 'Chicken in a rich tomato cream sauce.', method: ['Sear chicken.', 'Add tomato and cream.', 'Simmer until thick.'], ingredients: [{ id: 'f15_1', name: 'Chicken & Tomatoes', price: 13.50, category: 'Meat' }] },
  { id: 'fam_16', name: 'Crispy Breaded Fish & Chips', category: 'Friday Special', styleTag: 'FAMILY FAVORITE', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 25, estCost: 12.00, image: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=800&q=80', familyTip: 'Oven-baked fish fillets with chunky chips.', method: ['Bake fish and chips.', 'Serve with peas and tartar.'], ingredients: [{ id: 'f16_1', name: 'Fish & Chips', price: 12.00, category: 'Meat' }] },
  { id: 'fam_17', name: 'BBQ Chicken Flatbread Pizzas', category: 'Quick Pizza', styleTag: '15-MIN QUICK FIX', styleTagColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40', isDateNight: false, prepTime: 15, estCost: 11.50, image: 'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?auto=format&fit=crop&w=800&q=80', familyTip: 'Flatbreads topped with BBQ chicken and cheese.', method: ['Top flatbreads with BBQ sauce and chicken.', 'Bake until melted.'], ingredients: [{ id: 'f17_1', name: 'Flatbreads & BBQ Chicken', price: 11.50, category: 'Bakery' }] },
  { id: 'fam_18', name: 'Beef & Vegetable Stew', category: 'Slow Burner', styleTag: 'TRAYBAKE & ROAST', styleTagColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40', isDateNight: false, prepTime: 40, estCost: 14.00, image: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=800&q=80', familyTip: 'Tender chuck steak stewed with root veg.', method: ['Simmer beef and veg in stock.'], ingredients: [{ id: 'f18_1', name: 'Stewing Beef & Veg', price: 14.00, category: 'Meat' }] },
  { id: 'fam_19', name: 'Turkey & Cheese Sliders', category: 'Party Food', styleTag: 'KID-APPROVED FAVORITE', styleTagColor: 'bg-teal-500/20 text-teal-300 border-teal-500/40', isDateNight: false, prepTime: 20, estCost: 11.00, image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=800&q=80', familyTip: 'Bitesize burgers baked in a tray.', method: ['Layer rolls with turkey and cheese.', 'Bake until warm.'], ingredients: [{ id: 'f19_1', name: 'Sliders & Turkey', price: 11.00, category: 'Bakery' }] },
  { id: 'fam_20', name: 'Creamy Garlic Mushroom Chicken', category: 'Midweek Meal', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 13.00, image: 'https://images.unsplash.com/photo-1604908176997-125f2596f3ed?auto=format&fit=crop&w=800&q=80', familyTip: 'Earthy mushrooms in garlic cream.', method: ['Pan-fry chicken and mushrooms in cream.'], ingredients: [{ id: 'f20_1', name: 'Chicken & Mushrooms', price: 13.00, category: 'Meat' }] },
  { id: 'fam_21', name: 'Spaghetti Bolognese Bake', category: 'Family Pasta', styleTag: 'FAMILY FAVORITE', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 30, estCost: 12.50, image: 'https://images.unsplash.com/photo-1633964913295-ceb43826e7c9?auto=format&fit=crop&w=800&q=80', familyTip: 'Bolognese tossed with spaghetti and cheese.', method: ['Bake pasta and sauce with cheese top.'], ingredients: [{ id: 'f21_1', name: 'Mince & Spaghetti', price: 12.50, category: 'Meat' }] },
  { id: 'fam_22', name: 'Crispy Chicken Nuggets & Sweet Potato Fries', category: 'Kids Choice', styleTag: 'KID-APPROVED FAVORITE', styleTagColor: 'bg-teal-500/20 text-teal-300 border-teal-500/40', isDateNight: false, prepTime: 20, estCost: 10.50, image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=800&q=80', familyTip: 'Homemade crispy nuggets.', method: ['Bake nuggets and fries.'], ingredients: [{ id: 'f22_1', name: 'Chicken & Sweet Potatoes', price: 10.50, category: 'Meat' }] },
  { id: 'fam_23', name: 'Lemon Herb Roast Chicken Dinner', category: 'Sunday Roast', styleTag: 'TRAYBAKE & ROAST', styleTagColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40', isDateNight: false, prepTime: 50, estCost: 16.00, image: 'https://images.unsplash.com/photo-1514944298352-f4d732111d18?auto=format&fit=crop&w=800&q=80', familyTip: 'Whole roast chicken with all the trimmings.', method: ['Roast chicken with lemon and herbs.'], ingredients: [{ id: 'f23_1', name: 'Whole Chicken & Veg', price: 16.00, category: 'Meat' }] },
  { id: 'fam_24', name: 'Pork & Apple Burgers', category: 'Weekend Grill', styleTag: 'FAMILY FAVORITE', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 12.00, image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=800&q=80', familyTip: 'Pork patties infused with sweet apple.', method: ['Pan-fry pork burgers in buns.'], ingredients: [{ id: 'f24_1', name: 'Pork Burgers', price: 12.00, category: 'Meat' }] },
  { id: 'fam_25', name: 'Cheesy Vegetable Frittata', category: 'Quick Egg Dish', styleTag: '15-MIN QUICK FIX', styleTagColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40', isDateNight: false, prepTime: 20, estCost: 9.50, image: 'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?auto=format&fit=crop&w=800&q=80', familyTip: 'Eggs baked with peppers and cheese.', method: ['Whisk eggs and pour over veggies. Bake.'], ingredients: [{ id: 'f25_1', name: 'Eggs & Veggies', price: 9.50, category: 'Dairy' }] }
];
