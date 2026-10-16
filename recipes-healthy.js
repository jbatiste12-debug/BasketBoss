// recipes-healthy.js — Healthy & Light Midweek Meals
window.HEALTHY_RECIPES = [
  {
    id: 'hl_1',
    name: 'Honey-Glazed Salmon & Tenderstem Broccoli',
    category: 'Midweek Traybake • Healthy',
    styleTag: 'TRAYBAKE & ROAST',
    styleTagColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    isDateNight: false,
    prepTime: 20,
    estCost: 15.80,
    image: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=800&q=80',
    familyTip: 'Glazed in soy sauce, honey, and garlic. Roasts on a single sheet pan in under 20 minutes.',
    method: [
      'Place salmon fillets and tenderstem broccoli on a baking tray.',
      'Whisk soy sauce, honey, and minced garlic together, then brush generously over the salmon.',
      'Bake at 200°C for 15-18 minutes until salmon flakes easily.'
    ],
    ingredients: [
      { id: 'hl_1', name: 'Fresh Salmon Fillets (4-pack)', price: 9.50, category: 'Meat' },
      { id: 'hl_2', name: 'Tenderstem Broccoli (2 packs)', price: 3.60, category: 'Vegetables' },
      { id: 'hl_3', name: 'Honey & Soy Sauce', price: 2.70, category: 'Grains' }
    ]
  },
  {
    id: 'hl_2',
    name: 'Greek Chicken Souvlaki & Tzatziki Flatbreads',
    category: 'Mediterranean • Healthy & Fresh',
    styleTag: '15-MIN QUICK FIX',
    styleTagColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
    isDateNight: false,
    prepTime: 25,
    estCost: 14.10,
    image: 'https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?auto=format&fit=crop&w=800&q=80',
    familyTip: 'Marinate chicken in lemon, olive oil, and oregano. Serve with cucumber sticks and flatbreads.',
    method: [
      'Marinate diced chicken breast in olive oil, lemon juice, oregano, and garlic.',
      'Pan-fry or grill skewers until charred and cooked through.',
      'Serve warm in flatbreads with tzatziki sauce and crisp cucumber salad.'
    ],
    ingredients: [
      { id: 'hl_4', name: 'Chicken Breast Fillets (1kg)', price: 8.50, category: 'Meat' },
      { id: 'hl_5', name: 'Greek Flatbreads (6-pack)', price: 1.80, category: 'Bakery' },
      { id: 'hl_6', name: 'Tzatziki & Cucumbers', price: 3.80, category: 'Vegetables' }
    ]
  }
];
