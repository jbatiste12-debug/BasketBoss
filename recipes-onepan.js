// recipes-onepan.js — One-Pan Wonders & Traybakes (Accurately Matched Photos)
window.ONEPAN_RECIPES = [
  {
    id: 'op_1',
    name: 'One-Pan Creamy Garlic Parmesan Pasta Bake',
    category: 'Italian • Minimal Washing Up',
    styleTag: 'ONE-PAN WONDER',
    styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    isDateNight: false,
    prepTime: 20,
    estCost: 11.20,
    image: 'https://images.unsplash.com/photo-1633964913295-ceb43826e7c9?auto=format&fit=crop&w=800&q=80', // Accurate creamy pasta skillet
    familyTip: 'Everything cooks in a single deep frying pan or casserole dish—pasta, chicken broth, and cream cook together for maximum flavor and zero washing up.',
    method: [
      'Sauté diced chicken and minced garlic in olive oil in a large deep pan until golden.',
      'Add dry penne pasta, chicken stock, and double cream straight into the pan and bring to a simmer.',
      'Cover and simmer for 12-15 minutes until pasta absorbs liquid and is tender.',
      'Stir in grated parmesan cheese until melted and creamy. Serve straight from the pan.'
    ],
    ingredients: [
      { id: 'op_i1', name: 'Chicken Breast Fillets (500g)', price: 4.50, category: 'Meat' },
      { id: 'op_i2', name: 'Penne Pasta (500g)', price: 1.10, category: 'Grains' },
      { id: 'op_i3', name: 'Double Cream (300ml)', price: 1.80, category: 'Dairy' },
      { id: 'op_i4', name: 'Parmesan Grating Block', price: 3.80, category: 'Dairy' }
    ]
  },
  {
    id: 'op_2',
    name: 'One-Pan Sausage & Gnocchi Tomato Bake',
    category: 'Midweek Comfort • Family of 6',
    styleTag: 'ONE-PAN WONDER',
    styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    isDateNight: false,
    prepTime: 20,
    estCost: 12.50,
    image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80', // Accurate hearty skillet bake
    familyTip: 'Soft potato gnocchi cooks directly in the tomato sauce alongside sliced pork sausages. Incredible texture kids adore.',
    method: [
      'Brown sliced Cumberland sausages in a large frying pan until golden.',
      'Add a carton of passata, garlic powder, Italian herbs, and uncooked potato gnocchi straight into the pan.',
      'Simmer covered for 10 minutes until gnocchi is pillow-soft.',
      'Top with mozzarella cheese and grill for 3 minutes until bubbly and golden.'
    ],
    ingredients: [
      { id: 'op_i5', name: 'Cumberland Pork Sausages (6-pack)', price: 3.50, category: 'Meat' },
      { id: 'op_i6', name: 'Potato Gnocchi Pack (500g)', price: 1.80, category: 'Grains' },
      { id: 'op_i7', name: 'Passata with Basil (500g)', price: 1.30, category: 'Vegetables' },
      { id: 'op_i8', name: 'Mozzarella Grating Ball', price: 2.40, category: 'Dairy' }
    ]
  }
];
