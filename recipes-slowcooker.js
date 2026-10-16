// recipes-slowcooker.js — Batch Cook & Slow Cooker Favorites
window.SLOWCOOKER_RECIPES = [
  {
    id: 'sc_1',
    name: 'Smoky BBQ Pulled Pork Buns & Slaw',
    category: 'Slow Cooker • Family Feast',
    styleTag: 'TRAYBAKE & ROAST',
    styleTagColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    isDateNight: false,
    prepTime: 15,
    estCost: 14.50,
    image: 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=800&q=80',
    familyTip: 'Put pork shoulder in the slow cooker in the morning with BBQ sauce; by dinner time, it shreds effortlessly into soft brioche buns.',
    method: [
      'Place pork shoulder joint in the slow cooker with chopped onions and a bottle of smoky BBQ sauce.',
      'Cook on low for 7-8 hours. Remove and shred easily using two forks.',
      'Serve piled high in soft brioche buns with crunchy coleslaw.'
    ],
    ingredients: [
      { id: 'sc_1', name: 'Pork Shoulder Joint (1.2kg)', price: 7.50, category: 'Meat' },
      { id: 'sc_2', name: 'Brioche Burger Buns (6-pack)', price: 2.20, category: 'Bakery' },
      { id: 'sc_3', name: 'Coleslaw Kit & BBQ Sauce', price: 4.80, category: 'Vegetables' }
    ]
  },
  {
    id: 'sc_2',
    name: 'Hearty Beef & Three Bean Chilli Bowl',
    category: 'Batch Cook • Zero Waste',
    styleTag: 'ONE-PAN WONDER',
    styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    isDateNight: false,
    prepTime: 25,
    estCost: 14.30,
    image: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=800&q=80',
    familyTip: 'Batch cook this hearty chilli; leftovers taste even better the next day wrapped in burritos.',
    method: [
      'Brown beef mince in a large pot with diced onions and garlic.',
      'Add cumin, smoked paprika, chilli powder, chopped tomatoes, and rinsed kidney beans.',
      'Simmer on low heat for 25 minutes until rich and thick.',
      'Serve over fluffy boiled long-grain rice with a dollop of sour cream.'
    ],
    ingredients: [
      { id: 'sc_4', name: '5% Lean Beef Mince (750g)', price: 7.20, category: 'Meat' },
      { id: 'sc_5', name: 'Mixed Beans & Chopped Tomatoes', price: 3.50, category: 'Vegetables' },
      { id: 'sc_6', name: 'Long Grain Rice (1kg)', price: 3.60, category: 'Grains' }
    ]
  },
  {
    id: 'sc_3',
    name: 'Classic Cottage Pie with Root Veg Mash',
    category: 'Traditional • Family Favorite',
    styleTag: 'FAMILY FAVORITE',
    styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    isDateNight: false,
    prepTime: 40,
    estCost: 15.20,
    image: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=800&q=80',
    familyTip: 'Blend a parsnip in with the potato mash for a subtle sweet flavor kids love. Great for batch-cooking.',
    method: [
      'Brown beef mince with diced onions, carrots, and beef stock until thick and rich.',
      'Boil Maris Piper potatoes and parsnips until tender, then mash with butter and milk.',
      'Layer mince in a baking dish, top with mash, and bake at 200°C for 25 minutes until golden.'
    ],
    ingredients: [
      { id: 'sc_7', name: 'Beef Mince (750g family pack)', price: 7.20, category: 'Meat' },
      { id: 'sc_8', name: 'Maris Piper Potatoes (2.5kg bag)', price: 2.40, category: 'Vegetables' },
      { id: 'sc_9', name: 'Carrots & Parsnips Pack', price: 2.10, category: 'Vegetables' },
      { id: 'sc_10', name: 'Gravy Granules & Stock Cubes', price: 3.50, category: 'Grains' }
    ]
  }
];
