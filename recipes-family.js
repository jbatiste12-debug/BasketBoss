// recipes-family.js — Family Favorites & Kid-Friendly Dinners (Accurately Matched Photos)
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
    image: 'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?auto=format&fit=crop&w=800&q=80', // Accurate sizzling fajitas
    familyTip: 'Roast chicken and peppers on one big tray. Put wraps, cheddar, and sour cream in the middle of the table so kids build their own.',
    method: [
      'Preheat oven to 200°C (180°C fan). Slice chicken breasts and bell peppers into thin strips.',
      'Toss chicken and peppers on a large baking tray with olive oil, fajita seasoning, salt, and pepper.',
      'Roast in the oven for 20-22 minutes until chicken is cooked through and peppers are charred at the edges.',
      'Warm tortilla wraps in the microwave for 30 seconds. Serve family-style with grated cheddar and soured cream.'
    ],
    ingredients: [
      { id: 'i1', name: 'Chicken Breast Fillets (1kg pack)', price: 8.50, category: 'Meat' },
      { id: 'i2', name: 'Mixed Bell Peppers (3-pack)', price: 2.10, category: 'Vegetables' },
      { id: 'i3', name: 'Tortilla Wraps (8-pack)', price: 1.50, category: 'Grains' },
      { id: 'i4', name: 'Soured Cream & Chive Dip', price: 1.80, category: 'Dairy' },
      { id: 'i5', name: 'Mature Cheddar Block (400g)', price: 3.90, category: 'Dairy' }
    ]
  },
  {
    id: 'fam_2',
    name: 'Crispy Fish Finger Tacos & Crunchy Slaw',
    category: 'Fun Friday • Kids Favorite',
    styleTag: 'KID-APPROVED FAVORITE',
    styleTagColor: 'bg-teal-500/20 text-teal-300 border-teal-500/40',
    isDateNight: false,
    prepTime: 15,
    estCost: 9.80,
    image: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=800&q=80', // Accurate crispy tacos
    familyTip: 'An absolute winner with kids. Bake fish fingers until super crispy and let them wrap their own tacos with shredded lettuce and mayo.',
    method: [
      'Bake jumbo fish fingers in the oven at 200°C for 15 minutes until extra crunchy.',
      'Warm mini tortilla wraps in the microwave for 20 seconds.',
      'Shred lettuce and mix with a splash of mayo and lemon juice for a quick slaw.',
      'Assemble tacos with fish fingers, lettuce, and a mild garlic mayo drizzle.'
    ],
    ingredients: [
      { id: 'i10', name: 'Jumbo Battered Fish Fingers (10-pack)', price: 4.50, category: 'Meat' },
      { id: 'i11', name: 'Mini Tortilla Wraps (8-pack)', price: 1.50, category: 'Grains' },
      { id: 'i12', name: 'Little Gem Lettuce (2-pack)', price: 1.50, category: 'Vegetables' },
      { id: 'i13', name: 'Mayonnaise Squeezy Bottle', price: 2.30, category: 'Dairy' }
    ]
  },
  {
    id: 'fam_3',
    name: 'Slow-Simmered Beef Bolognese & Garlic Bread',
    category: 'Italian • Crowd Pleaser',
    styleTag: 'FAMILY FAVORITE',
    styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    isDateNight: false,
    prepTime: 30,
    estCost: 14.80,
    image: 'https://images.unsplash.com/photo-1621996346565-e3d5d6281298?auto=format&fit=crop&w=800&q=80', // Accurate spaghetti/bolognese dish
    familyTip: 'Finely grate courgettes and carrots straight into the mince—they melt into the tomato sauce so the kids never spot them.',
    method: [
      'Brown beef mince in a large pot over medium-high heat until well browned. Drain excess fat.',
      'Add finely diced onions, minced garlic, and grated carrots & courgettes. Cook for 5 minutes until soft.',
      'Pour in chopped tomatoes, beef stock, and simmer on low for 20 minutes until rich and thick.',
      'Boil penne pasta in salted water until al dente. Bake garlic baguettes according to package instructions.'
    ],
    ingredients: [
      { id: 'i6', name: '5% Lean Beef Mince (750g family pack)', price: 7.20, category: 'Meat' },
      { id: 'i7', name: 'Penne Pasta (1kg)', price: 1.60, category: 'Grains' },
      { id: 'i8', name: 'Chopped Tomatoes (4-pack tins)', price: 2.60, category: 'Vegetables' },
      { id: 'i9', name: 'Carrots & Courgettes Pack', price: 1.80, category: 'Vegetables' },
      { id: 'i10', name: 'Garlic Baguette (Twin Pack)', price: 2.00, category: 'Bakery' }
    ]
  }
];
